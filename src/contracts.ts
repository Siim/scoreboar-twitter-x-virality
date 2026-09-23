export const X_SELECTORS = Object.freeze({
  tweetRoot: 'article[data-testid="tweet"]',
  tweetText: '[data-testid="tweetText"]',
  composerPrimary: '[data-testid="tweetTextarea_0"]',
  composerFallback: 'div[role="textbox"][contenteditable="true"]',
  mediaPhoto: '[data-testid="tweetPhoto"]',
  mediaVideo: '[data-testid="videoPlayer"]',
  mediaCard: '[data-testid="card.wrapper"]',
  mediaPreview: '[data-testid="previewInterstitial"]',
  userName: '[data-testid="User-Name"]',
} as const)

export const X_COMPOSER_SELECTOR = [
  X_SELECTORS.composerPrimary,
  X_SELECTORS.composerFallback,
].join(", ")

export const X_TWEET_MEDIA_SELECTOR = [
  X_SELECTORS.mediaPhoto,
  X_SELECTORS.mediaVideo,
  X_SELECTORS.mediaCard,
  X_SELECTORS.mediaPreview,
].join(", ")

// ---------------------------------------------------------------------------
// Feature contract v2 — the inputs the Scoreboar v8 model was trained on.
//
// Mirrors normalize_post_text() and metadata_v2_vector() in
// virality/scripts/train_multitask_teacher_model.py. fixtures/feature-contract-v2.json
// is generated there and tests/feature-contract.test.ts holds this port to it,
// because every earlier drift between the two (local vs UTC time, weekday
// numbering, link cards counted as media, zeros for a missing author) cost
// accuracy silently.
// ---------------------------------------------------------------------------

export const FEATURE_CONTRACT_VERSION = 2 as const

export const METADATA_V2_FEATURE_ORDER = [
  "has_media",
  "has_photo",
  "has_video",
  "is_quote",
  "has_link",
  "hour_sin",
  "hour_cos",
  "weekday_sin",
  "weekday_cos",
  "author_known",
  "log_followers",
  "log_following",
  "log_statuses",
  "author_verified",
  "author_org_verified",
  "author_details_known",
  "log_favourites",
  "account_age",
  "log_text_chars",
  "line_breaks",
  "hashtag_count",
  "mention_count",
] as const

export type MetadataV2FeatureName = (typeof METADATA_V2_FEATURE_ORDER)[number]

export type MetadataV2FeatureMap = Record<MetadataV2FeatureName, number>

export type TimeInput = string | number | Date | null | undefined

export interface MetadataPreprocessInput {
  readonly text?: string | null
  /** t.co links X appends for attached media. API text carries them; page text never does. */
  readonly mediaUrls?: readonly string[] | null
  readonly hasMedia?: boolean | null
  readonly hasPhoto?: boolean | null
  readonly hasVideo?: boolean | null
  readonly isQuote?: boolean | null
  readonly hasCard?: boolean | null
  /** When the post went (or would go) out. Read in UTC, as in training. */
  readonly createdAt?: TimeInput
  readonly authorFollowers?: number | null
  readonly authorFollowing?: number | null
  readonly authorTweets?: number | null
  readonly authorVerified?: boolean | null
  readonly authorVerifiedType?: string | null
  readonly authorCreatedAt?: TimeInput
  readonly authorFavourites?: number | null
}

export interface MetadataPreprocessResult {
  readonly normalizedText: string
  readonly features: MetadataV2FeatureMap
  readonly vector: readonly number[]
}

export interface NormalizePostTextOptions {
  readonly mediaUrls?: readonly string[] | null
  readonly hasMedia?: boolean | null
}

export const LINK_PLACEHOLDER = "[link]"

/**
 * What page reading writes where a post shows a link. It is URL-shaped and
 * unpadded, so the contract's own URL rule turns it into [link] and swallows the
 * characters glued after it, exactly as it does for the t.co URL in API text and
 * the typed URL in a draft. It is not a t.co URL, so the has-media rule that drops
 * a trailing t.co (the media link in API text) never removes a real link.
 */
export const PAGE_LINK_STAND_IN = "https://link"

const URL_PATTERN = /https?:\/\/\S+|www\.\S+/giu
const TRAILING_TCO_PATTERN = /\s*https?:\/\/t\.co\/\w+\s*$/u
const HASHTAG_PATTERN = /(?:^|[^\p{L}\p{N}_])#[\p{L}\p{N}_]+/gu
const MENTION_PATTERN = /(?:^|[^\p{L}\p{N}_])@[A-Za-z0-9_]{1,20}/gu
const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" }

const unescapeHtml = (value: string): string => {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (entity, name: string) => {
    const lowered = name.toLowerCase()
    if (lowered.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lowered.slice(2), 16))
    if (lowered.startsWith("#")) return String.fromCodePoint(Number.parseInt(lowered.slice(1), 10))
    return NAMED_ENTITIES[lowered] ?? entity
  })
}

