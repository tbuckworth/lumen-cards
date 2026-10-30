import { expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { test, lifetimeTest } from './fixtures/offline-server'

type Probe = { registrations: number; checks: number; messages: number; delivery: string; holdRegistration: boolean; holdCheck: boolean; release: () => void; releaseCheck: () => void }
type TestWindow = Window & { offlineProbe: Probe; unmountLumen: () => void; mountLumen: () => void }

async function instrument(page: Page, holdRegistration: boolean) {
  // Delegate to the native browser implementations. Only message delivery/delay is
  // faulted: production registration/state helpers and App are never replaced.
  await page.addInitScript((hold) => {
    const probe = { registrations: 0, checks: 0, messages: 0, delivery: '', holdRegistration: hold, holdCheck: false, release: () => {}, releaseCheck: () => {} }
    Object.assign(window, { offlineProbe: probe })
    const register = ServiceWorkerContainer.prototype.register
    ServiceWorkerContainer.prototype.register = function (...args) {
      probe.registrations++
      return register.apply(this, args).then(async (value) => {
        if (probe.holdRegistration) await new Promise<void>((resolve) => { probe.release = resolve })
        return value
      })
    }
    const update = ServiceWorkerRegistration.prototype.update
    ServiceWorkerRegistration.prototype.update = function () {
      probe.checks++
      return update.call(this).then(async (value) => {
        if (probe.holdCheck) await new Promise<void>((resolve) => { probe.releaseCheck = resolve })
        return value
      })
    }
    const post = ServiceWorker.prototype.postMessage
    ServiceWorker.prototype.postMessage = function (message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) {
      if ((message as { type?: string })?.type === 'SKIP_WAITING') {
        probe.messages++
        if (probe.delivery === 'throw') throw new DOMException('Update delivery interrupted', 'InvalidStateError')
        if (probe.delivery === 'hold') return
      }
      return Reflect.apply(post, this, [message, transfer])
    }
  }, holdRegistration)
}

const counts = (page: Page) => page.evaluate(() => {
  const { registrations, checks, messages } = (window as unknown as TestWindow).offlineProbe
  return { registrations, checks, messages }
})
const visible = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
const ready = async (page: Page) => {
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    return navigator.serviceWorker.controller?.state === 'activated' && Boolean(registration?.active) && !registration?.waiting && !registration?.installing
  })).toBe(true)
  await expect(page.getByLabel('Offline status').getByRole('alert')).toHaveCount(0)
  await expect(page.getByLabel('Offline status').filter({ hasText: /setup…|install…|check…|Applying update…/ })).toHaveCount(0)
}
async function syntheticLibrary(page: Page) {
  await page.getByRole('button', { name: 'Start with an empty library' }).click()
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('tab', { name: 'Import' }).click()
  await page.getByPlaceholder(/"format": "lumen-deck"/).fill(JSON.stringify({
    format: 'lumen-deck', version: 1,
    deck: { title: 'Offline fixture deck', cards: [{ front: 'Synthetic question', back: 'Synthetic answer' }] }
  }))
  await page.getByRole('button', { name: 'Import pasted cards' }).click()
  await page.getByRole('button', { name: 'Today', exact: true }).click()
}
async function review(page: Page) {
  await page.getByRole('button', { name: 'Begin', exact: true }).click()
  await expect(page.getByText('Synthetic question')).toBeVisible()
  await page.getByRole('button', { name: 'Show answer' }).click()
  await page.getByRole('button', { name: /Good/ }).click()
  await page.getByRole('button', { name: 'Return home' }).click()
}

test('failed real registration stays visible while cards work, and retries once only when requested', async ({ page, offlineServer }, testInfo) => {
  offlineServer.failWorker = true
  await instrument(page, false)
  await page.goto(offlineServer.url)
  const status = page.getByLabel('Offline status')
  await expect(status.getByRole('alert')).toContainText(/Offline setup failed:.*(503|script|register)/i)
  await expect.poll(async () => (await counts(page)).registrations).toBe(1)
  await syntheticLibrary(page)
  await review(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.waitForTimeout(4000)
  await expect(status.getByRole('alert')).toBeVisible()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('offline-warning.png'), fullPage: true })
  offlineServer.failWorker = false
  await visible(page)
  expect((await counts(page)).registrations).toBe(1)
  await status.getByRole('button', { name: 'Retry offline setup' }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  await ready(page)
  expect((await counts(page)).registrations).toBe(2)
  await page.reload()
  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await expect(page.getByText('All caught up')).toBeVisible()
})

