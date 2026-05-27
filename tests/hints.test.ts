import { describe, expect, it } from "vitest"
import { analyzeComposerHints } from "../src/score-mapping"

describe("composer hints", () => {
  it("returns deterministic empty state with no active hints for empty composer text", () => {
    const result = analyzeComposerHints("   \n")

    expect(result.status).toBe("empty")
    expect(result.activeHints).toEqual([])
    expect(result.allHints.map((hint) => hint.id)).toEqual(["hook_clarity", "length", "specificity", "cta", "media_cue"])
    expect(result.allHints.every((hint) => hint.active === false)).toBe(true)
  })

  it("keeps hint output stable and ordered for broad improvements", () => {
    const result = analyzeComposerHints("nice update")

    expect(result.status).toBe("ready")
    expect(result.activeHints.map((hint) => hint.id)).toEqual(["hook_clarity", "length", "specificity", "cta"])
  })

  it("activates media cue only when visual language lacks attached media", () => {
    expect(analyzeComposerHints("What does this chart show today? reply with your guess", { hasMedia: false }).activeHints.map((hint) => hint.id)).toEqual([
      "media_cue",
    ])
    expect(analyzeComposerHints("What does this chart show today? reply with your guess", { hasMedia: true }).activeHints).toEqual([])
  })

  it("does not activate hints for a compact, specific composer with CTA", () => {
    expect(analyzeComposerHints("What changed in 30 days? Reply with your best guess.", { hasMedia: false }).activeHints).toEqual([])
  })
})
