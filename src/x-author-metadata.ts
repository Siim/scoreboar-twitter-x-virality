// Types only: this module is also bundled into the page listener, which has no contracts.ts.
import type { TweetAuthorMetadata } from "./contracts.js"
import type { TweetFoundEvent } from "./dom-detection.js"

export interface XAuthorStats {
  readonly authorHandle: string
  readonly authorFollowers: number | null
  readonly authorFollowing: number | null
  readonly authorTweets: number | null
  readonly authorVerified: boolean | null
  readonly authorVerifiedType?: string | null
  readonly authorCreatedAt?: string | null
  readonly authorFavourites?: number | null
  readonly authorMetadataSource: "loaded-x-response"
}

/** What a loaded timeline response says about one post, read passively. */
export interface XTweetFacts {
  readonly tweetId: string
  readonly authorHandle: string | null
  readonly createdAt: string | null
  readonly isQuote: boolean
  readonly mediaTypes: readonly string[]
  readonly hasCard: boolean
  /**
   * The post's text as x.com shows it, whole: a long post's full note rather
   * than the timeline's cut preview, and a link card's URL kept as a link
   * where X hides it from the body. Links are page stand-ins, never t.co.
   */
  readonly text?: string | null
  /** The text is a long post's full note, so it replaces a cut-short page preview. */
  readonly textIsFullNote?: boolean
}

// Same stand-in as PAGE_LINK_STAND_IN in contracts.ts (not importable here): URL-shaped so the
// contract reads it as [link], and not t.co so the has-media trailing-t.co rule leaves it alone.
const FACTS_LINK_STAND_IN = "https://link"
const TCO_URL_PATTERN = /https?:\/\/t\.co\/\w+/giu
const STATUS_URL_PATTERN = /^https?:\/\/(?:(?:www|mobile)\.)?(?:x|twitter)\.com\/(?:\w{1,20}|i(?:\/web)?)\/status(?:es)?\/(\d+)/iu
// API text escapes only these three; X's indices count the characters unescaped.
const API_ESCAPES: Readonly<Record<string, string>> = { "&amp;": "&", "&lt;": "<", "&gt;": ">" }

const isJsonRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null
}

const recordAt = (value: unknown, path: readonly string[]): Record<string, unknown> | null => {
  let current: unknown = value
  for (const key of path) {
    if (!isJsonRecord(current)) return null
    current = current[key]
  }
  return isJsonRecord(current) ? current : null
}

