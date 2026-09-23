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
  describeTweetRoot,
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
  performance: { percentile: 0.75, engagementMultiple: 1.8, reachMultiple: 2.4 },
  numericScores: { hook_quality: 0.91 },
  booleanScores: {},
  message: "deterministic badge fixture score",
  model: {
    provider: "local-onnx",
    path: "extension/assets/model/scoreboar-v8.onnx",
    version: "v8",
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
    expect(badges.map(badgeValueText)).toEqual(["75", "75", "75"])
    expect(badges.map((badge) => badge.querySelector(".scoreboar-meter")?.getAttribute("data-level"))).toEqual(["4", "4", "4"])
    expect(badges[0]?.querySelector("img.scoreboar-boar")).toBeNull()
    const firstDetails = badges[0] ? detailsForBadge(badges[0]) : null
    expect(firstDetails?.textContent).toContain("Beats 75%")
    expect(firstDetails?.textContent).toContain("About 1.8× the usual engagement, 2.4× the usual views")
    expect(firstDetails?.textContent).toContain("SignalsOpening line9.1/10")
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
    expect(badges.every((badge) => badgeValueText(badge) === "")).toBe(true)
    expect(badges.every((badge) => badge.querySelector(".scoreboar-meter")?.getAttribute("data-tone") === "pending")).toBe(true)
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
    expect(badges.every((badge) => badgeValueText(badge) === "")).toBe(true)
    expect(badges.every((badge) => badge.querySelector(".scoreboar-meter")?.getAttribute("data-tone") === "off")).toBe(true)
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
          performance: { percentile: 0.88, engagementMultiple: 2.1, reachMultiple: 2.6 },
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
    expect(badge ? badgeValueText(badge) : null).toBe("88")
    expect(badge?.querySelector(".scoreboar-feed-badge__flag")?.textContent).toBe("bait")
    expect(details?.textContent).toContain("Beats 88%")
    expect(details?.textContent).toContain("Top fifth 0% · Bottom fifth 0%")
    expect(details?.textContent).toContain("Red flagsslop 74%bait 91%")
    expect(details?.textContent).not.toContain("needs context")
    expect(details?.querySelectorAll('[data-scoreboar-chip-tone="danger"]')).toHaveLength(2)
  })

  it("shows an older model's single most likely fifth, never a merged range", async () => {
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
          performance: null,
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
    expect(details?.textContent).toContain("Most likely medium 27%")
    expect(details?.textContent).toContain("Red flagsnone")
    expect(details?.textContent).not.toContain("range")
  })

  it("states calibrated odds plainly for a borderline post", async () => {
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
          performance: { percentile: 0.58, engagementMultiple: 1.2, reachMultiple: 1.1 },
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
    expect(badge ? badgeValueText(badge) : null).toBe("58")
    expect(details?.textContent).toContain("Beats 58%")
    expect(details?.textContent).toContain("Top fifth 16% · Bottom fifth 0%")
    expect(details?.textContent).not.toContain("–")
    expect(details?.querySelectorAll('.scoreboar-feed-badge__scale-step[data-on="true"]')).toHaveLength(3)
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
    expect(details?.textContent).toContain("Top fifth")
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
    // v2 contract: the exact post time, read in UTC by the model.
    expect(seenMetadata[0]?.createdAt).toBe(createdAtDate.toISOString())
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

describe("a long post the timeline cut short", () => {
  it("is not scored on its preview; the full text from X's response is", async () => {
    const dom = new JSDOM(`<article data-testid="tweet"><div data-testid="tweetText">Start of a long post</div><button data-testid="tweet-text-show-more-link">Show more</button></article>`)
    const root = dom.window.document.querySelector("article")!
    const timers: Array<() => void> = []
    const scoredTexts: string[] = []
    const controller = createFeedBadgeController({
      document: dom.window.document,
      scheduler: (callback) => {
        timers.push(callback)
        return () => undefined
      },
      scorer: {
        scoreTweet: async (text) => {
          scoredTexts.push(text)
          return scoredResult(text, 1)
        },
      },
    })
    const event = {
      ...describeTweetRoot(root),
      previousKey: null,
      changed: false,
    }
    expect(event.textTruncated).toBe(true)

    await controller.renderTweetBadge(event)
    const badge = dom.window.document.querySelector<HTMLElement>(badgeSelector)!
    expect(scoredTexts).toEqual([])
    expect(badge.getAttribute(SCOREBOAR_BADGE_STATE_ATTRIBUTE)).toBe("pending")

    // X's response arrives with the whole note before the wait is over.
    await controller.renderTweetBadge({ ...event, text: "Start of a long post that goes on and on", textTruncated: false })
    timers.forEach((timer) => timer())
    expect(scoredTexts).toEqual(["Start of a long post that goes on and on"])
    expect(badge.getAttribute(SCOREBOAR_BADGE_STATE_ATTRIBUTE)).toBe("scored")

    // Without it, the badge gives up rather than score a different, shorter post.
    await controller.renderTweetBadge(event)
    timers.at(-1)?.()
    expect(badge.getAttribute(SCOREBOAR_BADGE_STATE_ATTRIBUTE)).toBe("unavailable")
    expect(scoredTexts).toHaveLength(1)
  })
})
