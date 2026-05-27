const ENABLED_STORAGE_KEY = "scoreboarEnabled"

const toggle = document.getElementById("toggle")
const stateLabel = document.getElementById("state-label")
const status = document.getElementById("status")

const setUi = (enabled) => {
  toggle.setAttribute("aria-pressed", String(enabled))
  stateLabel.textContent = enabled ? "On for X/Twitter" : "Off"
  status.textContent = enabled
    ? "Feed badges and composer hints are active."
    : "Scoreboar UI is hidden until re-enabled."
}

const readEnabled = async () => {
  const result = await chrome.storage.local.get({ [ENABLED_STORAGE_KEY]: true })
  return result[ENABLED_STORAGE_KEY] !== false
}

const writeEnabled = async (enabled) => {
  await chrome.storage.local.set({ [ENABLED_STORAGE_KEY]: enabled })
}

const init = async () => {
  let enabled = await readEnabled()
  setUi(enabled)
  toggle.addEventListener("click", async () => {
    enabled = toggle.getAttribute("aria-pressed") !== "true"
    setUi(enabled)
    await writeEnabled(enabled)
  })
}

void init()
