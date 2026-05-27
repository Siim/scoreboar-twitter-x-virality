import {
  createScoreTextOffscreenRequest,
  createScoreTextResponse,
  createUnavailableScoreTextResult,
  isScoreTextRequestMessage,
} from "../src/inference-runtime.js"

type ChromeSendResponse = (response?: unknown) => void

type ChromeRuntimeLike = {
  readonly lastError?: { readonly message?: string }
  readonly onMessage?: {
    readonly addListener: (
      listener: (message: unknown, sender: unknown, sendResponse: ChromeSendResponse) => boolean | void,
    ) => void
  }
  readonly sendMessage?: (message: unknown) => Promise<unknown>
}

type ChromeOffscreenLike = {
  readonly createDocument?: (options: {
    readonly url: string
    readonly reasons: readonly string[]
    readonly justification: string
  }) => Promise<void>
  readonly hasDocument?: () => Promise<boolean>
}

type ChromeExtensionLike = {
  readonly runtime?: ChromeRuntimeLike
  readonly offscreen?: ChromeOffscreenLike
}

const chromeApi = (globalThis as { chrome?: ChromeExtensionLike }).chrome

let creatingOffscreenDocument: Promise<void> | null = null

const ensureOffscreenDocument = async (): Promise<void> => {
  if (!chromeApi?.offscreen?.createDocument) {
    throw new Error("Chrome offscreen API is unavailable")
  }

  if (chromeApi.offscreen.hasDocument && await chromeApi.offscreen.hasDocument()) {
    return
  }

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chromeApi.offscreen.createDocument({
      url: "extension/offscreen.html",
      reasons: ["WORKERS"],
      justification: "Keep local-only Scoreboar inference in an extension document while the service worker routes messages.",
    }).finally(() => {
      creatingOffscreenDocument = null
    })
  }

  await creatingOffscreenDocument
}

const routeScoreTextRequest = async (message: unknown): Promise<unknown> => {
  if (!isScoreTextRequestMessage(message)) {
    return null
  }

  try {
    await ensureOffscreenDocument()
    return await chromeApi?.runtime?.sendMessage?.(createScoreTextOffscreenRequest(message.payload, message.requestId))
  } catch {
    const unavailable = createUnavailableScoreTextResult(
      message.payload,
      "missing_local_onnx_artifact",
      "Local Scoreboar offscreen inference context is unavailable; no text leaves the extension.",
    )
    return createScoreTextResponse(unavailable, message.requestId)
  }
}

chromeApi?.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
  if (!isScoreTextRequestMessage(message)) {
    return false
  }

  void routeScoreTextRequest(message).then(sendResponse)
  return true
})

console.info("Scoreboar service worker router scaffold loaded")
