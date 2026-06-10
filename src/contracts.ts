export const X_SELECTORS = Object.freeze({
  tweetRoot: 'article[data-testid="tweet"]',
  tweetText: '[data-testid="tweetText"]',
  composerPrimary: '[data-testid="tweetTextarea_0"]',
  composerFallback: 'div[role="textbox"][contenteditable="true"]',
  currentAccountSwitcher: '[data-testid="SideNav_AccountSwitcher_Button"]',
  currentProfileLink: '[data-testid="AppTabBar_Profile_Link"]',
  mediaPhoto: '[data-testid="tweetPhoto"]',
  mediaVideo: '[data-testid="videoPlayer"]',
  mediaCard: '[data-testid="card.wrapper"]',
  mediaPreview: '[data-testid="previewInterstitial"]',
  composerMediaPreview: '[data-testid="attachments"], [data-testid="mediaPreview"], [data-testid="tweetPhoto"], [data-testid="videoPlayer"], img[src^="blob:"], video',
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

export const X_COMPOSER_MEDIA_SELECTOR = X_SELECTORS.composerMediaPreview

export const V5_METADATA_FEATURE_ORDER = [
  "has_media",
  "created_at_hour_sin",
  "created_at_hour_cos",
  "created_at_day_sin",
  "created_at_day_cos",
  "log_author_followers",
  "log_author_following",
  "log_author_tweets",
  "author_verified",
  "hashtag_count",
  "mention_count",
  "url_count",
] as const

export type V5MetadataFeatureName = (typeof V5_METADATA_FEATURE_ORDER)[number]

export type V5MetadataFeatureMap = Record<V5MetadataFeatureName, number>

export interface TextFeatureCounts {
  readonly hashtagCount: number
  readonly mentionCount: number
  readonly urlCount: number
}

export interface TweetAuthorMetadata {
  readonly authorHandle: string | null
  readonly authorFollowers: number | null
  readonly authorFollowing: number | null
  readonly authorTweets: number | null
  readonly authorVerified: boolean | null
  readonly authorMetadataSource: "same-page-dom" | "loaded-x-response" | "defaulted"
}

export interface TweetCreatedAtMetadata {
  readonly createdAtHour: number | null
  readonly createdAtDay: number | null
  readonly createdAtSource: "tweet-time" | "defaulted"
}

export interface MetadataPreprocessInput {
  readonly text?: string | null
  readonly hasMedia?: boolean | null
  readonly createdAtHour?: number | null
  readonly createdAtDay?: number | null
  readonly authorFollowers?: number | null
  readonly authorFollowing?: number | null
  readonly authorTweets?: number | null
  readonly authorVerified?: boolean | null
}

export interface MetadataPreprocessResult {
  readonly features: V5MetadataFeatureMap
  readonly vector: readonly number[]
  readonly textFeatures: TextFeatureCounts
}

type QueryRoot = Pick<ParentNode, "querySelector">
type QueryAllRoot = QueryRoot & Pick<ParentNode, "querySelectorAll"> & { readonly textContent?: string | null }
type OwnerDocumentRoot = { readonly ownerDocument?: Document | null }

const TWO_PI = 2 * Math.PI

const finiteNumberOrZero = (value: number | null | undefined): number => {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

const clip = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value))
}

const normalizeCount = (value: number): number => clip(value, 0, 20) / 20

const normalizeLogMetric = (value: number | null | undefined): number => {
  return Math.log1p(Math.max(0, finiteNumberOrZero(value))) / 20
}

const normalizeVisibleText = (value: string): string => value.replace(/\s+/g, " ").trim()

export const stripLeadingReplyMentions = (text: string): string => {
  return normalizeVisibleText(text).replace(/^(?:@[A-Za-z0-9_]{1,20}\s+)+/u, "").trim()
}

