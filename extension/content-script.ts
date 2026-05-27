import { extractTweetAuthorMetadata, extractTweetCreatedAtMetadata, extractTweetText, tweetHasMedia } from "../src/contracts.js"
import { createScoreboarDomDetector } from "../src/dom-detection.js"
import type { TweetFoundEvent } from "../src/dom-detection.js"
import { createComposerHintController } from "../src/composer-hints.js"
import { SCOREBOAR_COMPOSER_PANEL_ATTRIBUTE, SCOREBOAR_COMPOSER_STYLE_ATTRIBUTE } from "../src/composer-hints.js"
import { createFeedBadgeController } from "../src/feed-badges.js"
import { SCOREBOAR_BADGE_ATTRIBUTE, SCOREBOAR_BADGE_STYLE_ATTRIBUTE } from "../src/feed-badges.js"
import type { ScoreTextResponseMessage, ScoreTextResult } from "../src/inference-runtime.js"
import { createScoringGuardrails, createTextScoringCacheKey } from "../src/scoring-guardrails.js"
import type { XAuthorStats } from "../src/x-author-metadata.js"

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

(() => {
  const scoreTextMessageType = "scoreboar.scoreText"
  const enabledStorageKey = "scoreboarEnabled"
  const chromeApi = (globalThis as { chrome?: ScoreboarContentChrome }).chrome
  const authorStatsByHandle = new Map<string, XAuthorStats>()
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

  const startScoreboar = () => {
    if (typeof document === "undefined" || detector !== null) {
      return
    }
    const badgeController = createFeedBadgeController({
      document,
      scorer: {
        scoreTweet: async (text, metadata): Promise<ScoreTextResult | null> => {
          const response = await requestScoreText(text, metadata)
          return isScoreTextResponse(response) ? response.payload : null
        },
      },
    })
    const composerHintController = createComposerHintController({
      document,
      scorer: {
        scoreComposer: async (text, metadata): Promise<ScoreTextResult | null> => {
          const response = await requestScoreText(text, metadata)
          return isScoreTextResponse(response) ? response.payload : null
        },
      },
    })

    const enrichTweetEvent = (event: TweetFoundEvent): TweetFoundEvent => {
      const authorHandle = event.authorMetadata.authorHandle
      const cached = authorHandle ? authorStatsByHandle.get(authorHandle.toLowerCase()) : undefined
      if (!cached) {
        if (authorHandle) debug("author stats cache miss", { handle: authorHandle, cachedHandles: [...authorStatsByHandle.keys()].slice(0, 12) })
        return event
      }

      debug("author stats cache hit", {
        handle: authorHandle,
        followers: cached.authorFollowers,
        following: cached.authorFollowing,
        tweets: cached.authorTweets,
      })

      return {
        ...event,
        authorMetadata: {
          authorHandle: cached.authorHandle,
          authorFollowers: cached.authorFollowers ?? event.authorMetadata.authorFollowers,
          authorFollowing: cached.authorFollowing ?? event.authorMetadata.authorFollowing,
          authorTweets: cached.authorTweets ?? event.authorMetadata.authorTweets,
          authorVerified: cached.authorVerified ?? event.authorMetadata.authorVerified,
          authorMetadataSource: "loaded-x-response",
        },
      }
    }

    const renderTweetBadgeSafely = (event: TweetFoundEvent) => {
      void badgeController.renderTweetBadge(event).catch((error: unknown) => {
        handleScoreRequestError(error)
      })
    }

    const renderExistingTweetsWithCachedStats = () => {
      let rendered = 0
      for (const root of document.querySelectorAll("article[data-testid='tweet']")) {
        const text = extractTweetText(root).replace(/\s+/g, " ").trim()
        if (text.length === 0) continue
        rendered += 1
        const enriched = enrichTweetEvent({
          root,
          text,
          key: text,
          previousKey: text,
          changed: false,
          hasMedia: tweetHasMedia(root),
          authorMetadata: extractTweetAuthorMetadata(root),
          createdAtMetadata: extractTweetCreatedAtMetadata(root),
        })
        renderTweetBadgeSafely(enriched)
      }
      debug("refreshed visible tweets from author stats cache", { rendered, cachedHandles: authorStatsByHandle.size })
    }

    globalThis.addEventListener("message", (event) => {
      const message = event.data as ScoreboarAuthorMetadataMessage
      if (message.type !== "scoreboar.authorMetadataBatch" || !Array.isArray(message.payload)) return
      let updated = false
      let accepted = 0
      for (const item of message.payload) {
        if (!isXAuthorStats(item)) continue
        authorStatsByHandle.set(item.authorHandle.toLowerCase(), item)
        updated = true
        accepted += 1
      }
      debug("received author stats batch", { accepted, cachedHandles: authorStatsByHandle.size })
      if (updated) renderExistingTweetsWithCachedStats()
    })
    debug("requesting author stats cache replay")
    globalThis.postMessage({ type: "scoreboar.requestAuthorMetadataBatch" }, "*")

    detector = createScoreboarDomDetector({
      root: document,
      onTweetFound: (event) => {
        if (enabled) {
          renderTweetBadgeSafely(enrichTweetEvent(event))
        }
      },
      onComposerFound: (event) => {
        if (enabled) {
          composerHintController.renderComposerHints(event)
        }
      },
    })
    detector.observe()
  }

  const stopScoreboar = () => {
    detector?.disconnect()
    detector = null
    removeScoreboarUi()
  }

  globalThis.addEventListener("unhandledrejection", (event) => {
    if (!isExtensionContextInvalidated(event.reason)) return
    event.preventDefault()
    enabled = false
    stopScoreboar()
  })

  if (typeof document !== "undefined") {
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
