import Papa from 'papaparse'
import { assembleContentKey, blobDataUri, contentKey, imageBlob, imageSchema, MAX_IMPORT_BYTES, validateImage, storeImage } from './images'
import learningReport from '../config/learning-report.json'
import { z } from 'zod'
import { Rating } from 'ts-fsrs'
import { createCard, createDeck, db, setSetting } from './db'
import { BACKUP_FORMAT, DECK_FORMAT, RETENTION_BOUNDS } from '../types'
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
  front: z.string().trim().default(''),
  back: z.string().trim().default(''),
  frontImage: imageSchema.optional(),
  backImage: imageSchema.optional(),
  notes: z.string().optional().default(''),
  tags: z.array(z.string()).optional().default([]),
  source: z.string().optional()
}).refine((card) => Boolean(card.front || card.frontImage) && Boolean(card.back || card.backImage), 'Each side needs text or an image.')

export const lumenDeckPackSchema = z.object({
  format: z.literal(DECK_FORMAT.format),
  version: z.literal(DECK_FORMAT.version),
  createdAt: z.string().optional(),
  deck: z.object({
    id: z.string().min(1).optional(),
    title: z.string().trim().min(1),
    description: z.string().optional().default(''),
    color: z.string().optional(),
    cards: z.array(contentCardSchema).min(1)
  })
})

const compactDeckSchema = z.object({
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

const dateSchema = z.string().refine((value) => Number.isFinite(Date.parse(value)), 'Invalid date')

const storedFsrsSchema = z.object({
  due: dateSchema,
  stability: z.number().nonnegative(),
  difficulty: z.number().nonnegative(),
  elapsed_days: z.number().nonnegative(),
  scheduled_days: z.number().nonnegative(),
  learning_steps: z.number().nonnegative(),
  reps: z.number().nonnegative(),
  lapses: z.number().nonnegative(),
  state: z.number().int().min(0).max(3),
  last_review: dateSchema.optional()
})

const cardRecordSchema = z.object({
  id: z.string().min(1),
  deckId: z.string().min(1),
  front: z.string(),
  back: z.string(),
  frontImage: imageSchema.optional(),
  backImage: imageSchema.optional(),
  notes: z.string(),
  tags: z.array(z.string()),
  source: z.string().optional(),
  suspended: z.boolean(),
  due: dateSchema,
  fsrs: storedFsrsSchema,
  createdAt: z.string(),
  updatedAt: z.string()
}).refine((card) => Boolean(card.front.trim() || card.frontImage) && Boolean(card.back.trim() || card.backImage), 'Each side needs text or an image.')

const reviewRecordSchema = z.object({
  id: z.string().min(1),
  cardId: z.string().min(1),
  deckId: z.string().min(1),
  rating: z.number().int().min(1).max(4),
  state: z.number().int().min(0).max(3),
  reviewedAt: dateSchema,
  durationMs: z.number().nonnegative(),
  scheduledDays: z.number().nonnegative(),
  elapsedDays: z.number()
})

const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT.format),
  version: z.literal(BACKUP_FORMAT.version),
  exportedAt: z.string(),
  decks: z.array(deckRecordSchema),
  cards: z.array(cardRecordSchema),
  reviews: z.array(reviewRecordSchema),
  settings: z.array(z.discriminatedUnion('key', [
    z.object({ key: z.literal('onboardingComplete'), value: z.boolean() }),
    z.object({ key: z.literal('desiredRetention'), value: z.number().min(RETENTION_BOUNDS.min).max(RETENTION_BOUNDS.max) }),
    z.object({ key: z.literal('dailyNewCards'), value: z.number().int().min(0).max(1000) }),
    z.object({ key: z.literal('lastBackupAt'), value: dateSchema.nullable() })
  ]))
})

function htmlToText(value: string): string {
  if (!/[<&]/.test(value)) return value.trim()
  const withBreaks = value.replace(/<br\s*\/?>/gi, '\n').replace(/<\/div>/gi, '\n')
  const parser = new DOMParser()
  return (parser.parseFromString(withBreaks, 'text/html').body.textContent ?? '').trim()
}

export function checkDeckSize(input: string | Pick<Blob, 'size'>): void {
  const size = typeof input === 'string' ? new Blob([input]).size : input.size
  if (size > MAX_IMPORT_BYTES) throw new Error('Deck files must be 100 MB or smaller. Split this deck into smaller files.')
}

