import { describe, expect, it } from "vitest"
import type { ScoreTextResult } from "../src/inference-runtime"
import { emojiForScoreLabelSummary, formatScoreLabelSummary, mapProbabilitiesToInterestingness, mapScoreTextResultToLabel, pickScoreInsight } from "../src/score-mapping"

const scoredResult = (probabilities: ScoreTextResult["probabilities"]): ScoreTextResult => ({
  status: "scored",
  label: "scored",
  confidence: 0.9,
  probabilities,
  numericScores: {},
  message: "scored fixture",
  model: {
    provider: "local-onnx",
    path: "extension/assets/model/v5-full.onnx",
    available: true,
  },
  metadataVector: [],
})

describe("score-mapping", () => {
  it.each([
    [{ very_low: 1 }, 0, "Very Low", "0 · Very Low"],
    [{ low: 1 }, 25, "Low", "25 · Low"],
    [{ medium: 1 }, 50, "Medium", "50 · Medium"],
    [{ high: 1 }, 75, "High", "75 · High"],
    [{ very_high: 1 }, 100, "Very High", "100 · Very High"],
  ] as const)("maps fixed class probability %#", (probabilities, score, tag, labelText) => {
    expect(mapProbabilitiesToInterestingness(probabilities)).toMatchObject({
      status: "scored",
      interestingScore: score,
      tag,
      insight: null,
      labelText,
      confidence: 1,
    })
  })

  it("does not repeat the same insight emoji in compact score summaries", () => {
    const summary = mapScoreTextResultToLabel({
      status: "scored",
      label: "scored",
      confidence: 0.8,
      probabilities: { low: 0.1, medium: 0.1, high: 0.8 },
      numericScores: { virality_score: 0.72 },
      booleanScores: { needs_context: 0.91 },
      message: "fixture",
      model: { provider: "local-onnx", available: true },
      metadataVector: [1, 2, 3],
    })

    expect(formatScoreLabelSummary(summary)).toBe("🧩  72% · needs context")
  })

  it("normalizes mixed model probabilities into a deterministic weighted score", () => {
    expect(mapProbabilitiesToInterestingness({ very_low: 0.1, low: 0.2, medium: 0.4, high: 0.2, very_high: 0.1 })).toMatchObject({
      interestingScore: 50,
      tag: "Medium",
      confidence: 0.4,
      stability: {
        tier: "uncertain",
        reasons: expect.arrayContaining(["mixed model odds", "limited metadata"]),
      },
    })
  })

  it("reports stability rather than psychological raw confidence", () => {
    expect(mapProbabilitiesToInterestingness(
      { high: 0.82, medium: 0.12, low: 0.06 },
      {
        numericScores: { virality_score: 0.88 },
        metadataVector: [1, 0.5, 0.5, 0.5, 0.5, 0.8, 0.2, 0.3, 1, 0, 0, 0],
      },
    )).toMatchObject({
      confidence: 0.82,
      stability: {
        tier: "solid",
        label: "solid",
        reasons: ["heads agree"],
      },
    })
  })

  it("uses the numeric virality head for the product percent score when present", () => {
    expect(mapProbabilitiesToInterestingness(
      { very_low: 0.49, low: 0.09, medium: 0.17, high: 0.19, very_high: 0.06 },
      {
        numericScores: {
          virality_score: 0.36,
          hook_quality: 0.22,
          shareability_score: 0.36,
          conversation_potential: 0.5,
          novelty_score: 0.4,
          authenticity_score: 0.65,
        },
      },
    )).toMatchObject({
      interestingScore: 36,
      tag: "Low",
    })
  })

  it("accepts common model output aliases in stable class order", () => {
    expect(mapProbabilitiesToInterestingness({ class_4: 0.8, class_0: 0.2 })).toMatchObject({
      interestingScore: 80,
      tag: "Very High",
      confidence: 0.8,
    })
  })

  it("does not fake unavailable runtime results as scored", () => {
    const unavailable: ScoreTextResult = {
      status: "unavailable",
      label: "model_unavailable",
      confidence: null,
      probabilities: {},
      numericScores: {},
      reason: "missing_local_onnx_artifact",
      message: "No model fixture",
      model: {
        provider: "local-onnx",
        path: "extension/assets/model/v5-full.onnx",
        available: false,
      },
      metadataVector: [],
    }

    expect(mapScoreTextResultToLabel(unavailable)).toEqual({
      status: "unavailable",
      interestingScore: null,
      tag: null,
      insight: null,
      labelText: "Score unavailable",
      confidence: null,
      reason: "missing_local_onnx_artifact",
    })
  })

  it("maps scored runtime results through the same probability utility", () => {
    expect(mapScoreTextResultToLabel(scoredResult({ high: 0.7, very_high: 0.3 }))).toMatchObject({
      status: "scored",
      interestingScore: 83,
      tag: "Very High",
    })
  })

  it("picks compact v5 insight labels from boolean and numeric outputs", () => {
    expect(pickScoreInsight({ is_clickbait: 0.84 }, { hook_quality: 0.9 })).toMatchObject({
      id: "clickbait",
      label: "clickbait",
    })
    expect(pickScoreInsight({ is_ai_slop: true }, { hook_quality: 0.9 })).toMatchObject({
      id: "slop",
      label: "slop",
    })
    expect(mapScoreTextResultToLabel({
      ...scoredResult({ very_high: 1 }),
      booleanScores: { is_clickbait: 0.93 },
      numericScores: {},
    })).toMatchObject({
      interestingScore: 100,
      insight: { id: "clickbait", label: "clickbait" },
    })
  })

  it("adds funny emoji labels without changing objective score", () => {
    expect(emojiForScoreLabelSummary(mapScoreTextResultToLabel({
      ...scoredResult({ high: 1 }),
      booleanScores: { is_ai_slop: 0.88 },
      numericScores: {},
    }))).toBe("🤖")
    expect(formatScoreLabelSummary(mapProbabilitiesToInterestingness({ very_high: 1 }))).toBe("🚀 100%")
    expect(formatScoreLabelSummary(mapProbabilitiesToInterestingness({ high: 1 }))).toBe("🤯  75%")
    expect(formatScoreLabelSummary(mapProbabilitiesToInterestingness({ medium: 1 }))).toBe("🙂  50%")
    expect(formatScoreLabelSummary(mapProbabilitiesToInterestingness({ low: 1 }))).toBe("😨  25%")
    expect(formatScoreLabelSummary(mapProbabilitiesToInterestingness({ very_low: 1 }))).toBe("🥶   0%")
  })

  it("varies positive score emoji by the strongest feature signal", () => {
    expect(formatScoreLabelSummary(mapProbabilitiesToInterestingness(
      { high: 1 },
      { numericScores: { hook_quality: 0.91 } },
    ))).toBe("🎯  75% · hook")
    expect(formatScoreLabelSummary(mapProbabilitiesToInterestingness(
      { high: 1 },
      { numericScores: { shareability_score: 0.91 } },
    ))).toBe("📣  75% · share")
    expect(formatScoreLabelSummary(mapProbabilitiesToInterestingness(
      { high: 1 },
      { numericScores: { authenticity_score: 0.91 } },
    ))).toBe("🫡  75% · auth")
  })
})
