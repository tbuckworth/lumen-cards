import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('onboards, reviews a sample deck, and persists progress', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /Less repetition/ })).toBeVisible()
  await page.getByRole('button', { name: /Begin with three sample cards/ }).click()
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible()
  await expect(page.getByText('3 cards ready')).toBeVisible()

  await page.getByRole('button', { name: 'Begin', exact: true }).click()
  await expect(page.getByText('1/3')).toBeVisible()
  await page.getByRole('button', { name: 'Show answer' }).click()
  await page.getByRole('button', { name: /Good/ }).click()
  await page.getByRole('button', { name: 'Show answer' }).click()
  await page.getByRole('button', { name: /Easy/ }).click()
  await page.getByRole('button', { name: 'Show answer' }).click()
  await page.getByRole('button', { name: /Hard/ }).click()
  await expect(page.getByRole('heading', { name: 'Well remembered.' })).toBeVisible()
  await page.getByRole('button', { name: 'Return home' }).click()
  await expect(page.getByText('All caught up')).toBeVisible()

  await page.reload()
  await expect(page.getByText('All caught up')).toBeVisible()
})

test('imports a Claude deck and makes it available for study', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Start with an empty library' }).click()
  await page.getByRole('button', { name: 'Add' }).click()
  await page.getByRole('tab', { name: 'Import' }).click()
  await page.getByPlaceholder(/"format": "lumen-deck"/).fill(JSON.stringify({
    format: 'lumen-deck',
    version: 1,
    deck: {
      title: 'Paper notes',
      cards: [
        { front: 'Core claim?', back: 'The tested claim.', tags: ['paper'] },
        { front: 'Main limitation?', back: 'The sample was narrow.' }
      ]
    }
  }))
  await page.getByRole('button', { name: 'Import pasted cards' }).click()
  await expect(page.getByRole('heading', { name: 'Decks' })).toBeVisible()
  await page.getByRole('button', { name: /Paper notes/ }).click()
  await expect(page.getByRole('heading', { name: 'Paper notes' })).toBeVisible()
  await expect(page.getByText('Core claim?')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Study 2 due' })).toBeVisible()
})

test('has a complete installable PWA manifest', async ({ page }) => {
  await page.goto('./')
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(manifestHref).toBeTruthy()
  const manifest = await page.evaluate(async (href) => (await fetch(href!)).json(), manifestHref)
  expect(manifest.display).toBe('standalone')
  expect(manifest.icons).toHaveLength(3)
  expect(manifest.start_url).toBe('/lumen-cards/')
})

test('reloads from its cache while offline', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'Playwright WebKit does not support reliable offline network emulation for service-worker navigations.')
  await page.goto('./')
  await page.getByRole('button', { name: 'Start with an empty library' }).click()
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible()
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible()
})

test('has no automatically detectable accessibility violations', async ({ page }) => {
  await page.goto('./')
  let scan = await new AxeBuilder({ page }).analyze()
  expect(scan.violations).toEqual([])

  await page.getByRole('button', { name: /Begin with three sample cards/ }).click()
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible()
  scan = await new AxeBuilder({ page }).analyze()
  expect(scan.violations).toEqual([])

  await page.getByRole('button', { name: 'Add' }).click()
  scan = await new AxeBuilder({ page }).analyze()
  expect(scan.violations).toEqual([])

  await page.getByRole('button', { name: 'Settings' }).click()
  scan = await new AxeBuilder({ page }).analyze()
  expect(scan.violations).toEqual([])

  await page.getByRole('button', { name: 'Decks' }).click()
  scan = await new AxeBuilder({ page }).analyze()
  expect(scan.violations).toEqual([])

  await page.getByRole('button', { name: 'Today' }).click()
  await page.getByRole('button', { name: 'Begin', exact: true }).click()
  await page.getByRole('button', { name: 'Show answer' }).click()
  scan = await new AxeBuilder({ page }).analyze()
  expect(scan.violations).toEqual([])
})

test('a rapid double rating writes one review and undo permits rating again', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: /Begin with three sample cards/ }).click()
  await page.getByRole('button', { name: 'Begin', exact: true }).click()
  await page.getByRole('button', { name: 'Show answer' }).click()
  await page.locator('.rating--good').evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
  await page.getByRole('button', { name: 'Undo last answer' }).click()
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  await page.getByRole('button', { name: /Easy/ }).click()
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
  await expect(page.getByRole('alert')).toHaveCount(0)
})