export function parseDeckJson(raw: string): LumenDeckPack | { backup: z.infer<typeof backupSchema> } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('That file is not valid JSON.')
  }

  if (parsed && typeof parsed === 'object' && 'format' in parsed) {
    if (parsed.format === BACKUP_FORMAT.format) return { backup: parseSchema(backupSchema, parsed) }
    if (parsed.format === DECK_FORMAT.format) {
      checkDeckSize(raw)
      return parseSchema(lumenDeckPackSchema, parsed)
    }
    throw new Error('This file uses an unsupported format. Export a Lumen deck or backup.')
  }

  checkDeckSize(raw)
  const generic = parseSchema(compactDeckSchema, parsed)
  return {
    ...DECK_FORMAT, createdAt: new Date().toISOString(),
    deck: { title: generic.title ?? 'From Claude', description: generic.description ?? '', cards: generic.cards }
  }
}

export function parseTabularCards(raw: string): LumenContentCard[] {
  if (/<(?:img|audio|video)\b/i.test(raw)) throw new Error('This text file contains media that cannot be imported safely. Use Lumen JSON with embedded frontImage or backImage fields.')
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
  // Delimiter detection can advise using the default comma for a valid short CSV.
  // Structural errors must reject the entire import, even when rows were parsed.
  const error = result.errors.find((issue) => issue.code !== 'UndetectableDelimiter')
  if (error) {
    throw new Error(`Row ${(error.row ?? 0) + 1}: ${error.message}`)
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

  const cards = dataRows.map((row, index) => {
    const card = {
      front: htmlToText(row[frontIndex] ?? ''),
      back: htmlToText(row[backIndex] ?? ''),
      tags:
        tagsIndex >= 0
          ? (row[tagsIndex] ?? '').split(/[ ,]+/).map((tag) => tag.trim()).filter(Boolean)
          : [],
      notes: notesIndex >= 0 ? htmlToText(row[notesIndex] ?? '') : ''
    }
    if (!card.front || !card.back) throw new Error(`Row ${index + (hasHeader ? 2 : 1)}: Each card needs a complete front/back pair.`)
    return card
  })

  if (!cards.length) throw new Error('No complete front/back pairs were found.')
  return cards
}

function parseSchema<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  throw new Error(`${issue.path.join('.') || 'Deck'}: ${issue.message}`)
}

async function prepareCards(cards: LumenContentCard[]) {
  const prepared = []
  const ids = new Set<string>()
  for (const [index, input] of cards.entries()) {
    try {
      const item = parseSchema(contentCardSchema, input)
      if (item.id && ids.has(item.id)) throw new Error('Duplicate card ID. Give each card a distinct ID.')
      if (item.id) ids.add(item.id)
      const frontImage = item.frontImage ? imageBlob(item.frontImage) : undefined
      const backImage = item.backImage ? imageBlob(item.backImage) : undefined
      if (frontImage) await validateImage(frontImage)
      if (backImage) await validateImage(backImage)
      prepared.push({ ...item, frontImage: await storeImage(frontImage), backImage: await storeImage(backImage), contentKey: await contentKey(item.front, frontImage, backImage) })
    } catch (error) { throw new Error(`Card ${index + 1}: ${(error as Error).message}`) }
  }
  return prepared
}

type PreparedCards = Awaited<ReturnType<typeof prepareCards>>

