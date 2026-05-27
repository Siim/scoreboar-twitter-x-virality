import {
  X_COMPOSER_SELECTOR,
  X_SELECTORS,
  composerHasMedia,
  currentTimeMetadata,
  extractCurrentAccountMetadata,
  extractComposerText,
  extractTweetAuthorMetadata,
  extractTweetCreatedAtMetadata,
  extractTweetText,
  type TweetAuthorMetadata,
  type TweetCreatedAtMetadata,
  tweetHasMedia,
} from "./contracts.js"

export const SCOREBOAR_TWEET_PROCESSED_ATTRIBUTE = "data-scoreboar-tweet-processed" as const
export const SCOREBOAR_TWEET_KEY_ATTRIBUTE = "data-scoreboar-tweet-key" as const
export const SCOREBOAR_COMPOSER_PROCESSED_ATTRIBUTE = "data-scoreboar-composer-processed" as const

export interface TweetFoundEvent {
  readonly root: Element
  readonly text: string
  readonly key: string
  readonly previousKey: string | null
  readonly changed: boolean
  readonly hasMedia: boolean
  readonly authorMetadata: TweetAuthorMetadata
  readonly createdAtMetadata?: TweetCreatedAtMetadata
}

export interface ComposerFoundEvent {
  readonly element: Element
  readonly text: string
  readonly key: string
  readonly changed: boolean
  readonly hasMedia: boolean
  readonly authorMetadata: TweetAuthorMetadata
  readonly createdAtHour: number | null
  readonly createdAtDay: number | null
}

export interface ScoreboarDomDetectionCallbacks {
  readonly onTweetFound?: (event: TweetFoundEvent) => void
  readonly onComposerFound?: (event: ComposerFoundEvent) => void
}

export type ScheduledTaskCancel = () => void
export type ScanScheduler = (callback: () => void, delayMs: number) => ScheduledTaskCancel | void

export interface ScoreboarDomDetectorOptions extends ScoreboarDomDetectionCallbacks {
  readonly root?: ParentNode
  readonly throttleMs?: number
  readonly scheduler?: ScanScheduler
  readonly MutationObserverCtor?: typeof MutationObserver
}

export interface ScoreboarDomDetector {
  readonly scan: () => void
  readonly observe: () => void
  readonly disconnect: () => void
}

const DEFAULT_THROTTLE_MS = 100

const normalizeDetectedText = (text: string): string => text.replace(/\s+/g, " ").trim()

const defaultScheduler: ScanScheduler = (callback, delayMs) => {
  const timeoutId = globalThis.setTimeout(callback, delayMs)
  return () => globalThis.clearTimeout(timeoutId)
}

const getDocumentRoot = (): ParentNode => {
  if (typeof document === "undefined") {
    throw new Error("Scoreboar DOM detection requires a root or global document.")
  }

  return document
}

const candidateElements = (root: ParentNode, selector: string): Element[] => {
  const elements = new Set<Element>()
  const maybeElement = root as ParentNode & { matches?: (selector: string) => boolean }

  if (maybeElement.matches?.(selector) === true) {
    elements.add(root as Element)
  }

  root.querySelectorAll(selector).forEach((element) => elements.add(element))
  return [...elements]
}

const defaultMutationObserverCtor = (): typeof MutationObserver | undefined => {
  return typeof MutationObserver === "undefined" ? undefined : MutationObserver
}

const composerContextRoot = (composerElement: Element): Element | ParentNode => {
  return composerElement.closest('[role="dialog"], form') ?? composerElement.parentElement ?? composerElement
}

const composerKey = (text: string, hasMedia: boolean, authorMetadata: TweetAuthorMetadata): string => {
  return [
    text,
    hasMedia ? "media" : "no-media",
    authorMetadata.authorHandle ?? "",
    authorMetadata.authorFollowers ?? "",
    authorMetadata.authorFollowing ?? "",
    authorMetadata.authorTweets ?? "",
    authorMetadata.authorVerified ?? "",
  ].join("\u0000")
}

export const createScoreboarDomDetector = (options: ScoreboarDomDetectorOptions = {}): ScoreboarDomDetector => {
  const root = options.root ?? getDocumentRoot()
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS
  const scheduler = options.scheduler ?? defaultScheduler
  const tweetKeys = new WeakMap<Element, string>()
  const composerKeys = new WeakMap<Element, string>()
  let cancelScheduledScan: ScheduledTaskCancel | null = null
  let observer: MutationObserver | null = null

  const scanTweets = () => {
    for (const tweetRoot of candidateElements(root, X_SELECTORS.tweetRoot)) {
      const text = normalizeDetectedText(extractTweetText(tweetRoot))
      const key = text
      const previousKey = tweetKeys.get(tweetRoot) ?? null

      if (previousKey === key) {
        continue
      }

      tweetKeys.set(tweetRoot, key)
      tweetRoot.setAttribute(SCOREBOAR_TWEET_PROCESSED_ATTRIBUTE, "true")
      tweetRoot.setAttribute(SCOREBOAR_TWEET_KEY_ATTRIBUTE, key)
      options.onTweetFound?.({
        root: tweetRoot,
        text,
        key,
        previousKey,
        changed: previousKey !== null,
        hasMedia: tweetHasMedia(tweetRoot),
        authorMetadata: extractTweetAuthorMetadata(tweetRoot),
        createdAtMetadata: extractTweetCreatedAtMetadata(tweetRoot),
      })
    }
  }

  const scanComposers = () => {
    for (const composerElement of candidateElements(root, X_COMPOSER_SELECTOR)) {
      const contextRoot = composerContextRoot(composerElement)
      const text = normalizeDetectedText(extractComposerText(contextRoot))
      const hasMedia = composerHasMedia(contextRoot)
      const authorMetadata = extractCurrentAccountMetadata((composerElement.ownerDocument ?? root) as ParentNode & Pick<ParentNode, "querySelectorAll">)
      const key = composerKey(text, hasMedia, authorMetadata)
      const previousKey = composerKeys.get(composerElement)

      if (previousKey === key) {
        continue
      }

      composerKeys.set(composerElement, key)
      composerElement.setAttribute(SCOREBOAR_COMPOSER_PROCESSED_ATTRIBUTE, "true")
      options.onComposerFound?.({
        element: composerElement,
        text,
        key,
        changed: previousKey !== undefined,
        hasMedia,
        authorMetadata,
        ...currentTimeMetadata(),
      })
    }
  }

  const scan = () => {
    cancelScheduledScan = null
    scanTweets()
    scanComposers()
  }

  const scheduleScan = () => {
    if (cancelScheduledScan !== null) {
      return
    }

    cancelScheduledScan = scheduler(scan, throttleMs) ?? null
    if (cancelScheduledScan === null) {
      scan()
    }
  }

  const observe = () => {
    scan()

    if (observer !== null) {
      return
    }

    const ObserverCtor = options.MutationObserverCtor ?? defaultMutationObserverCtor()
    if (!ObserverCtor) {
      return
    }

    observer = new ObserverCtor(() => scheduleScan())
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    })
  }

  const disconnect = () => {
    observer?.disconnect()
    observer = null
    cancelScheduledScan?.()
    cancelScheduledScan = null
  }

  return { scan, observe, disconnect }
}
