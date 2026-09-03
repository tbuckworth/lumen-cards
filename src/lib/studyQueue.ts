import { State } from 'ts-fsrs'
import type { CardRecord, ReviewRecord } from '../types'

export function selectStudyQueue(
  cards: CardRecord[],
  todaysReviews: ReviewRecord[],
  dailyNewCards: number,
  now = new Date()
): CardRecord[] {
  const active = cards.filter((card) => !card.suspended)
  const dueReviews = active
    .filter((card) => card.fsrs.state !== State.New && new Date(card.due) <= now)
    .sort((a, b) => a.due.localeCompare(b.due))
  const newStudiedToday = todaysReviews.filter((review) => review.state === State.New).length
  const remainingNew = Math.max(0, dailyNewCards - newStudiedToday)
  const newCards = active
    .filter((card) => card.fsrs.state === State.New)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, remainingNew)
  return [...dueReviews, ...newCards]
}