const finiteNumberOrNull = (value: unknown): number | null => {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

const booleanOrNull = (value: unknown): boolean | null => {
  return typeof value === "boolean" ? value : null
}

const handleOrNull = (value: unknown): string | null => {
  return typeof value === "string" && /^[A-Za-z0-9_]{1,20}$/u.test(value) ? value : null
}

const shortStringOrNull = (value: unknown): string | null => {
  return typeof value === "string" && value.length > 0 && value.length <= 64 ? value : null
}

const statsFromUserResult = (value: Record<string, unknown>): XAuthorStats | null => {
  const core = isJsonRecord(value.core) ? value.core : null
  const legacy = isJsonRecord(value.legacy) ? value.legacy : null
  const verification = isJsonRecord(value.verification) ? value.verification : null
  const authorHandle = handleOrNull(core?.screen_name) ?? handleOrNull(legacy?.screen_name)
  if (!authorHandle || !legacy) return null

  const authorFollowers = finiteNumberOrNull(legacy.followers_count) ?? finiteNumberOrNull(legacy.normal_followers_count)
  const authorFollowing = finiteNumberOrNull(legacy.friends_count)
  const authorTweets = finiteNumberOrNull(legacy.statuses_count)
  const verified = booleanOrNull(legacy.verified) ?? booleanOrNull(verification?.verified)
  const blueVerified = booleanOrNull(value.is_blue_verified) ?? booleanOrNull(legacy.is_blue_verified)
  const authorVerified = verified === true || blueVerified === true ? true : verified === false && blueVerified === false ? false : null

  if (authorFollowers === null && authorFollowing === null && authorTweets === null && authorVerified === null) {
    return null
  }

  return {
    authorHandle,
    authorFollowers,
    authorFollowing,
    authorTweets,
    authorVerified,
    authorVerifiedType: shortStringOrNull(legacy.verified_type) ?? shortStringOrNull(verification?.verified_type),
    authorCreatedAt: shortStringOrNull(core?.created_at) ?? shortStringOrNull(legacy.created_at),
    authorFavourites: finiteNumberOrNull(legacy.favourites_count),
    authorMetadataSource: "loaded-x-response",
  }
}

/**
 * A flat REST v1.1 user, the shape the page bootstrap (window.__INITIAL_STATE__)
 * carries for the signed-in account, read with the same field rules as GraphQL.
 */
export const extractXAuthorStatsFromRestUser = (user: unknown): XAuthorStats | null => {
  if (!isJsonRecord(user)) return null
  return statsFromUserResult({ legacy: user, is_blue_verified: user.is_blue_verified })
}

/** The signed-in account from X's page bootstrap: session.user_id points into entities.users. */
export const extractXViewerFromInitialState = (state: unknown): XAuthorStats | null => {
  const session = recordAt(state, ["session"])
  const userId = typeof session?.user_id === "string" || typeof session?.user_id === "number" ? String(session.user_id) : null
  if (!userId) return null
  return extractXAuthorStatsFromRestUser(recordAt(state, ["entities", "users", "entities", userId]))
}

/**
 * The signed-in account when a response is about them: the Viewer query X runs
 * on load, or the post they just created (CreateTweet / CreateNoteTweet carry
 * the author's full user object).
 */
export const extractXViewerFromGraphql = (payload: unknown): XAuthorStats | null => {
  const data = recordAt(payload, ["data"])
  if (!data) return null
  const created = recordAt(data, ["create_tweet", "tweet_results", "result"]) ?? recordAt(data, ["notetweet_create", "tweet_results", "result"])
  const createdTweet = created && isJsonRecord(created.tweet) ? created.tweet : created
  const candidates = [
    recordAt(data, ["viewer", "user_results", "result"]),
    recordAt(data, ["viewer_v2", "user_results", "result"]),
    recordAt(createdTweet, ["core", "user_results", "result"]),
  ]
  for (const candidate of candidates) {
    const stats = candidate ? statsFromUserResult(candidate) : null
    if (stats) return stats
  }
  return null
}

const unescapeApiText = (text: string): string => text.replace(/&(?:amp|lt|gt);/gu, (entity) => API_ESCAPES[entity] ?? entity)

interface UrlEntity {
  readonly url: string
  readonly expandedUrl: string | null
  readonly start: number
}

/** A URL list: legacy.entities.urls, or a long post's note_tweet entity_set.urls (indices then count in the note). */
const urlEntities = (entitySet: unknown): UrlEntity[] => {
  const entities = isJsonRecord(entitySet) && Array.isArray(entitySet.urls) ? entitySet.urls : []
  return entities.flatMap((entity) => {
    if (!isJsonRecord(entity) || typeof entity.url !== "string") return []
    const indices = Array.isArray(entity.indices) ? entity.indices : []
    const start = typeof indices[0] === "number" ? indices[0] : -1
    return [{ url: entity.url, expandedUrl: typeof entity.expanded_url === "string" ? entity.expanded_url : null, start }]
  })
}

const cardUrl = (value: Record<string, unknown>): string | null => {
  const card = isJsonRecord(value.card) ? value.card : null
  if (!card) return null
  const legacyUrl = recordAt(card, ["legacy"])?.url
  if (typeof legacyUrl === "string" && /^https?:\/\//iu.test(legacyUrl)) return legacyUrl
  const bindings = recordAt(card, ["legacy"])?.binding_values ?? card.binding_values
  const entries = Array.isArray(bindings) ? bindings : isJsonRecord(bindings) ? Object.entries(bindings).map(([key, value]) => ({ key, value })) : []
  for (const entry of entries) {
    if (!isJsonRecord(entry) || entry.key !== "card_url") continue
    const bound = isJsonRecord(entry.value) ? entry.value.string_value : null
    if (typeof bound === "string" && /^https?:\/\//iu.test(bound)) return bound
  }
  return null
}

/** A link to the post being quoted (to any post, when the response does not say which). */
const quotedPermalink = (entity: UrlEntity, legacy: Record<string, unknown>): boolean => {
  const statusId = entity.expandedUrl ? STATUS_URL_PATTERN.exec(entity.expandedUrl)?.[1] : undefined
  if (!statusId) return false
  const quotedId = typeof legacy.quoted_status_id_str === "string" ? legacy.quoted_status_id_str : null
  return quotedId === null || statusId === quotedId
}

const displayRange = (legacy: Record<string, unknown>, length: number): readonly [number, number] => {
  const range = Array.isArray(legacy.display_text_range) ? legacy.display_text_range : null
  const start = typeof range?.[0] === "number" ? range[0] : 0
  const end = typeof range?.[1] === "number" ? range[1] : length
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start <= end && end <= length ? [start, end] : [0, length]
}

const noteResult = (value: Record<string, unknown>): Record<string, unknown> | null => recordAt(value, ["note_tweet", "note_tweet_results", "result"])

const noteText = (value: Record<string, unknown>): string | null => {
  const text = noteResult(value)?.text
  return typeof text === "string" && text.trim().length > 0 ? text : null
}

/**
 * The post as a reader sees it on x.com, from the API: after the reply
 * mentions X folds into "Replying to", without the media and quoted-post links
 * it hides, but with a trailing link card's URL kept as a link. The draft kept
 * that URL and so did training's API text; only the rendered body drops it.
 */
const pageTextFromTweetResult = (value: Record<string, unknown>, legacy: Record<string, unknown>, isQuote: boolean): string | null => {
  const fullText = typeof legacy.full_text === "string" ? unescapeApiText(legacy.full_text) : null
  const note = noteText(value)
  if (fullText === null && note === null) return null
  const points = Array.from(fullText ?? "")
  const [start, end] = displayRange(legacy, points.length)
  const entities = urlEntities(legacy.entities)
  let text: string
  if (note !== null) {
    // A long post: legacy.full_text is only the preview. Its reply prefix still applies.
    const replyPrefix = points.slice(0, start).join("")
    text = replyPrefix && note.startsWith(replyPrefix) ? note.slice(replyPrefix.length) : note
    text = unescapeApiText(text)
  } else {
    text = points.slice(start, end).join("")
    if (isJsonRecord(value.card)) {
      // The card's own URL when X names it, else the last link the body hides that is not a quoted post's.
      const card = cardUrl(value)
      const hidden = entities.filter((entity) => entity.start >= end && !quotedPermalink(entity, legacy))
      const hiddenCardLink = hidden.find((entity) => entity.url === card) ?? hidden.at(-1)
      const gap = hiddenCardLink ? points.slice(end, hiddenCardLink.start).join("") : null
      if (gap !== null && /^\s*$/u.test(gap)) text = `${text}${gap}${FACTS_LINK_STAND_IN}`
    }
  }

  const media = isJsonRecord(legacy.extended_entities) && Array.isArray(legacy.extended_entities.media) ? legacy.extended_entities.media : []
  for (const item of media) {
    if (isJsonRecord(item) && typeof item.url === "string" && item.url.length > 0) text = text.split(item.url).join(" ")
  }
  if (isQuote) {
    // A pasted post link X turned into the quote; it shows the quoted post instead. A long
    // post's legacy entities cover only its cut preview, so its note names the links its text holds.
    const quoteLinks = note !== null ? [...urlEntities(noteResult(value)?.entity_set), ...entities] : entities
    for (const entity of quoteLinks) {
      if (!quotedPermalink(entity, legacy)) continue
      const trimmed = text.trimEnd()
      if (trimmed.endsWith(entity.url)) text = trimmed.slice(0, -entity.url.length).trimEnd()
    }
  }
  return text.replace(TCO_URL_PATTERN, FACTS_LINK_STAND_IN)
}

const factsFromTweetResult = (value: Record<string, unknown>): XTweetFacts | null => {
  const tweetId = typeof value.rest_id === "string" && /^\d{1,25}$/u.test(value.rest_id) ? value.rest_id : null
  const legacy = isJsonRecord(value.legacy) ? value.legacy : null
  if (!tweetId || !legacy || typeof legacy.created_at !== "string" || !("full_text" in legacy || "is_quote_status" in legacy)) {
    return null
  }
  const userResult = isJsonRecord(value.core) && isJsonRecord(value.core.user_results) && isJsonRecord(value.core.user_results.result)
    ? value.core.user_results.result
    : null
  const userCore = userResult && isJsonRecord(userResult.core) ? userResult.core : null
  const userLegacy = userResult && isJsonRecord(userResult.legacy) ? userResult.legacy : null
  const extendedEntities = isJsonRecord(legacy.extended_entities) ? legacy.extended_entities : null
  const media = Array.isArray(extendedEntities?.media) ? extendedEntities.media : []
  const isQuote = legacy.is_quote_status === true || isJsonRecord(value.quoted_status_result)

  return {
    tweetId,
    authorHandle: handleOrNull(userCore?.screen_name) ?? handleOrNull(userLegacy?.screen_name),
    createdAt: legacy.created_at,
    isQuote,
    mediaTypes: media.map((item) => (isJsonRecord(item) && typeof item.type === "string" ? item.type : "")).filter(Boolean),
    hasCard: isJsonRecord(value.card),
    text: pageTextFromTweetResult(value, legacy, isQuote),
    textIsFullNote: noteText(value) !== null,
  }
}

const visitGraphql = (payload: unknown, visitor: (record: Record<string, unknown>) => void) => {
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!isJsonRecord(value)) return
    visitor(value)
    for (const child of Object.values(value)) {
      if (typeof child === "object" && child !== null) visit(child)
    }
  }
  visit(payload)
}

export const extractXAuthorStatsFromGraphql = (payload: unknown): readonly XAuthorStats[] => {
  const statsByHandle = new Map<string, XAuthorStats>()
  visitGraphql(payload, (record) => {
    const stats = statsFromUserResult(record)
    if (stats?.authorHandle) statsByHandle.set(stats.authorHandle.toLowerCase(), stats)
  })
  return [...statsByHandle.values()]
}

export const extractXTweetFactsFromGraphql = (payload: unknown): readonly XTweetFacts[] => {
  const factsById = new Map<string, XTweetFacts>()
  visitGraphql(payload, (record) => {
    const facts = factsFromTweetResult(record)
    if (facts) factsById.set(facts.tweetId, facts)
  })
  return [...factsById.values()]
}

// ---------------------------------------------------------------------------
// One merge for both scoring paths. A draft and the post it becomes must read
// the author and the post facts from the same sources in the same order, or
// the same post scores differently before and after it is published.
// ---------------------------------------------------------------------------

/** Loaded X stats first, field by field, then what the page itself shows. */
export const mergeAuthorMetadata = (
  handle: string | null,
  cached: XAuthorStats | undefined,
  dom: Partial<TweetAuthorMetadata> | null | undefined,
): TweetAuthorMetadata => ({
  authorHandle: cached?.authorHandle ?? handle ?? dom?.authorHandle ?? null,
  authorFollowers: cached?.authorFollowers ?? dom?.authorFollowers ?? null,
  authorFollowing: cached?.authorFollowing ?? dom?.authorFollowing ?? null,
  authorTweets: cached?.authorTweets ?? dom?.authorTweets ?? null,
  authorVerified: cached?.authorVerified ?? dom?.authorVerified ?? null,
  authorVerifiedType: cached?.authorVerifiedType ?? dom?.authorVerifiedType ?? null,
  authorCreatedAt: cached?.authorCreatedAt ?? dom?.authorCreatedAt ?? null,
  authorFavourites: cached?.authorFavourites ?? dom?.authorFavourites ?? null,
  authorMetadataSource: cached ? "loaded-x-response" : dom?.authorMetadataSource ?? "defaulted",
})

/**
 * A post as the page shows it, refined by what X's own response says about it:
 * media types, quote, card, time, and the whole text where the page shows a
 * cut preview or hides a card's link.
 */
export const applyTweetFacts = <Event extends TweetFoundEvent>(event: Event, facts: XTweetFacts | undefined): Event => {
  if (!facts) return event
  const hasVideo = facts.mediaTypes.some((type) => type === "video" || type === "animated_gif")
  const hasPhoto = facts.mediaTypes.includes("photo")
  const factsText = typeof facts.text === "string" ? facts.text.trim() : ""
  return {
    ...event,
    // A cut-short page preview stays cut short unless X sent the whole note.
    ...(factsText ? { text: factsText, textTruncated: event.textTruncated === true && facts.textIsFullNote !== true } : {}),
    hasMedia: facts.mediaTypes.length > 0,
    mediaFacts: { hasMedia: facts.mediaTypes.length > 0, hasPhoto, hasVideo, hasCard: facts.hasCard },
    isQuote: facts.isQuote,
    createdAtMetadata: facts.createdAt ? { createdAt: facts.createdAt, createdAtSource: "tweet-time" } : event.createdAtMetadata,
    authorMetadata: event.authorMetadata.authorHandle || !facts.authorHandle
      ? event.authorMetadata
      : { ...event.authorMetadata, authorHandle: facts.authorHandle },
  }
}

/** A post as the feed badge scores it: the page's reading, X's facts about the post, then its author's loaded stats. */
export const enrichTweetEvent = <Event extends TweetFoundEvent>(
  domEvent: Event,
  factsById: ReadonlyMap<string, XTweetFacts>,
  statsByHandle: ReadonlyMap<string, XAuthorStats>,
): Event => {
  const event = applyTweetFacts(domEvent, domEvent.tweetId ? factsById.get(domEvent.tweetId) : undefined)
  const authorHandle = event.authorMetadata.authorHandle
  const cached = authorHandle ? statsByHandle.get(authorHandle.toLowerCase()) : undefined
  return { ...event, authorMetadata: mergeAuthorMetadata(authorHandle, cached, event.authorMetadata) }
}