/** The text the model reads: what a reader sees on x.com, with every link as one placeholder. */
export const normalizePostText = (text: string | null | undefined, options: NormalizePostTextOptions = {}): string => {
  let value = typeof text === "string" ? text : ""
  const mediaUrls = (options.mediaUrls ?? []).filter((url): url is string => typeof url === "string" && url.length > 0)
  if (mediaUrls.length > 0) {
    for (const url of mediaUrls) value = value.split(url).join(" ")
  } else if (options.hasMedia === true) {
    value = value.replace(TRAILING_TCO_PATTERN, "")
  }
  value = unescapeHtml(value)
  value = value.replace(URL_PATTERN, LINK_PLACEHOLDER)
  value = value.replace(/\r\n?/gu, "\n")
  value = value.replace(/[ \t ]+/gu, " ")
  value = value.replace(/ *\n */gu, "\n")
  value = value.replace(/\n{3,}/gu, "\n\n")
  return value.trim()
}

const MONTHS: Readonly<Record<string, number>> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

/** Accepts ISO strings, epoch ms, Dates and X's "Sun Apr 03 23:48:02 +0000 2022". */
export const parseTimeInput = (value: TimeInput): Date | null => {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null
  if (typeof value === "number") {
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date : null
  }
  const twitter = /^\w{3} (\w{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2}) (\d{4})$/u.exec(value.trim())
  if (twitter) {
    const [, month, day, hour, minute, second, sign, offsetHours, offsetMinutes, year] = twitter
    const monthIndex = MONTHS[month!.toLowerCase()]
    if (monthIndex === undefined) return null
    const offset = (sign === "-" ? -1 : 1) * (Number(offsetHours) * 60 + Number(offsetMinutes))
    return new Date(Date.UTC(Number(year), monthIndex, Number(day), Number(hour), Number(minute), Number(second)) - offset * 60_000)
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed) : null
}

