import { extractXAuthorStatsFromGraphql } from "../src/x-author-metadata.js"

type ScoreboarPageMessage = {
  readonly type: "scoreboar.authorMetadataBatch"
  readonly payload: unknown
}

type ScoreboarRequestMessage = {
  readonly type?: unknown
}

(() => {
  const globalScope = globalThis as typeof globalThis & { __scoreboarAuthorListenerInstalled?: boolean }
  if (globalScope.__scoreboarAuthorListenerInstalled) return
  globalScope.__scoreboarAuthorListenerInstalled = true
  const statsByHandle = new Map<string, unknown>()

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

  globalScope.addEventListener("message", (event: MessageEvent<ScoreboarRequestMessage>) => {
    if (event.data?.type !== "scoreboar.requestAuthorMetadataBatch") return
    debug("received cache replay request", { cached: statsByHandle.size })
    if (statsByHandle.size === 0) return
    const message: ScoreboarPageMessage = {
      type: "scoreboar.authorMetadataBatch",
      payload: [...statsByHandle.values()],
    }
    globalScope.postMessage(message, "*")
  })

  const inspectPayload = (payload: unknown, source: "fetch" | "xhr", url: string) => {
    debug("inspecting X GraphQL response", { source, url: url.replace(/\?.*$/u, "") })
    postStats(payload)
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