test('registration success does not hide a real precache install failure', async ({ page, offlineServer }) => {
  offlineServer.failPrecache = true
  await instrument(page, false)
  await page.goto(offlineServer.url)
  const status = page.getByLabel('Offline status')
  await expect(status.getByRole('alert')).toContainText(/Offline install failed:.*redundant/i)
  await expect(status).not.toContainText('Ready offline')
  offlineServer.failPrecache = false
  await visible(page)
  const before = await counts(page)
  await status.getByRole('button', { name: 'Retry offline install' }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  await ready(page)
  expect((await counts(page)).checks).toBe(before.checks)
  expect((await counts(page)).registrations).toBe(2)
})

test('failed real update checks retain an existing worker and a usable waiting update', async ({ page, offlineServer }) => {
  await instrument(page, false)
  await page.goto(offlineServer.url)
  await ready(page)
  await syntheticLibrary(page)
  offlineServer.failWorker = true
  await visible(page)
  const status = page.getByLabel('Offline status')
  await expect(status.getByRole('alert')).toContainText(/Update check failed:/)
  const failed = await counts(page)
  offlineServer.failWorker = false
  offlineServer.revision++
  await visible(page)
  expect(await counts(page)).toEqual(failed)
  await status.getByRole('button', { name: 'Retry update check' }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  await expect(status.getByRole('button', { name: 'Update now' })).toBeVisible()
  expect((await counts(page)).checks).toBe(failed.checks + 1)
  offlineServer.failWorker = true
  await visible(page)
  await expect(status.getByRole('alert')).toContainText('Update check failed:')
  await expect(status.getByRole('button', { name: 'Update now' })).toBeEnabled()
  await review(page)
  offlineServer.failWorker = false
  await status.getByRole('button', { name: 'Retry update check' }).click()
  await expect(status.getByRole('alert')).toHaveCount(0)
  await expect(status.getByRole('button', { name: 'Update now' })).toBeEnabled()
})

test('a failed update install remains visible despite the old activated worker', async ({ page, offlineServer }) => {
  await instrument(page, false)
  await page.goto(offlineServer.url)
  await ready(page)
  offlineServer.failPrecache = true
  offlineServer.revision++
  await visible(page)
  const status = page.getByLabel('Offline status')
  await expect(status.getByRole('alert')).toContainText('Offline install failed:')
  const failed = await counts(page)
  offlineServer.failPrecache = false
  await visible(page)
  expect(await counts(page)).toEqual(failed)
  await status.getByRole('button', { name: 'Retry offline install' }).click()
  await expect(status.getByRole('button', { name: 'Update now' })).toBeVisible()
  await expect(status.getByRole('alert')).toHaveCount(0)
  expect((await counts(page)).checks).toBe(failed.checks + 1)
  expect((await counts(page)).registrations).toBe(1)
})

test('a delayed successful check cannot clear a newer failed attempt', async ({ page, offlineServer }) => {
  await instrument(page, false)
  await page.goto(offlineServer.url)
  await ready(page)
  await page.evaluate(() => { (window as unknown as TestWindow).offlineProbe.holdCheck = true })
  offlineServer.failPrecache = true
  offlineServer.revision++
  await visible(page)
  const status = page.getByLabel('Offline status')
  await expect(status.getByRole('alert')).toContainText('Offline install failed:')
  offlineServer.failPrecache = false
  offlineServer.failWorker = true
  await page.evaluate(() => { (window as unknown as TestWindow).offlineProbe.holdCheck = false })
  await status.getByRole('button', { name: 'Retry offline install' }).click()
  await expect(status.getByRole('alert')).toContainText('Update check failed:')
  await page.evaluate(() => (window as unknown as TestWindow).offlineProbe.releaseCheck())
  await page.waitForTimeout(250)
  await expect(status.getByRole('alert')).toContainText('Update check failed:')
})

test('applying waits for actual activation, retains failures, and reloads once after explicit retry', async ({ page, offlineServer }) => {
  await instrument(page, false)
  await page.goto(offlineServer.url)
  await ready(page)
  await syntheticLibrary(page)
  await expect(page.getByLabel('Offline status')).toHaveCount(0)
  offlineServer.revision++
  await visible(page)
  const status = page.getByLabel('Offline status')
  const update = status.getByRole('button', { name: 'Update now' })
  await expect(update).toBeVisible()
  await page.evaluate(async () => {
    const target = (await navigator.serviceWorker.getRegistration())!.waiting!
    window.addEventListener('beforeunload', () => {
      sessionStorage.setItem('fixture-confirmed-activation', String(target.state === 'activated' && navigator.serviceWorker.controller === target))
    })
  })
  let navigations = 0
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations++ })
  await page.evaluate(() => { (window as unknown as TestWindow).offlineProbe.delivery = 'throw' })
  await update.evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  await expect(status.getByRole('alert')).toContainText('Update delivery interrupted')
  expect((await counts(page)).messages).toBe(1)
  expect(navigations).toBe(0)
  await page.clock.install()
  await page.evaluate(() => { (window as unknown as TestWindow).offlineProbe.delivery = 'hold' })
  await status.getByRole('button', { name: 'Retry update' , exact: true }).click()
  await expect(status).toContainText('Applying update')
  await page.clock.fastForward(31_000)
  await expect(status.getByRole('alert')).toContainText('has not finished')
  expect(navigations).toBe(0)
  await page.evaluate(() => { (window as unknown as TestWindow).offlineProbe.delivery = '' })
  await Promise.all([
    page.waitForEvent('load'),
    status.getByRole('button', { name: 'Retry update', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  ])
  await expect.poll(() => navigations).toBe(1)
  expect(await page.evaluate(() => sessionStorage.getItem('fixture-confirmed-activation'))).toBe('true')
  await ready(page)
  await review(page)
  await page.reload()
  await expect(page.getByText('All caught up')).toBeVisible()
})

test('unsupported offline capability is explicit and installed mode alone promises no readiness', async ({ page, offlineServer }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(Navigator.prototype, 'serviceWorker')
    // Display-mode is a browser boundary, independent of worker/cache readiness.
    const match = window.matchMedia
    window.matchMedia = (query) => query === '(display-mode: standalone)' ? { matches: true } as MediaQueryList : match(query)
  })
  await page.goto(offlineServer.url)
  await expect(page.getByLabel('Offline status')).toContainText('Offline support is unavailable in this browser')
  await page.getByRole('button', { name: 'Start with an empty library' }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Installed on this device' })).toBeVisible()
  await expect(page.getByText(/Check the offline status/)).toBeVisible()
})

test('a redundant requested worker leaves the newer real update retryable', async ({ page, offlineServer }) => {
  await instrument(page, false)
  await page.goto(offlineServer.url)
  await ready(page)
  offlineServer.revision++
  await visible(page)
  const status = page.getByLabel('Offline status')
  await expect(status.getByRole('button', { name: 'Update now' })).toBeVisible()
  await page.evaluate(() => { (window as unknown as TestWindow).offlineProbe.delivery = 'hold' })
  await status.getByRole('button', { name: 'Update now' }).click()
  offlineServer.revision++
  // Model another tab/browser-managed check while this document's apply is pending.
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update() })
  await expect(status.getByRole('alert')).toContainText('requested update became redundant')
  await page.evaluate(() => { (window as unknown as TestWindow).offlineProbe.delivery = '' })
  await Promise.all([
    page.waitForEvent('load'),
    status.getByRole('button', { name: 'Retry update', exact: true }).click()
  ])
  await ready(page)
})