const finiteOrNull = (value: number | null | undefined): number | null => {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

const logScaled = (value: number | null | undefined): number => {
  const number = finiteOrNull(value)
  return number === null ? 0 : Math.log1p(Math.max(0, number)) / 20
}

const countMatches = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0

export const preprocessMetadata = (input: MetadataPreprocessInput = {}, now: Date = new Date()): MetadataPreprocessResult => {
  const text = normalizePostText(input.text, { mediaUrls: input.mediaUrls, hasMedia: input.hasMedia })
  const created = parseTimeInput(input.createdAt)
  const hour = created ? created.getUTCHours() + created.getUTCMinutes() / 60 : null
  const weekday = created ? (created.getUTCDay() + 6) % 7 : null // Monday = 0, as Python's weekday()

  const hasMedia = input.hasMedia === true
  const mediaTypeKnown = input.hasPhoto !== null && input.hasPhoto !== undefined || input.hasVideo !== null && input.hasVideo !== undefined
  const followers = finiteOrNull(input.authorFollowers)
  const authorKnown = followers !== null
  const authorCreated = parseTimeInput(input.authorCreatedAt)
  const detailsKnown = authorCreated !== null
  const anchor = created ?? now
  const accountAgeYears = authorCreated
    ? Math.min(Math.max(Math.floor((anchor.getTime() - authorCreated.getTime()) / 86_400_000) / 365.25, 0), 20)
    : 0
  const verifiedType = (input.authorVerifiedType ?? "").toLowerCase()

  const features: MetadataV2FeatureMap = {
    has_media: hasMedia ? 1 : 0,
    has_photo: mediaTypeKnown ? (input.hasPhoto === true ? 1 : 0) : hasMedia ? 0.7 : 0,
    has_video: mediaTypeKnown ? (input.hasVideo === true ? 1 : 0) : hasMedia ? 0.3 : 0,
    is_quote: input.isQuote === null || input.isQuote === undefined ? 0.25 : input.isQuote ? 1 : 0,
    has_link: text.includes(LINK_PLACEHOLDER) || input.hasCard === true ? 1 : 0,
    hour_sin: hour === null ? 0 : Math.sin((2 * Math.PI * hour) / 24),
    hour_cos: hour === null ? 0 : Math.cos((2 * Math.PI * hour) / 24),
    weekday_sin: weekday === null ? 0 : Math.sin((2 * Math.PI * weekday) / 7),
    weekday_cos: weekday === null ? 0 : Math.cos((2 * Math.PI * weekday) / 7),
    author_known: authorKnown ? 1 : 0,
    log_followers: authorKnown ? logScaled(followers) : 0,
    log_following: authorKnown ? logScaled(input.authorFollowing) : 0,
    log_statuses: authorKnown ? logScaled(input.authorTweets) : 0,
    author_verified: authorKnown && input.authorVerified === true ? 1 : 0,
    author_org_verified: verifiedType === "business" || verifiedType === "government" ? 1 : 0,
    author_details_known: detailsKnown ? 1 : 0,
    log_favourites: detailsKnown ? logScaled(input.authorFavourites) : 0,
    account_age: accountAgeYears / 20,
    log_text_chars: Math.min(Math.log1p([...text].length) / 8, 1),
    line_breaks: Math.min(countMatches(text, /\n/gu), 20) / 20,
    hashtag_count: Math.min(countMatches(text, HASHTAG_PATTERN), 10) / 10,
    mention_count: Math.min(countMatches(text, MENTION_PATTERN), 10) / 10,
  }

  return {
    normalizedText: text,
    features,
    vector: METADATA_V2_FEATURE_ORDER.map((featureName) => features[featureName]),
  }
}

/** The author fields a scoring request carries, when it carries any. */
export type ModelAuthorBlock = {
  readonly authorHandle: string | null
  readonly authorFollowers: number
  readonly authorFollowing: number | null
  readonly authorTweets: number | null
  readonly authorVerified: boolean | null
  readonly authorVerifiedType: string | null
  readonly authorCreatedAt: string
  readonly authorFavourites: number | null
}

/**
 * The author as a request hands it to the model: all of it or none of it.
 * Drafts and feed posts both go through here, so a draft and the post it
 * becomes get the same author.
 *
 * Every v8 training row had follower counts, and the only rows without a join
 * date were the v1 rows, mostly viral-search picks. Counts with
 * author_details_known = 0 therefore read as "an old viral post" and lift a
 * score by tens of percentile points. A missing author (author_known = 0) was
 * not in training either, but scores close to the full block. A verified type
 * on its own is worse: author_org_verified is not gated on author_known, and
 * no training row had it without the rest. A join date without the likes-given
 * count still lifts v8 by about 18 points (log_favourites = 0 never occurs with
 * a known join date in training), and missing following or post counts read
 * as zero the same way. So the author goes out only when the follower,
 * following, post and likes-given counts and a parseable join date are all
 * there, and not at all otherwise.
 */
export const authorBlockForModel = (author: Partial<TweetAuthorMetadata> | null | undefined): ModelAuthorBlock | null => {
  const followers = finiteOrNull(author?.authorFollowers)
  const following = finiteOrNull(author?.authorFollowing)
  const tweets = finiteOrNull(author?.authorTweets)
  const favourites = finiteOrNull(author?.authorFavourites)
  const createdAt = author?.authorCreatedAt ?? null
  if (!author || followers === null || following === null || tweets === null || favourites === null) return null
  if (createdAt === null || parseTimeInput(createdAt) === null) return null
  return {
    authorHandle: author.authorHandle ?? null,
    authorFollowers: followers,
    authorFollowing: following,
    authorTweets: tweets,
    authorVerified: author.authorVerified ?? null,
    authorVerifiedType: author.authorVerifiedType ?? null,
    authorCreatedAt: createdAt,
    authorFavourites: favourites,
  }
}

// ---------------------------------------------------------------------------
// Reading posts off x.com
// ---------------------------------------------------------------------------

export interface TweetAuthorMetadata {
  readonly authorHandle: string | null
  readonly authorFollowers: number | null
  readonly authorFollowing: number | null
  readonly authorTweets: number | null
  readonly authorVerified: boolean | null
  readonly authorVerifiedType?: string | null
  readonly authorCreatedAt?: string | null
  readonly authorFavourites?: number | null
  readonly authorMetadataSource: "same-page-dom" | "loaded-x-response" | "defaulted"
}

export interface TweetCreatedAtMetadata {
  /** ISO timestamp from the post's <time datetime>. */
  readonly createdAt: string | null
  readonly createdAtSource: "tweet-time" | "defaulted"
}

export interface TweetMediaFacts {
  readonly hasMedia: boolean
  readonly hasPhoto: boolean
  readonly hasVideo: boolean
  readonly hasCard: boolean
}

type QueryRoot = Pick<ParentNode, "querySelector">
type QueryAllRoot = QueryRoot & Pick<ParentNode, "querySelectorAll"> & { readonly textContent?: string | null }
type OwnerDocumentRoot = { readonly ownerDocument?: Document | null }

const isElementNode = (node: Node): node is Element => node.nodeType === 1
const isTextNode = (node: Node): node is Text => node.nodeType === 3

const isExternalHref = (href: string): boolean => {
  if (href.startsWith("/")) return false
  try {
    const host = new URL(href).hostname.toLowerCase()
    return !/(^|\.)(x|twitter)\.com$/u.test(host)
  } catch {
    return false
  }
}

/**
 * Text as a reader sees it. textContent drops emoji (X draws them as <img alt>)
 * and every line break, and shows links as truncated display URLs; the model
 * was trained on emoji, newlines and one placeholder per link.
 */
export const extractRichText = (node: Node | null | undefined): string => {
  if (!node) return ""
  if (!("childNodes" in node)) return (node as { textContent?: string | null }).textContent ?? ""
  const parts: string[] = []
  const walk = (current: Node) => {
    if (isTextNode(current)) {
      parts.push(current.data)
      return
    }
    if (!isElementNode(current)) return
    const tag = current.tagName.toUpperCase()
    if (tag === "BR") {
      parts.push("\n")
      return
    }
    if (tag === "IMG") {
      parts.push(current.getAttribute("alt") ?? "")
      return
    }
    if (tag === "A" && isExternalHref(current.getAttribute("href") ?? "")) {
      parts.push(PAGE_LINK_STAND_IN)
      return
    }
    for (const child of current.childNodes) walk(child)
  }
  walk(node)
  return parts.join("")
}

/** The quoted post inside a quote tweet: a nested block with its own author line. */
export const quotedTweetBlocks = (tweetRoot: QueryAllRoot): Element[] => {
  const blocks: Element[] = []
  for (const candidate of tweetRoot.querySelectorAll('div[role="link"]')) {
    if (candidate.querySelector(X_SELECTORS.userName)) blocks.push(candidate)
  }
  return blocks
}

export const outsideQuotedTweet = (element: Element, quoted: readonly Element[]): boolean => {
  return !quoted.some((block) => block.contains(element))
}

const canQueryAll = (root: QueryRoot): root is QueryAllRoot => typeof (root as Partial<QueryAllRoot>).querySelectorAll === "function"

const externalHrefs = (root: ParentNode): string[] => {
  return [...root.querySelectorAll("a[href]")].map((link) => link.getAttribute("href") ?? "").filter(isExternalHref)
}

/** The post's own text block; a quote with no words of its own has only the quoted post's. */
const ownTweetTextRoot = (tweetRoot: QueryRoot): Element | null => {
  if (!canQueryAll(tweetRoot)) return tweetRoot.querySelector(X_SELECTORS.tweetText)
  const quoted = quotedTweetBlocks(tweetRoot)
  return [...tweetRoot.querySelectorAll(X_SELECTORS.tweetText)].find((element) => outsideQuotedTweet(element, quoted)) ?? null
}

/**
 * The post's text as the model was trained on it. X drops a trailing URL from
 * the body when it shows that URL as a link card, but the API text (training)
 * and the draft (composer) both still end in it. So when the post's own card
 * links somewhere the body never does, the link goes back at the end. Polls
 * have no outside link, and a card inside a quoted post is not this post's.
 */
export const extractTweetText = (tweetRoot: QueryRoot): string => {
  const textRoot = ownTweetTextRoot(tweetRoot)
  const text = textRoot ? extractRichText(textRoot as unknown as Node) : ""
  if (!canQueryAll(tweetRoot)) return text
  const quoted = quotedTweetBlocks(tweetRoot)
  const ownCards = [...tweetRoot.querySelectorAll(X_SELECTORS.mediaCard)].filter((card) => outsideQuotedTweet(card, quoted))
  const cardHrefs = ownCards.flatMap((card) => externalHrefs(card))
  const textHrefs = textRoot ? externalHrefs(textRoot) : []
  if (cardHrefs.length === 0 || cardHrefs.some((href) => textHrefs.includes(href))) return text
  return text.replace(/\s*$/u, (space) => (space.includes("\n") ? "\n" : " ")) + PAGE_LINK_STAND_IN
}

/** The timeline shows a long post cut short, with "Show more"; its text here is only a prefix. */
export const tweetTextTruncated = (tweetRoot: QueryAllRoot): boolean => {
  const quoted = quotedTweetBlocks(tweetRoot)
  return [...tweetRoot.querySelectorAll('[data-testid="tweet-text-show-more-link"]')].some((link) => outsideQuotedTweet(link, quoted))
}

export const tweetHasMedia = (tweetRoot: QueryRoot): boolean => {
  return tweetRoot.querySelector(X_TWEET_MEDIA_SELECTOR) !== null
}

/**
 * Media on the post itself. Media inside a quoted post belongs to that post,
 * and a link card is a link, not media — training counted neither.
 */
export const extractTweetMediaFacts = (tweetRoot: QueryAllRoot): TweetMediaFacts => {
  const quoted = quotedTweetBlocks(tweetRoot)
  const own = (selector: string) => [...tweetRoot.querySelectorAll(selector)].filter((element) => outsideQuotedTweet(element, quoted))
  const videos = own(X_SELECTORS.mediaVideo)
  // A video's item is a tweetPhoto around (or inside) its videoPlayer; only the rest are photos.
  const photos = own(X_SELECTORS.mediaPhoto).filter((photo) => !photo.querySelector(X_SELECTORS.mediaVideo) && !photo.closest(X_SELECTORS.mediaVideo))
  const hasVideo = videos.length > 0
  const hasPhoto = photos.length > 0
  return {
    hasMedia: hasVideo || hasPhoto,
    hasPhoto,
    hasVideo,
    hasCard: own(X_SELECTORS.mediaCard).length > 0,
  }
}

export const tweetIsQuote = (tweetRoot: QueryAllRoot): boolean => quotedTweetBlocks(tweetRoot).length > 0

export const extractTweetId = (tweetRoot: QueryAllRoot): string | null => {
  for (const time of tweetRoot.querySelectorAll("a[href*='/status/'] time")) {
    const href = time.closest("a")?.getAttribute("href") ?? ""
    const match = /\/status\/(\d+)/u.exec(href)
    if (match?.[1]) return match[1]
  }
  return null
}

export const extractTweetCreatedAtMetadata = (tweetRoot: QueryRoot): TweetCreatedAtMetadata => {
  const datetime = tweetRoot.querySelector("time[datetime]")?.getAttribute("datetime")
  const parsed = datetime ? parseTimeInput(datetime) : null
  return parsed
    ? { createdAt: parsed.toISOString(), createdAtSource: "tweet-time" }
    : { createdAt: null, createdAtSource: "defaulted" }
}

const parseCompactCount = (value: string): number | null => {
  const match = value.trim().replace(/,/g, "").match(/^(\d+(?:\.\d+)?)([KMB])?$/iu)
  if (!match?.[1]) return null
  const numeric = Number.parseFloat(match[1])
  if (!Number.isFinite(numeric)) return null
  const multiplier = match[2]?.toLowerCase() === "k" ? 1_000 : match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2]?.toLowerCase() === "b" ? 1_000_000_000 : 1
  return Math.round(numeric * multiplier)
}

