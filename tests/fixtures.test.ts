import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const fixture = (name: string) => readFileSync(resolve("fixtures", name), "utf8")

describe("local HTML fixtures", () => {
  it("provides exactly three timeline tweet roots with tweet text nodes", () => {
    const html = fixture("timeline.html")
    const tweetRoots = html.match(/<article\b[^>]*data-testid="tweet"/g) ?? []
    const tweetTexts = html.match(/data-testid="tweetText"/g) ?? []

    expect(tweetRoots).toHaveLength(3)
    expect(tweetTexts).toHaveLength(3)
  })

  it("provides a local editable composer without posting behavior", () => {
    const html = fixture("composer.html")

    expect(html).toContain('data-testid="tweetTextarea_0"')
    expect(html).toContain('contenteditable="true"')
    expect(html).toContain('type="button" disabled')
    expect(html).not.toMatch(/<form\b|action=|fetch\(|XMLHttpRequest|sendBeacon/)
  })
})
