import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"

// Downloads the model files pinned in model-assets.json from Hugging Face and
// refuses any file whose SHA-256 does not match the pin. The pins travel with
// the source, so a build always gets exactly the model its feature contract
// (src/contracts.ts) was trained for.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pins = JSON.parse(await readFile(join(root, "model-assets.json"), "utf8"))
const hfRepo = process.env.SCOREBOAR_HF_REPO ?? pins.repo
const hfRevision = process.env.SCOREBOAR_HF_REVISION ?? pins.revision
const hfEndpoint = (process.env.SCOREBOAR_HF_ENDPOINT ?? "https://huggingface.co").replace(/\/$/u, "")
const hfToken = process.env.HF_TOKEN ?? process.env.HUGGING_FACE_HUB_TOKEN ?? ""
const verify = !process.env.SCOREBOAR_HF_REVISION && !process.env.SCOREBOAR_HF_REPO

const fileExists = async (path) => {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

const sha256 = async (path) => {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path)) hash.update(chunk)
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
  await rename(temporary, target)
}

for (const [filename, pin] of Object.entries(pins.files)) {
  const target = join(root, pin.path)
  if (await fileExists(target) && (!verify || await sha256(target) === pin.sha256)) {
    console.info(`Keeping ${filename} (${verify ? "matches pin" : "unpinned run"})`)
    continue
  }
  console.info(`Downloading ${filename} from ${hfRepo}@${hfRevision}`)
  await downloadFile(hfResolveUrl(filename), target)
  if (verify) {
    const actual = await sha256(target)
    if (actual !== pin.sha256) {
      await rm(target, { force: true })
      throw new Error(`${filename} SHA-256 ${actual} does not match the pin ${pin.sha256}`)
    }
  }
}

console.info(`Scoreboar ${pins.version} assets are ready in artifacts/model/.`)
