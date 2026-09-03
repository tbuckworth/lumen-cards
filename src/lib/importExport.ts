import Papa from 'papaparse'
import { z } from 'zod'
import { Rating } from 'ts-fsrs'
import { createCard, createDeck, db, makeId, setSetting } from './db'
import type {
  CardRecord,
  DeckRecord,
  ImportResult,
  LumenContentCard,
  LumenDeckPack,
  ReviewRecord,
  SettingRecord
} from '../types'

const contentCardSchema = z.object({
  id: z.string().min(1).optional(),
  front: z.string().trim().min(1),
  back: z.string().trim().min(1),
  notes: z.string().optional().default(''),
  tags: z.array(z.string()).optional().default([]),
  source: z.string().optional()
})

export const lumenDeckPackSchema = z.object({
  format: z.literal('lumen-deck'),
  version: z.literal(1),
  createdAt: z.string().optional(),
  deck: z.object({
    id: z.string().optional(),
    title: z.string().trim().min(1),
    description: z.string().optional().default(''),
    color: z.string().optional(),
    cards: z.array(contentCardSchema).min(1)
  })
})

const genericClaudePackSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  cards: z.array(contentCardSchema).min(1)
})

const deckRecordSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  color: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
})

const storedFsrsSchema = z.object({
  due: z.string(),
  stability: z.number(),
  difficulty: z.number(),
  elapsed_days: z.number(),
  scheduled_days: z.number(),
  learning_steps: z.number(),
  reps: z.number(),
  lapses: z.number(),
  state: z.number().int(),
  last_review: z.string().optional()
})

const cardRecordSchema = z.object({
  id: z.string().min(1),
  deckId: z.string().min(1),
  front: z.string().min(1),
  back: z.string().min(1),
  notes: z.string(),
  tags: z.array(z.string()),
  source: z.string().optional(),
  suspended: z.boolean(),
  due: z.string(),
  fsrs: storedFsrsSchema,
  createdAt: z.string(),
  updatedAt: z.string()
})

const reviewRecordSchema = z.object({
  id: z.string().min(1),
  cardId: z.string().min(1),
  deckId: z.string().min(1),
  rating: z.number().int().min(1).max(4),
  state: z.number().int(),
  reviewedAt: z.string(),
  durationMs: z.number().nonnegative(),
  scheduledDays: z.number(),
  elapsedDays: z.number()
})

const backupSchema = z.object({
  format: z.literal('lumen-backup'),
  version: z.literal(1),
  exportedAt: z.string(),
  decks: z.array(deckRecordSchema),
  cards: z.array(cardRecordSchema),
  reviews: z.array(reviewRecordSchema),
  settings: z.array(z.object({ key: z.string(), value: z.unknown() }))
})

function normalizeFront(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

function htmlToText(value: string): string {
  if (!/[<&]/.test(value)) return value.trim()
  const withBreaks = value.replace(/<br\s*\/?>/gi, '\n').replace(/<\/div>/gi, '\n')
  const parser = new DOMParser()
  return (parser.parseFromString(withBreaks, 'text/html').body.textContent ?? '').trim()
}

export function parseDeckJson(raw: string): LumenDeckPack | { backup: z.infer<typeof backupSchema> } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('That file is not valid JSON.')
  }

  const backup = backupSchema.safeParse(parsed)
  if (backup.success) return { backup: backup.data }

  const pack = lumenDeckPackSchema.safeParse(parsed)
  if (pack.success) return pack.data

  const generic = genericClaudePackSchema.safeParse(parsed)
  if (generic.success) {
    return {
      format: 'lumen-deck',
      version: 1,
      createdAt: new Date().toISOString(),
      deck: {
        title: generic.data.title ?? 'From Claude',
        description: generic.data.description ?? '',
        cards: generic.data.cards
      }
    }
  }

  throw new Error('I could not find a Lumen deck. Each card needs a front and a back.')
}

