import {
  extractXAuthorStatsFromGraphql,
  extractXTweetFactsFromGraphql,
  extractXViewerFromGraphql,
  extractXViewerFromInitialState,
  mergeTweetFacts,
  type XAuthorStats,
  type XTweetFacts,
} from "../src/x-author-metadata.js"

type ScoreboarPageMessage = {
  readonly type: "scoreboar.authorMetadataBatch" | "scoreboar.tweetFactsBatch" | "scoreboar.viewer"
  readonly payload: unknown
}

// Enough for a long scrolling session; the oldest posts are long off screen.
const MAX_CACHED_TWEET_FACTS = 4000

type ScoreboarRequestMessage = {
  readonly type?: unknown
}

(() => {
  const globalScope = globalThis as typeof globalThis & { __scoreboarAuthorListenerInstalled?: boolean, __INITIAL_STATE__?: unknown }
  if (globalScope.__scoreboarAuthorListenerInstalled) return
  globalScope.__scoreboarAuthorListenerInstalled = true
  const statsByHandle = new Map<string, unknown>()
  const factsByTweetId = new Map<string, XTweetFacts>()
  let viewerHandle: string | null = null

  const debug = (message: string, details?: unknown) => {
    globalScope.console.info(`[Scoreboar author-listener] ${message}`, details ?? "")
  }

  const shouldInspectUrl = (url: string): boolean => {
    return /\/i\/api\/(?:1\.1\/)?graphql\//u.test(url)
  }

  const postStats = (payload: unknown) => {
    const stats = extractXAuthorStatsFromGraphql(payload)
    if (stats.length === 0) return
    for (const stat of stats) {
      statsByHandle.set(stat.authorHandle.toLowerCase(), stat)
    }
    debug("captured loaded X author stats", {
      batch: stats.length,
      cached: statsByHandle.size,
      handles: stats.slice(0, 12).map((stat) => stat.authorHandle),
    })
    const message: ScoreboarPageMessage = {
      type: "scoreboar.authorMetadataBatch",
      payload: [...statsByHandle.values()],
    }
    globalScope.postMessage(message, "*")
  }

  const postTweetFacts = (payload: unknown) => {
    const facts = extractXTweetFactsFromGraphql(payload)
    if (facts.length === 0) return
    // Sent and replayed as the fullest reading so far: a later response without a long post's note keeps the note.
    const kept = facts.map((fact) => {
      const merged = mergeTweetFacts(factsByTweetId.get(fact.tweetId), fact)
      factsByTweetId.delete(fact.tweetId)
      factsByTweetId.set(fact.tweetId, merged)
      return merged
    })
    while (factsByTweetId.size > MAX_CACHED_TWEET_FACTS) {
      const oldest = factsByTweetId.keys().next().value
      if (oldest === undefined) break
      factsByTweetId.delete(oldest)
    }
    const message: ScoreboarPageMessage = { type: "scoreboar.tweetFactsBatch", payload: kept }
    globalScope.postMessage(message, "*")
  }

  // The signed-in account, sent with its newest stats: later captures (Viewer, CreateTweet,
  // the profile) overwrite the same entry, so the composer and the feed read the same numbers.
  const postViewer = () => {
    if (!viewerHandle) return
    const message: ScoreboarPageMessage = { type: "scoreboar.viewer", payload: statsByHandle.get(viewerHandle.toLowerCase()) }
    globalScope.postMessage(message, "*")
  }

  const setViewer = (stats: XAuthorStats, source: string) => {
    const key = stats.authorHandle.toLowerCase()
    // A loaded response is newer than the page bootstrap, so the bootstrap never overwrites one.
    if (source !== "initial-state" || !statsByHandle.has(key)) statsByHandle.set(key, stats)
    viewerHandle = stats.authorHandle
    debug("identified signed-in account", { handle: viewerHandle, source })
    postViewer()
  }

  // X's page bootstrap names the signed-in account (session.user_id) and holds its
  // user object. Catch it as X's inline script assigns it, before any composer opens.
  const seedViewerFromInitialState = (state: unknown) => {
    try {
      const stats = extractXViewerFromInitialState(state)
      if (stats) setViewer(stats, "initial-state")
    } catch {
      // Never let reading X's bootstrap break X.
    }
  }
  try {
    if (globalScope.__INITIAL_STATE__ !== undefined) {
      seedViewerFromInitialState(globalScope.__INITIAL_STATE__)
    } else {
      let initialState: unknown
      Object.defineProperty(globalScope, "__INITIAL_STATE__", {
        configurable: true,
        enumerable: true,
        get: () => initialState,
        set: (value: unknown) => {
          initialState = value
          seedViewerFromInitialState(value)
        },
      })
    }
  } catch {
    // Already defined by the page as something we cannot wrap; DOMContentLoaded below still reads it.
  }
  globalScope.document?.addEventListener("DOMContentLoaded", () => {
    if (!viewerHandle) seedViewerFromInitialState(globalScope.__INITIAL_STATE__)
  })

  globalScope.addEventListener("message", (event: MessageEvent<ScoreboarRequestMessage>) => {
    if (event.data?.type !== "scoreboar.requestAuthorMetadataBatch") return
    debug("received cache replay request", { cached: statsByHandle.size, tweets: factsByTweetId.size })
    postViewer()
    if (factsByTweetId.size > 0) {
      const facts: ScoreboarPageMessage = { type: "scoreboar.tweetFactsBatch", payload: [...factsByTweetId.values()] }
      globalScope.postMessage(facts, "*")
    }
    if (statsByHandle.size === 0) return
    const message: ScoreboarPageMessage = {
      type: "scoreboar.authorMetadataBatch",
      payload: [...statsByHandle.values()],
    }
    globalScope.postMessage(message, "*")
  })

  const inspectPayload = (payload: unknown, source: "fetch" | "xhr", url: string) => {
    debug("inspecting X GraphQL response", { source, url: url.replace(/\?.*$/u, "") })
    postTweetFacts(payload)
    postStats(payload)
    const viewer = extractXViewerFromGraphql(payload)
    if (viewer) setViewer(viewer, "graphql")
  }

  const inspectResponse = (response: Response) => {
    if (!shouldInspectUrl(response.url)) return
    void response.clone().json().then((payload) => inspectPayload(payload, "fetch", response.url)).catch(() => undefined)
  }

  const originalFetch = globalScope.fetch
  if (typeof originalFetch === "function") {
    debug("wrapping fetch for loaded X author stats")
    globalScope.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await originalFetch(...args)
      inspectResponse(response)
      return response
    }
  }

  const OriginalXMLHttpRequest = globalScope.XMLHttpRequest
  if (typeof OriginalXMLHttpRequest === "function") {
    debug("wrapping XMLHttpRequest for loaded X author stats")
    const originalOpen = OriginalXMLHttpRequest.prototype.open
    const originalSend = OriginalXMLHttpRequest.prototype.send
    OriginalXMLHttpRequest.prototype.open = function patchedOpen(
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ) {
      ;(this as XMLHttpRequest & { __scoreboarRequestUrl?: string }).__scoreboarRequestUrl = String(url)
      return originalOpen.call(this, method, url, async ?? true, username ?? null, password ?? null)
    }
    OriginalXMLHttpRequest.prototype.send = function patchedSend(body?: Document | XMLHttpRequestBodyInit | null) {
      this.addEventListener("load", function onLoad() {
        const request = this as XMLHttpRequest & { __scoreboarRequestUrl?: string }
        const url = request.__scoreboarRequestUrl ?? request.responseURL
        if (!url || !shouldInspectUrl(url)) return
        if (typeof request.responseText !== "string" || request.responseText.length === 0) return
        try {
          inspectPayload(JSON.parse(request.responseText), "xhr", url)
        } catch {
          // Ignore non-JSON or inaccessible responses.
        }
      })
      return originalSend.call(this, body ?? null)
    }
  }
})()
