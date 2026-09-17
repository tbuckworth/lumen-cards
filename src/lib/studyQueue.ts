import { State } from 'ts-fsrs'
import type { CardRecord, ReviewRecord } from '../types'

export type StudyMode = 'due' | 'ahead'

export function hasNewCards(cards: CardRecord[]): boolean {
  return cards.some((card) => !card.suspended && card.fsrs.state === State.New)
}

export function selectStudyQueue(
  cards: CardRecord[],
  todaysReviews: ReviewRecord[],
  dailyNewCards: number,
  now = new Date(),
  mode: StudyMode = 'due'
): CardRecord[] {
  const active = cards.filter((card) => !card.suspended)
  const dueReviews = active
    .filter((card) => card.fsrs.state !== State.New && new Date(card.due) <= now)
    .sort((a, b) => a.due.localeCompare(b.due))
  // The same per-deck allowance applies to deck sessions and the combined Home queue.
  const newStudiedByDeck = new Map<string, number>()
  for (const review of todaysReviews) {
    if (review.state === State.New) {
      newStudiedByDeck.set(review.deckId, (newStudiedByDeck.get(review.deckId) ?? 0) + 1)
    }
  }
  const newCards = active
    .filter((card) => card.fsrs.state === State.New)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .filter((card) => {
      if (mode === 'ahead') return true
      const used = newStudiedByDeck.get(card.deckId) ?? 0
      if (used >= dailyNewCards) return false
      newStudiedByDeck.set(card.deckId, used + 1)
      return true
    })
  return [...dueReviews, ...newCards]
}
