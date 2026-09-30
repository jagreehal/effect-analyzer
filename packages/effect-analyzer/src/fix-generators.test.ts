import { describe, expect, it } from "vitest"
import { generateConfigSecretFix } from "./fix-generators"
import type { LintFinding } from "./lint-session"

const finding = {
  filePath: "a.ts",
  rule: "config-secret-without-redacted",
  severity: "warning",
  message: "",
  line: 1,
  column: 1
} as LintFinding

describe("generateConfigSecretFix", () => {
  it("rewrites Config.String to Config.Redacted", () => {
    expect(generateConfigSecretFix(finding, `const t = Config.String("API_TOKEN")`)?.after).toBe(
      `const t = Config.Redacted("API_TOKEN")`
    )
  })
})
