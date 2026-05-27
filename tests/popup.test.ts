import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("extension popup controls", () => {
  it("exposes only the stable enable switch", () => {
    const html = readFileSync(resolve("extension", "popup.html"), "utf8")
    const script = readFileSync(resolve("extension", "popup.js"), "utf8")

    expect(html).toContain('id="toggle"')
    expect(html).not.toContain("Only bangers")
    expect(html).not.toContain('id="bangers-toggle"')
    expect(script).toContain("scoreboarEnabled")
    expect(script).not.toContain("scoreboarOnlyBangers")
  })
})
