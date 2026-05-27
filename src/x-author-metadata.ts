export interface XAuthorStats {
  readonly authorHandle: string
  readonly authorFollowers: number | null
  readonly authorFollowing: number | null
  readonly authorTweets: number | null
  readonly authorVerified: boolean | null
  readonly authorMetadataSource: "loaded-x-response"
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
