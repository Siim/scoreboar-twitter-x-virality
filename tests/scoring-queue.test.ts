import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"
import { createFeedBadgeController } from "../src/feed-badges"
import type { ScoreTextResult } from "../src/inference-runtime"

const scoredResult = (text: string): ScoreTextResult => ({
  status: "scored",
  label: "scored",
  confidence: 0.8,
  probabilities: { high: 0.8, medium: 0.2 },
  numericScores: {},
  message: "queued fixture score",
  model: {
    provider: "local-onnx",
    path: "extension/assets/model/v5-full.onnx",
    available: true,
  },
  metadataVector: [text.length],
})

describe("scoring queue guardrails", () => {
  it("keeps 50 tweet scoring requests under the configured concurrency limit", async () => {
    const concurrency = 4
    const tweetMarkup = Array.from({ length: 50 }, (_, index) => {
      return `<article data-testid="tweet"><div data-testid="tweetText">Queued local tweet ${index}</div></article>`
    }).join("")
    const dom = new JSDOM(`<main>${tweetMarkup}</main>`)
    const releaseScoring: Array<() => void> = []
    let activeCalls = 0
    let maxConcurrentCalls = 0
    let completedCalls = 0
    let totalCalls = 0

    const controller = createFeedBadgeController({
      document: dom.window.document,
      scoringConcurrency: concurrency,
      scorer: {
        scoreTweet: async (text) => {
          totalCalls += 1
          activeCalls += 1
          maxConcurrentCalls = Math.max(maxConcurrentCalls, activeCalls)

          await new Promise<void>((resolve) => {
            releaseScoring.push(resolve)
          })

          activeCalls -= 1
          completedCalls += 1
          return scoredResult(text)
        },
      },
    })

    const renderPromises = [...dom.window.document.querySelectorAll("article[data-testid='tweet']")].map((root) => {
      const text = root.textContent ?? ""
      return controller.renderTweetBadge({
        root,
        text,
        key: text,
        previousKey: null,
        changed: false,
        hasMedia: false,
        authorMetadata: {
          authorHandle: null,
          authorFollowers: null,
          authorFollowing: null,
          authorTweets: null,
          authorVerified: null,
          authorMetadataSource: "defaulted",
        },
      })
    })

    expect(activeCalls).toBe(concurrency)
    expect(releaseScoring).toHaveLength(concurrency)

    while (completedCalls < 50) {
      const release = releaseScoring.shift()
      expect(release).toBeDefined()
      release?.()
      await Promise.resolve()
      await Promise.resolve()
      expect(maxConcurrentCalls).toBeLessThanOrEqual(concurrency)
    }

    await Promise.all(renderPromises)
    expect(totalCalls).toBe(50)
    expect(maxConcurrentCalls).toBeLessThanOrEqual(concurrency)
  })
})
