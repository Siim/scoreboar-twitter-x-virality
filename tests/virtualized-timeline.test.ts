import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"
import {
  SCOREBOAR_TWEET_KEY_ATTRIBUTE,
  SCOREBOAR_TWEET_PROCESSED_ATTRIBUTE,
  createScoreboarDomDetector,
} from "../src/index"

describe("virtualized-timeline recycled tweet nodes", () => {
  it("rescans a recycled tweet root when logical text changes without stale state", () => {
    const dom = new JSDOM(`
      <main>
        <article data-testid="tweet">
          <div data-testid="tweetText">Original virtualized tweet text.</div>
        </article>
      </main>
    `)
    const tweetRoot = dom.window.document.querySelector("article")
    const tweetText = dom.window.document.querySelector('[data-testid="tweetText"]')
    const seen: Array<{ text: string; previousKey: string | null; changed: boolean }> = []
    const detector = createScoreboarDomDetector({
      root: dom.window.document,
      onTweetFound: ({ text, previousKey, changed }) => seen.push({ text, previousKey, changed }),
    })

    detector.scan()
    const firstKey = tweetRoot?.getAttribute(SCOREBOAR_TWEET_KEY_ATTRIBUTE)
    detector.scan()

    expect(seen).toEqual([
      { text: "Original virtualized tweet text.", previousKey: null, changed: false },
    ])
    expect(tweetRoot?.getAttribute(SCOREBOAR_TWEET_PROCESSED_ATTRIBUTE)).toBe("true")

    if (!tweetText) {
      throw new Error("missing tweet text fixture node")
    }
    tweetText.textContent = "Recycled timeline node now represents a different tweet."
    detector.scan()
    detector.scan()

    expect(seen).toEqual([
      { text: "Original virtualized tweet text.", previousKey: null, changed: false },
      {
        text: "Recycled timeline node now represents a different tweet.",
        previousKey: "Original virtualized tweet text.",
        changed: true,
      },
    ])
    expect(tweetRoot?.getAttribute(SCOREBOAR_TWEET_KEY_ATTRIBUTE)).toBe(
      "Recycled timeline node now represents a different tweet.",
    )
    expect(tweetRoot?.getAttribute(SCOREBOAR_TWEET_KEY_ATTRIBUTE)).not.toBe(firstKey)
  })
})
