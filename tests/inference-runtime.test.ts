import { afterEach, describe, expect, it } from "vitest"
import { V5_METADATA_FEATURE_ORDER } from "../src/contracts"
import {
  SCOREBOAR_LOCAL_ONNX_PATH,
  SCOREBOAR_SCORE_TEXT_MESSAGE,
  SCOREBOAR_SCORE_TEXT_RESPONSE_MESSAGE,
  createScoreTextRequest,
  handleScoreTextMessage,
  isScoreTextRequestMessage,
  scoreText,
} from "../src/inference-runtime"

const originalDisableModel = process.env.SCOREBOAR_DISABLE_MODEL

afterEach(() => {
  if (originalDisableModel === undefined) {
    delete process.env.SCOREBOAR_DISABLE_MODEL
  } else {
    process.env.SCOREBOAR_DISABLE_MODEL = originalDisableModel
  }
  delete (globalThis as { chrome?: unknown }).chrome
})

describe("inference-runtime scoreText", () => {
  it("returns a structured unavailable result when no local ONNX artifact is available", async () => {
    delete process.env.SCOREBOAR_DISABLE_MODEL

    const result = await scoreText({
      text: "Ship local inference only #build @scoreboar https://example.test/post",
      metadata: {
        source: "fixture",
        hasMedia: true,
        createdAtHour: 11,
        createdAtDay: 2,
        authorFollowers: 1200,
      },
    })

    expect(result).toMatchObject({
      status: "unavailable",
      label: "model_unavailable",
      confidence: null,
      probabilities: {},
      numericScores: {},
      reason: "missing_local_onnx_artifact",
      model: {
        provider: "local-onnx",
        path: SCOREBOAR_LOCAL_ONNX_PATH,
        available: false,
      },
    })
    expect(result.message).toContain("no text leaves the extension")
    expect(result.metadataVector).toHaveLength(V5_METADATA_FEATURE_ORDER.length)
  })

  it("honors SCOREBOAR_DISABLE_MODEL without touching Chrome APIs or a runner", async () => {
    process.env.SCOREBOAR_DISABLE_MODEL = "1"
    ;(globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage: () => { throw new Error("should not send") } } }
    let runnerCalled = false

    const result = await scoreText(
      { text: "Disabled local model" },
      {
        modelAvailable: true,
        runner: {
          score: async () => {
            runnerCalled = true
            throw new Error("should not run")
          },
        },
      },
    )

    expect(runnerCalled).toBe(false)
    expect(result.status).toBe("unavailable")
    expect(result.reason).toBe("disabled_by_environment")
    expect(result.probabilities).toEqual({})
    expect(result.numericScores).toEqual({})
  })
})

describe("inference-runtime message contract", () => {
  it("creates and recognizes scoreText requests", () => {
    const request = createScoreTextRequest(
      {
        text: "Contract test",
        metadata: { source: "composer", hasMedia: false },
      },
      "req-1",
    )

    expect(request).toEqual({
      type: SCOREBOAR_SCORE_TEXT_MESSAGE,
      requestId: "req-1",
      payload: {
        text: "Contract test",
        metadata: { source: "composer", hasMedia: false },
      },
    })
    expect(isScoreTextRequestMessage(request)).toBe(true)
    expect(isScoreTextRequestMessage({ type: SCOREBOAR_SCORE_TEXT_MESSAGE, payload: { text: 123 } })).toBe(false)
  })

  it("handles scoreText request messages as unavailable responses by default", async () => {
    delete process.env.SCOREBOAR_DISABLE_MODEL

    const response = await handleScoreTextMessage(createScoreTextRequest({ text: "Score me locally" }, "req-2"))

    expect(response).toMatchObject({
      type: SCOREBOAR_SCORE_TEXT_RESPONSE_MESSAGE,
      requestId: "req-2",
      payload: {
        status: "unavailable",
        label: "model_unavailable",
        confidence: null,
        probabilities: {},
        numericScores: {},
        reason: "missing_local_onnx_artifact",
      },
    })
  })

  it("ignores unrelated runtime messages", async () => {
    await expect(handleScoreTextMessage({ type: "other", payload: { text: "x" } })).resolves.toBeNull()
  })
})