export function parseTabularCards(raw: string): LumenContentCard[] {
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/)
  const directives = lines.filter((line) => line.startsWith('#'))
  const body = lines.filter((line) => !line.startsWith('#')).join('\n').trim()
  if (!body) throw new Error('The file does not contain any cards.')

  const separator = directives.find((line) => line.toLowerCase().startsWith('#separator:'))
  const separatorName = separator?.split(':').slice(1).join(':').trim().toLowerCase()
  const delimiter = separatorName === 'tab' ? '\t' : separatorName === 'semicolon' ? ';' : ''
  const result = Papa.parse<string[]>(body, {
    delimiter,
    skipEmptyLines: 'greedy'
  })
  if (result.errors.length && result.data.length === 0) {
    throw new Error(result.errors[0]?.message ?? 'The text file could not be read.')
  }

  const rows = result.data
  const declaredColumns = directives
    .find((line) => line.toLowerCase().startsWith('#columns:'))
    ?.slice('#columns:'.length)
    .split(delimiter || '\t')
    .map((field) => field.trim().toLowerCase())
  const first = rows[0]?.map((field) => field.trim().toLowerCase()) ?? []
  const hasHeader = first.includes('front') && first.includes('back')
  const columns = declaredColumns ?? (hasHeader ? first : ['front', 'back', 'tags', 'notes'])
  const dataRows = hasHeader ? rows.slice(1) : rows
  const frontIndex = columns.indexOf('front') >= 0 ? columns.indexOf('front') : 0
  const backIndex = columns.indexOf('back') >= 0 ? columns.indexOf('back') : 1
  const tagsIndex = columns.indexOf('tags')
  const notesIndex = columns.indexOf('notes')

  const cards = dataRows
    .map((row) => ({
      front: htmlToText(row[frontIndex] ?? ''),
      back: htmlToText(row[backIndex] ?? ''),
      tags:
        tagsIndex >= 0
          ? (row[tagsIndex] ?? '').split(/[ ,]+/).map((tag) => tag.trim()).filter(Boolean)
          : [],
      notes: notesIndex >= 0 ? htmlToText(row[notesIndex] ?? '') : ''
    }))
    .filter((card) => card.front && card.back)

  if (!cards.length) throw new Error('No complete front/back pairs were found.')
  return cards
}

export async function importContentCards(
  deckId: string,
  cards: LumenContentCard[]
): Promise<ImportResult> {
  const existing = await db.cards.where('deckId').equals(deckId).toArray()
  const byId = new Map(existing.map((card) => [card.id, card]))
  const byFront = new Map(existing.map((card) => [normalizeFront(card.front), card]))
  const result: ImportResult = {
    decksAdded: 0,
    cardsAdded: 0,
    cardsUpdated: 0,
    cardsSkipped: 0,
    deckId
  }

  for (const input of cards) {
    const parsed = contentCardSchema.safeParse(input)
    if (!parsed.success) {
      result.cardsSkipped += 1
      continue
    }
    const item = parsed.data
    const match = (item.id && byId.get(item.id)) || byFront.get(normalizeFront(item.front))
    if (match) {
      await db.cards.update(match.id, {
        front: item.front.trim(),
        back: item.back.trim(),
        notes: item.notes.trim(),
        tags: item.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean),
        source: item.source?.trim() || match.source,
        updatedAt: new Date().toISOString()
      })
      result.cardsUpdated += 1
    } else {
      const created = await createCard(deckId, item.front, item.back, {
        id: item.id,
        notes: item.notes,
        tags: item.tags,
        source: item.source
      })
      byId.set(created.id, created)
      byFront.set(normalizeFront(created.front), created)
      result.cardsAdded += 1
    }
  }
  await db.decks.update(deckId, { updatedAt: new Date().toISOString() })
  return result
}

export async function importDeckPack(pack: LumenDeckPack): Promise<ImportResult> {
  const existing = pack.deck.id
    ? await db.decks.get(pack.deck.id)
    : await db.decks.filter((deck) => deck.title.toLowerCase() === pack.deck.title.toLowerCase()).first()
  const deck =
    existing ??
    (await createDeck(pack.deck.title, pack.deck.description, pack.deck.color ?? '#ae765f'))
  const result = await importContentCards(deck.id, pack.deck.cards)
  result.decksAdded = existing ? 0 : 1
  return result
}

export async function restoreBackup(raw: string): Promise<ImportResult> {
  const parsed = parseDeckJson(raw)
  if (!('backup' in parsed)) throw new Error('This is a deck, not a full Lumen backup.')
  const { backup } = parsed
  await db.transaction('rw', db.decks, db.cards, db.reviews, db.settings, async () => {
    await db.decks.bulkPut(backup.decks as DeckRecord[])
    await db.cards.bulkPut(backup.cards as CardRecord[])
    await db.reviews.bulkPut(backup.reviews as ReviewRecord[])
    await db.settings.bulkPut(backup.settings as SettingRecord[])
  })
  return {
    decksAdded: backup.decks.length,
    cardsAdded: backup.cards.length,
    cardsUpdated: 0,
    cardsSkipped: 0
  }
}