test('late activation after a timeout requires an explicit reload', async ({ page, offlineServer }) => {
  await instrument(page, false)
  await page.goto(offlineServer.url)
  await ready(page)
  offlineServer.revision++
  await visible(page)
  const status = page.getByLabel('Offline status')
  await expect(status.getByRole('button', { name: 'Update now' })).toBeVisible()
  await page.clock.install()
  await page.evaluate(() => { (window as unknown as TestWindow).offlineProbe.delivery = 'hold' })
  await status.getByRole('button', { name: 'Update now' }).click()
  await page.clock.fastForward(31_000)
  await expect(status.getByRole('alert')).toContainText('has not finished')
  let navigations = 0
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations++ })
  await page.evaluate(async () => {
    ;(window as unknown as TestWindow).offlineProbe.delivery = ''
    ;(await navigator.serviceWorker.getRegistration())!.waiting!.postMessage({ type: 'SKIP_WAITING' })
  })
  await expect(status.getByRole('button', { name: 'Reload app' })).toBeVisible()
  await expect(status.getByRole('alert')).toContainText('has not finished')
  expect(navigations).toBe(0)
  await Promise.all([
    page.waitForEvent('load'),
    status.getByRole('button', { name: 'Reload app' }).click()
  ])
  await ready(page)
  expect(navigations).toBe(1)
})

lifetimeTest('StrictMode reattaches one registration, and late native callbacks cannot affect an unmounted app', async ({ page, offlineServer }) => {
  await instrument(page, true)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(offlineServer.url)
  await expect.poll(async () => (await counts(page)).registrations).toBe(1)
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.evaluate(() => {
    const view = window as unknown as TestWindow
    view.unmountLumen()
    view.offlineProbe.release()
  })
  await page.waitForTimeout(250)
  await expect(page.locator('#root')).toBeEmpty()
  expect((await counts(page)).registrations).toBe(1)
  await page.evaluate(() => {
    const view = window as unknown as TestWindow
    view.offlineProbe.holdRegistration = false
    view.mountLumen()
  })
  await ready(page)
  expect((await counts(page)).registrations).toBe(2)
  offlineServer.revision++
  await visible(page)
  const status = page.getByLabel('Offline status')
  await expect(status.getByRole('button', { name: 'Update now' })).toBeVisible()
  await page.evaluate(() => { (window as unknown as TestWindow).offlineProbe.delivery = 'hold' })
  await status.getByRole('button', { name: 'Update now' }).click()
  await page.evaluate(() => (window as unknown as TestWindow).unmountLumen())
  let navigations = 0
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations++ })
  await page.evaluate(async () => {
    const view = window as unknown as TestWindow
    view.offlineProbe.delivery = ''
    const registration = await navigator.serviceWorker.getRegistration()
    registration!.waiting!.postMessage({ type: 'SKIP_WAITING' })
  })
  await expect.poll(() => page.evaluate(async () => !(await navigator.serviceWorker.getRegistration())!.waiting)).toBe(true)
  await page.waitForTimeout(250)
  expect(navigations).toBe(0)
  expect(errors).toEqual([])
  await expect(page.locator('#root')).toBeEmpty()
})
