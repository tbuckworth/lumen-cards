import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'
import type { DeckRecord, ReviewRecord } from '../../src/types'

test.setTimeout(60_000)

const herbs = ['Burdock', 'Calendula', 'Nettle', 'Yarrow']

async function importPack(page: Page, deck: object) {
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('tab', { name: 'Import', exact: true }).click()
  await page.getByPlaceholder(/"format": "lumen-deck"/).fill(JSON.stringify({ format: 'lumen-deck', version: 1, deck }))
  await page.getByRole('button', { name: 'Import pasted cards' }).click()
  await expect(page.getByRole('heading', { name: 'Decks', exact: true })).toBeVisible()
}

async function backup(page: Page): Promise<{ decks: DeckRecord[]; reviews: ReviewRecord[] }> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save a full backup' }).click()
  return JSON.parse(await readFile((await (await download).path())!, 'utf8'))
}

test('imported groups organise the deck list and a saved tag filter narrows deck sessions only', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Start with an empty library' }).click()
  // Two herbs per monthly batch, and one card built for next year.
  await importPack(page, {
    id: 'mat-med', title: 'Materia medica', group: 'Materia Medica',
    cards: [
      ...herbs.map((herb, i) => ({ id: `herb-${i}`, front: `${herb}: part used`, back: 'Answer', tags: [i < 2 ? 'batch-oct' : 'batch-nov'] })),
      { id: 'herb-y2', front: 'Lime flower: part used', back: 'Answer', tags: ['y2-botany'] }
    ]
  })
  await importPack(page, { id: 'muscles', title: 'Muscles', group: 'Anatomy & Physiology', cards: [{ id: 'muscle-1', front: 'Biceps action', back: 'Flexes the elbow' }] })
  await importPack(page, { id: 'loose', title: 'Loose notes', cards: [{ id: 'loose-1', front: 'Loose question', back: 'Answer' }] })

  await expect(page.locator('.deck-group__title')).toHaveText(['Anatomy & Physiology', 'Materia Medica', 'Other decks'])
  await expect(page.getByRole('region', { name: 'Materia Medica' }).getByText('5 due')).toBeVisible()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])

  await page.getByRole('button', { name: /Materia medica/ }).click()
  await page.getByRole('button', { name: /#batch-nov/ }).click()
  await expect(page.getByRole('button', { name: 'Study 2 due' })).toBeVisible()
  await expect(page.getByText('Studying only #batch-nov')).toBeVisible()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])

  // The filter is stored with the deck, so it survives a reload.
  await page.reload()
  await page.getByRole('button', { name: 'Decks', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Materia Medica' }).getByText('2 due')).toBeVisible()
  await page.getByRole('button', { name: /Materia medica/ }).click()
  await page.getByRole('button', { name: 'Study 2 due' }).click()
  const seen: string[] = []
  for (let i = 0; i < 2; i++) {
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(i))
    seen.push((await page.locator('.review-card__front h1').textContent())!)
    await page.getByRole('button', { name: 'Show answer' }).click()
    await page.getByRole('button', { name: /Easy/ }).click()
  }
  expect(seen.sort()).toEqual(['Nettle: part used', 'Yarrow: part used'])
  await expect(page.getByRole('heading', { name: 'Well remembered.' })).toBeVisible()
  await page.getByRole('button', { name: 'Return home' }).click()

  // Today is not filtered: the other herbs, the other decks and next year's card are still there.
  await expect(page.getByText('5 cards ready')).toBeVisible()

  await page.getByRole('button', { name: 'Decks', exact: true }).click()
  await page.getByRole('button', { name: /Materia medica/ }).click()
  await page.getByRole('button', { name: 'All except these' }).click()
  await page.getByRole('button', { name: /#y2-botany/ }).click()
  await expect(page.getByRole('button', { name: 'Study 2 due' })).toBeVisible()
  await expect(page.getByText('Studying all except #batch-nov, #y2-botany')).toBeVisible()

  const saved = await backup(page)
  expect(saved.decks.find((deck) => deck.id === 'mat-med')).toMatchObject({ group: 'Materia Medica', studyTags: { mode: 'except', tags: ['batch-nov', 'y2-botany'] } })
  expect(saved.decks.find((deck) => deck.id === 'loose')).not.toHaveProperty('group')
  expect(saved.reviews.map((review) => review.cardId).sort()).toEqual(['herb-2', 'herb-3'])
})