const extractCountNearLabel = (text: string, label: "followers" | "following" | "posts" | "tweets"): number | null => {
  const escapedLabel = label === "posts" ? "posts?" : label
  const before = new RegExp(`(\\d+(?:[,.]\\d+)?\\s*[KMB]?)\\s+${escapedLabel}`, "iu").exec(text)
  if (before?.[1]) return parseCompactCount(before[1].replace(/\s+/g, ""))
  const after = new RegExp(`${escapedLabel}\\s+(\\d+(?:[,.]\\d+)?\\s*[KMB]?)`, "iu").exec(text)
  return after?.[1] ? parseCompactCount(after[1].replace(/\s+/g, "")) : null
}

const regexEscape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const extractNumberField = (text: string, fieldName: string): number | null => {
  const match = new RegExp(`\\\\?"${regexEscape(fieldName)}\\\\?":(\\d+)`, "u").exec(text)
  if (!match?.[1]) return null
  const value = Number.parseInt(match[1], 10)
  return Number.isFinite(value) ? value : null
}

const extractBooleanField = (text: string, fieldName: string): boolean | null => {
  const match = new RegExp(`\\\\?"${regexEscape(fieldName)}\\\\?":(true|false)`, "u").exec(text)
  return match?.[1] === "true" ? true : match?.[1] === "false" ? false : null
}

