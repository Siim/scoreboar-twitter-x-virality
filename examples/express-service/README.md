# Scoreboar v8 API example

A small Express service that runs the Scoreboar v8 model with `onnxruntime-node`, for scoring posts from your own code instead of inside Chrome. It is optional: the extension does not need it and never calls it.

It imports the extension's own `src/contracts.ts`, `src/local-tokenizer.ts` and `src/inference-runtime.ts`, so a post and its metadata reach the model exactly as they do in the extension: the same text normalization, the same 22-value metadata vector (feature contract v2), and the same 128-token cap.

## Run

Node 20 or newer. From the repo root, download the pinned model files once:

```bash
npm run download:model
```

This puts `scoreboar-v8.onnx`, `scoreboar-v8.json` and `tokenizer.json` in `artifacts/model/`. Then:

```bash
cd examples/express-service
npm install
npm run build
npm start
```

The service listens on `http://127.0.0.1:8787`. At startup it checks `scoreboar-v8.json` against the code (model version, feature contract, metadata order, token limit) and refuses to start on a mismatch, because a model fed the wrong inputs still returns numbers, only wrong ones.

| Variable | Default |
|---|---|
| `PORT` | `8787` |
| `HOST` | `127.0.0.1`. There is no auth, so only widen this behind something that has it. |
| `SCOREBOAR_MODEL_PATH` | `../../artifacts/model/scoreboar-v8.onnx` |
| `SCOREBOAR_MODEL_INFO_PATH` | `../../artifacts/model/scoreboar-v8.json` |
| `SCOREBOAR_TOKENIZER_PATH` | `../../artifacts/model/tokenizer.json` |
| `SCOREBOAR_ONNX_THREADS` | onnxruntime's default (all cores) |

## Score one post

```bash
curl -s http://127.0.0.1:8787/score \
  -H 'content-type: application/json' \
  -d '{
    "text": "Our Q3 report is out &amp; it'\''s a big one 📈\n\nFull breakdown with @analyst_jane: https://example.com/q3-report #fintech https://t.co/AbC123xyz",
    "metadata": {
      "createdAt": "Tue Sep 22 07:05:12 +0000 2026",
      "hasMedia": true,
      "hasPhoto": true,
      "hasVideo": false,
      "isQuote": false,
      "hasCard": false,
      "authorFollowers": 254000,
      "authorFollowing": 120,
      "authorTweets": 8800,
      "authorVerified": true,
      "authorVerifiedType": "Business",
      "authorCreatedAt": "2011-06-10T12:00:00Z",
      "authorFavourites": 1500
    }
  }'
```

Only `text` is required. Send the text as it appears in the post or draft, links and all; the service normalizes it (`normalizePostText`) the way the model was trained.

### Metadata

Every field is optional, and leaving one out is not the same as sending zero: the model has a separate "unknown" for each. Send what you know. Keys are camelCase; any other key is rejected with a 400, so a typo such as `author_followers` cannot quietly score the post as if the author were unknown. `source` and `url`, which the extension's messages carry, are accepted and ignored.

| Field | Type | Notes |
|---|---|---|
| `createdAt` | ISO date, epoch ms, or X's `created_at` | When the post went out, read in UTC. For a draft, the time you plan to post; the extension uses the current time. Left out, the hour and weekday are unknown. |
| `hasMedia` | boolean | A photo or video is attached. |
| `hasPhoto`, `hasVideo` | boolean | The media type. Sending either marks the type as known; with only `hasMedia`, the model assumes 0.7 photo and 0.3 video. |
| `isQuote` | boolean | The post quotes another post. Left out, it counts as unknown (0.25). |
| `hasCard` | boolean | The post shows a link card. A URL in the text already counts as a link. |
| `mediaUrls` | string[] | The t.co links X's API appends to the text for attached media; they are cut from the text. Without them, a post with `hasMedia` loses only a trailing t.co link. |
| `authorFollowers` | number | Left out, the author is unknown, and `authorFollowing`, `authorTweets` and `authorVerified` are ignored. |
| `authorFollowing` | number | |
| `authorTweets` | number | The author's post count (`statuses_count`). |
| `authorVerified` | boolean | |
| `authorVerifiedType` | string | `business` or `government` counts as organization verification. |
| `authorCreatedAt` | time, as `createdAt` | Account creation. Left out, account age and `authorFavourites` are ignored. |
| `authorFavourites` | number | Likes the author has given (`favourites_count`). |

