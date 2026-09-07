import type { Grade, State } from 'ts-fsrs'

export type Route = 'home' | 'decks' | 'add' | 'settings' | 'review'

export interface DeckRecord {
  id: string
  title: string
  description: string
  color: string
  createdAt: string
  updatedAt: string
}

export interface StoredFsrsCard {
  due: string
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  state: State
  last_review?: string
}

export interface StoredImage { type: string; data: ArrayBuffer }
export type CardImageData = Blob | StoredImage

export interface CardRecord {
  frontImage?: CardImageData
  backImage?: CardImageData
  contentKey?: string
  id: string
  deckId: string
  front: string
  back: string
  notes: string
  tags: string[]
  source?: string
  suspended: boolean
  due: string
  fsrs: StoredFsrsCard
  createdAt: string
  updatedAt: string
}

export interface ReviewRecord {
  id: string
  cardId: string
  deckId: string
  rating: Grade
  state: State
  reviewedAt: string
  durationMs: number
  scheduledDays: number
  elapsedDays: number
}

export interface SettingRecord {
  key: string
  value: unknown
}

export interface LumenContentCard {
  frontImage?: string
  backImage?: string
  id?: string
  front: string
  back: string
  notes?: string
  tags?: string[]
  source?: string
}

export interface LumenDeckPack {
  format: 'lumen-deck'
  version: 1
  createdAt?: string
  deck: {
    id?: string
    title: string
    description?: string
    color?: string
    cards: LumenContentCard[]
  }
}

export interface ImportResult {
  decksAdded: number
  cardsAdded: number
  cardsUpdated: number
  cardsSkipped: number
  deckId?: string
}

export const DECK_COLORS = ['#ae765f', '#72806f', '#bf9856', '#76858e', '#8f7585'] as const

export const DEFAULT_SETTINGS = {
  onboardingComplete: false,
  desiredRetention: 0.9,
  dailyNewCards: 20,
  lastBackupAt: null as string | null
}
