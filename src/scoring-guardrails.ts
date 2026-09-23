import { type MetadataPreprocessInput, preprocessMetadata } from "./contracts.js"

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

const scoreboarGuardrailsPositiveInteger = (value: number | undefined, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback
  }

  return Math.max(1, Math.floor(value))
}

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

/**
 * A result is reused only for the exact input the model reads: the normalized
 * text (line breaks included) and the feature vector. Two requests share a
 * score exactly when the model would see the same thing, so an attachment, a
 * quote, a card, the hour or the author's details arriving later always
 * rescores, and a caller-supplied id can never stand in for the text.
 */
export const createTextScoringCacheKey = (
  text: string,
  metadata?: object,
): string => {
  const { normalizedText, vector } = preprocessMetadata({ ...(metadata as MetadataPreprocessInput | undefined), text })
  return `scoreboar:${normalizedText}\u0000${vector.map((value) => value.toFixed(4)).join(",")}`
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