const extractStringField = (text: string, fieldName: string): string | null => {
  const match = new RegExp(`\\\\?"${regexEscape(fieldName)}\\\\?":\\\\?"([^"\\\\]{1,64})\\\\?"`, "u").exec(text)
  return match?.[1] ?? null
}

/** The article's own chrome (author line, badges, hidden counts): not the post body and not a quoted post. */
const authorChromeText = (tweetRoot: QueryAllRoot, quoted: readonly Element[]): string => {
  if (!("childNodes" in tweetRoot)) return tweetRoot.textContent ?? ""
  const skipped = new Set<Element>([...quoted, ...tweetRoot.querySelectorAll(X_SELECTORS.tweetText)])
  const parts: string[] = []
  const walk = (node: Node) => {
    if (isTextNode(node)) {
      parts.push(node.data)
      return
    }
    if (isElementNode(node) && skipped.has(node)) return
    for (const child of node.childNodes) walk(child)
  }
  walk(tweetRoot as unknown as Node)
  return parts.join("")
}

const extractAuthorHandle = (tweetRoot: QueryAllRoot, quoted: readonly Element[], chromeText: string): string | null => {
  const avatarContainer = [...tweetRoot.querySelectorAll("[data-testid^='UserAvatar-Container-']")].find((element) => outsideQuotedTweet(element, quoted))
  const avatarHandle = avatarContainer?.getAttribute("data-testid")?.match(/^UserAvatar-Container-([A-Za-z0-9_]{1,20})$/u)?.[1]
  if (avatarHandle) return avatarHandle

  const userNameLinks = [...tweetRoot.querySelectorAll("[data-testid='User-Name'] a[href]")].filter((element) => outsideQuotedTweet(element, quoted))
  for (const link of userNameLinks) {
    const href = link.getAttribute("href") ?? ""
    const match = href.match(/^\/([A-Za-z0-9_]{1,20})(?:$|[/?#])/u)
    if (match?.[1]) return match[1]
  }

  const links = [...tweetRoot.querySelectorAll(":scope > div a[href], [data-testid='Tweet-User-Avatar'] a[href]")].filter((element) => outsideQuotedTweet(element, quoted))
  for (const link of links) {
    const href = link.getAttribute("href") ?? ""
    const match = href.match(/^\/([A-Za-z0-9_]{1,20})(?:$|[/?#])/u)
    if (match?.[1] && !["home", "i", "intent", "messages", "notifications", "search", "settings"].includes(match[1])) {
      return match[1]
    }
  }

  // A mention in the post body is someone else; only the chrome names the author.
  const handleMatch = chromeText.match(/@([A-Za-z0-9_]{1,20})\b/u)
  return handleMatch?.[1] ?? null
}

type SerializedAuthorMetadata = Omit<TweetAuthorMetadata, "authorHandle" | "authorMetadataSource">

const SERIALIZED_OBJECT_LEVELS = 3
const SERIALIZED_OBJECT_MAX_CHARS = 20_000
const SERIALIZED_WINDOW_CHARS = 2_500

const plainRecord = (value: unknown): Record<string, unknown> | null => {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}
const serializedNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null)
const serializedBoolean = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null)
const serializedShortString = (value: unknown): string | null => {
  return typeof value === "string" && value.length > 0 && value.length <= 64 ? value : null
}

/**
 * The { … } objects around `index`, innermost first, as [start, end) ranges.
 * None when `index` sits inside a string: that is JSON escaped into a JS
 * string, which the old text-window read still handles.
 */
const enclosingJsonObjects = (text: string, index: number): Array<readonly [number, number]> => {
  const open: number[] = []
  const ends = new Map<number, number>()
  let wanted: number[] | null = null
  let inString = false
  let escaped = false
  for (let position = 0; position < text.length; position += 1) {
    if (position === index) {
      if (inString) return []
      wanted = open.slice(-SERIALIZED_OBJECT_LEVELS).reverse()
      if (wanted.length === 0) return []
    }
    const char = text[position]
    if (inString) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === "\"") inString = false
      continue
    }
    if (char === "\"") {
      inString = true
    } else if (char === "{") {
      open.push(position)
    } else if (char === "}") {
      const start = open.pop()
      if (wanted && start !== undefined && wanted.includes(start)) {
        ends.set(start, position + 1)
        if (ends.size === wanted.length) break
      }
    }
  }
  return (wanted ?? []).flatMap((start) => {
    const end = ends.get(start)
    return end === undefined || end - start > SERIALIZED_OBJECT_MAX_CHARS ? [] : [[start, end] as const]
  })
}

/** One user object, flat REST v1.1 (the page bootstrap) or GraphQL { core, legacy }, if it is this handle's and has counts. */
const serializedUserStats = (objectText: string, authorHandle: string): SerializedAuthorMetadata | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(objectText)
  } catch {
    return null
  }
  const record = plainRecord(parsed)
  if (!record) return null
  const core = plainRecord(record.core)
  const legacy = plainRecord(record.legacy) ?? record
  const verification = plainRecord(record.verification)
  const screenName = serializedShortString(core?.screen_name) ?? serializedShortString(legacy.screen_name)
  if (screenName?.toLowerCase() !== authorHandle.toLowerCase()) return null
  const authorFollowers = serializedNumber(legacy.followers_count) ?? serializedNumber(legacy.normal_followers_count)
  if (authorFollowers === null) return null
  const verified = serializedBoolean(legacy.verified) ?? serializedBoolean(verification?.verified)
  const blueVerified = serializedBoolean(record.is_blue_verified) ?? serializedBoolean(legacy.is_blue_verified)
  return {
    authorFollowers,
    authorFollowing: serializedNumber(legacy.friends_count),
    authorTweets: serializedNumber(legacy.statuses_count),
    authorVerified: verified === true || blueVerified === true ? true : verified === false && blueVerified === false ? false : null,
    authorVerifiedType: serializedShortString(legacy.verified_type) ?? serializedShortString(verification?.verified_type),
    authorCreatedAt: serializedShortString(core?.created_at) ?? serializedShortString(legacy.created_at),
    authorFavourites: serializedNumber(legacy.favourites_count),
  }
}