### Response

```json
{
  "status": "scored",
  "model": { "version": "v8", "featureContract": 2 },
  "performance": {
    "percentile": 0.6531,
    "topFifth": 0.2348,
    "bottomFifth": 0.1527,
    "engagementMultiple": 1.4011,
    "reachMultiple": 1.2451
  },
  "probabilities": {
    "very_low": 0.1527,
    "low": 0.1845,
    "medium": 0.1931,
    "high": 0.2349,
    "very_high": 0.2348
  },
  "numericScores": {
    "virality_score": 0.2402,
    "hook_quality": 0.3497,
    "clarity_score": 0.5510,
    "...": "13 in all",
    "expected_performance": 0.3479
  },
  "booleanScores": {
    "is_rage_bait": 0.0013,
    "is_clickbait": 0.5605,
    "is_ai_slop": 0.0753,
    "needs_context": 0.8671,
    "has_clear_takeaway": 0.3433
  },
  "input": {
    "normalizedText": "Our Q3 report is out & it's a big one 📈\n\nFull breakdown with @analyst_jane: [link] #fintech",
    "tokens": 36,
    "features": { "has_media": 1, "has_photo": 1, "has_video": 0, "is_quote": 0, "has_link": 1, "...": "22 in all" }
  }
}
```

Numbers are shortened here; the service returns them unrounded.

| Field | Meaning |
|---|---|
| `performance.percentile` | The headline, 0 to 1: the share of ordinary posts, from accounts this size, this post is expected to beat. 0.65 is the extension's "Beats 65% of posts". Calibrated, from the model's `performance` output. |
| `performance.topFifth`, `performance.bottomFifth` | Calibrated chance of landing in the top or bottom fifth of ordinary posts. The same numbers as `probabilities.very_high` and `probabilities.very_low`. |
| `performance.engagementMultiple` | Predicted engagement as a multiple of what the account's reach alone predicts: `exp(outcomes[1])`. |
| `performance.reachMultiple` | Predicted views, as the same kind of multiple: `exp(outcomes[2])`. Named as in the extension's `PerformancePrediction`. |
| `probabilities` | Calibrated chance of each fifth, `very_low` to `very_high`: a softmax of `virality_logits`. The graph already divides the logits by the fitted temperature, so they are used as they come. |
| `numericScores` | 13 explanation scores (`hook_quality`, `clarity_score`, `novelty_score` and so on), learned from grok-4.7 labels. 0 to 1: the graph ends in a sigmoid, and the teacher's 0 to 10 labels were divided by 10 for training. They describe the text; the forecast is `performance`. |
| `booleanScores` | Chance of each of 5 flags (`is_rage_bait`, `is_clickbait`, `is_ai_slop`, `needs_context`, `has_clear_takeaway`): a sigmoid of the calibrated `boolean_logits`. |
| `input` | What the model read: the normalized text, its token count (at most 128; longer posts keep their opening), and the 22 metadata values by name. Check here that a request meant what you think. |

## Score many posts

`POST /score/batch` takes up to 64 posts and runs them as one inference, padded only to the longest post, with the padding masked out. The results match scoring each post alone.

```bash
curl -s http://127.0.0.1:8787/score/batch \
  -H 'content-type: application/json' \
  -d '{"posts": [
    {"text": "Shipped the new onboarding today. 7 steps down to 3.", "metadata": {"authorFollowers": 12400}},
    {"text": "hot take: most productivity systems are procrastination with extra steps"}
  ]}'
```

The response is `{ "results": [...] }`, one object per post in request order, each shaped like the single-post response.

## Other routes and errors

- `GET /health` returns `{ "ok": true, "model": { "version": "v8", "featureContract": 2, "maxTokens": 128 } }`.
- A bad request (missing text, unknown or mistyped metadata field, unreadable date, bad JSON, too many posts) returns 400 with `{ "error": "..." }` naming the field.
- Runs on one model session take turns, because overlapping `run()` calls in `onnxruntime-node` have crashed the process. Batch posts rather than sending many requests at once.