export const selectTweetTextForScoring = (visibleText: string, loadedText: string | null | undefined): string => {
  const visible = normalizeVisibleText(visibleText)
  const loaded = typeof loadedText === "string" ? normalizeVisibleText(loadedText) : ""
  if (loaded.length === 0 || loaded.length <= visible.length) return visible

  const loadedWithoutReplyMentions = stripLeadingReplyMentions(loaded)
  if (loadedWithoutReplyMentions.length >= visible.length && loadedWithoutReplyMentions.startsWith(visible)) {
    return loadedWithoutReplyMentions
  }

  if (loaded.startsWith(visible)) return loaded
  return loaded
}

export const extractTextFeatures = (text: string | null | undefined): TextFeatureCounts => {
  const safeText = typeof text === "string" ? text : ""
  const hashtagCount = safeText.match(/(^|[^\p{L}\p{N}_])#[\p{L}\p{N}_]+/gu)?.length ?? 0
  const mentionCount = safeText.match(/(^|[^\p{L}\p{N}_])@[A-Za-z0-9_]{1,20}/gu)?.length ?? 0
  const urlCount = safeText.match(/https?:\/\/[^\s]+|www\.[^\s]+/giu)?.length ?? 0

  return { hashtagCount, mentionCount, urlCount }
}

export const preprocessMetadata = (input: MetadataPreprocessInput = {}): MetadataPreprocessResult => {
  const textFeatures = extractTextFeatures(input.text)
  const hour = clip(finiteNumberOrZero(input.createdAtHour), 0, 23)
  const day = clip(finiteNumberOrZero(input.createdAtDay), 0, 6)

  const features: V5MetadataFeatureMap = {
    has_media: input.hasMedia === true ? 1 : 0,
    created_at_hour_sin: Math.sin((TWO_PI * hour) / 24),
    created_at_hour_cos: Math.cos((TWO_PI * hour) / 24),
    created_at_day_sin: Math.sin((TWO_PI * day) / 7),
    created_at_day_cos: Math.cos((TWO_PI * day) / 7),
    log_author_followers: normalizeLogMetric(input.authorFollowers),
    log_author_following: normalizeLogMetric(input.authorFollowing),
    log_author_tweets: normalizeLogMetric(input.authorTweets),
    author_verified: input.authorVerified === true ? 1 : 0,
    hashtag_count: normalizeCount(textFeatures.hashtagCount),
    mention_count: normalizeCount(textFeatures.mentionCount),
    url_count: normalizeCount(textFeatures.urlCount),
  }

  return {
    features,
    vector: V5_METADATA_FEATURE_ORDER.map((featureName) => features[featureName]),
    textFeatures,
  }
}

export const extractTweetText = (tweetRoot: QueryRoot): string => {
  return tweetRoot.querySelector(X_SELECTORS.tweetText)?.textContent ?? ""
}

export const tweetHasMedia = (tweetRoot: QueryRoot): boolean => {
  return tweetRoot.querySelector(X_TWEET_MEDIA_SELECTOR) !== null
}

export const extractTweetStatusId = (tweetRoot: QueryAllRoot): string | null => {
  for (const link of [...tweetRoot.querySelectorAll('a[href*="/status/"]')]) {
    const href = link.getAttribute("href") ?? ""
    const match = href.match(/\/status\/(\d+)(?:$|[/?#])/u)
    if (match?.[1]) return match[1]
  }

  return null
}

export const tweetTextIsTruncated = (tweetRoot: QueryAllRoot): boolean => {
  const text = tweetRoot.textContent ?? ""
  if (!/show more/iu.test(text)) return false

  return [...tweetRoot.querySelectorAll("a, button, span, div")].some((node) => {
    return node.textContent?.replace(/\s+/g, " ").trim().toLowerCase() === "show more"
  })
}

export const composerHasMedia = (composerRoot: QueryRoot): boolean => {
  return composerRoot.querySelector(X_COMPOSER_MEDIA_SELECTOR) !== null
}

export const timeMetadataFromDate = (date: Date): Omit<TweetCreatedAtMetadata, "createdAtSource"> => {
  if (!Number.isFinite(date.getTime())) {
    return { createdAtHour: null, createdAtDay: null }
  }

  return {
    createdAtHour: date.getHours(),
    createdAtDay: date.getDay(),
  }
}

export const currentTimeMetadata = (now: Date = new Date()): Omit<TweetCreatedAtMetadata, "createdAtSource"> => {
  return timeMetadataFromDate(now)
}

export const extractTweetCreatedAtMetadata = (tweetRoot: QueryRoot): TweetCreatedAtMetadata => {
  const datetime = tweetRoot.querySelector("time[datetime]")?.getAttribute("datetime")
  if (!datetime) {
    return { createdAtHour: null, createdAtDay: null, createdAtSource: "defaulted" }
  }

  const parsed = timeMetadataFromDate(new Date(datetime))
  return parsed.createdAtHour === null || parsed.createdAtDay === null
    ? { createdAtHour: null, createdAtDay: null, createdAtSource: "defaulted" }
    : { ...parsed, createdAtSource: "tweet-time" }
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

const extractAuthorHandle = (tweetRoot: QueryAllRoot): string | null => {
  const avatarContainer = [...tweetRoot.querySelectorAll("[data-testid^='UserAvatar-Container-']")][0]
  const avatarHandle = avatarContainer?.getAttribute("data-testid")?.match(/^UserAvatar-Container-([A-Za-z0-9_]{1,20})$/u)?.[1]
  if (avatarHandle) return avatarHandle

  const userNameLinks = [...tweetRoot.querySelectorAll("[data-testid='User-Name'] a[href]")]
  for (const link of userNameLinks) {
    const href = link.getAttribute("href") ?? ""
    const match = href.match(/^\/([A-Za-z0-9_]{1,20})(?:$|[/?#])/u)
    if (match?.[1]) return match[1]
  }

  const links = [...tweetRoot.querySelectorAll(":scope > div a[href], [data-testid='Tweet-User-Avatar'] a[href]")]
  for (const link of links) {
    const href = link.getAttribute("href") ?? ""
    const match = href.match(/^\/([A-Za-z0-9_]{1,20})(?:$|[/?#])/u)
    if (match?.[1] && !["home", "i", "intent", "messages", "notifications", "search", "settings"].includes(match[1])) {
      return match[1]
    }
  }

  const handleMatch = tweetRoot.textContent?.match(/@([A-Za-z0-9_]{1,20})\b/u)
  return handleMatch?.[1] ?? null
}

const extractSerializedAuthorMetadata = (document: Document | null | undefined, authorHandle: string | null): Omit<TweetAuthorMetadata, "authorHandle" | "authorMetadataSource"> | null => {
  if (!document || !authorHandle) return null
  const needle = `\\\\?"screen_name\\\\?":\\\\?"${regexEscape(authorHandle)}\\\\?"`

  for (const script of [...document.scripts]) {
    const text = script.textContent ?? ""
    const handleIndex = text.search(new RegExp(needle, "u"))
    if (handleIndex < 0) continue
    const windowText = text.slice(Math.max(0, handleIndex - 2500), handleIndex + 2500)
    const authorFollowers = extractNumberField(windowText, "followers_count") ?? extractNumberField(windowText, "normal_followers_count")
    const authorFollowing = extractNumberField(windowText, "friends_count")
    const authorTweets = extractNumberField(windowText, "statuses_count")
    const verified = extractBooleanField(windowText, "verified")
    const blueVerified = extractBooleanField(windowText, "is_blue_verified")
    const authorVerified = verified === true || blueVerified === true ? true : verified === false && blueVerified === false ? false : null
    if (authorFollowers !== null || authorFollowing !== null || authorTweets !== null || authorVerified !== null) {
      return { authorFollowers, authorFollowing, authorTweets, authorVerified }
    }
  }

  return null
}

export const extractTweetAuthorMetadata = (tweetRoot: QueryAllRoot): TweetAuthorMetadata => {
  const localText = tweetRoot.textContent ?? ""
  const authorHandle = extractAuthorHandle(tweetRoot)
  const serialized = extractSerializedAuthorMetadata((tweetRoot as OwnerDocumentRoot).ownerDocument, authorHandle)
  const authorFollowers = extractCountNearLabel(localText, "followers") ?? serialized?.authorFollowers ?? null
  const authorFollowing = extractCountNearLabel(localText, "following") ?? serialized?.authorFollowing ?? null
  const authorTweets = extractCountNearLabel(localText, "posts") ?? extractCountNearLabel(localText, "tweets") ?? serialized?.authorTweets ?? null
  const authorVerified = /verified account|blue verified|premium account/iu.test(localText) || tweetRoot.querySelector('[aria-label*="Verified" i], [data-testid*="verified" i]') !== null ? true : serialized?.authorVerified ?? null
  const hasStats = authorFollowers !== null || authorFollowing !== null || authorTweets !== null || authorVerified !== null
  const hasLocalAuthorData = hasStats || authorHandle !== null

  return {
    authorHandle,
    authorFollowers,
    authorFollowing,
    authorTweets,
    authorVerified,
    authorMetadataSource: hasLocalAuthorData ? "same-page-dom" : "defaulted",
  }
}

const extractCurrentAccountHandle = (root: QueryAllRoot): string | null => {
  const accountSwitcher = root.querySelector(X_SELECTORS.currentAccountSwitcher)
  const avatarHandle = accountSwitcher?.querySelector('[data-testid^="UserAvatar-Container-"]')?.getAttribute("data-testid")?.match(/^UserAvatar-Container-([A-Za-z0-9_]{1,20})$/u)?.[1]
  if (avatarHandle) return avatarHandle

  const accountText = accountSwitcher?.textContent ?? ""
  const accountHandle = accountText.match(/@([A-Za-z0-9_]{1,20})\b/u)?.[1]
  if (accountHandle) return accountHandle

  const profileHref = root.querySelector(X_SELECTORS.currentProfileLink)?.getAttribute("href") ?? ""
  const profileHandle = profileHref.match(/^\/([A-Za-z0-9_]{1,20})(?:$|[/?#])/u)?.[1]
  if (profileHandle) return profileHandle

  return null
}

export const extractCurrentAccountMetadata = (root: QueryAllRoot): TweetAuthorMetadata => {
  const accountSwitcher = root.querySelector(X_SELECTORS.currentAccountSwitcher)
  const localText = accountSwitcher?.textContent ?? ""
  const authorHandle = extractCurrentAccountHandle(root)
  const rootDocument = (root as OwnerDocumentRoot).ownerDocument ?? ((root as { readonly nodeType?: number }).nodeType === 9 ? root as Document : null)
  const serialized = extractSerializedAuthorMetadata(rootDocument, authorHandle)
  const authorFollowers = extractCountNearLabel(localText, "followers") ?? serialized?.authorFollowers ?? null
  const authorFollowing = extractCountNearLabel(localText, "following") ?? serialized?.authorFollowing ?? null
  const authorTweets = extractCountNearLabel(localText, "posts") ?? extractCountNearLabel(localText, "tweets") ?? serialized?.authorTweets ?? null
  const localVerified = /verified account|blue verified|premium account/iu.test(localText) || accountSwitcher?.querySelector('[aria-label*="Verified" i], [data-testid*="verified" i]') !== null
  const authorVerified = localVerified ? true : serialized?.authorVerified ?? null
  const hasStats = authorFollowers !== null || authorFollowing !== null || authorTweets !== null || authorVerified !== null
  const hasLocalAuthorData = hasStats || authorHandle !== null

  return {
    authorHandle,
    authorFollowers,
    authorFollowing,
    authorTweets,
    authorVerified,
    authorMetadataSource: hasLocalAuthorData ? "same-page-dom" : "defaulted",
  }
}

export const extractComposerText = (root: QueryRoot): string => {
  return root.querySelector(X_COMPOSER_SELECTOR)?.textContent ?? ""
}
