import {
  X_COMPOSER_SELECTOR,
  X_SELECTORS,
  authorBlockForModel,
  extractSerializedAuthorMetadata,
  extractTweetAuthorMetadata,
  extractTweetCreatedAtMetadata,
  extractTweetId,
  extractTweetMediaFacts,
  extractTweetText,
  extractViewerHandle,
  normalizePostText,
  parseTimeInput,
  readComposerDraft,
  splitTrailingPostLink,
  stripReplyMentionPrefix,
  type ModelAuthorBlock,
  type TweetAuthorMetadata,
  type TweetCreatedAtMetadata,
  type TweetMediaFacts,
  tweetIsQuote,
  tweetTextTruncated,
} from "./contracts.js"
import { mergeAuthorMetadata, type XAuthorStats } from "./x-author-metadata.js"

export const SCOREBOAR_TWEET_PROCESSED_ATTRIBUTE = "data-scoreboar-tweet-processed" as const
export const SCOREBOAR_TWEET_KEY_ATTRIBUTE = "data-scoreboar-tweet-key" as const
export const SCOREBOAR_COMPOSER_PROCESSED_ATTRIBUTE = "data-scoreboar-composer-processed" as const

export interface TweetFoundEvent {
  readonly root: Element
  /** Post text with its line breaks; the model reads them. */
  readonly text: string
  /** The text as the model reads it (normalizePostText), for change detection. */
  readonly key: string
  readonly previousKey: string | null
  readonly changed: boolean
  readonly tweetId?: string | null
  readonly hasMedia: boolean
  readonly mediaFacts?: TweetMediaFacts
  readonly isQuote?: boolean | null
  /** The page shows only the start of a long post ("Show more"); the text is a prefix. */
  readonly textTruncated?: boolean
  readonly authorMetadata: TweetAuthorMetadata
  readonly createdAtMetadata?: TweetCreatedAtMetadata
}

/**
 * A draft, read so that it matches the post it will become: the text X will
 * publish, and the attachments, quote and poll that post will carry, each as a
 * known value whenever the page shows it.
 */
