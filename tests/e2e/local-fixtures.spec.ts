import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const extensionPath = resolve("dist")
const evidencePath = resolve(".sisyphus", "evidence")

const fixtureHtml = (name: string): string => readFileSync(resolve("fixtures", name), "utf8")

const launchExtensionFixture = async (): Promise<{ readonly context: BrowserContext; readonly userDataDir: string }> => {
  execFileSync(process.execPath, ["scripts/build-extension.mjs"], { stdio: "pipe" })

  const userDataDir = mkdtempSync(join(tmpdir(), "scoreboar-e2e-"))
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  })

  await context.route("**/*", async (route) => {
    const url = route.request().url()
    if (url === "https://x.com/home") {
      await route.fulfill({ status: 200, contentType: "text/html", body: fixtureHtml("timeline.html") })
      return
    }
    if (url === "https://x.com/compose/post") {
      await route.fulfill({ status: 200, contentType: "text/html", body: fixtureHtml("composer.html") })
      return
    }

    await route.abort("blockedbyclient")
  })

  return { context, userDataDir }
}

const closeFixture = async (context: BrowserContext, userDataDir: string): Promise<void> => {
  await context.close()
  rmSync(userDataDir, { recursive: true, force: true })
}

const openFixturePage = async (context: BrowserContext, url: string): Promise<Page> => {
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto(url)
  return page
}

test("unpacked extension adds exactly one scored badge per fixture tweet", async () => {
  const { context, userDataDir } = await launchExtensionFixture()
  try {
    const page = await openFixturePage(context, "https://x.com/home")

    await expect(page.locator('article[data-testid="tweet"]')).toHaveCount(3)
    await expect(page.locator('[data-scoreboar-feed-badge="true"]')).toHaveCount(3)
    await expect(page.locator('[data-scoreboar-feed-badge-state="scored"]')).toHaveCount(3, { timeout: 15000 })

    await page.locator('article[data-testid="tweet"]').first().evaluate((tweet) => {
      const text = tweet.querySelector('[data-testid="tweetText"]')
      if (text) {
        text.textContent = "Updated fixture tweet proves mutation rescans do not duplicate badges."
      }
    })

    await expect(page.locator('[data-scoreboar-feed-badge="true"]')).toHaveCount(3)
    await expect(page.locator('article[data-testid="tweet"]').first().locator('[data-scoreboar-feed-badge="true"]')).toHaveCount(1)
    await expect(page.locator('article[data-testid="tweet"]').first().locator('[data-scoreboar-feed-badge-state="scored"]')).toHaveCount(1, { timeout: 15000 })
    await page.screenshot({ path: join(evidencePath, "task-14-feed-badges.png"), fullPage: true })
  } finally {
    await closeFixture(context, userDataDir)
  }
})

test("unpacked extension adds debounced composer hints and hides empty state", async () => {
  const { context, userDataDir } = await launchExtensionFixture()
  try {
    const page = await openFixturePage(context, "https://x.com/compose/post")
    const composer = page.locator('[data-testid="tweetTextarea_0"]')

    await expect(composer).toHaveAttribute("contenteditable", "true")
    await expect(page.locator('[data-scoreboar-composer-panel="true"]')).toBeHidden()

    await composer.fill("Thread: A specific local launch story with screenshots, a clear outcome, and a useful takeaway.")
    await expect(page.locator('[data-scoreboar-composer-panel="true"]')).toBeVisible()
    await expect(page.locator('[data-scoreboar-composer-panel-state="ready"]')).toHaveCount(1, { timeout: 15000 })
    await expect(page.locator('[data-scoreboar-composer-hint-id]')).not.toHaveCount(0)

    await composer.fill("")
    await expect(page.locator('[data-scoreboar-composer-panel="true"]')).toBeHidden()
    await page.screenshot({ path: join(evidencePath, "task-14-composer-hints.png"), fullPage: true })
  } finally {
    await closeFixture(context, userDataDir)
  }
})