/** The old read for JSON escaped inside a JS string: fields near the handle. */
const windowedAuthorStats = (text: string, handleIndex: number): SerializedAuthorMetadata | null => {
  const windowText = text.slice(Math.max(0, handleIndex - SERIALIZED_WINDOW_CHARS), handleIndex + SERIALIZED_WINDOW_CHARS)
  const authorFollowers = extractNumberField(windowText, "followers_count") ?? extractNumberField(windowText, "normal_followers_count")
  const authorFollowing = extractNumberField(windowText, "friends_count")
  const authorTweets = extractNumberField(windowText, "statuses_count")
  const verified = extractBooleanField(windowText, "verified")
  const blueVerified = extractBooleanField(windowText, "is_blue_verified")
  const authorVerified = verified === true || blueVerified === true ? true : verified === false && blueVerified === false ? false : null
  if (authorFollowers === null && authorFollowing === null && authorTweets === null && authorVerified === null) return null
  return {
    authorFollowers,
    authorFollowing,
    authorTweets,
    authorVerified,
    authorVerifiedType: extractStringField(windowText, "verified_type"),
    // Never the details from a window: a post's created_at sits right before its
    // author's screen_name, and a join date is what lets the counts reach the model
    // (authorBlockForModel), so a post's time here would score the author as brand new.
    authorCreatedAt: null,
    authorFavourites: null,
  }
}

const serializedAuthorCache = new WeakMap<Document, Map<string, { readonly scripts: number, readonly value: SerializedAuthorMetadata | null }>>()

/**
 * An account's stats from data X serialized into the page, such as the
 * signed-in account in window.__INITIAL_STATE__. Every "screen_name" match is
 * tried (settings.screen_name comes before the user entity), and fields are
 * read only from the one JSON object that is that user, so created_at and
 * favourites_count cannot come from a neighbouring object.
 */
export const extractSerializedAuthorMetadata = (document: Document | null | undefined, authorHandle: string | null): SerializedAuthorMetadata | null => {
  if (!document || !authorHandle) return null
  const scripts = [...document.scripts]
  const cacheKey = authorHandle.toLowerCase()
  const cached = serializedAuthorCache.get(document)?.get(cacheKey)
  if (cached && cached.scripts === scripts.length) return cached.value

  const needle = new RegExp(`\\\\?"screen_name\\\\?":\\\\?"${regexEscape(authorHandle)}\\\\?"`, "giu")
  let value: SerializedAuthorMetadata | null = null
  let windowed: SerializedAuthorMetadata | null = null
  search: for (const script of scripts) {
    const text = script.textContent ?? ""
    for (const match of text.matchAll(needle)) {
      const objects = enclosingJsonObjects(text, match.index)
      if (objects.length === 0) {
        windowed ??= windowedAuthorStats(text, match.index)
        continue
      }
      for (const [start, end] of objects) {
        value = serializedUserStats(text.slice(start, end), authorHandle)
        if (value) break search
      }
    }
  }
  value ??= windowed

  const perDocument = serializedAuthorCache.get(document) ?? new Map()
  perDocument.set(cacheKey, { scripts: scripts.length, value })
  serializedAuthorCache.set(document, perDocument)
  return value
}