// Called only inside a transaction, after image decoding and hashing have finished.
async function importPreparedCards(deckId: string, cards: PreparedCards): Promise<ImportResult> {
  if (!await db.decks.get(deckId)) throw new Error('Choose an existing deck or name a new one.')
  const existing = await db.cards.where('deckId').equals(deckId).toArray()
  const byId = new Map(existing.map((card) => [card.id, card]))
  const keyFor = (card: CardRecord) => card.contentKey ?? assembleContentKey(card.front)
  const byContent = new Map<string, CardRecord[]>()
  const addKey = (card: CardRecord) => byContent.set(keyFor(card), [...(byContent.get(keyFor(card)) ?? []), card])
  existing.forEach(addKey)
  const result: ImportResult = { decksAdded: 0, cardsAdded: 0, cardsUpdated: 0, cardsSkipped: 0, deckId }
  for (const item of cards) {
    const candidates = byContent.get(item.contentKey) ?? []
    // Explicit IDs always win. Ambiguous fronts must never choose an arbitrary card.
    const match = item.id ? byId.get(item.id) : candidates.length === 1 ? candidates[0] : undefined
    if (!item.id && candidates.length > 1) throw new Error('More than one card matches this prompt and image. Add distinct card IDs before importing.')
    const content = { front: item.front, back: item.back, frontImage: item.frontImage, backImage: item.backImage,
      contentKey: item.contentKey, notes: item.notes.trim(), tags: item.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean),
      source: item.source, updatedAt: new Date().toISOString() }
    if (match) {
      const updated = { ...match, ...content }
      await db.cards.put(updated)
      byContent.set(keyFor(match), (byContent.get(keyFor(match)) ?? []).filter((card) => card.id !== match.id))
      byId.set(updated.id, updated)
      addKey(updated)
      result.cardsUpdated += 1
    } else {
      if (item.id && await db.cards.get(item.id)) throw new Error('This card ID belongs to another deck. Use distinct IDs for different decks.')
      const created = await createCard(deckId, item.front, item.back, { ...content, id: item.id })
      byId.set(created.id, created)
      addKey(created)
      result.cardsAdded += 1
    }
  }
  await db.decks.update(deckId, { updatedAt: new Date().toISOString() })
  return result
}

export async function importContentCards(deckId: string, cards: LumenContentCard[]): Promise<ImportResult> {
  const prepared = await prepareCards(cards)
  return db.transaction('rw', db.decks, db.cards, () => importPreparedCards(deckId, prepared))
}

export async function importDeckPack(input: LumenDeckPack): Promise<ImportResult> {
  const pack = parseSchema(lumenDeckPackSchema, input)
  const prepared = await prepareCards(pack.deck.cards)
  return db.transaction('rw', db.decks, db.cards, async () => {
    const existing = pack.deck.id ? await db.decks.get(pack.deck.id)
      : await db.decks.filter((deck) => deck.title.toLowerCase() === pack.deck.title.toLowerCase()).first()
    const deck = existing ?? await createDeck(pack.deck.title, pack.deck.description, pack.deck.color, pack.deck.id)
    const result = await importPreparedCards(deck.id, prepared)
    result.decksAdded = existing ? 0 : 1
    return result
  })
}

export async function restoreBackup(raw: string): Promise<ImportResult> {
  const parsed = parseDeckJson(raw)
  if (!('backup' in parsed)) throw new Error('This is a deck, not a full Lumen backup.')
  const { backup } = parsed
  const prepared = await prepareCards(backup.cards)
  const cards = backup.cards.map((card, index) => ({ ...card, ...prepared[index] }))
  const decks = new Set(backup.decks.map((deck) => deck.id))
  const cardsById = new Map(cards.map((card) => [card.id, card]))
  if (decks.size !== backup.decks.length || cardsById.size !== cards.length || new Set(backup.reviews.map((review) => review.id)).size !== backup.reviews.length) throw new Error('Backup contains duplicate IDs.')
  if (cards.some((card) => !decks.has(card.deckId)) || backup.reviews.some((review) => cardsById.get(review.cardId)?.deckId !== review.deckId)) throw new Error('Backup contains missing or mismatched cards or decks.')
  await db.transaction('rw', db.decks, db.cards, db.reviews, db.settings, async () => {
    await db.decks.bulkPut(backup.decks as DeckRecord[])
    await db.cards.bulkPut(cards as CardRecord[])
    await db.reviews.where('cardId').anyOf([...cardsById.keys()]).delete()
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
    ...DECK_FORMAT,
    createdAt: new Date().toISOString(),
    deck: {
      id: deck.id,
      title: deck.title,
      description: deck.description,
      color: deck.color,
      cards: await Promise.all(cards.map(async ({ id, front, back, notes, tags, source, frontImage, backImage }) => ({
        frontImage: await blobDataUri(frontImage),
        backImage: await blobDataUri(backImage),
        id,
        front,
        back,
        notes,
        tags,
        source
      })))
    }
  }
}

export async function makeBackup(): Promise<string> {
  const [decks, cards, reviews, settings] = await db.transaction('r', db.decks, db.cards, db.reviews, db.settings, () => Promise.all([
    db.decks.toArray(),
    db.cards.toArray(),
    db.reviews.toArray(),
    db.settings.toArray()
  ]))
  const contents = JSON.stringify(
    {
      ...BACKUP_FORMAT,
      exportedAt: new Date().toISOString(),
      decks,
      cards: await Promise.all(cards.map(async ({ contentKey: _key, ...card }) => ({ ...card, frontImage: await blobDataUri(card.frontImage), backImage: await blobDataUri(card.backImage) }))),
      reviews,
      settings
    },
    null,
    2
  )
  await setSetting('lastBackupAt', new Date().toISOString())
  return contents
}

function tsvField(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\t/g, ' ')
    .replace(/\r?\n/g, '<br>')
}

