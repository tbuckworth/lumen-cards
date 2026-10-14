import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { State } from 'ts-fsrs'
import type { CardRecord, ReviewRecord } from '../../src/types'

test.setTimeout(60_000)

const day = 86_400_000

function herbCard(id: string, front: string, created: Date, due?: Date): CardRecord {
  const scheduled = Boolean(due)
  const at = (due ?? created).toISOString()
  return {
    id, deckId: 'herbs', front, back: `About ${front}`, notes: '', tags: [], suspended: false, due: at,
    fsrs: {
      due: at, stability: scheduled ? 4 : 0, difficulty: scheduled ? 5 : 0, elapsed_days: 0,
      scheduled_days: scheduled ? 3 : 0, learning_steps: 0, reps: scheduled ? 2 : 0, lapses: 0,
      state: scheduled ? State.Review : State.New,
      ...(scheduled ? { last_review: new Date(due!.getTime() - 3 * day).toISOString() } : {})
    },
    createdAt: created.toISOString(), updatedAt: created.toISOString()
  }
}

async function backup(page: Page): Promise<{ cards: CardRecord[]; reviews: ReviewRecord[] }> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save a full backup' }).click()
  return JSON.parse(await readFile((await (await download).path())!, 'utf8'))
}

test('new cards come before recall, and each group is shuffled without touching saved schedules', async ({ page }) => {
  // Tuula's case: a herb deck whose new cards were added grouped by herb, plus reviews due today.
  const created = new Date(Date.now() - 10 * day)
  const fresh = ['Burdock', 'Calendula'].flatMap((herb, h) => Array.from({ length: 5 }, (_, i) =>
    herbCard(`${herb}-${i + 1}`, `${herb} question ${i + 1}`, new Date(created.getTime() + (h * 5 + i) * 1000))))
  const recall = Array.from({ length: 4 }, (_, i) =>
    herbCard(`Recall-${i + 1}`, `Recall question ${i + 1}`, new Date(created.getTime() - day), new Date(Date.now() - (4 - i) * 3_600_000)))
  const original = {
    format: 'lumen-backup', version: 1, exportedAt: new Date().toISOString(),
    decks: [{ id: 'herbs', title: 'Term 1 herbs', description: '', color: '#72806f', createdAt: created.toISOString(), updatedAt: created.toISOString() }],
    cards: [...recall, ...fresh], reviews: [], settings: []
  }

  await page.goto('./')
  await page.getByRole('button', { name: 'Start with an empty library' }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  page.on('dialog', (dialog) => dialog.accept())
  await page.locator('.settings-row--file input').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(original)) })
  await expect(page.locator('.toast')).toContainText('Restored 14 cards')
  const restored = await backup(page)
  expect(restored.cards.map((card) => [card.id, card.fsrs, card.due]).sort())
    .toEqual(original.cards.map((card) => [card.id, card.fsrs, card.due]).sort())

  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await expect(page.getByText('14 cards ready')).toBeVisible()
  await page.getByRole('button', { name: 'Begin', exact: true }).click()
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '14')
  const seen: { kind: string; front: string }[] = []
  for (let i = 0; i < 14; i++) {
    const card = page.locator('.review-card')
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(i))
    seen.push({ kind: (await card.locator('.eyebrow').textContent())!, front: (await card.getByRole('heading').textContent())! })
    await page.getByRole('button', { name: 'Show answer' }).click()
    await page.getByRole('button', { name: /Good/ }).click()
  }
  await expect(page.getByRole('heading', { name: 'Well remembered.' })).toBeVisible()

  expect(seen.slice(0, 10).map((card) => card.kind)).toEqual(Array(10).fill('New card'))
  expect(seen.slice(10).map((card) => card.kind)).toEqual(Array(4).fill('Recall'))
  const newFronts = seen.slice(0, 10).map((card) => card.front)
  expect([...newFronts].sort()).toEqual(fresh.map((card) => card.front).sort())
  // An unshuffled session would show every Burdock card, then every Calendula card (a 1 in 3.6 million chance when shuffled).
  expect(newFronts).not.toEqual(fresh.map((card) => card.front))
  expect(seen.slice(10).map((card) => card.front).sort()).toEqual(recall.map((card) => card.front).sort())

  // Every card was graded once, in the order shown; nothing else changed.
  await page.getByRole('button', { name: 'Return home' }).click()
  const after = await backup(page)
  expect(after.cards).toHaveLength(14)
  expect(after.reviews).toHaveLength(14)
  const byCard = new Map(after.reviews.map((review) => [review.cardId, review]))
  for (const card of original.cards) {
    expect(byCard.get(card.id)?.state).toBe(card.fsrs.state)
    expect(after.cards.find((saved) => saved.id === card.id)?.fsrs.reps).toBe(card.fsrs.reps + 1)
  }
  const reviewOrder = [...after.reviews].sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt)).map((review) => review.cardId)
  expect(reviewOrder.map((id) => original.cards.find((card) => card.id === id)!.front)).toEqual(seen.map((card) => card.front))
})
