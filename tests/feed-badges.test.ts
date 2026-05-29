import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"
import {
  SCOREBOAR_BADGE_ATTRIBUTE,
  SCOREBOAR_BADGE_STATE_ATTRIBUTE,
  X_SELECTORS,
  createFeedBadgeController,
  createScoreboarDomDetector,
  createUnavailableScoreTextResult,
} from "../src/index"
import type { ScoreTextResult } from "../src/inference-runtime"

const fixture = (name: string) => readFileSync(resolve("fixtures", name), "utf8")

const badgeSelector = `[${SCOREBOAR_BADGE_ATTRIBUTE}="true"]`
const badgeValueText = (badge: HTMLElement): string | null => badge.querySelector(".scoreboar-feed-badge__value")?.textContent ?? null
const detailsForBadge = (badge: HTMLElement): HTMLElement | null => {
  const detailsId = badge.getAttribute("aria-controls")
  return detailsId ? badge.ownerDocument.getElementById(detailsId) : null
}

const scoredResult = (text: string, highProbability: number): ScoreTextResult => ({
  status: "scored",
  label: "scored",
  confidence: highProbability,
  probabilities: { high: highProbability, medium: 1 - highProbability },
  numericScores: { hook_quality: 0.91 },
  booleanScores: {},
  message: "deterministic badge fixture score",
  model: {
    provider: "local-onnx",
    path: "extension/assets/model/v5-full.onnx",
    available: true,
  },
  metadataVector: [text.length],
})