export const extractTweetAuthorMetadata = (tweetRoot: QueryAllRoot): TweetAuthorMetadata => {
  const quoted = quotedTweetBlocks(tweetRoot)
  // Counts and badges come from the author's chrome only: a post that says "10K followers" is not a follower count.
  const chromeText = authorChromeText(tweetRoot, quoted)
  const authorHandle = extractAuthorHandle(tweetRoot, quoted, chromeText)
  const serialized = extractSerializedAuthorMetadata((tweetRoot as OwnerDocumentRoot).ownerDocument, authorHandle)
  const authorFollowers = extractCountNearLabel(chromeText, "followers") ?? serialized?.authorFollowers ?? null
  const authorFollowing = extractCountNearLabel(chromeText, "following") ?? serialized?.authorFollowing ?? null
  const authorTweets = extractCountNearLabel(chromeText, "posts") ?? extractCountNearLabel(chromeText, "tweets") ?? serialized?.authorTweets ?? null
  const verifiedBadge = [...tweetRoot.querySelectorAll('[aria-label*="Verified" i], [data-testid*="verified" i]')].some((element) => outsideQuotedTweet(element, quoted))
  const authorVerified = /verified account|blue verified|premium account/iu.test(chromeText) || verifiedBadge ? true : serialized?.authorVerified ?? null
  const hasStats = authorFollowers !== null || authorFollowing !== null || authorTweets !== null || authorVerified !== null
  const hasLocalAuthorData = hasStats || authorHandle !== null

  return {
    authorHandle,
    authorFollowers,
    authorFollowing,
    authorTweets,
    authorVerified,
    authorVerifiedType: serialized?.authorVerifiedType ?? null,
    authorCreatedAt: serialized?.authorCreatedAt ?? null,
    authorFavourites: serialized?.authorFavourites ?? null,
    authorMetadataSource: hasLocalAuthorData ? "same-page-dom" : "defaulted",
  }
}

// Elements that hold lines of their own in an editor: the <div> lines of a plain
// contenteditable and Draft.js's block wrappers, the <p> paragraphs of Lexical
// or ProseMirror, list items, and anything marked as a Draft.js block. Spans
// (Draft.js's [data-offset-key] leaves included) stay inside their line.
const EDITOR_LINE_TAGS = new Set(["DIV", "P", "LI", "UL", "OL", "BLOCKQUOTE", "PRE", "H1", "H2", "H3", "H4", "H5", "H6"])
// Whitespace a browser folds away between blocks: the markup's own, not the writer's.
const FOLDED_WHITESPACE = /^[\t\n\f\r ]*$/u

const holdsEditorLines = (element: Element): boolean => {
  return EDITOR_LINE_TAGS.has(element.tagName.toUpperCase()) || element.getAttribute("data-block") === "true"
}

/**
 * An editor's lines as the page draws them, whatever editor it is: every
 * block starts a new line, a <br> ends one, and a block with nothing in it (or
 * only a <br>) is one empty line. A <br> that closes a block adds no line of
 * its own: editors put one there to keep an empty or last line open. Inside a
 * line, text reads as extractRichText reads it (emoji by their alt text, one
 * placeholder per outside link), less the zero-width U+FEFF some editors park
 * the caret on.
 */
const readEditorLines = (editor: Element): string[] => {
  const lines: string[] = []
  // The line being read, or null right after a block or a <br> closed one.
  let line: string | null = null
  const add = (text: string) => {
    line = (line ?? "") + text
  }
  const closeLine = () => {
    if (line !== null && !FOLDED_WHITESPACE.test(line)) lines.push(line)
    line = null
  }
  // Whether the node shows anything: text, an emoji, a link, a line break or a line.
  const walk = (node: Node): boolean => {
    if (isTextNode(node)) {
      const text = node.data.replace(/﻿/gu, "")
      if (text) add(text)
      return !FOLDED_WHITESPACE.test(text)
    }
    if (!isElementNode(node)) return false
    const tag = node.tagName.toUpperCase()
    if (tag === "BR") {
      lines.push(line ?? "")
      line = null
      return true
    }
    if (tag === "IMG") {
      const alt = node.getAttribute("alt") ?? ""
      if (alt) add(alt)
      return alt !== ""
    }
    if (tag === "A" && isExternalHref(node.getAttribute("href") ?? "")) {
      add(PAGE_LINK_STAND_IN)
      return true
    }
    const block = holdsEditorLines(node)
    if (block) closeLine()
    let shows = false
    for (const child of node.childNodes) shows = walk(child) || shows
    if (!block) return shows
    if (shows) {
      closeLine()
    } else {
      line = null
      lines.push("")
    }
    return true
  }
  for (const child of editor.childNodes) walk(child)
  closeLine()
  return lines
}

