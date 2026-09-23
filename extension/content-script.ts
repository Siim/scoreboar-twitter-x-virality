import { createScoreboarDomDetector, describeTweetRoot, readViewerAuthorMetadata } from "../src/dom-detection.js"
import type { TweetFoundEvent } from "../src/dom-detection.js"
import { createComposerHintController } from "../src/composer-hints.js"
import { SCOREBOAR_COMPOSER_PANEL_ATTRIBUTE, SCOREBOAR_COMPOSER_STYLE_ATTRIBUTE } from "../src/composer-hints.js"
import { createFeedBadgeController } from "../src/feed-badges.js"
import { SCOREBOAR_BADGE_ATTRIBUTE, SCOREBOAR_BADGE_STYLE_ATTRIBUTE } from "../src/feed-badges.js"
import type { ScoreTextResponseMessage, ScoreTextResult } from "../src/inference-runtime.js"
import { createScoringGuardrails, createTextScoringCacheKey } from "../src/scoring-guardrails.js"
// Plain imports only: the classic content-script bundle drops import lines, so an alias would not exist there.
import { enrichTweetEvent, type XAuthorStats, type XTweetFacts } from "../src/x-author-metadata.js"

type ScoreboarContentChrome = {
  readonly runtime?: {
    readonly id?: string
    readonly sendMessage?: (message: unknown) => Promise<unknown>
  }
  readonly storage?: {
    readonly local?: {
      readonly get?: (defaults: Record<string, unknown>) => Promise<Record<string, unknown>>
    }
    readonly onChanged?: {
      readonly addListener?: (listener: (changes: Record<string, { readonly newValue?: unknown }>, areaName: string) => void) => void
    }
  }
}

type ScoreboarContentRuntime = {
  readonly requestScoreText: (text: string, metadata?: Record<string, unknown>) => Promise<unknown>
}

type ScoreboarContentScoreRequest = {
  readonly text: string
  readonly metadata: Record<string, unknown>
}

type ScoreboarAuthorMetadataMessage = {
  readonly type?: unknown
  readonly payload?: unknown
}

const isScoreTextResponse = (value: unknown): value is ScoreTextResponseMessage => {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "scoreboar.scoreText.response"
}

const isXAuthorStats = (value: unknown): value is XAuthorStats => {
  const record = value as Partial<XAuthorStats> | null
  return typeof value === "object" && value !== null && typeof record?.authorHandle === "string"
}

// Posts are at most 25,000 characters; anything longer is not X's text.
const MAX_FACTS_TEXT_LENGTH = 30_000

const isXTweetFacts = (value: unknown): value is XTweetFacts => {
  const record = value as Partial<XTweetFacts> | null
  if (typeof value !== "object" || value === null || typeof record?.tweetId !== "string" || !Array.isArray(record?.mediaTypes)) return false
  const text = record.text
  return text === undefined || text === null || (typeof text === "string" && text.length <= MAX_FACTS_TEXT_LENGTH)
}

