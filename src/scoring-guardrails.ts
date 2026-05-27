export const DEFAULT_SCOREBOAR_SCORING_CONCURRENCY = 3
export const DEFAULT_SCOREBOAR_SCORING_CACHE_SIZE = 512

export interface ScoreboarScoringGuardrailStats {
  readonly activeCount: number
  readonly queuedCount: number
  readonly cacheSize: number
  readonly concurrency: number
}

export interface ScoreboarScoringGuardrailOptions<Input> {
  readonly concurrency?: number
  readonly cacheSize?: number
  readonly keyFor?: (input: Input) => string
}

export interface ScoreboarScoringGuardrailController<Input, Result> {
  readonly score: (input: Input, scorer: (input: Input) => Promise<Result>) => Promise<Result>
  readonly clear: () => void
  readonly stats: () => ScoreboarScoringGuardrailStats
}

export type ScoreboarScoringMetadata = Readonly<Record<string, unknown>>

const SCOREBOAR_GUARDRAIL_SCORING_METADATA_KEYS = [
  "hasMedia",
  "createdAtHour",
  "createdAtDay",
  "authorFollowers",
  "authorFollowing",
  "authorTweets",
  "authorVerified",
  "authorHandle",
] as const

const scoreboarGuardrailsPositiveInteger = (value: number | undefined, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback
  }

  return Math.max(1, Math.floor(value))
}

const scoreboarGuardrailsNormalizeText = (text: string): string => text.replace(/\s+/g, " ").trim()

const scoreboarGuardrailsStableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => scoreboarGuardrailsStableStringify(item)).join(",")}]`
  }

  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => {
    return `${JSON.stringify(key)}:${scoreboarGuardrailsStableStringify(record[key])}`
  }).join(",")}}`
}

export const scoreboarStableHash = (value: string): string => {
  let hash = 0x811c9dc5

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return hash.toString(36)
}

const scoreboarGuardrailsStringMetadataValue = (
  metadata: object | undefined,
  keys: readonly string[],
): string | null => {
  if (!metadata) {
    return null
  }

  const metadataRecord = metadata as ScoreboarScoringMetadata

  for (const key of keys) {
    const value = metadataRecord[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim()
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value)
    }
  }

  return null
}

const scoreboarGuardrailsScoringMetadata = (metadata: object | undefined): Record<string, unknown> => {
  const scoringMetadata: Record<string, unknown> = {}

  if (!metadata) {
    return scoringMetadata
  }

  const metadataRecord = metadata as ScoreboarScoringMetadata

  for (const key of SCOREBOAR_GUARDRAIL_SCORING_METADATA_KEYS) {
    if (metadataRecord[key] !== undefined) {
      scoringMetadata[key] = metadataRecord[key]
    }
  }

  return scoringMetadata
}

export const createTextScoringCacheKey = (
  text: string,
  metadata?: object,
): string => {
  const stableInput = {
    id: scoreboarGuardrailsStringMetadataValue(metadata, ["scoreboarCacheKey", "cacheKey", "tweetId", "id", "key"]),
    text: scoreboarGuardrailsNormalizeText(text),
    metadata: scoreboarGuardrailsScoringMetadata(metadata),
  }

  return `scoreboar:${scoreboarStableHash(scoreboarGuardrailsStableStringify(stableInput))}`
}

export const createScoringGuardrails = <Input, Result>(
  options: ScoreboarScoringGuardrailOptions<Input> = {},
): ScoreboarScoringGuardrailController<Input, Result> => {
  const concurrency = scoreboarGuardrailsPositiveInteger(options.concurrency, DEFAULT_SCOREBOAR_SCORING_CONCURRENCY)
  const cacheLimit = scoreboarGuardrailsPositiveInteger(options.cacheSize, DEFAULT_SCOREBOAR_SCORING_CACHE_SIZE)
  const keyFor = options.keyFor ?? ((input: Input) => scoreboarStableHash(scoreboarGuardrailsStableStringify(input)))
  const cachedScores = new Map<string, Promise<Result>>()
  const queuedTasks: Array<() => void> = []
  let activeCount = 0

  const drainQueue = () => {
    if (activeCount >= concurrency) {
      return
    }

    queuedTasks.shift()?.()
  }

  const enqueue = (run: () => Promise<Result>): Promise<Result> => new Promise((resolve, reject) => {
    const task = () => {
      activeCount += 1
      let promise: Promise<Result>
      try {
        promise = run()
      } catch (error) {
        promise = Promise.reject(error)
      }
      const finish = () => {
        activeCount -= 1
        drainQueue()
      }
      promise.then(
        (value) => {
          resolve(value)
          finish()
        },
        (error: unknown) => {
          reject(error)
          finish()
        },
      )
    }

    if (activeCount < concurrency) {
      task()
    } else {
      queuedTasks.push(task)
    }
  })

  const remember = (key: string, promise: Promise<Result>) => {
    cachedScores.set(key, promise)

    while (cachedScores.size > cacheLimit) {
      const oldestKey = cachedScores.keys().next().value as string | undefined
      if (oldestKey === undefined || oldestKey === key) {
        break
      }
      cachedScores.delete(oldestKey)
    }
  }

  return {
    score: (input, scorer) => {
      const key = keyFor(input)
      const cached = cachedScores.get(key)
      if (cached) {
        return cached
      }

      const promise = enqueue(() => scorer(input)).catch((error: unknown) => {
        if (cachedScores.get(key) === promise) {
          cachedScores.delete(key)
        }
        throw error
      })
      remember(key, promise)
      return promise
    },
    clear: () => {
      cachedScores.clear()
    },
    stats: () => ({
      activeCount,
      queuedCount: queuedTasks.length,
      cacheSize: cachedScores.size,
      concurrency,
    }),
  }
}
