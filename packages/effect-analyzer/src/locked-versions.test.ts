import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import { dependencyKey, installedPackage, makeVersionCheck } from "./locked-versions"

type Files = Record<string, string>

const manifest = (helper?: string, name = "app") =>
  JSON.stringify({ name, dependencies: helper === undefined ? {} : { helper } })

/** Compares an installed `helper` with what `ref` records, seen from `from`. */
const check = (
  ref: Files,
  version: string | undefined,
  { checkout = ref, from = "packages/app/src", importer = true, key = "helper" }: {
    checkout?: Files
    from?: string
    importer?: boolean
    key?: string
  } = {}
) => {
  const root = mkdtempSync(join(tmpdir(), "locked-versions-"))
  try {
    for (const [tree, files] of [["ref", ref], ["checkout", checkout]] as const) {
      mkdirSync(join(root, tree, from), { recursive: true })
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, tree, path)), { recursive: true })
        writeFileSync(join(root, tree, path), text, "utf8")
      }
    }
    const versionOf = makeVersionCheck(join(root, "ref"), join(root, "checkout"))
    return versionOf({ name: "helper", version }, join(root, "ref", from), importer ? key : undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** `packages/app` and `packages/other` each resolve `helper` to their own version. */
const LOCKS: ReadonlyArray<readonly [string, (app: string, other: string) => Files]> = [
  ["pnpm-lock.yaml", (app, other) => ({
    // pnpm 11+ writes its own tools as a first document.
    "pnpm-lock.yaml": `---
lockfileVersion: '9.0'

importers:

  .:
    packageManagerDependencies:
      helper:
        specifier: 9.9.9
        version: 9.9.9

---
lockfileVersion: '9.0'

importers:

  .: {}

  packages/app:
    dependencies:
      '@scope/x':
        specifier: ^1.0.0
        version: 1.0.0(helper@${app})
      helper:
        specifier: ^1.0.0
        version: ${app}(peer@3.0.0)

  packages/other:
    devDependencies:
      helper:
        specifier: ^1.0.0
        version: ${other}

packages:

  helper@${app}:
    resolution: {integrity: sha512-x}

  helper@${other}:
    resolution: {integrity: sha512-y}
`
  })],
  ["package-lock.json", (app, other) => ({
    "package-lock.json": JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { name: "root" },
        "packages/app": { name: "app", version: "0.0.0" },
        "node_modules/helper": { version: other },
        "packages/app/node_modules/helper": { version: app }
      }
    })
  })],
  ["yarn.lock", (app, other) => ({
    "yarn.lock": `# yarn lockfile v1

"helper@^1.0.0", helper@~1.0.0:
  version "${app}"
  resolved "x"

helper@^1.1.0:
  version "${other}"
`
  })],
  ["yarn.lock (berry)", (app, other) => ({
    "yarn.lock": `__metadata:
  version: 8

"helper@npm:^1.0.0, helper@npm:~1.0.0":
  version: ${app}
  resolution: "helper@npm:${app}"

"helper@npm:^1.1.0":
  version: ${other}
  resolution: "helper@npm:${other}"
`
  })],
  ["bun.lock", (app, other) => ({
    "bun.lock": `{
  "lockfileVersion": 1,
  "packages": {
    "helper": ["helper@${other}", "", {}, "sha512-x"],
    "app/helper": ["helper@${app}", "", {}, "sha512-y"],
  },
}`
  })]
]