export interface ComposerFoundEvent {
  readonly element: Element
  /** The text the post will have: reply mentions and a trailing quoted-post link removed, as X does. */
  readonly text: string
  /** The whole draft as the model reads it; dismissing the pill lasts until this changes. */
  readonly key: string
  /** Everything scoring reads from the page, so a new attachment or quote rescores unchanged text. */
  readonly signature?: string
  readonly changed: boolean
  /** When the draft was read; scoring uses the time it runs, or the scheduled time. */
  readonly createdAt: string
  /** Whether media is attached to the draft. */
  readonly hasMedia?: boolean
  /** Photo / video (GIFs count as video, as in training); null while an upload shows no type yet. */
  readonly hasPhoto?: boolean | null
  readonly hasVideo?: boolean | null
  /** The draft quotes a post: X's quote preview, or a trailing post link X turns into one. */
  readonly isQuote?: boolean
  /** A poll: X stores it as a card, so the posted tweet has one. */
  readonly hasCard?: boolean
  readonly isReply?: boolean
  /** The time X will post a scheduled draft, when the composer says so. */
  readonly scheduledAt?: string | null
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

// Keys are the text the model reads: line breaks count, trailing spaces and swapped URLs do not.
const normalizeDetectedText = (text: string): string => normalizePostText(text)

// ---------------------------------------------------------------------------
// The draft's own stretch of the page
//
// On x.com the toolbar is a sibling below the editor, never an ancestor, and
// the same <main> or dialog also holds the timeline, the post being replied
// to, a quoted post and the other posts of a thread. What belongs to a draft
// is what comes after its text box and before the next text box or the
// toolbar, in document order.
// ---------------------------------------------------------------------------

const DOCUMENT_POSITION_FOLLOWING = 4
const DOCUMENT_POSITION_CONTAINS = 8
const DOCUMENT_POSITION_CONTAINED_BY = 16

/** `later` comes after `earlier` in the page, and neither holds the other. */
const comesAfter = (earlier: Node, later: Node): boolean => {
  const position = earlier.compareDocumentPosition(later)
  return (position & DOCUMENT_POSITION_FOLLOWING) !== 0 && (position & (DOCUMENT_POSITION_CONTAINS | DOCUMENT_POSITION_CONTAINED_BY)) === 0
}

const composerSearchScope = (textbox: Element): ParentNode => {
  return textbox.closest('[role="dialog"], main') ?? textbox.ownerDocument.body ?? textbox.ownerDocument
}

interface ComposerRegion {
  readonly textbox: Element
  /** The toolbar, or the next thread post's text box when that comes first. */
  readonly end: Element
  readonly scope: ParentNode
  readonly contains: (element: Element) => boolean
}

const composerRegion = (textbox: Element): ComposerRegion | null => {
  const scope = composerSearchScope(textbox)
  const toolbar = [...scope.querySelectorAll('[data-testid="toolBar"]')].find((element) => comesAfter(textbox, element))
  // No toolbar yet (a collapsed inline reply): nothing can be attached.
  if (!toolbar) return null
  const nextTextbox = [...scope.querySelectorAll(X_COMPOSER_SELECTOR)].find((element) => element !== textbox && comesAfter(textbox, element))
  const end = nextTextbox && comesAfter(nextTextbox, toolbar) ? nextTextbox : toolbar
  // Everything between the two sits under their nearest common ancestor; searching only there keeps the timeline out of each scan.
  let block: Element | null = textbox.parentElement
  while (block && !block.contains(end)) block = block.parentElement
  return { textbox, end, scope: block ?? scope, contains: (element) => comesAfter(textbox, element) && comesAfter(element, end) }
}

const PROFILE_OR_EMOJI_IMAGE = /profile_images|\/emoji\/|abs(?:-\d)?\.twimg\.com\/(?:emoji|hashflags)/iu
const ANIMATED_IMAGE = /\.gif(?:$|[?#])|tweet_video|giphy|tenor/iu

// The poll editor's own controls; X allows a poll or media, never both. A posted poll has
// none of these inputs, selects or remove button, though it may name its choices alike.
const POLL_EDITOR_CONTROLS = [
  '[data-testid^="selectPoll"]',
  '[data-testid="removePollButton"]',
  'input[name^="Choice" i]',
]
const POLL_EDITOR_SELECTOR = [...POLL_EDITOR_CONTROLS, '[data-testid^="pollChoice"]'].join(", ")

// What only the draft itself holds: a local upload, an upload in progress, the poll editor.
const DRAFT_OWN_CONTENT_SELECTOR = [
  'img[src^="blob:"]',
  'video[src^="blob:"]',
  'video[poster^="blob:"]',
  '[role="progressbar"]',
  ...POLL_EDITOR_CONTROLS,
].join(", ")

const holdsDraftEditor = (element: Element, region: ComposerRegion): boolean => element.contains(region.textbox) || element.contains(region.end)

const holdsDraftContent = (element: Element, region: ComposerRegion): boolean => {
  return holdsDraftEditor(element, region) || element.querySelector(DRAFT_OWN_CONTENT_SELECTOR) !== null
}

/**
 * The posts shown inside the draft's stretch (a quoted post), each as the
 * whole block that holds it, so its media, its own attachments strip and a
 * poll it carries all stay that post's. A block is X's post link or article
 * around the author line; failing that, the largest block around the author
 * line that holds nothing of the draft's own.
 */
const postPreviewBlocks = (region: ComposerRegion): Element[] => {
  const blocks = new Set<Element>()
  for (const userName of region.scope.querySelectorAll(X_SELECTORS.userName)) {
    if (!region.contains(userName)) continue
    // X's own post block; a video playing in it may have a blob: source of its own.
    const card = userName.closest('div[role="link"], article')
    if (card && !holdsDraftEditor(card, region)) {
      blocks.add(card)
      continue
    }
    let block: Element = userName
    for (let parent = userName.parentElement; parent && !holdsDraftContent(parent, region); parent = parent.parentElement) block = parent
    blocks.add(block)
  }
  return [...blocks]
}

const insideAny = (element: Element, blocks: readonly Element[]): boolean => blocks.some((block) => block.contains(element))

interface ComposerMediaFacts {
  readonly hasMedia: boolean
  readonly hasPhoto: boolean | null
  readonly hasVideo: boolean | null
}

const NO_MEDIA: ComposerMediaFacts = { hasMedia: false, hasPhoto: false, hasVideo: false }

/**
 * What the user attached: only the draft's own [data-testid="attachments"]
 * strip counts, never a photo in the timeline, the replied-to post, a quoted
 * post (even one shown inside that strip, or with a strip of its own) or a
 * link-card preview. Videos and GIFs both count as video, as in training. A
 * strip still uploading has media of no known type yet, which the contract
 * fills in the way it did in training.
 */
const readComposerMedia = (region: ComposerRegion, previews: readonly Element[]): ComposerMediaFacts => {
  const strips = [...region.scope.querySelectorAll('[data-testid="attachments"]')].filter((strip) => region.contains(strip) && !insideAny(strip, previews))
  let hasPhoto = false
  let hasVideo = false
  let uploading = false
  for (const strip of strips) {
    const own = (element: Element) => !element.closest(X_SELECTORS.mediaCard) && !insideAny(element, previews)
    const videos = [...strip.querySelectorAll(`video, ${X_SELECTORS.mediaVideo}`)].filter(own)
    if (videos.length > 0) hasVideo = true
    for (const image of [...strip.querySelectorAll("img")].filter(own)) {
      const source = image.getAttribute("src") ?? ""
      if (PROFILE_OR_EMOJI_IMAGE.test(source)) continue
      if (ANIMATED_IMAGE.test(source)) {
        hasVideo = true
        continue
      }
      // A video's poster frame sits next to the video in the same item.
      if (videos.some((video) => video.parentElement?.contains(image))) continue
      hasPhoto = true
    }
    if ([...strip.querySelectorAll('[role="progressbar"]')].some(own)) uploading = true
  }
  if (hasPhoto || hasVideo) return { hasMedia: true, hasPhoto, hasVideo }
  return uploading ? { hasMedia: true, hasPhoto: null, hasVideo: null } : NO_MEDIA
}

/** The draft's own poll editor; a poll on a quoted post is that post's card. */
const composerHasPoll = (region: ComposerRegion, previews: readonly Element[]): boolean => {
  return [...region.scope.querySelectorAll(POLL_EDITOR_SELECTOR)].some((element) => region.contains(element) && !insideAny(element, previews))
}

/**
 * A reply: X folds its leading @mentions into "Replying to". Thread posts after
 * the first reply to the one before; the reply dialog (and the photo viewer's
 * reply box) shows the post being replied to above the editor; and a status
 * page's only inline editor is its reply box.
 */
const composerIsReply = (textbox: Element): boolean => {
  if (/^tweetTextarea_[1-9]/u.test(textbox.getAttribute("data-testid") ?? "")) return true
  const dialog = textbox.closest('[role="dialog"]')
  if (dialog) {
    return [...dialog.querySelectorAll(`${X_SELECTORS.tweetRoot}, ${X_SELECTORS.tweetText}`)].some((post) => comesAfter(post, textbox))
  }
  const path = textbox.ownerDocument.defaultView?.location?.pathname ?? ""
  return /\/status\/\d+/u.test(path)
}

const MONTH_INDEX: Readonly<Record<string, number>> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}
const SCHEDULE_BANNER = /Will send on (?:[A-Za-z]{3,9},? )?([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4}),? at (\d{1,2}):(\d{2}) ?([AP])\.?M\.?/iu

/** A scheduled draft goes out at the time X shows ("Will send on …"), read as the viewer's local time. */
const composerScheduledAt = (textbox: Element): string | null => {
  const container = textbox.closest('[role="dialog"]')
  const match = SCHEDULE_BANNER.exec(container?.textContent ?? "")
  if (!match) return null
  const [, monthName, day, year, hour, minute, meridiem] = match
  const month = MONTH_INDEX[(monthName ?? "").slice(0, 3).toLowerCase()]
  if (month === undefined) return null
  const hour12 = Number(hour) % 12
  const date = new Date(Number(year), month, Number(day), meridiem?.toUpperCase() === "P" ? hour12 + 12 : hour12, Number(minute))
  return parseTimeInput(date)?.toISOString() ?? null
}

export interface ComposerContext extends ComposerMediaFacts {
  readonly hasQuotedPost: boolean
  readonly hasPoll: boolean
  readonly isReply: boolean
  readonly scheduledAt: string | null
}

/** Everything around a draft that its post will carry. */
export const readComposerContext = (textbox: Element): ComposerContext => {
  const region = composerRegion(textbox)
  // X's quote preview under the draft: a post header after the text box, before the toolbar.
  const previews = region ? postPreviewBlocks(region) : []
  return {
    ...(region ? readComposerMedia(region, previews) : NO_MEDIA),
    hasQuotedPost: previews.length > 0,
    hasPoll: region ? composerHasPoll(region, previews) : false,
    isReply: composerIsReply(textbox),
    scheduledAt: composerScheduledAt(textbox),
  }
}

/** A draft as the post it will become. */
export const describeComposer = (composerElement: Element): Omit<ComposerFoundEvent, "changed"> & { readonly signature: string } => {
  const context = readComposerContext(composerElement)
  const draft = readComposerDraft(composerElement).trim()
  const posted = context.isReply ? stripReplyMentionPrefix(draft) : draft
  const { text, quotesPost } = splitTrailingPostLink(posted)
  const isQuote = quotesPost || context.hasQuotedPost
  // The whole draft, so deleting or changing a trailing post link still counts as an edit.
  const key = normalizeDetectedText(draft)
  const signature = [
    key,
    normalizeDetectedText(text),
    context.hasMedia,
    context.hasPhoto,
    context.hasVideo,
    isQuote,
    context.hasPoll,
    context.scheduledAt ?? "",
  ].join("\u0000")
  return {
    element: composerElement,
    text,
    key,
    signature,
    createdAt: new Date().toISOString(),
    hasMedia: context.hasMedia,
    hasPhoto: context.hasPhoto,
    hasVideo: context.hasVideo,
    isQuote,
    hasCard: context.hasPoll,
    isReply: context.isReply,
    scheduledAt: context.scheduledAt,
  }
}

type TweetReading = Omit<TweetFoundEvent, "previousKey" | "changed" | "authorMetadata" | "createdAtMetadata">
type DescribedTweet = Omit<TweetFoundEvent, "previousKey" | "changed">

/** The cheap part of a post's reading: enough to tell whether it changed. */
const readTweetRoot = (tweetRoot: Element): TweetReading => {
  const text = extractTweetText(tweetRoot).trim()
  const mediaFacts = extractTweetMediaFacts(tweetRoot)
  return {
    root: tweetRoot,
    text,
    key: normalizeDetectedText(text),
    tweetId: extractTweetId(tweetRoot),
    hasMedia: mediaFacts.hasMedia,
    mediaFacts,
    isQuote: tweetIsQuote(tweetRoot),
    textTruncated: tweetTextTruncated(tweetRoot),
  }
}

/** Media rendering late, or a recycled node showing another post, changes this even when the text does not. */
const tweetSignature = (reading: TweetReading): string => {
  const media = reading.mediaFacts
  return [
    reading.key,
    reading.tweetId ?? "",
    media?.hasPhoto,
    media?.hasVideo,
    media?.hasCard,
    reading.isQuote,
    reading.textTruncated,
  ].join("\u0000")
}

// The author block walks the whole article and the page's serialized data. It is read once per
// post an article shows (and again only when that reading changes), not on every scan and refresh.
const tweetAuthorReadings = new WeakMap<Element, { readonly signature: string, readonly authorMetadata: TweetAuthorMetadata, readonly createdAtMetadata: TweetCreatedAtMetadata }>()

const completeTweetReading = (reading: TweetReading, signature: string): DescribedTweet => {
  const cached = tweetAuthorReadings.get(reading.root)
  if (cached?.signature === signature) {
    return { ...reading, authorMetadata: cached.authorMetadata, createdAtMetadata: cached.createdAtMetadata }
  }
  const authorMetadata = extractTweetAuthorMetadata(reading.root)
  const createdAtMetadata = extractTweetCreatedAtMetadata(reading.root)
  tweetAuthorReadings.set(reading.root, { signature, authorMetadata, createdAtMetadata })
  return { ...reading, authorMetadata, createdAtMetadata }
}

/** Everything the page itself says about a post; loaded X responses can refine it later. */
export const describeTweetRoot = (tweetRoot: Element): DescribedTweet => {
  const reading = readTweetRoot(tweetRoot)
  return completeTweetReading(reading, tweetSignature(reading))
}

/**
 * The signed-in author as a draft is scored: the same sources, in the same
 * order, as the feed uses for that author's posts (loaded X stats, then data
 * the page serialized), cut to all of it or nothing by the same rule the feed
 * applies to that author's posts (authorBlockForModel).
 */
export const readViewerAuthorMetadata = (
  document: Document,
  knownHandle: string | null,
  statsByHandle: ReadonlyMap<string, XAuthorStats>,
): ModelAuthorBlock | null => {
  const handle = knownHandle ?? extractViewerHandle(document)
  if (!handle) return null
  return authorBlockForModel(mergeAuthorMetadata(handle, statsByHandle.get(handle.toLowerCase()), extractSerializedAuthorMetadata(document, handle)))
}

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

export const createScoreboarDomDetector = (options: ScoreboarDomDetectorOptions = {}): ScoreboarDomDetector => {
  const root = options.root ?? getDocumentRoot()
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS
  const scheduler = options.scheduler ?? defaultScheduler
  const tweetStates = new WeakMap<Element, { readonly key: string, readonly signature: string }>()
  const composerSignatures = new WeakMap<Element, string>()
  let cancelScheduledScan: ScheduledTaskCancel | null = null
  let observer: MutationObserver | null = null

  const scanTweets = () => {
    for (const tweetRoot of candidateElements(root, X_SELECTORS.tweetRoot)) {
      // Scans follow every mutation (video clocks, relative times): only the cheap reading runs until the post changes.
      const reading = readTweetRoot(tweetRoot)
      const key = reading.key
      const signature = tweetSignature(reading)
      const previous = tweetStates.get(tweetRoot)

      if (previous?.signature === signature) {
        continue
      }

      tweetStates.set(tweetRoot, { key, signature })
      tweetRoot.setAttribute(SCOREBOAR_TWEET_PROCESSED_ATTRIBUTE, "true")
      tweetRoot.setAttribute(SCOREBOAR_TWEET_KEY_ATTRIBUTE, key)
      options.onTweetFound?.({
        ...completeTweetReading(reading, signature),
        previousKey: previous?.key ?? null,
        changed: previous !== undefined,
      })
    }
  }

  const scanComposers = () => {
    for (const composerElement of candidateElements(root, X_COMPOSER_SELECTOR)) {
      // Read every scan, not only on typing: attaching media, opening a quote or adding a poll changes no text.
      const described = describeComposer(composerElement)
      const previousSignature = composerSignatures.get(composerElement)

      if (previousSignature === described.signature) {
        continue
      }

      composerSignatures.set(composerElement, described.signature)
      composerElement.setAttribute(SCOREBOAR_COMPOSER_PROCESSED_ATTRIBUTE, "true")
      options.onComposerFound?.({
        ...described,
        changed: previousSignature !== undefined,
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
