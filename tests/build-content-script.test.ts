import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("built content script bundle", () => {
  it("includes composer hints before content-script use and remains classic-script compatible", () => {
    execFileSync(process.execPath, ["scripts/build-extension.mjs"], { stdio: "pipe" })

    const contentScriptPath = resolve("dist/extension/content-script.js")
    const bundle = readFileSync(contentScriptPath, "utf8")
    const definitionIndex = bundle.search(/const createComposerHintController\b/)
    const usageIndex = bundle.indexOf("createComposerHintController({")

    expect(definitionIndex).toBeGreaterThanOrEqual(0)
    expect(usageIndex).toBeGreaterThan(definitionIndex)
    expect(bundle).toMatch(/const createFeedBadgeController\b/)
    expect(bundle).toContain("Extension context")
    expect(bundle).toContain("invalidated")
    expect(bundle).toContain("Could not establish connection")
    expect(bundle).toContain("unhandledrejection")
    expect(bundle).not.toContain("scoreboarOnlyBangers")
    expect(bundle).not.toContain("data-scoreboar-hidden-by-bangers")
    expect(bundle).not.toMatch(/^\s*import\s/m)
    expect(bundle).not.toMatch(/^\s*export\s/m)
    execFileSync(process.execPath, ["--check", contentScriptPath], { stdio: "pipe" })
  })
})
