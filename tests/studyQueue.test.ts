import { describe, expect, it } from 'vitest'
import { Rating, State, createEmptyCard } from 'ts-fsrs'
import type { CardRecord, ReviewRecord } from '../src/types'
import { serializeFsrsCard } from '../src/lib/scheduler'
import { selectStudyQueue } from '../src/lib/studyQueue'

function newCard(index: number): CardRecord {
  const fsrs = serializeFsrsCard(createEmptyCard(new Date('2026-09-03T09:00:00Z')))
  return {
    id: `card-${index}`,
    deckId: 'deck',
    front: `Question ${index}`,
    back: `Answer ${index}`,
    notes: '',
    tags: [],
    suspended: false,
    due: fsrs.due,
    fsrs,
    createdAt: new Date(2026, 8, 3, 9, index).toISOString(),
    updatedAt: new Date(2026, 8, 3, 9, index).toISOString()
  }
}

describe('study queue', () => {
  it('never advertises more new cards than the daily limit can serve', () => {
    const cards = Array.from({ length: 30 }, (_, index) => newCard(index))
    expect(selectStudyQueue(cards, [], 20)).toHaveLength(20)
  })

  it('accounts for new cards already studied today', () => {
    const review: ReviewRecord = {
      id: 'review',
      cardId: 'other',
      deckId: 'deck',
      rating: Rating.Good,
      state: State.New,
      reviewedAt: new Date().toISOString(),
      durationMs: 1000,
      scheduledDays: 0,
      elapsedDays: 0
    }
    expect(selectStudyQueue([newCard(1), newCard(2)], [review], 1)).toHaveLength(0)
  })
})
