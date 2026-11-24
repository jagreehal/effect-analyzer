import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from "node:fs"
import { dirname, join, resolve, sep } from "node:path"
import { describe, expect, it } from "vitest"

const REPO_ROOT = resolve(__dirname, "..")

/**
 * A floating Effect — `floatingEffect` is on by default, so this fires without
 * any per-rule configuration.
 */
const SOURCE = `import { Effect } from 'effect';

export const program = Effect.gen(function* () {
  Effect.succeed(1);
  return yield* Effect.succeed(2);
});
`

const TSCONFIG = {
  compilerOptions: {
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "bundler",
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    plugins: [{ name: "@effect/language-service" }]
  },
  include: ["src/**/*.ts"]
}

interface Finding {
  readonly rule: string
  readonly filePath: string
  readonly line: number
  readonly code?: number
  readonly source?: string
  readonly severity?: string
}

/**
 * The temp project lives inside the package so `effect`, `typescript` and
 * `@effect/tsgo` resolve through the normal parent-directory walk.
 */
const withProject = (
  fn: (dir: string, tsconfig: string) => void,
  diagnosticSeverity?: Record<string, string>
) => {
  const root = mkdtempSync(join(REPO_ROOT, ".tmp-tsgo-cli-"))
  try {
    mkdirSync(join(root, "src"), { recursive: true })
    writeFileSync(join(root, "src", "program.ts"), SOURCE, "utf8")
    const tsconfig = join(root, "tsconfig.json")
    const plugin = diagnosticSeverity
      ? { name: "@effect/language-service", diagnosticSeverity }
      : { name: "@effect/language-service" }
    writeFileSync(
      tsconfig,
      JSON.stringify(
        { ...TSCONFIG, compilerOptions: { ...TSCONFIG.compilerOptions, plugins: [plugin] } },
        null,
        2
      ),
      "utf8"
    )
    fn(join(root, "src"), tsconfig)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const runLint = (args: ReadonlyArray<string>) =>
  spawnSync(process.execPath, ["dist/cli.js", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  })

const parseFindings = (stdout: string): ReadonlyArray<Finding> => {
  const start = stdout.indexOf("{")
  const parsed = JSON.parse(stdout.slice(start)) as { data?: ReadonlyArray<Finding> }
  return parsed.data ?? []
}

describe("cli --lint-source --tsgo", () => {
  it("merges type-aware tsgo diagnostics into the findings", () => {
    withProject((srcDir, tsconfig) => {
      const result = runLint([srcDir, "--lint-source", "--tsgo", tsconfig])
      expect(result.status).toBe(0)

      const findings = parseFindings(result.stdout)
      const floating = findings.find((f) => f.rule === "floatingEffect")

      // Regression guard: the bridge originally passed no --lspconfig, and
      // `effect-tsgo diagnostics` does not read plugin options from tsconfig,
      // so it reported filesChecked: 0 and this was silently always undefined.
      expect(floating).toBeDefined()
      expect(floating?.filePath).toMatch(/program\.ts$/)
      expect(floating?.line).toBe(4)
    })
  })

  it("tells language-service findings apart from the analyzer’s own", () => {
    withProject((srcDir, tsconfig) => {
      const findings = parseFindings(
        runLint([srcDir, "--lint-source", "--tsgo", tsconfig, "--enable-rule", "barrel-import-from-effect"]).stdout
      )

      const floating = findings.find((f) => f.rule === "floatingEffect")
      expect(floating?.source).toBe("tsgo")
      // Effect language service diagnostics occupy the 377xxx code range, so an
      // agent can prove a finding is advisory rather than a type-checker error.
      expect(floating?.code).toBeGreaterThanOrEqual(377_000)
      expect(floating?.code).toBeLessThan(378_000)

      const builtIn = findings.find((f) => f.rule === "barrel-import-from-effect")
      expect(builtIn?.source).toBe("analyzer")
      expect(builtIn?.code).toBeUndefined()
    })
  })

  it("reports only the built-in rules with --no-tsgo", () => {
    withProject((srcDir) => {
      const result = runLint([srcDir, "--lint-source", "--no-tsgo", "--enable-rule", "barrel-import-from-effect"])
      expect(result.status).toBe(0)

      const rules = new Set(parseFindings(result.stdout).map((f) => f.rule))
      expect(rules.has("floatingEffect")).toBe(false)
      // ...but the source linter still runs.
      expect(rules.has("barrel-import-from-effect")).toBe(true)
    })
  })
})

describe("cli --lint-source --fail-on", () => {
  it("leaves the exit status alone when no gate is requested", () => {
    withProject(
      (srcDir, tsconfig) => {
        const result = runLint([srcDir, "--lint-source", "--tsgo", tsconfig])
        // Advisory-only runs must not change the exit status, even with an
        // error-severity diagnostic present, or agents cannot tell an advisory
        // run apart from a broken one.
        expect(result.status).toBe(0)
        const severities = parseFindings(result.stdout).map((f) => f.severity)
        expect(severities).toContain("error")
      },
      { floatingEffect: "error" }
    )
  })

  it("exits 1 when a finding reaches the requested severity", () => {
    withProject(
      (srcDir, tsconfig) => {
        const result = runLint([srcDir, "--lint-source", "--tsgo", tsconfig, "--fail-on=error"])
        expect(result.status).toBe(1)
      },
      { floatingEffect: "error" }
    )
  })

  it("exits 0 when every finding is below the requested severity", () => {
    withProject(
      (srcDir, tsconfig) => {
        const result = runLint([srcDir, "--lint-source", "--tsgo", tsconfig, "--fail-on=error"])
        expect(result.status).toBe(0)
      },
      { floatingEffect: "warning" }
    )
  })
})

describe("cli --lint-source --tsgo coverage", () => {
  /** A project where the tsconfig covers `src/` but not `extra/`. */
  const withPartialProject = (fn: (root: string, tsconfig: string) => void) => {
    const root = mkdtempSync(join(REPO_ROOT, ".tmp-tsgo-cov-"))
    try {
      mkdirSync(join(root, "src"), { recursive: true })
      mkdirSync(join(root, "extra"), { recursive: true })
      writeFileSync(join(root, "src", "program.ts"), SOURCE, "utf8")
      writeFileSync(join(root, "extra", "other.ts"), SOURCE, "utf8")
      const tsconfig = join(root, "tsconfig.json")
      writeFileSync(tsconfig, JSON.stringify(TSCONFIG, null, 2), "utf8")
      fn(root, tsconfig)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  it("reports which scanned files the language service never checked", () => {
    withPartialProject((root, tsconfig) => {
      const result = runLint([root, "--lint-source", "--tsgo", tsconfig])
      const start = result.stdout.indexOf("{")
      const envelope = JSON.parse(result.stdout.slice(start)) as {
        summary?: { tsgo?: { filesChecked?: number; unchecked?: ReadonlyArray<string> } }
      }

      // extra/other.ts is linted by our AST rules but outside the tsconfig, so
      // its tsgo diagnostics silently never existed. A partial check must not
      // be reportable as a full one.
      expect(envelope.summary?.tsgo?.filesChecked).toBe(1)
      expect(envelope.summary?.tsgo?.unchecked).toEqual([
        join(root, "extra", "other.ts")
      ])
    })
  })
})

/**
 * An Effect that is never run and a `yield` without its star, in a project with no
 * Effect language service setup.
 */
describe("cli without any Effect language service setup", () => {
  const UNYIELDED = `import { Effect } from "effect"

const findUser = (name: string) => Effect.succeed({ name })

export const syncUsers = Effect.fn("syncUsers")(
  function* (names: ReadonlyArray<string>) {
    for (const name of names) {
      findUser(name)
    }
    yield Effect.logInfo("synced", names.length)
  },
)
`
  const { plugins: _plugins, ...compilerOptions } = TSCONFIG.compilerOptions
  // Not `tmpdir()`: vitest.setup.ts points that inside the repo, where a parent
  // directory supplies both TypeScript and effect.
  const OUTSIDE = join(sep, "tmp")
  const RULES = ["floatingEffect", "missingStarInYieldEffectGen"]

  const withUnconfigured = (parent: string, fn: (root: string) => void) => {
    // realpath: macOS symlinks /tmp, and tsgo reports real paths.
    const root = realpathSync(mkdtempSync(join(parent, ".tmp-tsgo-bare-")))
    try {
      mkdirSync(join(root, "src"), { recursive: true })
      writeFileSync(join(root, "src", "sync-users.ts"), UNYIELDED, "utf8")
      writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ ...TSCONFIG, compilerOptions }), "utf8")
      fn(root)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  it("--lint-source reports both and gates on them", () => {
    withUnconfigured(REPO_ROOT, (root) => {
      const auto = runLint([join(root, "src"), "--lint-source", "--fail-on=error"])
      expect(parseFindings(auto.stdout).map((f) => f.rule)).toEqual(RULES)
      expect(auto.status).toBe(1)

      const explicit = runLint([
        join(root, "src"),
        "--lint-source",
        `--tsgo=${join(root, "tsconfig.json")}`,
        "--fail-on=error"
      ])
      expect(parseFindings(explicit.stdout).map((f) => f.rule)).toEqual(RULES)
      expect(explicit.status).toBe(1)
    })
  })

  it.each(["file", "directory"])("a plain %s run warns on stderr and leaves stdout alone", (kind) => {
    withUnconfigured(REPO_ROOT, (root) => {
      const target = kind === "file" ? join(root, "src", "sync-users.ts") : join(root, "src")
      const result = runLint([target, "--no-colocate"])
      expect(result.status).toBe(0)
      expect(result.stderr).toContain("sync-users.ts:8:7 - error floatingEffect")
      expect(result.stderr).toContain("sync-users.ts:10:5 - error missingStarInYieldEffectGen")
      expect(result.stdout).not.toContain("floatingEffect")

      const off = runLint([target, "--no-colocate", "--no-tsgo"])
      expect(off.stderr).not.toContain("floatingEffect")
    })
  })

  it("a directory run covers files that have no program to draw", () => {
    withUnconfigured(REPO_ROOT, (root) => {
      const file = join(root, "src", "sync-users.ts")
      writeFileSync(file, "import { Effect } from \"effect\"\nEffect.succeed(1)\n", "utf8")
      const result = runLint([join(root, "src"), "--no-colocate"])
      expect(result.stdout).toContain("No Effect programs found")
      expect(result.stderr).toContain("sync-users.ts:2:1 - error floatingEffect")
    })
  })

  it("--agent-report ranks them", () => {
    withUnconfigured(REPO_ROOT, (root) => {
      const result = runLint([join(root, "src"), "--agent-report"])
      for (const rule of RULES) expect(result.stdout).toContain(rule)
    })
  })

  it.each(["json", "text", "pretty", "github-actions"])(
    "diagnostics --format %s reports both and exits 1",
    (format) => {
      withUnconfigured(REPO_ROOT, (root) => {
        const result = runLint(["diagnostics", "--project", join(root, "tsconfig.json"), "--format", format])
        for (const rule of RULES) expect(result.stdout).toContain(rule)
        expect(result.stdout).not.toContain("Skipped")
        expect(result.status).toBe(1)
      })
    }
  )

  it("falls back to the bundled TypeScript when the project has none", () => {
    withUnconfigured(OUTSIDE, (root) => {
      mkdirSync(join(root, "node_modules"))
      symlinkSync(realpathSync(join(REPO_ROOT, "node_modules", "effect")), join(root, "node_modules", "effect"), "dir")
      const lint = runLint([join(root, "src"), "--lint-source"])
      expect(parseFindings(lint.stdout).map((f) => f.rule)).toEqual(RULES)

      // Relative paths still mean the caller's directory, not the fallback's.
      const diagnostics = spawnSync(
        process.execPath,
        [join(REPO_ROOT, "dist/cli.js"), "diagnostics", "--project", "tsconfig.json", "--format=text"],
        { cwd: root, encoding: "utf8" }
      )
      for (const rule of RULES) expect(diagnostics.stdout).toContain(rule)
    })
  })

  it("does not call files clean when effect is not installed", () => {
    withUnconfigured(OUTSIDE, (root) => {
      for (const flags of [[], [`--tsgo=${join(root, "tsconfig.json")}`]]) {
        const result = runLint([join(root, "src"), "--lint-source", ...flags])
        const envelope = JSON.parse(result.stdout) as {
          summary: {
            tsgo: { filesChecked: number; unchecked: ReadonlyArray<string>; skipped?: ReadonlyArray<string> }
          }
        }
        expect(envelope.summary.tsgo.filesChecked).toBe(0)
        expect(envelope.summary.tsgo.unchecked).toEqual([join(root, "src", "sync-users.ts")])
        expect(envelope.summary.tsgo.skipped?.join()).toContain("the effect package could not be resolved")
        expect(result.stderr).toContain("the effect package could not be resolved")
      }
    })
  })

  it("checks each package of a monorepo under its own configuration", () => {
    withUnconfigured(REPO_ROOT, (root) => {
      mkdirSync(join(root, "configured", "src"), { recursive: true })
      writeFileSync(join(root, "configured", "src", "sync-users.ts"), UNYIELDED, "utf8")
      writeFileSync(
        join(root, "configured", "tsconfig.json"),
        JSON.stringify({
          ...TSCONFIG,
          compilerOptions: {
            ...compilerOptions,
            plugins: [{ name: "@effect/language-service", diagnosticSeverity: { floatingEffect: "off" } }]
          }
        }),
        "utf8"
      )
      const findings = parseFindings(runLint([root, "--lint-source"]).stdout)
      const rulesIn = (path: string) => findings.filter((f) => f.filePath.startsWith(path)).map((f) => f.rule)
      expect(rulesIn(join(root, "src"))).toEqual(RULES)
      expect(rulesIn(join(root, "configured"))).toEqual(["missingStarInYieldEffectGen"])
    })
  })

  it.each(["error", "off"])(
    "a nested configuration with %s wins over one around it that includes its files",
    (nested) => {
      withUnconfigured(REPO_ROOT, (root) => {
        const put = (dir: string, floatingEffect: string) => {
          // Sorted before the nested project, so that the configuration around it is found first.
          mkdirSync(join(root, dir, "a"), { recursive: true })
          writeFileSync(join(root, dir, "a", "sync-users.ts"), UNYIELDED, "utf8")
          writeFileSync(
            join(root, dir, "tsconfig.json"),
            JSON.stringify({
              compilerOptions: {
                ...compilerOptions,
                plugins: [{ name: "@effect/language-service", diagnosticSeverity: { floatingEffect } }]
              },
              include: ["**/*.ts"],
              exclude: ["excluded"]
            }),
            "utf8"
          )
        }
        put(".", nested === "off" ? "error" : "off")
        put("nested", nested)
        // Not in the nested project, so left to the one around it.
        mkdirSync(join(root, "nested", "excluded"))
        writeFileSync(join(root, "nested", "excluded", "sync-users.ts"), UNYIELDED, "utf8")

        const floatingIn = (path: string) =>
          parseFindings(runLint([path, "--lint-source"]).stdout)
            .filter((f) => f.rule === "floatingEffect")
            .map((f) => [f.filePath, f.severity])
        const inNested = [[join(root, "nested", "a", "sync-users.ts"), "error"]]
        const around = ["a", "nested/excluded", "src"].map((dir) => [join(root, dir, "sync-users.ts"), "error"])
        expect(floatingIn(root)).toEqual(nested === "off" ? around : inNested)
        expect(floatingIn(join(root, "nested", "a", "sync-users.ts"))).toEqual(nested === "off" ? [] : inNested)
      })
    }
  )

  it("leaves a file its nearest configuration excludes to one around it, wherever the scan starts", () => {
    withUnconfigured(REPO_ROOT, (root) => {
      const configure = (dir: string, floatingEffect: string, include: string) =>
        writeFileSync(
          join(root, dir, "tsconfig.json"),
          JSON.stringify({
            compilerOptions: {
              ...compilerOptions,
              plugins: [{ name: "@effect/language-service", diagnosticSeverity: { floatingEffect } }]
            },
            include: [include]
          }),
          "utf8"
        )
      const excluded = join(root, "nested", "excluded")
      const scans = ["", "nested", "nested/excluded", "nested/excluded/one.ts"].map((path) => join(root, path))
      for (const dir of ["nested/src", "nested/excluded"]) mkdirSync(join(root, dir), { recursive: true })
      for (const path of ["src/a.ts", "excluded/one.ts", "excluded/two.ts"]) {
        writeFileSync(join(root, "nested", path), UNYIELDED, "utf8")
      }
      configure("nested", "off", "src")
      // Not the default severity, so it is this configuration's.
      configure(".", "warning", "**/*.ts")
      const found = (path: string) =>
        parseFindings(runLint([path, "--lint-source"]).stdout)
          .filter((f) => f.rule === "floatingEffect" && f.filePath.startsWith(excluded))
          .map((f) => [f.filePath, f.severity])
      const one = [join(excluded, "one.ts"), "warning"]
      const two = [join(excluded, "two.ts"), "warning"]
      expect(scans.map(found)).toEqual([[one, two], [one, two], [one, two], [one]])
    })
  })

  it.each([["extends", []], ["references an extension of", []], ["does not extend", ["floatingEffect"]]])(
    "does not take a configuration a nearer one %s for a project of its own",
    (relation, rules) => {
      withUnconfigured(REPO_ROOT, (root) => {
        mkdirSync(join(root, "nested", "excluded"), { recursive: true })
        writeFileSync(join(root, "nested", "excluded", "sync-users.ts"), UNYIELDED, "utf8")
        writeFileSync(join(root, "nested", "included.ts"), "export const included = 1\n", "utf8")
        // Neither `files` nor `include`, so everything around it.
        writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions }), "utf8")
        writeFileSync(
          join(root, "nested", "tsconfig.json"),
          JSON.stringify({
            ...(relation === "does not extend" ? { compilerOptions } : { extends: "../tsconfig.json" }),
            include: ["included.ts"]
          }),
          "utf8"
        )
        if (relation.startsWith("references")) {
          renameSync(join(root, "nested", "tsconfig.json"), join(root, "nested", "tsconfig.app.json"))
          writeFileSync(
            join(root, "nested", "tsconfig.json"),
            JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }] }),
            "utf8"
          )
        }
        const findings = parseFindings(runLint([join(root, "nested"), "--lint-source"]).stdout)
        expect(findings.map((f) => f.rule).filter((rule) => rule === "floatingEffect")).toEqual(rules)
      })
    }
  )

  /** A repository outside this one, with effect installed and `files` committed as base. */
  const withRepository = (
    files: Record<string, string>,
    fn: (
      root: string,
      change: (files: Record<string, string>, args?: ReadonlyArray<string>, tmp?: string) => {
        status: number | null
        newFindings: ReadonlyArray<{ rule: string; line: number; severity: string; file: string }>
        typeAwareSkipped: ReadonlyArray<string>
      }
    ) => void
  ) => {
    withUnconfigured(OUTSIDE, (root) => {
      const put = (entries: Record<string, string>) => {
        for (const [path, text] of Object.entries(entries)) {
          mkdirSync(dirname(join(root, path)), { recursive: true })
          writeFileSync(join(root, path), text, "utf8")
        }
      }
      const git = (...args: Array<string>) => {
        const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@e.com", ...args], {
          cwd: root,
          encoding: "utf8"
        })
        expect(r.status, r.stderr).toBe(0)
      }
      mkdirSync(join(root, "node_modules"))
      symlinkSync(realpathSync(join(REPO_ROOT, "node_modules", "effect")), join(root, "node_modules", "effect"), "dir")
      put({ ".gitignore": "node_modules\ngenerated.ts\n", ...files })
      git("init", "-q")
      git("add", ".")
      git("commit", "-qm", "base")
      fn(root, (changes, args = ["--base", "HEAD"], tmp = OUTSIDE) => {
        put(changes)
        const r = spawnSync(
          process.execPath,
          [join(REPO_ROOT, "dist/cli.js"), "review", ...args, "--format", "json", "--fail-on-regression"],
          { cwd: root, encoding: "utf8", env: { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp } }
        )
        return { ...JSON.parse(r.stdout), status: r.status }
      })
    })
  }
  const SYNC_USERS = "src/sync-users.ts"
  const INDENTED = UNYIELDED.replace("      findUser(", "        findUser(")

  it("review does not call a reformatted finding new", () => {
    withRepository({}, (root, change) => {
      const reformatted = change({ [SYNC_USERS]: INDENTED })
      expect(reformatted.newFindings).toEqual([])
      expect(reformatted.typeAwareSkipped).toEqual([])
      expect(reformatted.status).toBe(0)

      // A second floating call beside the reformatted one is new, and only one is.
      const added = change({
        [SYNC_USERS]: UNYIELDED.replace(
          "      findUser(name)",
          "        findUser(name)\n        findUser(name)"
        )
      })
      expect(added.newFindings.map((f) => f.rule)).toEqual(["floatingEffect"])
      expect(added.status).toBe(1)

      // Neither the checkout nor its index is disturbed by reading base.
      const status = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" })
      expect(status.stdout).toBe(` M ${SYNC_USERS}\n`)
    })
  })

  it("review resolves workspace packages to their base source", () => {
    const util = (body: string) =>
      `import { Effect } from "effect"\nexport const save = (n: number) => ${body}\nexport const E = Effect\n`
    const app = (n: number) =>
      `import { Effect } from "effect"
import { save } from "@w/util"

export const program = Effect.gen(function*() {
  save(${String(n)})
  yield* Effect.log("saved")
})
`
    withRepository({
      "packages/util/package.json": JSON.stringify({ name: "@w/util", type: "module", exports: "./index.ts" }),
      "packages/util/tsconfig.json": JSON.stringify({ compilerOptions, include: ["*.ts"] }),
      "packages/util/index.ts": util("n"),
      [SYNC_USERS]: app(1)
    }, (root, change) => {
      mkdirSync(join(root, "node_modules", "@w"))
      symlinkSync(join(root, "packages", "util"), join(root, "node_modules", "@w", "util"), "dir")
      // At head the helper is an Effect, so the same call no longer runs it.
      const report = change({ "packages/util/index.ts": util("Effect.succeed(n)"), [SYNC_USERS]: app(2) })
      expect(report.newFindings.map((f) => [f.file, f.rule])).toEqual([[SYNC_USERS, "floatingEffect"]])
      expect(report.typeAwareSkipped).toEqual([])
      expect(report.status).toBe(1)
    })
  })

  it("review reads base configuration whatever it is called", () => {
    const source = UNYIELDED.replace(
      "const findUser = (name: string) => Effect.succeed({ name })",
      "import { findUser } from \"~/packument\""
    )
    withRepository({
      "tsconfig.json": JSON.stringify({ extends: "./tsconfig.base.jsonc", include: ["src/**/*.ts"] }),
      "tsconfig.base.jsonc": `// shared\n${
        JSON.stringify({ compilerOptions: { ...compilerOptions, paths: { "~/*": ["./src/*"] } } })
      }`,
      "src/packument.ts":
        "import { Effect } from \"effect\"\nexport const findUser = (name: string) => Effect.succeed({ name })\n",
      [SYNC_USERS]: source
    }, (_root, change) => {
      const report = change({ [SYNC_USERS]: source.replace("      findUser(", "        findUser(") })
      expect(report.newFindings).toEqual([])
      expect(report.typeAwareSkipped).toEqual([])
      expect(report.status).toBe(0)
    })
  })

  it("review does not mind an upgraded package that only others import", () => {
    withRepository({
      "package.json": manifest("1.0.0"),
      "src/other.ts": "import { save } from \"helper\"\nexport const program = save(1)\n",
      [SYNC_USERS]: UNYIELDED
    }, (root, change) => {
      installHelper(root, "2.0.0")
      // Its types are Effects, and so lead to the globals that effect's do.
      const report = change({ "package.json": manifest("2.0.0"), [SYNC_USERS]: INDENTED })
      expect(report.newFindings).toEqual([])
      expect(report.typeAwareSkipped).toEqual([])
    })
  })

  it.each([["no globals", []], ["globals", ["floatingEffect"]]])(
    "review minds a module outside git that only others import if it adds %s",
    (adds, rules) => {
      withRepository({
        "src/other.ts": "import \"./generated.js\"\n",
        "src/generated.ts": "import { Effect } from \"effect\"\nexport const unused = Effect.void\n" +
          (adds === "globals" ? "import \"globals\"\n" : ""),
        "package.json": JSON.stringify({ dependencies: { globals: "1.0.0" } }),
        [SYNC_USERS]: UNYIELDED
      }, (root, change) => {
        const globals = join(root, "node_modules", "globals")
        mkdirSync(globals)
        writeFileSync(
          join(globals, "package.json"),
          JSON.stringify({ name: "globals", version: "1.0.0", types: "./index.d.ts" })
        )
        writeFileSync(join(globals, "index.d.ts"), "declare global {\n  const anything: number\n}\nexport {}\n")
        const report = change({ [SYNC_USERS]: INDENTED })
        expect(report.newFindings.map((f) => f.rule)).toEqual(rules)
        expect(report.typeAwareSkipped.length).toBe(rules.length)
      })
    }
  )

  it.each([["node_modules"], ["node_modules/@scope"]])("review links nothing through a tracked %s", (linked) => {
    const victim = realpathSync(mkdtempSync(join(OUTSIDE, ".tmp-tsgo-around-")))
    const stale = join(victim, "effect-analyzer-ref-stale")
    const recent = join(victim, "effect-analyzer-ref-recent")
    try {
      withRepository({ [SYNC_USERS]: "export {}\n" }, (root, change) => {
        const git = (...args: Array<string>) =>
          spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@e.com", ...args], { cwd: root })
        const target = join(victim, "target")
        mkdirSync(target)
        const id = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: root, input: target, encoding: "utf8" })
        git("update-index", "--add", "--cacheinfo", `120000,${id.stdout.trim()},${linked}`)
        git("commit", "-qm", "link")
        mkdirSync(join(root, "node_modules", "@scope", "pkg"), { recursive: true })
        for (const dir of [stale, recent]) mkdirSync(dir)
        utimesSync(stale, 0, 0)
        writeFileSync(join(root, SYNC_USERS), UNYIELDED, "utf8")
        git("add", SYNC_USERS)
        git("commit", "-qm", "head")
        change({}, ["--base", "HEAD~1", "--head", "HEAD"], victim)
        expect(readdirSync(target)).toEqual([])
        expect(existsSync(stale)).toBe(false)
        expect(existsSync(recent)).toBe(true)
      })
    } finally {
      rmSync(victim, { recursive: true, force: true })
    }
  })

  it.each([[[]], [["--head", "HEAD"]]])("review finds the same from a subdirectory %s", (head) => {
    withRepository({
      "packages/app/tsconfig.json": JSON.stringify(TSCONFIG),
      "packages/app/src/app.ts": "export {}\n"
    }, (root) => {
      const put = (path: string) => writeFileSync(join(root, path), UNYIELDED, "utf8")
      put("packages/app/src/app.ts")
      if (head.length > 0) {
        spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@e.com", "commit", "-qam", "head"], { cwd: root })
      } else put("packages/app/src/untracked.ts")
      const reviewIn = (dir: string, ...paths: Array<string>) => {
        const r = spawnSync(
          process.execPath,
          [
            join(REPO_ROOT, "dist/cli.js"),
            "review",
            "--base",
            head.length > 0 ? "HEAD~1" : "HEAD",
            ...head,
            "--format",
            "json",
            "--fail-on-regression",
            ...paths
          ],
          { cwd: join(root, dir), encoding: "utf8" }
        )
        return { status: r.status, ...JSON.parse(r.stdout) as { newFindings: ReadonlyArray<Finding> } }
      }
      const fromRoot = reviewIn(".")
      expect(fromRoot.status).toBe(1)
      expect(fromRoot.newFindings).toHaveLength(head.length > 0 ? 2 : 4)
      expect(reviewIn("packages/app")).toEqual(fromRoot)
      expect(reviewIn("packages/app/src", ".").newFindings).toEqual(fromRoot.newFindings)
    })
  })

  it("review names each file it did not check, whatever else it skipped", () => {
    const only = JSON.stringify({ ...TSCONFIG, include: ["src"] })
    withRepository({
      "tsconfig.json": JSON.stringify({ files: [] }),
      "a/tsconfig.json": "{ \"extends\": \"./missing.json\", \"files\": [] }",
      "a/one.ts": "export {}\n",
      "b/tsconfig.json": only,
      "b/scripts/two.ts": "export {}\n"
    }, (_root, change) => {
      const report = change({ "a/one.ts": UNYIELDED, "b/scripts/two.ts": UNYIELDED })
      expect(report.typeAwareSkipped.join()).toContain("a/one.ts: not checked")
      expect(report.typeAwareSkipped.join()).toContain("b/scripts/two.ts: not checked")
    })
  })

  it("review says when base cannot be reconstructed", () => {
    const source = UNYIELDED.replace(
      "const findUser = (name: string) => Effect.succeed({ name })",
      "import { findUser } from \"./generated.js\""
    )
    withRepository({
      // Ignored by git, so on disk but in no commit.
      "src/generated.ts":
        "import { Effect } from \"effect\"\nexport const findUser = (name: string) => Effect.succeed({ name })\n",
      [SYNC_USERS]: source
    }, (_root, change) => {
      const report = change({ [SYNC_USERS]: source.replace("      findUser(", "        findUser(") })
      expect(report.newFindings.map((f) => f.rule)).toEqual(["floatingEffect"])
      expect(report.typeAwareSkipped.join()).toContain("'./generated.js' does not resolve")
    })
  })

  it("review takes an explicit head's types from that ref", () => {
    const helper = (body: string) =>
      `import { Effect } from "effect"\nexport const E = Effect\nexport const save = (n: number) => ${body}\n`
    const caller = (n: number) =>
      `import { Effect } from "effect"
import { save } from "./helper"
export const program = Effect.gen(function*() {
  save(${String(n)})
  yield* Effect.log("saved")
})
`
    withRepository({ "src/helper.ts": helper("n"), [SYNC_USERS]: caller(1) }, (root, change) => {
      const git = (...args: Array<string>) =>
        spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@e.com", ...args], { cwd: root })
      writeFileSync(join(root, "src/helper.ts"), helper("Effect.succeed(n)"), "utf8")
      writeFileSync(join(root, SYNC_USERS), caller(2), "utf8")
      git("commit", "-qam", "head")
      const refs = ["--base", "HEAD~1", "--head", "HEAD"]
      const clean = change({}, refs)
      expect(clean.newFindings.map((f) => f.rule)).toEqual(["floatingEffect"])

      // Only the helper is edited, and only in the working tree.
      const dirty = change({ "src/helper.ts": helper("n") }, refs)
      expect(dirty.newFindings).toEqual(clean.newFindings)
      expect(dirty.typeAwareSkipped).toEqual([])
      expect(dirty.status).toBe(1)
    })
  })

  it.each([
    ["no project", {}],
    ["a project without the file", {
      "nested/tsconfig.json": JSON.stringify({ compilerOptions, include: ["other.ts"] })
    }]
  ])("review of two refs is not changed by what is around the snapshot of %s", (_, files) => {
    const tmp = realpathSync(mkdtempSync(join(OUTSIDE, ".tmp-tsgo-around-")))
    const FILES = ["nested/one.ts", "nested/two.ts"]
    const sources = (text: string) => Object.fromEntries(FILES.map((f) => [f, text]))
    try {
      withRepository({ ...files, ...sources("export {}\n") }, (root, change) => {
        const git = (...args: Array<string>) =>
          spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@e.com", ...args], { cwd: root })
        rmSync(join(root, "tsconfig.json"))
        git("commit", "-qam", "base")
        for (const changed of [FILES.slice(0, 1), FILES]) {
          for (const f of changed) writeFileSync(join(root, f), UNYIELDED, "utf8")
          git("commit", "-qam", "head")
          const refs = ["--base", "HEAD~1", "--head", "HEAD"]
          rmSync(join(tmp, "tsconfig.json"), { force: true })
          const clean = change({}, refs, tmp)
          writeFileSync(
            join(tmp, "tsconfig.json"),
            JSON.stringify({
              compilerOptions: {
                ...compilerOptions,
                plugins: [{ name: "@effect/language-service", diagnosticSeverity: { floatingEffect: "off" } }]
              }
            })
          )
          const surrounded = change({}, refs, tmp)
          expect(surrounded).toEqual(clean)
          if (changed.length === 1) expect(clean.newFindings.map((f) => f.rule)).toEqual(RULES)
          else expect(clean.newFindings.length + clean.typeAwareSkipped.length).toBeGreaterThan(0)
        }
      })
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it.each<[string, Record<string, unknown>, boolean]>([
    ["extended configuration", { extends: "../../shared.json", compilerOptions, include: ["src"] }, true],
    ["package's configuration", { extends: "around/tsconfig.json", compilerOptions, include: ["src"] }, true],
    ["referenced project", { files: [], references: [{ path: "../../shared.json" }] }, true],
    ["included file", { compilerOptions, include: ["src", "../../*.ts"] }, true],
    ["installed package's configuration", { extends: "shared/tsconfig.json", compilerOptions, include: ["src"] }, false]
  ])("review of two refs notices an %s around the snapshot, unless it is installed", (_, config, isOutside) => {
    const tmp = realpathSync(mkdtempSync(join(OUTSIDE, ".tmp-tsgo-around-")))
    const shared = JSON.stringify({
      compilerOptions: { plugins: [{ name: "@effect/language-service" }] },
      include: ["**/src/*.ts"]
    })
    const install = (dir: string, name: string) => {
      mkdirSync(join(dir, "node_modules", name), { recursive: true })
      writeFileSync(join(dir, "node_modules", name, "package.json"), JSON.stringify({ name, version: "1.0.0" }))
      writeFileSync(join(dir, "node_modules", name, "tsconfig.json"), shared)
    }
    try {
      writeFileSync(join(tmp, "shared.json"), shared)
      writeFileSync(join(tmp, "globals.d.ts"), "declare const around: number\n")
      install(tmp, "around")
      withRepository({ "tsconfig.json": JSON.stringify(config), [SYNC_USERS]: "export {}\n" }, (root, change) => {
        install(root, "shared")
        writeFileSync(join(root, SYNC_USERS), UNYIELDED, "utf8")
        spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@e.com", "commit", "-qam", "head"], { cwd: root })
        const report = change({}, ["--base", "HEAD~1", "--head", "HEAD"], tmp)
        if (isOutside) expect(report.typeAwareSkipped.join()).toContain("is not part of it")
        else {
          expect(report.newFindings.map((f) => f.rule)).toEqual(RULES)
          expect(report.typeAwareSkipped).toEqual([])
        }
      })
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it.each<[string, Record<string, string>, Record<string, string>, boolean]>([
    ["configuration", {}, { "tsconfig.json": "EXTERNAL/shared.json" }, true],
    ["extended configuration", { "tsconfig.json": JSON.stringify({ extends: "./shared.json", include: ["src"] }) }, {
      "shared.json": "EXTERNAL/shared.json"
    }, true],
    ["source file", {}, { "src/helper.ts": "EXTERNAL/helper.ts" }, true],
    ["source directory", {}, { "src/helper": "EXTERNAL/lib" }, true],
    ["manifest", {}, { "package.json": "EXTERNAL/package.json" }, true],
    [
      "file of the ref",
      { "lib/helper.ts": "export const helper = 1\n" },
      { "src/helper.ts": "../lib/helper.ts" },
      false
    ],
    ["lockfile", {}, { "package-lock.json": "EXTERNAL/package.json" }, true],
    [
      "lockfile of another package manager",
      {
        "package.json": JSON.stringify({ packageManager: "pnpm@10.0.0" }),
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n"
      },
      { "package-lock.json": "EXTERNAL/package.json" },
      false
    ],
    [
      "directory in place of another package manager's lockfile",
      {
        "package.json": JSON.stringify({ packageManager: "pnpm@10.0.0" }),
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n"
      },
      { "package-lock.json": "EXTERNAL/lib" },
      false
    ],
    [
      "lockfile in use",
      {
        "package.json": JSON.stringify({ packageManager: "pnpm@10.0.0" }),
        "package-lock.json": "{}"
      },
      { "pnpm-lock.yaml": "EXTERNAL/package.json" },
      true
    ],
    ["manifest of something else", { "fixtures/playground/main.ts": "export {}\n" }, {
      "fixtures/playground/package.json": "EXTERNAL/package.json",
      "fixtures/playground/yarn.lock": "EXTERNAL/package.json"
    }, false],
    ["manifest of what it imports", { "lib/index.ts": "export const helper = 1\n" }, {
      "lib/package.json": "EXTERNAL/package.json",
      "src/helper": "../lib"
    }, true],
    ["file that is no input", {}, { "README.md": "EXTERNAL/helper.ts" }, false]
  ])("review of two refs notices a tracked link from a %s to outside it", (_, files, links, isOutside) => {
    const tmp = realpathSync(mkdtempSync(join(OUTSIDE, ".tmp-tsgo-around-")))
    try {
      writeFileSync(join(tmp, "shared.json"), JSON.stringify({ compilerOptions, include: ["src"] }))
      writeFileSync(join(tmp, "helper.ts"), "export const helper = 1\n")
      writeFileSync(join(tmp, "package.json"), "{}")
      mkdirSync(join(tmp, "lib"))
      writeFileSync(join(tmp, "lib", "index.ts"), "export const helper = 1\n")
      const imports = Object.keys(links).some((path) => path.startsWith("src/"))
      withRepository({ ...files, [SYNC_USERS]: "export {}\n" }, (root, change) => {
        for (const [path, target] of Object.entries(links)) {
          rmSync(join(root, path), { force: true })
          symlinkSync(target.replace("EXTERNAL", tmp), join(root, path))
        }
        const git = (...args: Array<string>) =>
          spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@e.com", ...args], { cwd: root })
        git("add", ".")
        git("commit", "-qm", "links")
        writeFileSync(join(root, SYNC_USERS), (imports ? "import \"./helper\"\n" : "") + UNYIELDED, "utf8")
        git("commit", "-qam", "head")
        const report = change({}, ["--base", "HEAD~1", "--head", "HEAD"])
        if (isOutside) expect(report.typeAwareSkipped.join()).toContain("is not part of it")
        else {
          expect(report.newFindings.map((f) => f.rule)).toEqual(RULES)
          expect(report.typeAwareSkipped).toEqual([])
        }
      })
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it.each([
    ["a script", "/** @type {(n: number) => import(\"effect\").Effect.Effect<number>} */\nvar save\n", {}, true],
    ["a CommonJS module", "var save = 1\nmodule.exports = { save }\n", {}, false],
    ["a CommonJS module of any form", "var save = 1\nmodule[\"exports\"] = { save }\n", {}, false],
    [
      "a CommonJS module that defines",
      "var save = 1\nObject.defineProperty(exports, \"save\", { value: save })\n",
      {},
      false
    ],
    ["a CommonJS module that requires", "var save = require(\"./other\")\n", {}, false],
    ["told to be a module", "var save\n", { moduleDetection: "force" }, false],
    ["a module", "export const save = 1\n", {}, false],
    ["a script that is not loaded", "var save\n", { allowJs: false }, false]
  ])("review notices generated JavaScript only if it is %s", (_, generated, options, isMissed) => {
    withRepository({
      ".gitignore": "node_modules\ngenerated.js\n",
      "tsconfig.json": JSON.stringify({
        compilerOptions: { ...compilerOptions, allowJs: true, ...options },
        include: ["src"]
      }),
      "src/generated.js": generated,
      [SYNC_USERS]: UNYIELDED
    }, (_root, change) => {
      const report = change({ [SYNC_USERS]: INDENTED })
      if (isMissed) expect(report.typeAwareSkipped.join()).toContain("src/generated.js is not in git")
      else {
        expect(report.newFindings).toEqual([])
        expect(report.typeAwareSkipped).toEqual([])
      }
    })
  })

  it.each([[0], [1]])("review notices globals in installed JavaScript at maxNodeModuleJsDepth %s", (depth) => {
    withRepository({
      "package.json": manifest("1.0.0"),
      "tsconfig.json": JSON.stringify({
        compilerOptions: { ...compilerOptions, allowJs: true, maxNodeModuleJsDepth: depth },
        include: ["src"]
      }),
      "src/setup.ts": "import \"helper\"\n",
      [SYNC_USERS]: UNYIELDED
    }, (root, change) => {
      const helper = join(root, "node_modules", "helper")
      mkdirSync(helper)
      writeFileSync(
        join(helper, "package.json"),
        JSON.stringify({ name: "helper", version: "2.0.0", main: "./index.js" })
      )
      writeFileSync(join(helper, "index.js"), "function save() {}\n")
      const report = change({ "package.json": manifest("2.0.0"), [SYNC_USERS]: INDENTED })
      if (depth === 1) {
        expect(report.typeAwareSkipped.join()).toContain("the installed helper 2.0.0 is not the version")
      } else {
        expect(report.newFindings).toEqual([])
        expect(report.typeAwareSkipped).toEqual([])
      }
    })
  })

  it.each([["checkout", false], ["ref", true]])(
    "review minds installed JavaScript that only loads for a direct import if the %s has that import",
    (_, isInRef) => {
      const direct = "import \"helper\"\n"
      const lock = (helper: string) =>
        JSON.stringify({
          lockfileVersion: 3,
          packages: { "node_modules/entry": { version: "1.0.0" }, "node_modules/helper": { version: helper } }
        })
      withRepository({
        "package-lock.json": lock("1.0.0"),
        "tsconfig.json": JSON.stringify({
          compilerOptions: { ...compilerOptions, allowJs: true, maxNodeModuleJsDepth: 1 },
          include: ["src"]
        }),
        // Through this one alone it would be too deep.
        "src/setup.ts": "import \"entry\"\n" + (isInRef ? direct : ""),
        [SYNC_USERS]: UNYIELDED
      }, (root, change) => {
        const put = (name: string, version: string, text: string) => {
          const dir = join(root, "node_modules", name)
          mkdirSync(dir)
          writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version, main: "./index.js" }))
          writeFileSync(join(dir, "index.js"), text)
        }
        put("entry", "1.0.0", "require(\"helper\")\n")
        put("helper", "2.0.0", "function save() {}\n")
        const report = change({
          "package-lock.json": lock("2.0.0"),
          "src/setup.ts": "import \"entry\"\n" + direct,
          [SYNC_USERS]: INDENTED
        })
        if (isInRef) expect(report.typeAwareSkipped.join()).toContain("the installed helper 2.0.0 is not the version")
        else {
          expect(report.newFindings).toEqual([])
          expect(report.typeAwareSkipped).toEqual([])
        }
      })
    }
  )

  it("review follows what JavaScript imports in JSDoc", () => {
    withRepository({
      "package.json": manifest("1.0.0"),
      "tsconfig.json": JSON.stringify({ compilerOptions: { ...compilerOptions, allowJs: true }, include: ["src"] }),
      "src/globals.js": "/** @type {typeof import(\"helper\").save} */\nvar save\n",
      [SYNC_USERS]: callsHelper(1).replace("import { save } from \"helper\"\n", "")
    }, (root, change) => {
      installHelper(root, "2.0.0")
      const report = change({
        "package.json": manifest("2.0.0"),
        [SYNC_USERS]: callsHelper(2).replace("import { save } from \"helper\"\n", "")
      })
      expect(report.newFindings.map((f) => f.rule)).toEqual(["floatingEffect"])
      expect(report.typeAwareSkipped.join()).toContain("the installed helper 2.0.0 is not the version")
    })
  })

  it("review does not take a package from around the snapshot for the ref's", () => {
    const tmp = realpathSync(mkdtempSync(join(OUTSIDE, ".tmp-tsgo-around-")))
    try {
      withRepository({ [SYNC_USERS]: callsHelper(1) }, (root, change) => {
        installHelper(tmp, "1.0.0")
        writeFileSync(join(root, SYNC_USERS), callsHelper(2), "utf8")
        spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@e.com", "commit", "-qam", "head"], { cwd: root })
        const report = change({}, ["--base", "HEAD~1", "--head", "HEAD"], tmp)
        expect(report.newFindings).toEqual([])
        expect(report.typeAwareSkipped.join()).toContain("is not part of it")
      })
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it("review notices ambient declarations that are not in git", () => {
    const ambient = "declare const findUser: (name: string) => import(\"effect\").Effect.Effect<string>\n"
    const source = UNYIELDED.replace("const findUser = (name: string) => Effect.succeed({ name })\n", "")
    withRepository({
      ".gitignore": "node_modules\ngenerated\n",
      "src/generated/globals.d.ts": ambient,
      [SYNC_USERS]: source
    }, (root, change) => {
      const indented = source.replace("      findUser(", "        findUser(")
      const unseen = change({ [SYNC_USERS]: indented })
      expect(unseen.typeAwareSkipped.join()).toContain("src/generated/globals.d.ts is not in git")

      // A tracked one is in base too, and there is nothing to notice.
      rmSync(join(root, "src", "generated"), { recursive: true })
      writeFileSync(join(root, SYNC_USERS), source, "utf8")
      writeFileSync(join(root, "src", "globals.d.ts"), ambient, "utf8")
      const git = (...args: Array<string>) =>
        spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@e.com", ...args], { cwd: root })
      git("add", ".")
      git("commit", "-qm", "tracked")
      const seen = change({ [SYNC_USERS]: indented })
      expect(seen.newFindings).toEqual([])
      expect(seen.typeAwareSkipped).toEqual([])
      expect(seen.status).toBe(0)
    })
  })

  it("review notices head source reached through an installed package", () => {
    const util = (body: string) =>
      `import { Effect } from "effect"\nexport const E = Effect\nexport const save = (n: number) => ${body}\n`
    const app = (n: number) =>
      `import { Effect } from "effect"
import { save } from "reexport"
export const program = Effect.gen(function*() {
  save(${String(n)})
  yield* Effect.log("saved")
})
`
    withRepository({
      "packages/util/package.json": JSON.stringify({ name: "@w/util", type: "module", exports: "./index.ts" }),
      "packages/util/tsconfig.json": JSON.stringify({ compilerOptions, include: ["*.ts"] }),
      "packages/util/index.ts": util("n"),
      [SYNC_USERS]: app(1)
    }, (root, change) => {
      mkdirSync(join(root, "node_modules", "@w"))
      symlinkSync(join(root, "packages", "util"), join(root, "node_modules", "@w", "util"), "dir")
      const installed = join(root, "node_modules", "reexport")
      mkdirSync(installed)
      writeFileSync(
        join(installed, "package.json"),
        JSON.stringify({ name: "reexport", type: "module", types: "./index.d.ts" })
      )
      writeFileSync(join(installed, "index.d.ts"), "export { save } from \"@w/util\"\n")

      // Unchanged, the workspace package reads the same from either side.
      const same = change({ [SYNC_USERS]: app(2) })
      expect(same.newFindings).toEqual([])
      expect(same.typeAwareSkipped).toEqual([])

      const report = change({ "packages/util/index.ts": util("Effect.succeed(n)"), [SYNC_USERS]: app(3) })
      expect(report.newFindings.map((f) => [f.file, f.rule])).toEqual([[SYNC_USERS, "floatingEffect"]])
      expect(report.typeAwareSkipped.join()).toContain("packages/util/index.ts is read from the checkout")
      expect(report.status).toBe(1)
    })
  })

  const REFS = ["--base", "HEAD~1", "--head", "HEAD"]
  const commit = (root: string) => {
    for (const args of [["add", "."], ["-c", "user.name=t", "-c", "user.email=t@e.com", "commit", "-qm", "next"]]) {
      expect(spawnSync("git", args, { cwd: root }).status).toBe(0)
    }
  }

  it("review of two refs is not changed by an untracked config", () => {
    withRepository({
      "tsconfig.json": JSON.stringify({ extends: "./local.jsonc", include: ["src/**/*.ts"] }),
      [SYNC_USERS]: "export {}\n"
    }, (root, change) => {
      writeFileSync(join(root, SYNC_USERS), UNYIELDED, "utf8")
      commit(root)
      const clean = change({}, REFS)
      expect(clean.newFindings.map((f) => f.rule)).toContain("floatingEffect")
      expect(clean.status).toBe(1)
      const local = change({
        "local.jsonc": JSON.stringify({
          compilerOptions: {
            ...compilerOptions,
            plugins: [{ name: "@effect/language-service", diagnosticSeverity: { floatingEffect: "off" } }]
          }
        })
      }, REFS)
      expect(local.newFindings).toEqual(clean.newFindings)
      expect(local.typeAwareSkipped.join()).toContain("tsconfig.json does not resolve there")
      expect(local.status).toBe(1)
    })
  })

  it.each([["generated/globals.d.ts"], ["globals.d.ts"]])(
    "review of two refs is not changed by a local %s",
    (path) => {
      const source = UNYIELDED.replace("const findUser = (name: string) => Effect.succeed({ name })\n", "")
        .replace("yield findUser", "yield* findUser")
      withRepository({
        ".gitignore": "node_modules\ngenerated\n",
        [SYNC_USERS]: source
      }, (root, change) => {
        const changed = source.replace("      findUser(", "        findUser(")
        writeFileSync(join(root, SYNC_USERS), changed, "utf8")
        commit(root)
        const clean = change({}, REFS)
        const local = change({
          [`src/${path}`]: "declare const findUser: (name: string) => import(\"effect\").Effect.Effect<string>\n"
        }, REFS)
        expect(local.newFindings).toEqual(clean.newFindings)
        expect(local.status).toBe(clean.status)
        expect(clean.status).toBe(0)
      })
    }
  )

  const manifest = (helper: string) => JSON.stringify({ name: "app", private: true, dependencies: { helper } })
  const callsHelper = (n: number) =>
    `import { Effect } from "effect"
import { save } from "helper"
export const program = Effect.gen(function*() {
  save(${String(n)})
  yield* Effect.log("saved")
})
`
  /** Every version is an Effect: only what is recorded says base's might not have been. */
  const installHelper = (dir: string, version: string) => {
    const helper = join(dir, "node_modules", "helper")
    mkdirSync(helper, { recursive: true })
    writeFileSync(join(helper, "package.json"), JSON.stringify({ name: "helper", version, types: "./index.d.ts" }))
    writeFileSync(
      join(helper, "index.d.ts"),
      "export declare const save: (n: number) => import(\"effect\").Effect.Effect<number>\n"
    )
  }

  it("review notices an upgraded dependency", () => {
    withRepository({ "package.json": manifest("1.0.0"), [SYNC_USERS]: callsHelper(1) }, (root, change) => {
      // At base's own version the same call is an old finding.
      installHelper(root, "1.0.0")
      const same = change({ [SYNC_USERS]: callsHelper(2) })
      expect(same.newFindings).toEqual([])
      expect(same.typeAwareSkipped).toEqual([])

      installHelper(root, "2.0.0")
      const upgraded = change({ "package.json": manifest("2.0.0") })
      expect(upgraded.newFindings.map((f) => f.rule)).toEqual(["floatingEffect"])
      expect(upgraded.typeAwareSkipped.join()).toContain("the installed helper 2.0.0 is not the version")
      expect(upgraded.status).toBe(1)
    })
  })

  const withTypes = (types: ReadonlyArray<string>) =>
    JSON.stringify({ ...TSCONFIG, compilerOptions: { ...compilerOptions, types } })

  it("review notices an upgraded ambient package that only base's config names", () => {
    withRepository({
      "package.json": manifest("1.0.0"),
      "tsconfig.json": withTypes(["helper"]),
      [SYNC_USERS]: callsHelper(1).replace("import { save } from \"helper\"\n", "")
    }, (root, change) => {
      installHelper(root, "2.0.0")
      writeFileSync(
        join(root, "node_modules", "helper", "index.d.ts"),
        "import { Effect } from \"effect\"\nexport declare const save: (n: number) => Effect.Effect<number>\ndeclare global {\n  const save: (n: number) => Effect.Effect<number>\n}\n"
      )
      const report = change({
        "package.json": manifest("2.0.0"),
        "tsconfig.json": withTypes([]),
        [SYNC_USERS]: callsHelper(2)
      })
      expect(report.newFindings.map((f) => f.rule)).toEqual(["floatingEffect"])
      expect(report.typeAwareSkipped.join()).toContain("the installed helper 2.0.0 is not the version")
      expect(report.status).toBe(1)
    })
  })

  it.each([["another package"], ["itself"], ["another of its files"]])(
    "review notices an upgraded package whose globals are behind %s",
    (behind) => {
      const lock = (helper: string) =>
        JSON.stringify({
          lockfileVersion: 3,
          packages: { "node_modules/entry": { version: "1.0.0" }, "node_modules/helper": { version: helper } }
        })
      const calls = (n: number) => callsHelper(n).replace("import { save } from \"helper\"\n", "")
      withRepository({
        "package.json": JSON.stringify({ dependencies: { entry: "1.0.0", helper: "*" } }),
        "package-lock.json": lock("1.0.0"),
        "src/setup.ts": `import "${behind === "another package" ? "entry" : "helper"}"\n`,
        [SYNC_USERS]: calls(1)
      }, (root, change) => {
        const put = (path: string, text: string) => {
          mkdirSync(dirname(join(root, "node_modules", path)), { recursive: true })
          writeFileSync(join(root, "node_modules", path), text)
        }
        const install = (version: string) => {
          installHelper(root, version)
          const globals =
            "declare global {\n  const save: (n: number) => import(\"effect\").Effect.Effect<number>\n}\nexport {}\n"
          put("helper/globals.d.ts", globals)
          put("helper/index.d.ts", behind === "itself" ? globals : "export * from \"./globals.js\"\n")
        }
        put("entry/package.json", JSON.stringify({ name: "entry", version: "1.0.0", types: "./index.d.ts" }))
        put("entry/index.d.ts", "export * from \"helper\"\n")

        install("1.0.0")
        const same = change({ [SYNC_USERS]: calls(2) })
        expect(same.newFindings).toEqual([])
        expect(same.typeAwareSkipped).toEqual([])

        install("2.0.0")
        const upgraded = change({ "package-lock.json": lock("2.0.0") })
        expect(upgraded.newFindings.map((f) => f.rule)).toEqual(["floatingEffect"])
        expect(upgraded.typeAwareSkipped.join()).toContain("the installed helper 2.0.0 is not the version")
        expect(upgraded.status).toBe(1)
      })
    }
  )

  it.each([["types"], ["import"], ["tracked"]])("review notices an upgraded package behind ambient %s", (via) => {
    const globals =
      "import { save as helper } from \"helper\"\ndeclare global {\n  const save: typeof helper\n}\nexport {}\n"
    const lock = (helper: string) =>
      JSON.stringify({
        lockfileVersion: 3,
        packages: { "node_modules/ambient": { version: "1.0.0" }, "node_modules/helper": { version: helper } }
      })
    withRepository({
      "package.json": JSON.stringify({ dependencies: { ambient: "1.0.0" } }),
      "package-lock.json": lock("1.0.0"),
      "tsconfig.json": withTypes(via === "types" ? ["ambient"] : []),
      ...(via === "import" ? { "src/setup.ts": "import \"ambient\"\n" } : {}),
      ...(via === "tracked" ? { "src/globals.d.ts": globals } : {}),
      [SYNC_USERS]: callsHelper(1).replace("import { save } from \"helper\"\n", "")
    }, (root, change) => {
      const ambient = join(root, "node_modules", "ambient")
      mkdirSync(ambient)
      writeFileSync(
        join(ambient, "package.json"),
        JSON.stringify({ name: "ambient", version: "1.0.0", types: "./index.d.ts" })
      )
      writeFileSync(join(ambient, "index.d.ts"), globals)
      const changed = callsHelper(2).replace("import { save } from \"helper\"\n", "")

      installHelper(root, "1.0.0")
      const same = change({ [SYNC_USERS]: changed })
      expect(same.newFindings).toEqual([])
      expect(same.typeAwareSkipped).toEqual([])

      installHelper(root, "2.0.0")
      const upgraded = change({ "package-lock.json": lock("2.0.0") })
      expect(upgraded.newFindings.map((f) => f.rule)).toEqual(["floatingEffect"])
      expect(upgraded.typeAwareSkipped.join()).toContain("the installed helper 2.0.0 is not the version")
      expect(upgraded.status).toBe(1)
    })
  })

  it("review audits base under the project that checked the file", () => {
    const nested = JSON.stringify({ compilerOptions, include: ["src"] })
    const FILE = "nested/extra/program.ts"
    const source = callsHelper(1).replace("import { save } from \"helper\"\n", "")
    const globals = "declare const save: (n: number) => import(\"effect\").Effect.Effect<number>\n"
    for (const reference of [false, true]) {
      withRepository({
        ".gitignore": "node_modules\nglobals.d.ts\n",
        "globals.d.ts": globals,
        "nested/tsconfig.json": reference
          ? JSON.stringify({ files: [], references: [{ path: "../tsconfig.all.json" }] })
          : nested,
        [reference ? "tsconfig.all.json" : "tsconfig.json"]: JSON.stringify({ compilerOptions, include: ["**/*.ts"] }),
        "nested/src/other.ts": "export const other = 1\n",
        [FILE]: source
      }, (_root, change) => {
        const report = change({ [FILE]: source.replace("  save", "    save") })
        expect(report.newFindings.map((f) => [f.file, f.rule])).toEqual([[FILE, "floatingEffect"]])
        expect(report.typeAwareSkipped.join()).toContain("globals.d.ts is not in git")
      })
    }
  })

  it("review does not audit base for an ambient package that only head's config names", () => {
    withRepository({
      "package.json": manifest("1.0.0"),
      "tsconfig.json": withTypes([]),
      [SYNC_USERS]: UNYIELDED
    }, (root, change) => {
      installHelper(root, "2.0.0")
      const report = change({
        "package.json": manifest("2.0.0"),
        "tsconfig.json": withTypes(["helper"]),
        [SYNC_USERS]: INDENTED
      })
      expect(report.newFindings).toEqual([])
      expect(report.typeAwareSkipped).toEqual([])
      expect(report.status).toBe(0)
    })
  })

  it("review notices what only base's config finds outside git", () => {
    const declaration =
      "import { Effect } from \"effect\"\nexport declare const save: (n: number) => Effect.Effect<number>\n"
    const config = (paths: Record<string, ReadonlyArray<string>>, include: ReadonlyArray<string>) =>
      JSON.stringify({ compilerOptions: { ...compilerOptions, paths }, include })
    const ignored = { ".gitignore": "node_modules\ngenerated\n" }
    // A path mapping to a generated file that head no longer has or needs.
    withRepository({
      ...ignored,
      "generated/helper.d.ts": declaration,
      "tsconfig.json": config({ helper: ["./generated/helper.d.ts"] }, ["src"]),
      [SYNC_USERS]: callsHelper(1)
    }, (_root, change) => {
      const report = change({
        "tsconfig.json": config({}, ["src"]),
        [SYNC_USERS]: callsHelper(2)
          .replace("import { save } from \"helper\"", "const save = (n: number) => Effect.succeed(n)")
      })
      expect(report.typeAwareSkipped.join()).toContain("'helper' does not resolve there")
    })
    // Generated globals that head no longer includes.
    withRepository({
      ...ignored,
      "generated/globals.d.ts": "declare const findUser: (name: string) => import(\"effect\").Effect.Effect<string>\n",
      "tsconfig.json": config({}, ["src", "generated"]),
      [SYNC_USERS]: UNYIELDED
    }, (_root, change) => {
      const report = change({ "tsconfig.json": config({}, ["src"]), [SYNC_USERS]: INDENTED })
      expect(report.typeAwareSkipped.join()).toContain("generated/globals.d.ts is not in git")
    })
  })

  it("review does not take another workspace's locked version for the importer's", () => {
    const lock = (app: string) =>
      `lockfileVersion: '9.0'\n\nimporters:\n\n  packages/app:\n    dependencies:\n      helper:\n        specifier: ^1.0.0\n        version: ${app}\n\n  packages/other:\n    dependencies:\n      helper:\n        specifier: ^1.0.0\n        version: 1.1.0\n\npackages:\n\n  helper@1.0.0: {}\n\n  helper@1.1.0: {}\n`
    const APP = "packages/app/src/app.ts"
    withRepository({
      "pnpm-lock.yaml": lock("1.0.0"),
      "packages/app/package.json": manifest("^1.0.0"),
      "packages/app/tsconfig.json": JSON.stringify({ compilerOptions, include: ["src"] }),
      [APP]: callsHelper(1)
    }, (root, change) => {
      installHelper(join(root, "packages/app"), "1.1.0")
      const report = change({ "pnpm-lock.yaml": lock("1.1.0"), [APP]: callsHelper(2) })
      expect(report.newFindings.map((f) => [f.file, f.rule])).toEqual([[APP, "floatingEffect"]])
      expect(report.typeAwareSkipped.join()).toContain("the installed helper 1.1.0 is not the version")
      expect(report.status).toBe(1)
    })
  })

  it("review looks an aliased dependency up by its alias", () => {
    const source = callsHelper(1).replace("\"helper\"", "\"helper-v2\"")
    withRepository({
      "package.json": JSON.stringify({ dependencies: { helper: "1.0.0", "helper-v2": "npm:helper@2.0.0" } }),
      [SYNC_USERS]: source
    }, (root, change) => {
      // As pnpm links it, so that only the import has the alias.
      installHelper(join(root, "node_modules/.pnpm/helper@2.0.0"), "2.0.0")
      symlinkSync(
        join(root, "node_modules/.pnpm/helper@2.0.0/node_modules/helper"),
        join(root, "node_modules/helper-v2"),
        "dir"
      )
      const report = change({ [SYNC_USERS]: source.replace("  save", "    save") })
      expect(report.newFindings).toEqual([])
      expect(report.typeAwareSkipped).toEqual([])
      expect(report.status).toBe(0)
    })
  })

  it("review notices an upgrade in a version 1 package-lock.json", () => {
    const lock = (version: string) => JSON.stringify({ lockfileVersion: 1, dependencies: { helper: { version } } })
    withRepository({
      "package.json": manifest("^1.0.0"),
      "package-lock.json": lock("1.0.0"),
      [SYNC_USERS]: callsHelper(1)
    }, (root, change) => {
      installHelper(root, "1.1.0")
      const report = change({ "package-lock.json": lock("1.1.0"), [SYNC_USERS]: callsHelper(2) })
      expect(report.newFindings.map((f) => f.rule)).toEqual(["floatingEffect"])
      expect(report.typeAwareSkipped.join()).toContain("the installed helper 1.1.0 is not the version")
      expect(report.status).toBe(1)
    })
  })

  it.each([["commonjs"], ["module"]])("review audits the branch of a package that %s source gets", (type) => {
    const declaration =
      "import { Effect } from \"effect\"\nexport declare const save: (n: number) => Effect.Effect<number>\n"
    withRepository({
      ".gitignore": "node_modules\ngenerated.d.cts\n",
      "package.json": JSON.stringify({ name: "app", type }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: { ...compilerOptions, module: "NodeNext", moduleResolution: "NodeNext" },
        include: ["src"]
      }),
      "packages/helper/package.json": JSON.stringify({
        name: "helper",
        exports: {
          import: { types: "./tracked.d.mts" },
          require: { types: "./generated.d.cts" }
        }
      }),
      "packages/helper/tracked.d.mts": declaration,
      "packages/helper/generated.d.cts": declaration,
      [SYNC_USERS]: callsHelper(1)
    }, (root, change) => {
      symlinkSync(join(root, "packages", "helper"), join(root, "node_modules", "helper"), "dir")
      const report = change({ [SYNC_USERS]: callsHelper(1).replace("  save", "    save") })
      if (type === "module") {
        expect(report.newFindings).toEqual([])
        expect(report.typeAwareSkipped).toEqual([])
      } else {
        expect(report.newFindings.map((f) => f.rule)).toEqual(["floatingEffect"])
        expect(report.typeAwareSkipped.join()).toContain("'helper' does not resolve there")
      }
    })
  })

  it("review does not call a re-written range an upgrade", () => {
    withRepository({ "package.json": manifest("1.0.0"), [SYNC_USERS]: callsHelper(1) }, (root, change) => {
      installHelper(root, "1.0.0")
      const report = change({
        "package.json": manifest("^1.0.0"),
        [SYNC_USERS]: callsHelper(1).replace("  save", "    save")
      })
      expect(report.newFindings).toEqual([])
      expect(report.typeAwareSkipped).toEqual([])
      expect(report.status).toBe(0)
    })
  })

  it("review reports a warning that became an error, not the reverse", () => {
    const config = (floatingEffect: string) =>
      JSON.stringify({
        ...TSCONFIG,
        compilerOptions: {
          ...compilerOptions,
          plugins: [{ name: "@effect/language-service", diagnosticSeverity: { floatingEffect } }]
        }
      })
    withRepository({ "tsconfig.json": config("warning") }, (_root, change) => {
      const raised = change({ "tsconfig.json": config("error"), [SYNC_USERS]: INDENTED })
      expect(raised.newFindings.map((f) => [f.rule, f.severity])).toEqual([["floatingEffect", "error"]])
      expect(raised.status).toBe(1)
    })
    withRepository({ "tsconfig.json": config("error") }, (_root, change) => {
      const lowered = change({ "tsconfig.json": config("warning"), [SYNC_USERS]: INDENTED })
      expect(lowered.newFindings).toEqual([])
      expect(lowered.status).toBe(0)
    })
  })

  it.each([[[]], [["--lint-source"]]])("checks under the project given to --tsconfig %s", (flags) => {
    withUnconfigured(OUTSIDE, (root) => {
      mkdirSync(join(root, "node_modules"))
      symlinkSync(realpathSync(join(REPO_ROOT, "node_modules", "effect")), join(root, "node_modules", "effect"), "dir")
      writeFileSync(join(root, "src", "other.ts"), UNYIELDED, "utf8")
      renameSync(join(root, "tsconfig.json"), join(root, "tsconfig.custom.json"))
      const result = spawnSync(
        process.execPath,
        [join(REPO_ROOT, "dist/cli.js"), "src", "--no-colocate", "--tsconfig", "tsconfig.custom.json", ...flags],
        { cwd: root, encoding: "utf8" }
      )
      const output = flags.length > 0 ? result.stdout : result.stderr
      expect(output.match(/floatingEffect/g)?.length).toBeGreaterThanOrEqual(2)
      expect(result.stderr).not.toContain("skipped")
      expect(result.stderr).not.toContain("did not cover")
    })
  })

  it("review reports them only on the lines the change touched", () => {
    withUnconfigured(REPO_ROOT, (root) => {
      const git = (...args: Array<string>) => {
        const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@e.com", ...args], {
          cwd: root,
          encoding: "utf8"
        })
        expect(r.status, r.stderr).toBe(0)
      }
      const file = join(root, "src", "sync-users.ts")
      // The missing star predates the change; the floating call is new.
      writeFileSync(file, UNYIELDED.replace("      findUser", "      yield* findUser"), "utf8")
      git("init", "-q")
      git("add", ".")
      git("commit", "-qm", "base")
      writeFileSync(file, UNYIELDED, "utf8")

      const review = (...args: Array<string>) =>
        JSON.parse(
          spawnSync(process.execPath, [join(REPO_ROOT, "dist/cli.js"), "review", "--format", "json", ...args], {
            cwd: root,
            encoding: "utf8"
          }).stdout
        ) as {
          newFindings: ReadonlyArray<{ rule: string; line: number }>
          typeAwareSkipped: ReadonlyArray<string>
          risk: string
          markdown: string
        }
      const report = review("--base", "HEAD")
      expect(report.newFindings.map((f) => [f.rule, f.line])).toEqual([["floatingEffect", 8]])
      expect(report.typeAwareSkipped).toEqual([])
      expect(report.risk).toBe("high")

      // An uncommitted edit is not part of the head under review.
      git("commit", "-qam", "head")
      writeFileSync(file, `${UNYIELDED}\nexport const later = 1\n`, "utf8")
      const committed = review("--base", "HEAD~1", "--head", "HEAD")
      expect(committed.newFindings.map((f) => [f.rule, f.line])).toEqual([["floatingEffect", 8]])
      expect(committed.typeAwareSkipped).toEqual([])
    })
  })
})
