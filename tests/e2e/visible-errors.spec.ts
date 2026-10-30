import { expect, test } from '@playwright/test'

test('a failed native startup read shows its cause and recovers only on Retry', async ({ page }) => {
  // Native storage faults cannot be forced safely; intercept only the browser API for this fresh test context.
  await page.addInitScript(() => {
    let fail = true
    const original = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (key) {
      if (fail && this.name === 'settings' && key === 'onboardingComplete') throw new DOMException('Startup read interrupted', 'UnknownError')
      return original.call(this, key)
    }
    Object.defineProperty(window, 'releaseStorageFault', { value: () => { fail = false } })
  })
  await page.goto('./')
  await expect(page.getByRole('alert')).toContainText('Startup read interrupted')
  await expect(page.getByRole('button', { name: /Begin with three sample cards/ })).toHaveCount(0)
  await page.evaluate(() => (window as unknown as { releaseStorageFault: () => void }).releaseStorageFault())
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Less repetition/ })).toBeVisible()
})

test('a failed preference write retains the confirmed value until a successful explicit retry', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Start with an empty library' }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('slider')).toHaveValue('90')
  // Inject an abort at the native write boundary; leave real Dexie, handlers and transaction behavior intact.
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (this.name === 'settings' && value.key === 'desiredRetention') throw new DOMException('Preference write interrupted', 'AbortError')
      return original.call(this, value, ...args)
    }
    Object.defineProperty(window, 'releaseStorageFault', { value: () => { IDBObjectStore.prototype.put = original } })
  })
  await page.getByRole('slider').press('ArrowLeft')
  await expect(page.getByRole('alert')).toContainText('Preference write interrupted')
  await expect(page.getByRole('slider')).toHaveValue('90')
  await page.evaluate(() => (window as unknown as { releaseStorageFault: () => void }).releaseStorageFault())
  await page.getByRole('slider').press('ArrowLeft')
  await expect(page.getByRole('slider')).toHaveValue('89')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('slider')).toHaveValue('89')
})

test('failed onboarding rolls back its sample transaction and a repeated choice creates it once', async ({ page }) => {
  // Fail only the final native setup write so the app must roll back the already-created sample rows.
  await page.addInitScript(() => {
    let fail = true
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (fail && this.name === 'settings' && value.key === 'onboardingComplete') throw new DOMException('Setup quota exhausted', 'QuotaExceededError')
      return original.call(this, value, ...args)
    }
    Object.defineProperty(window, 'releaseStorageFault', { value: () => { fail = false } })
  })
  await page.goto('./')
  const begin = page.getByRole('button', { name: /Begin with three sample cards/ })
  await begin.evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  await expect(page.getByRole('alert')).toContainText('not enough storage')
  const counts = await page.evaluate(async () => {
    const request = indexedDB.open('lumen-cards')
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await Promise.all(['decks', 'cards'].map((name) => new Promise<number>((resolve, reject) => {
        const count = database.transaction(name).objectStore(name).count()
        count.onsuccess = () => resolve(count.result)
        count.onerror = () => reject(count.error)
      })))
    } finally { database.close() }
  })
  expect(counts).toEqual([0, 0])
  await page.evaluate(() => (window as unknown as { releaseStorageFault: () => void }).releaseStorageFault())
  await begin.evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  await expect(page.getByText('3 cards ready')).toBeVisible()
})
