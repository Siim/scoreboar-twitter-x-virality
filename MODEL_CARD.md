---
license: mit
pipeline_tag: text-classification
tags:
  - onnx
  - browser
  - chrome-extension
  - local-first
  - social-media
  - twitter
  - x.com
  - tweet-scoring
  - twitter-scoring
  - virality-score
  - social-media-scoring
  - content-scoring
  - post-scoring
---

# Scoreboar ONNX — local Twitter/X.com post scoring model

Scoreboar is a local-first Twitter/X.com tweet and post scoring model packaged as ONNX for browser or Node.js inference. It estimates how likely a short social post is to perform, and also exposes feature heads that help explain the score.

## Intended use

- Local/offline scoring inside a browser extension.
- Ranking visible Twitter/X.com draft/timeline text into broad performance buckets.
- Giving lightweight writing feedback: hook, clarity, novelty, shareability, context risk, slop/clickbait/rage-bait signals.

Best UX: present a range such as `medium–high`, not a single exact truth claim.

## Source code

Reference extension and backend example source code:

<https://github.com/Siim/scoreboar-twitter-x-virality>

The GitHub repo contains:

- minimal Chrome MV3 extension
- build-time Hugging Face model download flow
- optional Node.js/Express inference service example
- install instructions for loading the extension in Chrome

## Not intended for

- Automated moderation or enforcement.
- Final truth/quality judgment.
- Sensitive decisions about people.
- Uploading user text to a remote inference API.
- Extra scraping or profile probing on X/Twitter.

## Buckets

The outcome head predicts five ordinal buckets:

1. `very_low`
2. `low`
3. `medium`
4. `high`
5. `very_high`

The extension should usually display a padded percent plus bucket/range, for example ` 58% · medium–high`.

## Architecture

Underlying base encoder: `answerdotai/ModernBERT-base`.

Scoreboar fine-tunes a shared ModernBERT text encoder, fuses the pooled text representation with a small handcrafted metadata vector, then branches into multiple prediction heads:

- **5-way outcome head** predicts the ordinal performance bucket: `very_low`, `low`, `medium`, `high`, `very_high`.
- **12 numeric Grok/teacher feature heads** estimate `virality_score`, `hook_quality`, `clarity_score`, `novelty_score`, `emotional_intensity`, `controversy_level`, `shareability_score`, `conversation_potential`, `authenticity_score`, `urgency_level`, `call_to_action_strength`, and `trend_alignment`.
- **5 boolean Grok/teacher quality heads** estimate `is_rage_bait`, `is_clickbait`, `is_ai_slop`, `needs_context`, and `has_clear_takeaway`.
- **3 categorical teacher heads** were part of training supervision: `primary_emotion`, `target_audience`, and `content_type`.
- **12 model metadata inputs** are derived from 10 raw metadata fields: media flag, time, author/account context, and entity counts.

The enriched training shape has three separate parts:

### Runtime inputs

The model receives tokenized post text plus this **12-value metadata vector**:

1. `has_media`
2. `created_at_hour_sin`
3. `created_at_hour_cos`
4. `created_at_day_sin`
5. `created_at_day_cos`
6. `log_author_followers`
7. `log_author_following`
8. `log_author_tweets`
9. `author_verified`
10. `hashtag_count`
11. `mention_count`
12. `url_count`

These come from 10 raw metadata fields before transforms: `has_media`, `created_at_hour`, `created_at_day`, `author_followers`, `author_following`, `author_tweets`, `author_verified`, `hashtag_count`, `mention_count`, and `url_count`.

### Teacher/enrichment targets

The model was supervised with **20 auxiliary teacher targets**:

Numeric targets, normalized from 0-10 to 0-1 during training:

1. `virality_score`
2. `hook_quality`
3. `clarity_score`
4. `novelty_score`
5. `emotional_intensity`
6. `controversy_level`
7. `shareability_score`
8. `conversation_potential`
9. `authenticity_score`
10. `urgency_level`
11. `call_to_action_strength`
12. `trend_alignment`

