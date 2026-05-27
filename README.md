# Scoreboar Twitter/X Virality

Scoreboar is the original local-first Chrome MV3 extension that adds compact scoring labels to X/Twitter timeline posts and lightweight hints while drafting a post. This public package uses the same extension scripts, DOM detection, popup, icons, styles, and build pipeline as the working private extension; the only publishing-specific addition is a Hugging Face download script for the large ONNX model assets.

## What it does

- Adds one compact badge per detected `article[data-testid="tweet"]` on `https://x.com/*` and `https://twitter.com/*`.
- Adds debounced composer hints for X post textareas/contenteditable composer boxes.
- Passively reads author metadata only when X has already loaded it into same-page GraphQL responses.
- Runs local ONNX inference in a Chrome offscreen document.
- Keeps model, tokenizer, ONNX Runtime Web, and WASM assets packaged locally under `dist/`.

It has no backend, no telemetry, no auth handling, no cloud sync, no extra X API/profile probing, and no runtime CDN/model fetches.

## Install in Chrome

```bash
npm install
npm run build:hf
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repo’s `dist/` folder.
5. Open `https://x.com` or `https://twitter.com`.

## Hugging Face model download

Large model files are not committed to git. `npm run build:hf` downloads the reference model assets from Hugging Face before running the original extension build.

Default model repo:

```text
siimh/scoreboar-twitter-x-virality
```

Useful commands:

```bash
npm run download:model
npm run build:hf
```

Optional pinning:

```bash
SCOREBOAR_HF_REPO=siimh/scoreboar-twitter-x-virality \
SCOREBOAR_HF_REVISION=<commit-sha-or-tag> \
npm run build:hf
```

For private or gated repos, set `HF_TOKEN` or `HUGGING_FACE_HUB_TOKEN`. Never commit tokens.

The download script writes the files into the exact paths expected by the original build:

```text
artifacts/model/v5-full.onnx
model/v5-source/tokenizer/tokenizer.json
```

The original build then packages them as:

```text
dist/extension/assets/model/v5-full.onnx
dist/extension/assets/tokenizer/tokenizer.json
```

The stable runtime filename is `v5-full.onnx`; this file contains the final/latest validated v7-lineage export.

## Development

```bash
npm run typecheck
npm test
npm run build:hf
npm run assert:dist
npm run assert:manifest
npm run assert:no-remote-assets
```

## Model and data summary

- Runtime artifact: `v5-full.onnx` stable filename containing the final/latest validated v7-lineage model export.
- Base encoder: `answerdotai/ModernBERT-base`.
- Architecture: shared ModernBERT text encoder + 12-field metadata fusion + feature heads + 5-way ordinal outcome head.
- Approximate training corpus: **~60K Twitter/X.com posts total**.
  - **~50K viral/high-engagement posts**.
  - **~10K random/baseline posts**.
  - Refreshed with recent posts from roughly the **last 18 months**.
- Grok/teacher enrichment targets: **12 numeric scores**, **5 boolean flags**, and **3 categorical labels**.
- Runtime/browser ONNX exposes the 5-way outcome head plus **12 numeric** and **5 boolean** feature heads.
- Validation snapshot: `58.73%` exact 5-bucket accuracy and `98.34%` within ±1 bucket.

See `MODEL_CARD.md` for the full model card.

## Project layout

```text
manifest.config.ts             source manifest used by original build
extension/                     original MV3 entrypoints, popup, icons, page listener
src/                           original DOM detection, scoring UI, guardrails, runtime contracts
scripts/build-extension.mjs    original extension build script
scripts/download-hf-assets.mjs Hugging Face model/tokenizer downloader
fixtures/                      local X-like fixture pages for tests
tests/                         original unit/integration tests
MODEL_CARD.md                  Hugging Face model documentation
```

## Guardrails

- Runtime/model assets are packaged locally under `dist/extension/assets/`.
- The extension does not load scripts, WASM, tokenizers, or model files from remote URLs at runtime.
- The extension does not make X API requests.
- Scoreboar may passively parse already-loaded same-page X GraphQL responses for author metadata.
- The score is directional. Use ranges/buckets such as `medium–high`, not exact truth claims.
