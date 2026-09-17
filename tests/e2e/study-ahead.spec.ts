import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'
import { State } from 'ts-fsrs'
import type { CardRecord, ReviewRecord, SettingRecord } from '../../src/types'

test.setTimeout(60_000)

async function importDeck(page: Page, title: string, count: number) {
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('tab', { name: 'Import', exact: true }).click()
  await page.getByPlaceholder(/"format": "lumen-deck"/).fill(JSON.stringify({
    format: 'lumen-deck', version: 1,
    deck: { id: title, title, cards: Array.from({ length: count }, (_, i) => ({
      id: `${title}-${i}`, front: `${title} question ${i + 1}`, back: `Answer ${i + 1}`
    })) }
  }))
  await page.getByRole('button', { name: 'Import pasted cards' }).click()
  await expect(page.getByRole('heading', { name: 'Decks', exact: true })).toBeVisible()
}

async function setDailyLimit(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByLabel('New cards per day, per deck').selectOption('5')
}

async function rateEasy(page: Page, count: number) {
  for (let i = 0; i < count; i++) {
    await page.getByRole('button', { name: 'Show answer' }).click()
    await page.getByRole('button', { name: /Easy/ }).click()
  }
}

async function backup(page: Page): Promise<{ cards: CardRecord[]; reviews: ReviewRecord[]; settings: SettingRecord[] }> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save a full backup' }).click()
  return JSON.parse(await readFile((await (await download).path())!, 'utf8'))
}

test('each deck keeps its allowance in counts and sessions; deck study ahead is temporary and supports undo', async ({ page }, testInfo) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Start with an empty library' }).click()
  await importDeck(page, 'Anatomy', 7)
  await importDeck(page, 'Botany', 7)
  await setDailyLimit(page)
  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await expect(page.getByText('10 cards ready')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Study ahead', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Begin', exact: true }).click()
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '10')
  await page.getByRole('button', { name: 'End review' }).click()

  await page.getByRole('button', { name: 'Decks', exact: true }).click()
  await page.getByRole('button', { name: /Anatomy/ }).click()
  await expect(page.getByRole('button', { name: 'Study ahead', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Study 5 due' }).click()
  await rateEasy(page, 5)
  await page.getByRole('button', { name: 'Return home' }).click()
  await expect(page.getByText('5 cards ready')).toBeVisible()
  await expect(page.locator('.deck-tile').filter({ hasText: 'Anatomy' })).toContainText('Resting')
  await expect(page.locator('.deck-tile').filter({ hasText: 'Botany' })).toContainText('5 due')

  await page.getByRole('button', { name: 'Decks', exact: true }).click()
  await expect(page.locator('.deck-row').filter({ hasText: 'Anatomy' })).toContainText('Resting')
  await expect(page.locator('.deck-row').filter({ hasText: 'Botany' })).toContainText('5 due')
  await page.getByRole('button', { name: /Botany/ }).click()
  await page.getByRole('button', { name: 'Study 5 due' }).click()
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '5')
  await expect(page.getByRole('heading', { name: /Botany question/ })).toBeVisible()
  await page.getByRole('button', { name: 'End review' }).click()
  const before = await backup(page)

  await page.getByRole('button', { name: 'Decks', exact: true }).click()
  await page.getByRole('button', { name: /Anatomy/ }).click()
  await expect(page.getByRole('button', { name: 'Nothing due' })).toBeDisabled()
  await expect(page.locator('.deck-hero').getByRole('button', { name: 'Study ahead' })).toBeVisible()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('deck-study-ahead.png'), fullPage: true })
  await page.getByRole('button', { name: 'Study ahead' }).click()
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '2')
  await expect(page.getByRole('heading', { name: 'Anatomy question 6' })).toBeVisible()
  await page.getByRole('button', { name: 'Show answer' }).click()
  await page.getByRole('button', { name: /Good/ }).click()
  await page.getByRole('button', { name: 'Undo last answer' }).click()
  await expect(page.getByRole('heading', { name: 'Anatomy question 6' })).toBeVisible()
  await page.getByRole('button', { name: /Easy/ }).click()
  await page.getByRole('button', { name: 'End review' }).click()
  const after = await backup(page)
  expect(after.reviews).toHaveLength(before.reviews.length + 1)
  expect(after.reviews).toEqual(expect.arrayContaining(before.reviews))
  expect(after.cards.filter((card) => card.id !== 'Anatomy-5')).toEqual(before.cards.filter((card) => card.id !== 'Anatomy-5'))
  const studied = after.cards.find((card) => card.id === 'Anatomy-5')!
  expect(studied.fsrs.reps).toBe(1)
  expect(studied.fsrs.state).not.toBe(State.New)
  expect(new Date(studied.due).getTime()).toBeGreaterThan(new Date(studied.fsrs.last_review!).getTime())
  expect(after.reviews.find((review) => review.cardId === studied.id)?.state).toBe(State.New)
  await expect(page.getByLabel('New cards per day, per deck')).toHaveValue('5')

  // Starting an ordinary session after an override must restore the per-deck cap.
  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await page.getByRole('button', { name: 'Begin', exact: true }).click()
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '5')
  await expect(page.getByRole('heading', { name: /Botany question/ })).toBeVisible()
})

test('Home study ahead serves remaining unseen cards across decks, survives reload, and respects paused cards', async ({ page }, testInfo) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Start with an empty library' }).click()
  await importDeck(page, 'Anatomy', 6)
  await importDeck(page, 'Botany', 7)
  await page.getByRole('button', { name: /Botany/ }).click()
  await page.getByRole('button', { name: 'Edit Botany question 7' }).click()
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await setDailyLimit(page)
  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await page.getByRole('button', { name: 'Begin', exact: true }).click()
  await rateEasy(page, 10)
  await page.getByRole('button', { name: 'Return home' }).click()
  await page.reload()
  await expect(page.getByText('All caught up')).toBeVisible()
  await expect(page.getByRole('button', { name: /Done/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Study ahead' })).toBeVisible()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('home-study-ahead.png'), fullPage: true })
  await page.getByRole('button', { name: 'Study ahead' }).click()
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '2')
  await rateEasy(page, 2)
  await page.getByRole('button', { name: 'Return home' }).click()
  await expect(page.getByRole('button', { name: 'Study ahead' })).toHaveCount(0)
  const saved = await backup(page)
  expect(saved.cards).toHaveLength(13)
  expect(saved.reviews).toHaveLength(12)
  expect(saved.cards.filter((card) => card.fsrs.state === State.New).map((card) => card.id)).toEqual(['Botany-6'])

  // Reimport preserves both ordinary and ahead scheduling/history, including the pause.
  await importDeck(page, 'Botany', 7)
  const reimported = await backup(page)
  expect(reimported.reviews).toEqual(saved.reviews)
  expect(reimported.cards.map((card) => [card.id, card.fsrs, card.due, card.suspended]))
    .toEqual(saved.cards.map((card) => [card.id, card.fsrs, card.due, card.suspended]))
  await expect(page.getByLabel('New cards per day, per deck')).toHaveValue('5')
  await expect(page.getByText('Lumen 1.2 · FSRS scheduling · made to last')).toBeVisible()
  await page.getByRole('button', { name: 'Decks', exact: true }).click()
  await page.getByRole('button', { name: /Botany/ }).click()
  await expect(page.getByRole('button', { name: 'Nothing due' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Study ahead' })).toHaveCount(0)
})