const ankiColumns = [
  { label: 'Front', value: (card: CardRecord) => card.front },
  { label: 'Back', value: (card: CardRecord) => card.back },
  { label: 'Tags', value: (card: CardRecord) => card.tags.join(' ') },
  { label: 'Notes', value: (card: CardRecord) => card.notes }
]

export async function makeAnkiTsv(deckId: string): Promise<string> {
  const deck = await db.decks.get(deckId)
  if (!deck) throw new Error('Deck not found.')
  const cards = await db.cards.where('deckId').equals(deckId).toArray()
  if (cards.some((card) => card.frontImage || card.backImage)) throw new Error('Anki text export cannot preserve images. Export a Lumen deck instead.')
  const header = [
    '#separator:Tab',
    '#html:true',
    `#deck:${deck.title}`,
    `#columns:${ankiColumns.map((column) => column.label).join('\t')}`
  ]
  const rows = cards.map((card) =>
    ankiColumns.map((column) => tsvField(column.value(card))).join('\t')
  )
  return [...header, ...rows].join('\n')
}

export type DeckExportFormat = 'lumen' | 'anki'

const deckExportFormats = {
  lumen: {
    encode: async (id: string) => JSON.stringify(await makeDeckPack(id), null, 2),
    suffix: '.lumen.json', mimeType: 'application/json', successMessage: 'Deck exported.'
  },
  anki: {
    encode: makeAnkiTsv,
    suffix: '-anki.txt', mimeType: 'text/plain;charset=utf-8', successMessage: 'Anki file exported.'
  }
} satisfies Record<DeckExportFormat, { encode: (id: string) => Promise<string>; suffix: string; mimeType: string; successMessage: string }>

export async function makeDeckExport(deck: Pick<DeckRecord, 'id' | 'title'>, format: DeckExportFormat) {
  const policy = deckExportFormats[format]
  return {
    contents: await policy.encode(deck.id),
    filename: `${safeFilename(deck.title)}${policy.suffix}`,
    mimeType: policy.mimeType,
    successMessage: policy.successMessage
  }
}

export async function makeLearningReport(deckId?: string): Promise<string> {
  const deck = deckId ? await db.decks.get(deckId) : undefined
  const cards = deckId
    ? await db.cards.where('deckId').equals(deckId).toArray()
    : await db.cards.toArray()
  const ids = new Set(cards.map((card) => card.id))
  const reviews = (await db.reviews.toArray()).filter((review) =>
    ids.has(review.cardId)
  )
  const byCard = new Map<string, { reviews: number; again: number }>()
  for (const review of reviews) {
    const counts = byCard.get(review.cardId) ?? { reviews: 0, again: 0 }
    counts.reviews += 1
    if (review.rating === Rating.Again) counts.again += 1
    byCard.set(review.cardId, counts)
  }
  const difficult = cards
    .map((card) => ({ card, ...(byCard.get(card.id) ?? { reviews: 0, again: 0 }) }))
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
      `- **${entry.card.front || "Image prompt"}** (card ID: ${entry.card.id})`,
      entry.card.frontImage || entry.card.backImage ? "  - This card contains an image. Share the Lumen deck as well so Claude can see it." : "",
      `  - Expected: ${entry.card.back}`,
      `  - Again: ${entry.again}/${entry.reviews}; next due ${new Date(entry.card.due).toLocaleDateString()}`,
      entry.card.notes ? `  - Note: ${entry.card.notes}` : ''
    )
  }
  lines.push(
    '',
    '## Prompt for Claude',
    '',
    learningReport.prompt
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
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([contents], filename, { type })
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    try { await navigator.share({ title, files: [file] }) }
    catch (error) {
      if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return 'cancelled'
      throw error
    }
    return 'shared'
  }
  downloadText(contents, filename, type)
  return 'downloaded'
}

