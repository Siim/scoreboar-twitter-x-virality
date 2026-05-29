export interface XAuthorStats {
  readonly authorHandle: string
  readonly authorFollowers: number | null
  readonly authorFollowing: number | null
  readonly authorTweets: number | null
  readonly authorVerified: boolean | null
  readonly authorMetadataSource: "loaded-x-response"
}

export interface XTweetText {
  readonly tweetId: string
  readonly text: string
  readonly textSource: "loaded-x-response"
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null
}

const finiteNumberOrNull = (value: unknown): number | null => {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

const booleanOrNull = (value: unknown): boolean | null => {
  return typeof value === "boolean" ? value : null
}

const stringOrNull = (value: unknown): string | null => {
  return typeof value === "string" && /^[A-Za-z0-9_]{1,20}$/u.test(value) ? value : null
}

const tweetIdOrNull = (value: unknown): string | null => {
  return typeof value === "string" && /^\d+$/u.test(value) ? value : null
}

const tweetTextOrNull = (value: unknown): string | null => {
  return typeof value === "string" && value.trim().length > 0 ? value.replace(/\s+/g, " ").trim() : null
}

const statsFromUserResult = (value: Record<string, unknown>): XAuthorStats | null => {
  const core = isRecord(value.core) ? value.core : null
  const legacy = isRecord(value.legacy) ? value.legacy : null
  const authorHandle = stringOrNull(core?.screen_name) ?? stringOrNull(legacy?.screen_name)
  if (!authorHandle || !legacy) return null

  const authorFollowers = finiteNumberOrNull(legacy.followers_count) ?? finiteNumberOrNull(legacy.normal_followers_count)
  const authorFollowing = finiteNumberOrNull(legacy.friends_count)
  const authorTweets = finiteNumberOrNull(legacy.statuses_count)
  const verified = booleanOrNull(legacy.verified)
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
    authorMetadataSource: "loaded-x-response",
  }
}

export const extractXAuthorStatsFromGraphql = (payload: unknown): readonly XAuthorStats[] => {
  const statsByHandle = new Map<string, XAuthorStats>()
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!isRecord(value)) return

    const stats = statsFromUserResult(value)
    if (stats?.authorHandle) {
      statsByHandle.set(stats.authorHandle.toLowerCase(), stats)
    }

    for (const child of Object.values(value)) {
      if (typeof child === "object" && child !== null) visit(child)
    }
  }

  visit(payload)
  return [...statsByHandle.values()]
}

const tweetTextFromResult = (value: Record<string, unknown>): XTweetText | null => {
  const legacy = isRecord(value.legacy) ? value.legacy : null
  const tweetId = tweetIdOrNull(value.rest_id) ?? tweetIdOrNull(legacy?.id_str)
  if (!tweetId || !legacy) return null

  const noteTweet = isRecord(value.note_tweet) ? value.note_tweet : null
  const noteTweetResults = isRecord(noteTweet?.note_tweet_results) ? noteTweet.note_tweet_results : null
  const noteTweetResult = isRecord(noteTweetResults?.result) ? noteTweetResults.result : null
  const noteTweetText = tweetTextOrNull(noteTweetResult?.text)
  const legacyFullText = tweetTextOrNull(legacy.full_text)
  const legacyText = tweetTextOrNull(legacy.text)
  const text = noteTweetText ?? legacyFullText ?? legacyText
  if (!text) return null

  return { tweetId, text, textSource: "loaded-x-response" }
}

export const extractXTweetTextsFromGraphql = (payload: unknown): readonly XTweetText[] => {
  const textByTweetId = new Map<string, XTweetText>()
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!isRecord(value)) return

    const tweetText = tweetTextFromResult(value)
    if (tweetText) {
      const existing = textByTweetId.get(tweetText.tweetId)
      if (!existing || tweetText.text.length > existing.text.length) {
        textByTweetId.set(tweetText.tweetId, tweetText)
      }
    }

    for (const child of Object.values(value)) {
      if (typeof child === "object" && child !== null) visit(child)
    }
  }

  visit(payload)
  return [...textByTweetId.values()]
}