(() => {
  const scoreTextMessageType = "scoreboar.scoreText"
  const enabledStorageKey = "scoreboarEnabled"
  const chromeApi = (globalThis as { chrome?: ScoreboarContentChrome }).chrome
  const authorStatsByHandle = new Map<string, XAuthorStats>()
  const tweetFactsById = new Map<string, XTweetFacts>()
  // Who is signed in, as X's own data says (page bootstrap, Viewer query, the post just created).
  let viewerHandle: string | null = null
  let refreshScheduled = false
  let enabled = true
  let detector: ReturnType<typeof createScoreboarDomDetector> | null = null
  const contentScoreGuardrails = createScoringGuardrails<ScoreboarContentScoreRequest, unknown>({
    keyFor: (request) => createTextScoringCacheKey(request.text, request.metadata),
  })

  const debug = (message: string, details?: unknown) => {
    console.info(`[Scoreboar content] ${message}`, details ?? "")
  }

  const readEnabled = async (): Promise<boolean> => {
    try {
      const stored = await chromeApi?.storage?.local?.get?.({ [enabledStorageKey]: true })
      return stored?.[enabledStorageKey] !== false
    } catch {
      return true
    }
  }

  const isExtensionContextInvalidated = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error)
    return /Extension context (?:was )?invalidated|Could not establish connection|Receiving end does not exist|message port closed/iu.test(message)
  }

  const isExtensionContextAlive = (): boolean => {
    try {
      return Boolean(chromeApi?.runtime?.id)
    } catch {
      return false
    }
  }

  const handleScoreRequestError = (error: unknown): null => {
    if (isExtensionContextInvalidated(error)) {
      enabled = false
      stopScoreboar()
      return null
    }
    console.info("[Scoreboar content] score request failed", error)
    return null
  }

  const removeScoreboarUi = () => {
    document.querySelectorAll(`[${SCOREBOAR_BADGE_ATTRIBUTE}="true"], [${SCOREBOAR_COMPOSER_PANEL_ATTRIBUTE}="true"]`).forEach((node) => node.remove())
    document.querySelectorAll(".scoreboar-feed-badge__details").forEach((node) => node.remove())
    document.querySelectorAll(`style[${SCOREBOAR_BADGE_STYLE_ATTRIBUTE}="true"], style[${SCOREBOAR_COMPOSER_STYLE_ATTRIBUTE}="true"]`).forEach((node) => node.remove())
  }

  const requestScoreText: ScoreboarContentRuntime["requestScoreText"] = async (text, metadata = {}) => {
    const request = {
      text,
      metadata: {
        source: "unknown",
        ...metadata,
      },
    }

    try {
      return await contentScoreGuardrails.score(request, async (guardedRequest) => {
        if (!enabled) {
          return null
        }
        if (!isExtensionContextAlive()) {
          enabled = false
          stopScoreboar()
          return null
        }
        const sendMessage = chromeApi?.runtime?.sendMessage
        if (!sendMessage) {
          return null
        }
        return await sendMessage({
          type: scoreTextMessageType,
          payload: {
            text: guardedRequest.text,
            metadata: guardedRequest.metadata,
          },
        })
      })
    } catch (error) {
      return handleScoreRequestError(error)
    }
  }

  ;(globalThis as { scoreboarContentRuntime?: ScoreboarContentRuntime }).scoreboarContentRuntime = {
    requestScoreText,
  }

  // Set while Scoreboar runs, cleared when it stops: nothing that outlives a stop may reach the page through an old controller.
  let badgeController: ReturnType<typeof createFeedBadgeController> | null = null
  let composerHintController: ReturnType<typeof createComposerHintController> | null = null
  // The signed-in author's stats as the open drafts were last scored with.
  let lastViewerSignature = ""

  const running = (): boolean => enabled && detector !== null

  // The draft's author is read from the same sources, in the same order, as the feed reads that author's posts.
  const viewerMetadata = () => readViewerAuthorMetadata(document, viewerHandle, authorStatsByHandle)

  const enrichForBadge = (domEvent: TweetFoundEvent): TweetFoundEvent => {
    const event = enrichTweetEvent(domEvent, tweetFactsById, authorStatsByHandle)
    const authorHandle = event.authorMetadata.authorHandle
    if (event.authorMetadata.authorMetadataSource === "loaded-x-response") {
      debug("author stats cache hit", {
        handle: authorHandle,
        followers: event.authorMetadata.authorFollowers,
        following: event.authorMetadata.authorFollowing,
        tweets: event.authorMetadata.authorTweets,
      })
    } else if (authorHandle) {
      debug("author stats cache miss", { handle: authorHandle, cachedHandles: [...authorStatsByHandle.keys()].slice(0, 12) })
    }
    return event
  }

  // A draft typed before the signed-in author's stats arrived is rescored once they do.
  // Compared by value: the page listener re-sends its whole cache with every batch.
  const refreshComposersIfViewerChanged = () => {
    if (!running() || composerHintController === null) return
    const signature = JSON.stringify(viewerMetadata())
    if (signature === lastViewerSignature) return
    lastViewerSignature = signature
    debug("signed-in author stats changed; rescoring open drafts", { handle: viewerHandle })
    composerHintController.refresh()
  }

  const renderTweetBadgeSafely = (event: TweetFoundEvent) => {
    if (badgeController === null) return
    void badgeController.renderTweetBadge(event).catch((error: unknown) => {
      handleScoreRequestError(error)
    })
  }

  const renderExistingTweetsWithCachedStats = () => {
    refreshScheduled = false
    if (!running()) return
    let rendered = 0
    for (const root of document.querySelectorAll("article[data-testid='tweet']")) {
      const described = describeTweetRoot(root)
      if (described.text.length === 0) continue
      rendered += 1
      renderTweetBadgeSafely(enrichForBadge({ ...described, previousKey: described.key, changed: false }))
    }
    debug("refreshed visible tweets from loaded X data", { rendered, cachedHandles: authorStatsByHandle.size, cachedTweets: tweetFactsById.size })
  }

  // Responses arrive in bursts while scrolling; rescore once per burst.
  const scheduleRefresh = () => {
    if (!running() || refreshScheduled) return
    refreshScheduled = true
    globalThis.setTimeout(renderExistingTweetsWithCachedStats, 250)
  }

  // Registered once for the page's life. What X loads is kept even while Scoreboar is off, so it is
  // ready when it comes back on; only a running Scoreboar rescores anything.
  const handlePageMessage = (event: MessageEvent) => {
    const message = event.data as ScoreboarAuthorMetadataMessage
    if (message?.type === "scoreboar.viewer") {
      if (!isXAuthorStats(message.payload)) return
      viewerHandle = message.payload.authorHandle
      authorStatsByHandle.set(message.payload.authorHandle.toLowerCase(), message.payload)
      refreshComposersIfViewerChanged()
      return
    }
    if (!Array.isArray(message?.payload)) return
    if (message.type === "scoreboar.tweetFactsBatch") {
      let accepted = 0
      for (const item of message.payload) {
        if (!isXTweetFacts(item)) continue
        tweetFactsById.set(item.tweetId, item)
        accepted += 1
      }
      if (accepted > 0) scheduleRefresh()
      return
    }
    if (message.type !== "scoreboar.authorMetadataBatch") return
    let updated = false
    let accepted = 0
    for (const item of message.payload) {
      if (!isXAuthorStats(item)) continue
      authorStatsByHandle.set(item.authorHandle.toLowerCase(), item)
      updated = true
      accepted += 1
    }
    debug("received author stats batch", { accepted, cachedHandles: authorStatsByHandle.size })
    if (updated) {
      scheduleRefresh()
      refreshComposersIfViewerChanged()
    }
  }

  const startScoreboar = () => {
    if (typeof document === "undefined" || detector !== null) {
      return
    }
    badgeController = createFeedBadgeController({
      document,
      scorer: {
        scoreTweet: async (text, metadata): Promise<ScoreTextResult | null> => {
          const response = await requestScoreText(text, metadata)
          return isScoreTextResponse(response) ? response.payload : null
        },
      },
    })
    const composers = createComposerHintController({
      document,
      viewerMetadata,
      scorer: {
        scoreComposer: async (text, metadata): Promise<ScoreTextResult | null> => {
          const response = await requestScoreText(text, metadata)
          return isScoreTextResponse(response) ? response.payload : null
        },
      },
    })
    composerHintController = composers
    lastViewerSignature = JSON.stringify(viewerMetadata())

    detector = createScoreboarDomDetector({
      root: document,
      onTweetFound: (event) => {
        if (enabled) {
          renderTweetBadgeSafely(enrichForBadge(event))
        }
      },
      onComposerFound: (event) => {
        if (enabled) {
          composers.renderComposerHints(event)
        }
      },
    })
    debug("requesting author stats cache replay")
    globalThis.postMessage({ type: "scoreboar.requestAuthorMetadataBatch" }, "*")
    detector.observe()
  }

  const stopScoreboar = () => {
    detector?.disconnect()
    detector = null
    composerHintController?.dispose()
    composerHintController = null
    badgeController = null
    removeScoreboarUi()
  }

  globalThis.addEventListener("unhandledrejection", (event) => {
    if (!isExtensionContextInvalidated(event.reason)) return
    event.preventDefault()
    enabled = false
    stopScoreboar()
  })

  if (typeof document !== "undefined") {
    globalThis.addEventListener("message", handlePageMessage)
    void readEnabled().then((storedEnabled) => {
      enabled = storedEnabled
      if (enabled) {
        startScoreboar()
      } else {
        stopScoreboar()
      }
    })
    try {
      chromeApi?.storage?.onChanged?.addListener?.((changes, areaName) => {
        if (areaName !== "local") return
        if (!(enabledStorageKey in changes)) return
        enabled = changes[enabledStorageKey]?.newValue !== false
        if (enabled) {
          startScoreboar()
        } else {
          stopScoreboar()
        }
      })
    } catch (error) {
      handleScoreRequestError(error)
    }
  }

  ;(globalThis as { scoreboarContentRuntimeLoaded?: boolean }).scoreboarContentRuntimeLoaded = true
})()
