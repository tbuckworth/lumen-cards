import Dexie, { type EntityTable } from 'dexie'
import { createEmptyCard } from 'ts-fsrs'
import {
  DEFAULT_SETTINGS,
  type CardRecord,
  type DeckRecord,
  type ReviewRecord,
  type SettingRecord
} from '../types'
import { serializeFsrsCard } from './scheduler'

export class LumenDatabase extends Dexie {
  decks!: EntityTable<DeckRecord, 'id'>
  cards!: EntityTable<CardRecord, 'id'>
  reviews!: EntityTable<ReviewRecord, 'id'>
  settings!: EntityTable<SettingRecord, 'key'>

  constructor() {
    super('lumen-cards')
    this.version(1).stores({
      decks: 'id, title, updatedAt',
      cards: 'id, deckId, due, [deckId+due], *tags, updatedAt',
      reviews: 'id, cardId, deckId, reviewedAt, [cardId+reviewedAt]',
      settings: 'key'
    })
  }
}

export const db = new LumenDatabase()

export function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`
}

export async function getSetting<T>(key: keyof typeof DEFAULT_SETTINGS): Promise<T> {
  const row = await db.settings.get(key)
  return (row?.value ?? DEFAULT_SETTINGS[key]) as T
}

export async function setSetting(key: keyof typeof DEFAULT_SETTINGS, value: unknown): Promise<void> {
  await db.settings.put({ key, value })
}

export async function createDeck(
  title: string,
  description = '',
  color = '#ae765f'
): Promise<DeckRecord> {
  const now = new Date().toISOString()
  const deck: DeckRecord = {
    id: makeId('deck'),
    title: title.trim(),
    description: description.trim(),
    color,
    createdAt: now,
    updatedAt: now
  }
  await db.decks.add(deck)
  return deck
}

export async function createCard(
  deckId: string,
  front: string,
  back: string,
  options: { notes?: string; tags?: string[]; source?: string; id?: string } = {}
): Promise<CardRecord> {
  const now = new Date()
  const fsrs = serializeFsrsCard(createEmptyCard(now))
  const card: CardRecord = {
    id: options.id ?? makeId('card'),
    deckId,
    front: front.trim(),
    back: back.trim(),
    notes: options.notes?.trim() ?? '',
    tags: options.tags?.map((tag) => tag.trim().toLowerCase()).filter(Boolean) ?? [],
    source: options.source?.trim() || undefined,
    suspended: false,
    due: fsrs.due,
    fsrs,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  }
  await db.cards.add(card)
  return card
}

export async function seedSampleDeck(): Promise<void> {
  const deck = await createDeck(
    'A small beginning',
    'Three cards to show how Lumen works. Delete this deck whenever you like.',
    '#bf9856'
  )
  await Promise.all([
    createCard(deck.id, 'What makes a good flashcard?', 'One clear question testing one idea.', {
      notes: 'Short, specific cards are easier to retrieve and diagnose.',
      tags: ['lumen', 'learning']
    }),
    createCard(deck.id, 'Why recall before rereading?', 'Retrieval strengthens memory and reveals what you do not yet know.', {
      tags: ['lumen', 'learning']
    }),
    createCard(deck.id, 'What do the four review choices mean?', 'Again: missed it. Hard: recalled with difficulty. Good: correct. Easy: effortless.', {
      tags: ['lumen']
    })
  ])
}

export async function deleteDeck(deckId: string): Promise<void> {
  await db.transaction('rw', db.decks, db.cards, db.reviews, async () => {
    await db.cards.where('deckId').equals(deckId).delete()
    await db.reviews.where('deckId').equals(deckId).delete()
    await db.decks.delete(deckId)
  })
}

export async function resetDatabase(): Promise<void> {
  await db.transaction('rw', db.decks, db.cards, db.reviews, db.settings, async () => {
    await Promise.all([db.decks.clear(), db.cards.clear(), db.reviews.clear(), db.settings.clear()])
  })
}
