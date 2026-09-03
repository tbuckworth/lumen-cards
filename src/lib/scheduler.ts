import {
  Rating,
  createEmptyCard,
  fsrs,
  type Card,
  type Grade,
  type RecordLogItem
} from 'ts-fsrs'
import type { CardRecord, StoredFsrsCard } from '../types'

export const RATINGS = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const

export const RATING_LABELS: Record<number, string> = {
  [Rating.Again]: 'Again',
  [Rating.Hard]: 'Hard',
  [Rating.Good]: 'Good',
  [Rating.Easy]: 'Easy'
}

export function serializeFsrsCard(card: Card): StoredFsrsCard {
  return {
    ...card,
    due: card.due.toISOString(),
    last_review: card.last_review?.toISOString()
  }
}

export function deserializeFsrsCard(card?: StoredFsrsCard): Card {
  if (!card) return createEmptyCard(new Date())
  return {
    ...card,
    due: new Date(card.due),
    last_review: card.last_review ? new Date(card.last_review) : undefined
  }
}

export function makeScheduler(desiredRetention = 0.9) {
  return fsrs({
    request_retention: desiredRetention,
    maximum_interval: 36500,
    enable_fuzz: true,
    enable_short_term: true,
    learning_steps: ['1m', '10m'],
    relearning_steps: ['10m']
  })
}

export function previewRatings(
  card: CardRecord,
  now = new Date(),
  desiredRetention = 0.9
): RecordLogItem[] {
  const result = makeScheduler(desiredRetention).repeat(deserializeFsrsCard(card.fsrs), now)
  return RATINGS.map((rating) => result[rating])
}

export function scheduleReview(
  card: CardRecord,
  rating: Grade,
  now = new Date(),
  desiredRetention = 0.9
): RecordLogItem {
  return makeScheduler(desiredRetention).next(deserializeFsrsCard(card.fsrs), now, rating)
}

export function formatInterval(due: Date, from = new Date()): string {
  const seconds = Math.max(0, Math.round((due.getTime() - from.getTime()) / 1000))
  if (seconds < 5400) return `${Math.max(1, Math.round(seconds / 60))}m`
  const hours = seconds / 3600
  if (hours < 36) return `${Math.round(hours)}h`
  const days = hours / 24
  if (days < 60) return `${Math.round(days)}d`
  const months = days / 30.44
  if (months < 11) return `${Math.round(months)}mo`
  return `${Math.round(days / 365.25)}y`
}

export function isDue(card: CardRecord, at = new Date()): boolean {
  return !card.suspended && new Date(card.due).getTime() <= at.getTime()
}
