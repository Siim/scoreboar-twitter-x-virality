# Scoreboar ONNX Express API example

This example wraps the same local `v5-full.onnx` model and tokenizer used by the Chrome extension in a tiny Express service.

It is optional. The extension does not need a backend.

## Run

From the repo root, download the model assets once:

```bash
npm run download:model
```

Then run the API example:

```bash
cd examples/express-service
npm install
npm run build
npm start
```

By default it loads:

```text
../../artifacts/model/v5-full.onnx
../../model/v5-source/tokenizer/tokenizer.json
```

Override paths if needed:

```bash
SCOREBOAR_MODEL_PATH=/absolute/path/to/v5-full.onnx \
SCOREBOAR_TOKENIZER_PATH=/absolute/path/to/tokenizer.json \
npm start
```

## Request

```bash
curl -s http://localhost:8787/score \
  -H 'content-type: application/json' \
  -d '{"text":"I built a tiny local model that tells you when your tweet is probably dead.","metadata":{"source":"unknown","hasMedia":false}}'
```

The response includes the 5-bucket probabilities, 12 numeric feature heads, 5 boolean feature heads, and the metadata vector used for inference.