Boolean targets:

1. `is_rage_bait`
2. `is_clickbait`
3. `is_ai_slop`
4. `needs_context`
5. `has_clear_takeaway`

Categorical targets:

1. `primary_emotion`
2. `target_audience`
3. `content_type`

### Runtime outputs

The browser/Node ONNX artifact exposes the 5-way bucket head plus the 12 numeric and 5 boolean auxiliary heads. The categorical targets were useful during training, but the minimal extension UI does not need to render them.

The stable browser/runtime artifact filename is `v5-full.onnx`, but this file represents the final/latest validated v7-lineage model export.

```text
tweet / post text
   │
   ▼
byte-level BPE tokenizer
   │ input_ids + attention_mask
   ▼
ModernBERT-base shared encoder
   │ pooled text representation
   │
   ├────────────── metadata vector
   │               has_media
   │               created_at_hour sin/cos
   │               created_at_day sin/cos
   │               author stats when already available
   │               author_verified
   │               hashtag / mention / URL counts
   │
   ▼
fused text + metadata representation
   │
   ├─ feature heads
   │    hook_quality
   │    clarity_score
   │    novelty_score
   │    shareability_score
   │    conversation_potential
   │    authenticity_score
   │    rage_bait / clickbait / ai_slop / needs_context
   │
   └─ outcome head
        very_low / low / medium / high / very_high
```

## Training summary

- Trained for the Scoreboar scorer used in the X11.social virality/interestingness workflow.
- Data mix: viral/high-engagement examples plus random tweets/posts, refreshed with recent posts from roughly the last 18 months.
- Teacher labels were used for internal feature heads; the outcome head predicts the performance bucket.
- Current browser artifact is the final/latest validated lineage while retaining the historical runtime filename `v5-full.onnx` for compatibility. The filename is stable packaging ABI, not the training-version source of truth.

Training code is intentionally not included in this first inference/model release. It can be published later after cleanup.

## Training data at a glance

Approximate training corpus:

- **~60K Twitter/X.com posts total**
- **~50K viral or high-engagement posts** used to teach strong-performing patterns
- **~10K random/baseline posts** used to keep the model calibrated against normal timeline content
- Recent-post refresh focused on roughly the **last 18 months** of Twitter/X.com content
- Grok/teacher enrichment targets from the training script: **12 numeric scores**, **5 boolean flags**, and **3 categorical labels**
- Runtime/browser ONNX exposes the 5-way outcome head plus the 12 numeric and 5 boolean feature heads; categorical teacher heads were training supervision and are not required by the minimal extension UI

The dataset is intentionally mixed: high-performing examples provide the positive signal, while random/baseline posts help the model avoid treating every polished post as automatically high-performing.

## Validation snapshot

Latest validated v7 checkpoint:

- exact 5-bucket accuracy: `58.73%`
- within ±1 bucket: `98.34%`
- class MAE: `0.4295`
- macro F1: `0.5067`
- numeric MAE: `0.9245`

ONNX parity validation passed against the PyTorch checkpoint with max absolute delta about `2.5e-5` under tolerance `0.001`.

## Inference files

Expected extension asset paths:

```text
extension/assets/model/v5-full.onnx
extension/assets/tokenizer/tokenizer.json
extension/assets/runtime/ort.wasm.min.js
extension/assets/runtime/*.wasm
```

The extension packages these files locally. It should not fetch model, tokenizer, runtime, or script assets at runtime.

For backend/service usage, load the same `v5-full.onnx` and `tokenizer.json` from local disk with ONNX Runtime for Node.js. The reference source package includes `examples/express-service/` showing a minimal `POST /score` API.

## Privacy

The reference extension runs inference in Chrome using a local offscreen document. It has no backend, no telemetry, no cloud sync, and no remote model calls. Text stays inside the extension runtime.