describe("feed badge UI", () => {
  it("renders one compact scored badge for each of the three fixture tweets without duplicates", async () => {
    const dom = new JSDOM(fixture("timeline.html"))
    const initialTweetTexts = [...dom.window.document.querySelectorAll(X_SELECTORS.tweetText)].map((node) => node.textContent)
    const badgeController = createFeedBadgeController({
      document: dom.window.document,
      scorer: {
        scoreTweet: async (text) => scoredResult(text, 1),
      },
    })
    const rendered: Array<Promise<void>> = []
    const detector = createScoreboarDomDetector({
      root: dom.window.document,
      onTweetFound: (event) => {
        rendered.push(badgeController.renderTweetBadge(event))
      },
    })

    detector.scan()
    detector.scan()
    await Promise.all(rendered)

    const badges = [...dom.window.document.querySelectorAll<HTMLElement>(badgeSelector)]
    expect(dom.window.document.querySelectorAll(X_SELECTORS.tweetRoot)).toHaveLength(3)
    expect(badges).toHaveLength(3)
    expect(badges.map((badge) => badge.getAttribute(SCOREBOAR_BADGE_STATE_ATTRIBUTE))).toEqual([
      "scored",
      "scored",
      "scored",
    ])
    expect(badges.map(badgeValueText)).toEqual([
      "🎯  75%",
      "🎯  75%",
      "🎯  75%",
    ])
    expect(badges[0]?.querySelector("img.scoreboar-boar")).toBeNull()
    const firstDetails = badges[0] ? detailsForBadge(badges[0]) : null
    expect(firstDetails?.textContent).toContain("Signals: hook 91%")
    expect(firstDetails?.textContent).not.toContain("Author stats:")
    expect(firstDetails?.textContent).not.toContain("Media:")
    expect([...dom.window.document.querySelectorAll(X_SELECTORS.tweetText)].map((node) => node.textContent)).toEqual(initialTweetTexts)
  })

  it("keeps a pending badge while fixture scoring is in flight", () => {
    const dom = new JSDOM(fixture("timeline.html"))
    const badgeController = createFeedBadgeController({
      document: dom.window.document,
      scorer: {
        scoreTweet: () => new Promise(() => undefined),
      },
    })
    const detector = createScoreboarDomDetector({
      root: dom.window.document,
      onTweetFound: (event) => {
        void badgeController.renderTweetBadge(event)
      },
    })

    detector.scan()

    const badges = [...dom.window.document.querySelectorAll<HTMLElement>(badgeSelector)]
    expect(badges).toHaveLength(3)
    expect(badges.map((badge) => badge.getAttribute(SCOREBOAR_BADGE_STATE_ATTRIBUTE))).toEqual([
      "pending",
      "pending",
      "pending",
    ])
    expect(badges.every((badge) => badgeValueText(badge) === "…")).toBe(true)
  })

  it("falls back to unavailable badges when ONNX scoring is unavailable", async () => {
    const dom = new JSDOM(fixture("timeline.html"))
    const badgeController = createFeedBadgeController({
      document: dom.window.document,
      scorer: {
        scoreTweet: async (text) => createUnavailableScoreTextResult(
          { text, metadata: { source: "fixture" } },
          "missing_local_onnx_artifact",
          "No packaged ONNX artifact in fixture tests.",
        ),
      },
    })
    const rendered: Array<Promise<void>> = []
    const detector = createScoreboarDomDetector({
      root: dom.window.document,
      onTweetFound: (event) => {
        rendered.push(badgeController.renderTweetBadge(event))
      },
    })

    detector.scan()
    await Promise.all(rendered)

    const badges = [...dom.window.document.querySelectorAll<HTMLElement>(badgeSelector)]
    expect(badges).toHaveLength(3)
    expect(badges.map((badge) => badge.getAttribute(SCOREBOAR_BADGE_STATE_ATTRIBUTE))).toEqual([
      "unavailable",
      "unavailable",
      "unavailable",
    ])
    expect(badges.every((badge) => badgeValueText(badge) === "—")).toBe(true)
  })

  it("still scores timeline previews when X truncates the tweet text", async () => {
    const dom = new JSDOM(`
      <article data-testid="tweet">
        <div data-testid="tweetText">i solved my pain by building a phone app that makes your</div>
        <a href="/siimh/status/2060333451543290334">5h</a>
        <span>Show more</span>
      </article>
    `)
    let scoreCalls = 0
    const badgeController = createFeedBadgeController({
      document: dom.window.document,
      scorer: {
        scoreTweet: async (text) => {
          scoreCalls += 1
          return scoredResult(text, 1)
        },
      },
    })
    const rendered: Array<Promise<void>> = []
    const detector = createScoreboarDomDetector({
      root: dom.window.document,
      onTweetFound: (event) => {
        rendered.push(badgeController.renderTweetBadge(event))
      },
    })

    detector.scan()
    await Promise.all(rendered)

    const badge = dom.window.document.querySelector<HTMLElement>(badgeSelector)
    const details = badge ? detailsForBadge(badge) : null
    expect(scoreCalls).toBe(1)
    expect(badge?.getAttribute(SCOREBOAR_BADGE_STATE_ATTRIBUTE)).toBe("scored")
    expect(badge ? badgeValueText(badge) : null).toBe("🎯  75%")
    expect(details?.textContent).toContain("🎯  75%")
  })

  it("shows red-flag warning chips and extra model stats for clickbait or slop", async () => {
    const dom = new JSDOM(`
      <article data-testid="tweet">
        <div data-testid="tweetText">You won't believe what happened next</div>
        <button aria-label="Grok actions">Grok</button>
      </article>
    `)
    const badgeController = createFeedBadgeController({
      document: dom.window.document,
      scorer: {
        scoreTweet: async (text) => ({
          ...scoredResult(text, 0.82),
          confidence: null,
          probabilities: { high: 0.82, medium: 0.12, low: 0.06 },
          numericScores: {
            hook_quality: 0.93,
            virality_score: 0.88,
            shareability_score: 0.72,
            novelty_score: 0.41,
            conversation_potential: 0.66,
          },
          booleanScores: {
            is_clickbait: 0.91,
            is_ai_slop: 0.74,
            is_rage_bait: 0.2,
            needs_context: 0.63,
          },
          metadataVector: [1, 2, 3, 4],
        }),
      },
    })
    const tweet = dom.window.document.querySelector<HTMLElement>(X_SELECTORS.tweetRoot)
    expect(tweet).not.toBeNull()

    await badgeController.renderTweetBadge({
      root: tweet!,
      text: "You won't believe what happened next",
      key: "red-flag-fixture",
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

    const badge = dom.window.document.querySelector<HTMLElement>(badgeSelector)
    const details = badge ? detailsForBadge(badge) : null
    expect(badge ? badgeValueText(badge) : null).toBe("🎣  88%")
    expect(details?.textContent).toContain("🎣  88%")
    expect(details?.textContent).toContain("Reliability: solid estimate")
    expect(details?.textContent).toContain("Style: clickbait")
    expect(details?.textContent).not.toContain("certainty high")
    expect(details?.textContent).not.toContain("features 4")
    expect(details?.textContent).toContain("Bucket odds: high bucket · 82% odds")
    expect(details?.textContent).not.toContain("Other buckets:")
    expect(details?.textContent).toContain("Red flags: 🚩 top: 🎣 clickbait🤖 slop 74%🎣 bait 91%🧩 needs context 63%")
    expect(details?.querySelectorAll('[data-scoreboar-chip-tone="danger"]')).toHaveLength(3)
  })

  it("describes close bucket odds as mixed instead of overconfident raw classes", async () => {
    const dom = new JSDOM(`
      <article data-testid="tweet">
        <div data-testid="tweetText">Measured update with a few possible reads</div>
        <button aria-label="Grok actions">Grok</button>
      </article>
    `)
    const badgeController = createFeedBadgeController({
      document: dom.window.document,
      scorer: {
        scoreTweet: async (text) => ({
          ...scoredResult(text, 0.27),
          confidence: null,
          probabilities: { medium: 0.27, high: 0.24, very_high: 0.23, low: 0.16, very_low: 0.1 },
          numericScores: { hook_quality: 0.55, shareability_score: 0.64, conversation_potential: 0.65, authenticity_score: 0.81 },
          booleanScores: {},
          metadataVector: Array.from({ length: 12 }, (_, index) => index),
        }),
      },
    })
    const tweet = dom.window.document.querySelector<HTMLElement>(X_SELECTORS.tweetRoot)
    expect(tweet).not.toBeNull()

    await badgeController.renderTweetBadge({
      root: tweet!,
      text: "Measured update with a few possible reads",
      key: "mixed-bucket-fixture",
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

    const badge = dom.window.document.querySelector<HTMLElement>(badgeSelector)
    const details = badge ? detailsForBadge(badge) : null
    expect(details?.textContent).toContain("Reliability: rough estimate")
    expect(details?.textContent).not.toContain("mixed model odds")
    expect(details?.textContent).not.toContain("certainty low")
    expect(details?.textContent).not.toContain("features 12")
    expect(details?.textContent).toContain("Bucket odds: medium–high buckets · 51% odds")
    expect(details?.textContent).toContain("Red flags: no strong flags")
    expect(details?.textContent).not.toContain("Other buckets:")
  })

  it("combines adjacent top buckets when the leading class is not strong", async () => {
    const dom = new JSDOM(`
      <article data-testid="tweet">
        <div data-testid="tweetText">Borderline high-ish update</div>
        <button aria-label="Grok actions">Grok</button>
      </article>
    `)
    const badgeController = createFeedBadgeController({
      document: dom.window.document,
      scorer: {
        scoreTweet: async (text) => ({
          ...scoredResult(text, 0.41),
          probabilities: { high: 0.41, medium: 0.33, very_high: 0.16, low: 0.1 },
          numericScores: { virality_score: 0.58, hook_quality: 0.6, shareability_score: 0.57 },
          booleanScores: { has_clear_takeaway: 0.66 },
          metadataVector: Array.from({ length: 12 }, (_, index) => index),
        }),
      },
    })
    const tweet = dom.window.document.querySelector<HTMLElement>(X_SELECTORS.tweetRoot)
    expect(tweet).not.toBeNull()

    await badgeController.renderTweetBadge({
      root: tweet!,
      text: "Borderline high-ish update",
      key: "range-fixture",
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

    const badge = dom.window.document.querySelector<HTMLElement>(badgeSelector)
    const details = badge ? detailsForBadge(badge) : null
    expect(badge ? badgeValueText(badge) : null).toBe("🤔  58%")
    expect(details?.textContent).toContain("🤔  58%")
    expect(details?.textContent).toContain("Style: rough read")
    expect(details?.textContent).toContain("Bucket odds: medium–high buckets · 74% odds")
  })

  it("keeps badge score and details title aligned when bucket odds differ", async () => {
    const dom = new JSDOM(`
      <article data-testid="tweet">
        <div data-testid="tweetText">Score and odds can be different without being contradictory</div>
        <button aria-label="Grok actions">Grok</button>
      </article>
    `)
    const badgeController = createFeedBadgeController({
      document: dom.window.document,
      scorer: {
        scoreTweet: async (text) => ({
          ...scoredResult(text, 0.69),
          probabilities: { high: 0.69, medium: 0.12, very_high: 0.09, low: 0.07, very_low: 0.03 },
          numericScores: { virality_score: 0.65, hook_quality: 0.7 },
          booleanScores: {},
          metadataVector: Array.from({ length: 12 }, (_, index) => index),
        }),
      },
    })
    const tweet = dom.window.document.querySelector<HTMLElement>(X_SELECTORS.tweetRoot)
    expect(tweet).not.toBeNull()

    await badgeController.renderTweetBadge({
      root: tweet!,
      text: "Score and odds can be different without being contradictory",
      key: "score-odds-fixture",
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

    const badge = dom.window.document.querySelector<HTMLElement>(badgeSelector)
    const details = badge ? detailsForBadge(badge) : null
    expect(badge ? badgeValueText(badge) : null).toBe("😎  65%")
    expect(details?.querySelector(".scoreboar-feed-badge__details-title")?.textContent).toBe("😎  65%")
    expect(details?.textContent).toContain("Bucket odds: high bucket · 69% odds")
    expect(details?.textContent).not.toContain("Likely range: high 69%")
  })

  it("places the badge before a native Grok/top-tools target when present", async () => {
    const dom = new JSDOM(`
      <article data-testid="tweet">
        <div data-testid="tweetText">Tool placement fixture</div>
        <button aria-label="Grok actions">Grok</button>
      </article>
    `)
    const badgeController = createFeedBadgeController({
      document: dom.window.document,
      scorer: {
        scoreTweet: async (text) => scoredResult(text, 1),
      },
    })
    const tweet = dom.window.document.querySelector<HTMLElement>(X_SELECTORS.tweetRoot)
    expect(tweet).not.toBeNull()

    await badgeController.renderTweetBadge({
      root: tweet!,
      text: "Tool placement fixture",
      key: "Tool placement fixture",
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

    const badge = dom.window.document.querySelector<HTMLElement>(badgeSelector)
    const grok = dom.window.document.querySelector<HTMLElement>('[aria-label="Grok actions"]')
    expect(badge?.getAttribute("data-scoreboar-feed-badge-placement")).toBe("top-tools")
    expect(badge?.nextElementSibling).toBe(grok)
  })

  it("anchors placement to the actual native button instead of a wrapping div", async () => {
    const dom = new JSDOM(`
      <article data-testid="tweet">
        <div data-testid="tweetText">Nested tool fixture</div>
        <div data-testid="tool-wrapper"><button aria-label="Grok actions"><span data-testid="grok-icon">Grok</span></button></div>
      </article>
    `)
    const badgeController = createFeedBadgeController({
      document: dom.window.document,
      scorer: { scoreTweet: async (text) => scoredResult(text, 1) },
    })
    const tweet = dom.window.document.querySelector<HTMLElement>(X_SELECTORS.tweetRoot)
    expect(tweet).not.toBeNull()

    await badgeController.renderTweetBadge({
      root: tweet!,
      text: "Nested tool fixture",
      key: "Nested tool fixture",
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

    const badge = dom.window.document.querySelector<HTMLElement>(badgeSelector)
    const button = dom.window.document.querySelector<HTMLElement>('[aria-label="Grok actions"]')
    expect(badge?.nextElementSibling).toBe(button)
    expect(dom.window.document.querySelector('[data-testid="tool-wrapper"]')?.firstElementChild).toBe(badge)
  })

  it("opens score details from the badge trigger", async () => {
    const dom = new JSDOM(`
      <article data-testid="tweet">
        <div data-testid="tweetText">Details fixture</div>
        <button aria-label="Grok actions">Grok</button>
      </article>
    `, { pretendToBeVisual: true })
    const badgeController = createFeedBadgeController({
      document: dom.window.document,
      scorer: {
        scoreTweet: async (text) => scoredResult(text, 1),
      },
    })
    const tweet = dom.window.document.querySelector<HTMLElement>(X_SELECTORS.tweetRoot)
    expect(tweet).not.toBeNull()

    await badgeController.renderTweetBadge({
      root: tweet!,
      text: "Details fixture",
      key: "Details fixture",
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

    const badge = dom.window.document.querySelector<HTMLElement>(badgeSelector)
    expect(badge?.querySelector(".scoreboar-feed-badge__help")).toBeNull()
    expect(badge?.getAttribute("role")).toBe("button")
    expect(badge?.getAttribute("tabindex")).toBe("0")
    expect(badge?.getAttribute("aria-expanded")).toBe("false")

    badge?.click()

    expect(badge?.getAttribute("data-scoreboar-feed-badge-open")).toBe("true")
    expect(badge?.getAttribute("aria-expanded")).toBe("true")
    expect(badge?.getAttribute("aria-controls")).toBeTruthy()
    const details = badge ? detailsForBadge(badge) : null
    expect(details?.parentElement).toBe(dom.window.document.body)
    expect(details?.getAttribute("data-scoreboar-feed-details-open")).toBe("true")
    expect(details?.textContent).toContain("Bucket odds:")
    expect(details?.textContent).not.toContain("Author stats:")
    expect(details?.getAttribute("style")).toContain("--scoreboar-popover-top")
    expect(details?.getAttribute("style")).toContain("--scoreboar-popover-arrow-left")
  })

  it("passes local media detection into scoring and details", async () => {
    const seenMetadata: Record<string, unknown>[] = []
    const createdAt = "2026-05-26T13:45:00.000Z"
    const createdAtDate = new Date(createdAt)
    const dom = new JSDOM(`
      <article data-testid="tweet">
        <a href="/fixture/status/1"><time datetime="${createdAt}">May 26</time></a>
        <div data-testid="tweetText">Media fixture</div>
        <div data-testid="tweetPhoto"></div>
      </article>
    `)
    const badgeController = createFeedBadgeController({
      document: dom.window.document,
      scorer: {
        scoreTweet: async (text, metadata) => {
          seenMetadata.push(metadata)
          return scoredResult(text, 1)
        },
      },
    })
    const rendered: Array<Promise<void>> = []
    const detector = createScoreboarDomDetector({
      root: dom.window.document,
      onTweetFound: (event) => {
        rendered.push(badgeController.renderTweetBadge(event))
      },
    })

    detector.scan()
    await Promise.all(rendered)

    const badge = dom.window.document.querySelector<HTMLElement>(badgeSelector)
    expect(seenMetadata[0]?.hasMedia).toBe(true)
    expect(seenMetadata[0]?.createdAtHour).toBe(createdAtDate.getHours())
    expect(seenMetadata[0]?.createdAtDay).toBe(createdAtDate.getDay())
    expect(seenMetadata[0]?.createdAtSource).toBe("tweet-time")
    expect(badge ? detailsForBadge(badge)?.textContent : null).not.toContain("Media:")
  })

  it("passes same-page author metadata into scoring and details", async () => {
    const seenMetadata: Record<string, unknown>[] = []
    const dom = new JSDOM(`
      <article data-testid="tweet">
        <a href="/nikitaboar">@nikitaboar</a>
        <span aria-label="Verified account">Verified</span>
        <div hidden>12.4K Followers 321 Following 777 Posts</div>
        <div data-testid="tweetText">Author metadata fixture</div>
      </article>
    `)
    const badgeController = createFeedBadgeController({
      document: dom.window.document,
      scorer: {
        scoreTweet: async (text, metadata) => {
          seenMetadata.push(metadata)
          return scoredResult(text, 1)
        },
      },
    })
    const rendered: Array<Promise<void>> = []
    const detector = createScoreboarDomDetector({
      root: dom.window.document,
      onTweetFound: (event) => {
        rendered.push(badgeController.renderTweetBadge(event))
      },
    })

    detector.scan()
    await Promise.all(rendered)

    const badge = dom.window.document.querySelector<HTMLElement>(badgeSelector)
    expect(seenMetadata[0]).toMatchObject({
      authorHandle: "nikitaboar",
      authorFollowers: 12400,
      authorFollowing: 321,
      authorTweets: 777,
      authorVerified: true,
      authorMetadataSource: "same-page-dom",
    })
    const details = badge ? detailsForBadge(badge) : null
    expect(details?.textContent).not.toContain("Author stats:")
    expect(details?.textContent).not.toContain("@nikitaboar:")
  })
})
