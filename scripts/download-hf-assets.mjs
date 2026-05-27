import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const defaultHfRepo = "siimh/scoreboar-twitter-x-virality"
const hfRepo = process.env.SCOREBOAR_HF_REPO ?? defaultHfRepo
const hfRevision = process.env.SCOREBOAR_HF_REVISION ?? "main"
const hfEndpoint = (process.env.SCOREBOAR_HF_ENDPOINT ?? "https://huggingface.co").replace(/\/$/u, "")
const hfToken = process.env.HF_TOKEN ?? process.env.HUGGING_FACE_HUB_TOKEN ?? ""

const modelTarget = join(root, "artifacts", "model", "v5-full.onnx")
const tokenizerTarget = join(root, "model", "v5-source", "tokenizer", "tokenizer.json")

const fileExists = async (path) => {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

const sha256 = async (path) => {
  const hash = createHash("sha256")
  const file = await import("node:fs").then(({ createReadStream }) => createReadStream(path))
  for await (const chunk of file) hash.update(chunk)
  return hash.digest("hex")
}

const hfResolveUrl = (filename) => `${hfEndpoint}/${hfRepo}/resolve/${encodeURIComponent(hfRevision)}/${filename}?download=true`

const downloadFile = async (url, target) => {
  const response = await fetch(url, {
    headers: hfToken ? { Authorization: `Bearer ${hfToken}` } : undefined,
    redirect: "follow",
  })
  if (!response.ok || !response.body) {
    throw new Error(`Download failed ${response.status} ${response.statusText}: ${url}`)
  }

  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.download`
  await pipeline(response.body, createWriteStream(temporary))
  await copyFile(temporary, target)
  await rm(temporary, { force: true })
}

if (!hfRepo && process.argv.includes("--require-hf-config")) {
  throw new Error("Set SCOREBOAR_HF_REPO=owner/model-repo before downloading Hugging Face assets.")
}

for (const [filename, target] of [["v5-full.onnx", modelTarget], ["tokenizer.json", tokenizerTarget]]) {
  if (await fileExists(target)) {
    console.info(`Keeping existing ${filename}: ${target}`)
    continue
  }
  console.info(`Downloading ${filename} from ${hfRepo}@${hfRevision}`)
  await downloadFile(hfResolveUrl(filename), target)
}

await writeFile(
  join(root, "artifacts", "MODEL_ASSETS.json"),
  `${JSON.stringify({
    repo: hfRepo,
    revision: hfRevision,
    files: {
      "v5-full.onnx": { path: "artifacts/model/v5-full.onnx", sha256: await sha256(modelTarget) },
      "tokenizer.json": { path: "model/v5-source/tokenizer/tokenizer.json", sha256: await sha256(tokenizerTarget) },
    },
  }, null, 2)}\n`,
  "utf8",
)

console.info("Scoreboar Hugging Face assets are ready for the original extension build.")