export async function makeDeckPack(deckId: string): Promise<LumenDeckPack> {
  const deck = await db.decks.get(deckId)
  if (!deck) throw new Error('Deck not found.')
  const cards = await db.cards.where('deckId').equals(deckId).toArray()
  return {
    format: 'lumen-deck',
    version: 1,
    createdAt: new Date().toISOString(),
    deck: {
      id: deck.id,
      title: deck.title,
      description: deck.description,
      color: deck.color,
      cards: cards.map(({ id, front, back, notes, tags, source }) => ({
        id,
        front,
        back,
        notes,
        tags,
        source
      }))
    }
  }
}

export async function makeBackup(): Promise<string> {
  const [decks, cards, reviews, settings] = await Promise.all([
    db.decks.toArray(),
    db.cards.toArray(),
    db.reviews.toArray(),
    db.settings.toArray()
  ])
  await setSetting('lastBackupAt', new Date().toISOString())
  return JSON.stringify(
    {
      format: 'lumen-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      decks,
      cards,
      reviews,
      settings
    },
    null,
    2
  )
}

function tsvField(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\t/g, ' ')
    .replace(/\r?\n/g, '<br>')
}

export async function makeAnkiTsv(deckId: string): Promise<string> {
  const deck = await db.decks.get(deckId)
  if (!deck) throw new Error('Deck not found.')
  const cards = await db.cards.where('deckId').equals(deckId).toArray()
  const header = [
    '#separator:Tab',
    '#html:true',
    `#deck:${deck.title}`,
    '#columns:Front\tBack\tTags\tNotes'
  ]
  const rows = cards.map((card) =>
    [card.front, card.back, card.tags.join(' '), card.notes].map(tsvField).join('\t')
  )
  return [...header, ...rows].join('\n')
}

export async function makeLearningReport(deckId?: string): Promise<string> {
  const deck = deckId ? await db.decks.get(deckId) : undefined
  const cards = deckId
    ? await db.cards.where('deckId').equals(deckId).toArray()
    : await db.cards.toArray()
  const ids = new Set(cards.map((card) => card.id))
  const reviews = (await db.reviews.orderBy('reviewedAt').reverse().toArray()).filter((review) =>
    ids.has(review.cardId)
  )
  const byCard = new Map<string, ReviewRecord[]>()
  for (const review of reviews) {
    const list = byCard.get(review.cardId) ?? []
    list.push(review)
    byCard.set(review.cardId, list)
  }
  const difficult = cards
    .map((card) => {
      const history = byCard.get(card.id) ?? []
      return {
        card,
        again: history.filter((review) => review.rating === Rating.Again).length,
        reviews: history.length,
        latest: history[0]
      }
    })
    .filter((entry) => entry.reviews > 0)
    .sort((a, b) => b.again - a.again || b.reviews - a.reviews)
    .slice(0, 12)

  const lines = [
    '# Lumen learning report',
    '',
    `Deck: ${deck?.title ?? 'All decks'}`,
    `Generated: ${new Date().toLocaleString()}`,
    `Cards: ${cards.length} · Reviews: ${reviews.length}`,
    '',
    '## Cards needing the most attention',
    ''
  ]
  if (!difficult.length) lines.push('No reviews yet.')
  for (const entry of difficult) {
    lines.push(
      `- **${entry.card.front}**`,
      `  - Expected: ${entry.card.back}`,
      `  - Again: ${entry.again}/${entry.reviews}; next due ${new Date(entry.card.due).toLocaleDateString()}`,
      entry.card.notes ? `  - Note: ${entry.card.notes}` : ''
    )
  }
  lines.push(
    '',
    '## Prompt for Claude',
    '',
    'Use this review history to diagnose misconceptions. Suggest edits only where a card is ambiguous, overloaded, or missing prerequisite context. Return any revised cards as a valid Lumen deck.'
  )
  return lines.filter((line) => line !== '').join('\n\n')
}

export function safeFilename(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'lumen'
}

export function downloadText(contents: string, filename: string, type = 'application/json'): void {
  const blob = new Blob([contents], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function shareTextFile(
  contents: string,
  filename: string,
  title: string,
  type = 'text/plain'
): Promise<'shared' | 'downloaded'> {
  const file = new File([contents], filename, { type })
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    await navigator.share({ title, files: [file] })
    return 'shared'
  }
  downloadText(contents, filename, type)
  return 'downloaded'
}

export function makeReviewId(): string {
  return makeId('review')
}