describe("the version a ref records", () => {
  describe.each(LOCKS)("in %s", (_, lock) => {
    const ref = { "packages/app/package.json": manifest("^1.0.0"), ...lock("1.0.0", "1.1.0") }

    it("is the importing workspace's, not another's", () => {
      expect(check(ref, "1.0.0")).toBe("same")
      expect(check(ref, "1.1.0")).toBe("other")
      expect(check(ref, "1.2.0")).toBe("other")
    })

    it("does not depend on how the range is written", () => {
      const checkout = { ...ref, "packages/app/package.json": manifest("^1.0.0 || ^2.0.0") }
      expect(check(ref, "1.0.0", { checkout })).toBe("same")
    })

    it("is unknown behind another package when there are several and the lockfile changed", () => {
      const checkout = { ...ref, ...lock("1.1.0", "1.0.0") }
      expect(check(ref, "1.1.0", { checkout, importer: false })).toBe("unknown")
      expect(check(ref, "1.1.0", { importer: false })).toBe("same")
      expect(check({ ...ref, ...lock("1.0.0", "1.0.0") }, "1.0.0", { checkout, importer: false })).toBe("same")
    })

    it("is another when only the checkout's lockfile has the package", () => {
      const empty = Object.fromEntries(Object.keys(lock("1", "1")).map((k) => [k, "{}"]))
      expect(check(empty, "1.0.0", { checkout: ref })).toBe("other")
      // In neither: bundled with another package.
      expect(check(empty, "1.0.0")).toBe("same")
    })
  })

  it("is unknown when an importer's lockfile entry cannot be found", () => {
    const [, lock] = LOCKS[0] ?? []
    const files = lock?.("1.0.0", "1.1.0") ?? {}
    const checkout = { ...files, "pnpm-lock.yaml": `${files["pnpm-lock.yaml"] ?? ""}\n` }
    expect(check({ ...files, "package.json": manifest("^1.0.0") }, "1.1.0", { from: "src", checkout })).toBe("unknown")
  })

  // Without a lockfile: [range at the ref, installed, range in the checkout].
  it.each<[string, string | undefined, string, string]>([
    ["1.0.0", "1.0.0", "1.0.0", "same"],
    ["1.0.0", "1.0.1", "1.0.0", "other"],
    // An exact pin says what was installed, whatever it is changed to.
    ["1.0.0", "1.0.0", "^1.0.0", "same"],
    ["1.0.0", "1.1.0", "^1.0.0", "other"],
    ["1.0.0", "1.0.0-beta.1", "1.0.0", "other"],
    ["^1.5.0", "1.0.0", "^1.5.0", "other"],
    ["^1.5.0", "1.6.0", "^1.5.0", "same"],
    ["^1.0.0", "1.6.0", "^1.5.0", "unknown"],
    ["^1.0.0", "1.6.0", "1.6.0", "unknown"],
    ["^0.2.3", "0.3.0", "^0.2.3", "other"],
    ["~1.2.3", "1.2.0", "~1.2.3", "other"],
    ["1.x", "2.0.0", "1.x", "other"],
    [">=1 <3", "3.0.0", ">=1 <3", "other"],
    ["^1.0.0 || ^2.0.0", "2.1.0", "^1.0.0 || ^2.0.0", "same"],
    ["1.0.0 - 1.4.0", "1.5.0", "1.0.0 - 1.4.0", "other"],
    ["^4.0.0-beta.1", "4.0.0-beta.2", "^4.0.0-beta.1", "same"],
    ["file:a-1.tgz", "1.0.0", "file:a-2.tgz", "unknown"],
    ["1.0.0", undefined, "2.0.0", "unknown"]
  ])("without a lockfile follows the manifest: %s, installed %s, now %s", (range, version, now, expected) => {
    const files = (helper: string) => ({ "packages/app/package.json": manifest(helper) })
    expect(check(files(range), version, { checkout: files(now) })).toBe(expected)
  })

  describe("in a version 1 package-lock.json", () => {
    const lock = (version: string, nested = version) => ({
      "packages/app/package.json": manifest("^1.0.0"),
      "package-lock.json": JSON.stringify({
        lockfileVersion: 1,
        dependencies: {
          helper: { version },
          "helper-v2": { version: "npm:helper@2.0.0" },
          other: { version: "1.0.0", dependencies: { helper: { version: nested } } },
          hosted: { version: "git+ssh://git@example.com/hosted.git#abc" }
        }
      })
    })

    it("is read from the dependency tree", () => {
      expect(check(lock("1.0.0"), "1.0.0", { checkout: lock("1.1.0") })).toBe("same")
      expect(check(lock("1.0.0"), "1.1.0", { checkout: lock("1.1.0") })).toBe("other")
      expect(check(lock("1.0.0", "1.1.0"), "1.1.0")).toBe("other")
      expect(check(lock("1.0.0"), "2.0.0", { key: "helper-v2" })).toBe("same")
    })
  })

  it.each<[string, string, string]>([
    ["bun.lockb", "\u0000binary", "\u0000changed"],
    ["pnpm-lock.yaml", "lockfileVersion: 5.4\npackages:\n  /helper/1.0.0: {}\n", "lockfileVersion: 5.4\n"],
    ["package-lock.json", "<<<<<<< not json", "{"]
  ])("is unknown when a %s that cannot be read changes", (name, text, changed) => {
    const files = (lock: string, range = "^1.0.0") => ({ "packages/app/package.json": manifest(range), [name]: lock })
    expect(check(files(text), "1.1.0", { checkout: files(changed) })).toBe("unknown")
    expect(check(files(text), "1.1.0", { checkout: files(changed), importer: false })).toBe("unknown")
    expect(check(files(text), "1.1.0")).toBe("same")
    // A pin still says.
    expect(check(files(text, "1.1.0"), "1.1.0", { checkout: files(changed) })).toBe("same")
  })

  describe("in one of two lockfiles", () => {
    const lockfile = (version: string) => ({
      "package-lock.json": JSON.stringify({ lockfileVersion: 1, dependencies: { helper: { version } } }),
      "yarn.lock": `helper@^1.0.0:\n  version "${version}"\n`,
      "pnpm-lock.yaml":
        `lockfileVersion: '9.0'\n\nimporters:\n\n  packages/app:\n    dependencies:\n      helper:\n        specifier: ^1.0.0\n        version: ${version}\n`
    })
    const app = (fields: object = {}) => ({
      "packages/app/package.json": manifest("^1.0.0"),
      "package.json": JSON.stringify(fields)
    })
    const npm = { "package-lock.json": lockfile("1.1.0")["package-lock.json"] }
    const yarn = { "yarn.lock": lockfile("1.1.0")["yarn.lock"] }
    const stalePnpm = { "pnpm-lock.yaml": lockfile("1.0.0")["pnpm-lock.yaml"] }

    it.each([
      [{ packageManager: "npm@10.0.0" }, npm, "same"],
      [{ packageManager: "pnpm@11.0.0+sha512.x" }, npm, "other"],
      [{ devEngines: { packageManager: { name: "yarn" } } }, yarn, "same"]
    ])("is the declared package manager's: %j", (fields, used, expected) => {
      expect(check({ ...app(fields), ...used, ...stalePnpm }, "1.1.0")).toBe(expected)
    })

    it("is unknown when none is declared and they disagree", () => {
      expect(check({ ...app(), ...npm, ...stalePnpm }, "1.1.0")).toBe("unknown")
      expect(check({ ...app({ packageManager: "bun@1.0.0" }), ...npm, ...stalePnpm }, "1.1.0")).toBe("unknown")
      expect(check({ ...app(), ...npm, ...yarn }, "1.1.0")).toBe("same")
      expect(check({ ...app(), ...npm, ...stalePnpm }, "1.2.0")).toBe("other")
    })

    const nested = (files: Files) =>
      Object.fromEntries(Object.entries(files).map(([path, text]) => [`packages/app/${path}`, text]))
    const stale = { "package-lock.json": lockfile("1.0.0")["package-lock.json"] }
    const pnpm = { "pnpm-lock.yaml": lockfile("1.1.0")["pnpm-lock.yaml"] }

    it("is the declared package manager's, though another's is nearer", () => {
      // Version 1 of yarn's lockfile does not say what else it installs.
      expect(check({ ...app({ packageManager: "yarn@1.22.0" }), ...yarn, ...nested(stale) }, "1.1.0")).toBe("same")
      expect(check({ ...app(), ...yarn, ...nested(stale) }, "1.1.0")).toBe("other")
    })

    it("is the workspace's that lists the package, though one is nearer", () => {
      expect(check({ ...app(), ...pnpm, ...nested(stale) }, "1.1.0")).toBe("same")
      expect(check({ ...app({ packageManager: "npm@10.0.0" }), ...pnpm, ...nested(stale) }, "1.0.0")).toBe("same")
    })

    it.each<[string, string]>([
      [
        "package-lock.json",
        JSON.stringify({ packages: { "": {}, "packages/app": {}, "node_modules/helper": { version: "1.1.0" } } })
      ],
      [
        "yarn.lock",
        "\"app@workspace:packages/app\":\n  version: 0.0.0-use.local\n\n\"helper@npm:^1.0.0\":\n  version: 1.1.0\n"
      ],
      [
        "bun.lock",
        "{\"workspaces\":{\"\":{},\"packages/app\":{\"name\":\"app\"}},\"packages\":{\"helper\":[\"helper@1.1.0\",\"\",{}],}}"
      ]
    ])("is the workspace's in a %s", (name, text) => {
      expect(check({ ...app(), [name]: text, ...nested(stale) }, "1.1.0")).toBe("same")
    })

    it("is its own for a package the workspace does not list", () => {
      const files = { ...app(), ...pnpm, "examples/one/package.json": manifest("^1.0.0") }
      const own = { "examples/one/package-lock.json": stale["package-lock.json"] }
      expect(check({ ...files, ...own }, "1.0.0", { from: "examples/one" })).toBe("same")
    })

    it("is the shrinkwrap's, as it is for npm", () => {
      const shrinkwrap = { "npm-shrinkwrap.json": lockfile("1.0.0")["package-lock.json"] }
      expect(check({ ...app(), ...npm, ...shrinkwrap }, "1.0.0")).toBe("same")
    })
  })

  describe("of a dependency under another name", () => {
    const app = {
      "packages/app/package.json": JSON.stringify({
        name: "app",
        dependencies: { helper: "1.0.0", "helper-v2": "npm:helper@^2.0.0" }
      })
    }
    it.each<[string, Files]>([
      ["package.json", {}],
      ["pnpm-lock.yaml", {
        "pnpm-lock.yaml":
          "lockfileVersion: '9.0'\n\nimporters:\n\n  packages/app:\n    dependencies:\n      helper:\n        specifier: 1.0.0\n        version: 1.0.0\n      helper-v2:\n        specifier: npm:helper@^2.0.0\n        version: helper@2.0.0\n\npackages:\n\n  helper@1.0.0: {}\n\n  helper@2.0.0: {}\n"
      }],
      ["package-lock.json", {
        "package-lock.json": JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "node_modules/helper": { version: "1.0.0" },
            "node_modules/helper-v2": { name: "helper", version: "2.0.0" }
          }
        })
      }],
      ["yarn.lock", {
        "yarn.lock": "helper@1.0.0:\n  version \"1.0.0\"\n\n\"helper-v2@npm:helper@^2.0.0\":\n  version \"2.0.0\"\n"
      }],
      ["bun.lock", {
        "bun.lock": "{\"packages\":{\"helper\":[\"helper@1.0.0\",\"\",{}],\"helper-v2\":[\"helper@2.0.0\",\"\",{}],}}"
      }]
    ])("is the alias's in %s", (_, lock) => {
      const ref = { ...app, ...lock }
      expect(check(ref, "2.0.0", { key: "helper-v2" })).toBe("same")
      expect(check(ref, "1.0.0", { key: "helper-v2" })).toBe("other")
      expect(check(ref, "1.0.0")).toBe("same")
      expect(check(ref, "2.0.0")).toBe("other")
    })

    it("is another when the name is taken over by a different package", () => {
      const ref = { "packages/app/package.json": manifest("npm:fork@1.0.0") }
      expect(check(ref, "1.0.0")).toBe("other")
    })
  })

  it("is not judged when nothing records it", () => {
    expect(check({ "packages/app/package.json": manifest() }, "1.0.0")).toBe("same")
  })
})

describe("the installed package", () => {
  it("is found under the name it is depended on by", () => {
    expect(dependencyKey("/r/node_modules/helper-v2/index.d.ts")).toBe("helper-v2")
    expect(dependencyKey("/r/node_modules/.pnpm/a@1/node_modules/@s/b/c/d.d.ts")).toBe("@s/b")
    expect(dependencyKey("/r/src/a.ts")).toBeUndefined()
  })

  it("is not a manifest inside it", () => {
    const root = mkdtempSync(join(tmpdir(), "locked-versions-"))
    try {
      const dir = join(root, "node_modules", "helper")
      mkdirSync(join(dir, "hooks"), { recursive: true })
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "helper", version: "1.0.0" }))
      writeFileSync(join(dir, "hooks", "package.json"), JSON.stringify({ name: "helper-hooks", version: "0.1.0" }))
      expect(installedPackage(join(dir, "hooks", "index.d.ts"))).toMatchObject({ name: "helper", version: "1.0.0" })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