/**
 * A draft's text from its own editor element, one line per line the editor
 * draws. Draft.js (X's editor) keeps each line in a [data-block] element and
 * is read block by block; any other editor, or a plain contenteditable, is
 * read by its block structure (readEditorLines), so paragraphs in <div> or <p>
 * elements keep their line breaks and blank lines instead of running together.
 */
export const readComposerDraft = (composer: Element): string => {
  const blocks = [...composer.querySelectorAll('[data-block="true"]')]
  if (blocks.length > 0) {
    return blocks.map((block) => extractRichText(block).replace(/\n+$/u, "")).join("\n")
  }
  return readEditorLines(composer).join("\n")
}

/** The draft in the first composer under `root`. */
export const extractComposerText = (root: QueryRoot): string => {
  const composer = root.querySelector(X_COMPOSER_SELECTOR)
  if (!composer) return ""
  if (!("querySelectorAll" in composer)) return (composer as { textContent?: string | null }).textContent ?? ""
  return readComposerDraft(composer as Element)
}

const HANDLE_PATTERN_SOURCE = "[A-Za-z0-9_]{1,20}"
const NOT_PROFILE_PATHS = new Set(["home", "explore", "i", "messages", "notifications", "search", "settings", "compose", "intent", "login", "logout"])

const avatarHandleIn = (root: QueryRoot, container: string): string | null => {
  const testId = root.querySelector(`${container} [data-testid^="UserAvatar-Container-"]`)?.getAttribute("data-testid") ?? ""
  return new RegExp(`^UserAvatar-Container-(${HANDLE_PATTERN_SOURCE})$`, "u").exec(testId)?.[1] ?? null
}

/**
 * The signed-in account, from page structure rather than display text: the
 * account switcher's avatar (present whether the side nav is expanded or
 * collapsed to icons), the Profile tab's link, the narrow layout's profile
 * button, and only then the switcher's "@handle" line. A display name can hold
 * an "@" of its own ("Siim | building @x11social"), so it is never the first
 * "@" in the switcher's text.
 */
export const extractViewerHandle = (root: QueryRoot): string | null => {
  const switcherSelector = '[data-testid="SideNav_AccountSwitcher_Button"]'
  const fromSwitcherAvatar = avatarHandleIn(root, switcherSelector)
  if (fromSwitcherAvatar) return fromSwitcherAvatar

  const href = root.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute("href") ?? ""
  const fromProfileLink = new RegExp(`^/(${HANDLE_PATTERN_SOURCE})(?:[/?#]|$)`, "u").exec(href)?.[1]
  if (fromProfileLink && !NOT_PROFILE_PATHS.has(fromProfileLink.toLowerCase())) return fromProfileLink

  const fromMobileAvatar = avatarHandleIn(root, '[data-testid="DashButton_ProfileIcon_Link"]')
  if (fromMobileAvatar) return fromMobileAvatar

  const switcher = root.querySelector(switcherSelector)
  if (!switcher) return null
  const spans = "querySelectorAll" in switcher ? [...switcher.querySelectorAll("span")].reverse() : []
  for (const span of spans) {
    const match = new RegExp(`^@(${HANDLE_PATTERN_SOURCE})$`, "u").exec(span.textContent?.trim() ?? "")
    if (match?.[1]) return match[1]
  }
  const mentions = [...(switcher.textContent ?? "").matchAll(new RegExp(`@(${HANDLE_PATTERN_SOURCE})`, "gu"))]
  return mentions.at(-1)?.[1] ?? null
}

// A post link at the very end of a draft: with or without a scheme, any
// ?s=…&t=… share suffix, and /photo/1 or /video/1.
const TRAILING_POST_LINK_PATTERN = /\s*(?:https?:\/\/|(?<![\p{L}\p{N}_.@/-]))(?:(?:www|mobile)\.)?(?:x|twitter)\.com\/(?:[A-Za-z0-9_]{1,20}|i(?:\/web)?)\/status(?:es)?\/\d+\S*\s*$/iu

/**
 * X posts a draft that ends with a post link as a quote of that post and does
 * not show the link. Only the last link counts: a post link mid-text stays a
 * link, as X shows it.
 */
export const splitTrailingPostLink = (draft: string): { readonly text: string, readonly quotesPost: boolean } => {
  const match = TRAILING_POST_LINK_PATTERN.exec(draft)
  return match ? { text: draft.slice(0, match.index).trimEnd(), quotesPost: true } : { text: draft, quotesPost: false }
}

// X handles are at most 15 characters; a longer "@word" is not one X would fold away.
const REPLY_MENTION_PREFIX = /^(?:@[A-Za-z0-9_]{1,15}(?:\s+|$))+/u

/**
 * A reply's leading @mentions join X's "Replying to" line, and the posted
 * reply's text starts after them. Only mentions followed by whitespace count;
 * "@alice, …" stays as it is.
 */
export const stripReplyMentionPrefix = (text: string): string => text.trimStart().replace(REPLY_MENTION_PREFIX, "").trim()
