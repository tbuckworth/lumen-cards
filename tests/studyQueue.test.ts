import { describe, expect, it } from 'vitest'
import { Rating, State, createEmptyCard } from 'ts-fsrs'
import type { CardRecord, ReviewRecord } from '../src/types'
import { scheduleReview, serializeFsrsCard } from '../src/lib/scheduler'
import { hasNewCards, selectStudyQueue, shuffleStudyQueue } from '../src/lib/studyQueue'

const now = new Date('2026-09-03T12:00:00Z')

// Small deterministic generator so shuffle tests are repeatable.
function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

function review(deckId: string, state = State.New): ReviewRecord {
  return {
    id: `review-${deckId}`, cardId: 'already-studied', deckId,
    rating: Rating.Good, state, reviewedAt: now.toISOString(),
    durationMs: 1000, scheduledDays: 0, elapsedDays: 0
  }
}

function scheduledCard(index: number, due: string, state = State.Review): CardRecord {
  const card = newCard(index)
  return { ...card, due, fsrs: { ...card.fsrs, state, due, reps: 1 } }
}

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

  it('keeps each deck’s allowance independent, including a combined queue', () => {
    const anatomy = { ...newCard(1), deckId: 'anatomy' }
    const botany = [newCard(2), newCard(3)]
    const review: ReviewRecord = {
      id: 'review', cardId: 'already-studied', deckId: 'anatomy',
      rating: Rating.Good, state: State.New, reviewedAt: new Date().toISOString(),
      durationMs: 1000, scheduledDays: 0, elapsedDays: 0
    }
    expect(selectStudyQueue(botany, [review], 1)).toEqual([botany[0]])
    expect(selectStudyQueue([anatomy, ...botany], [review], 1)).toEqual([botany[0]])
    expect(selectStudyQueue([anatomy, ...botany], [], 1)).toEqual([anatomy, botany[0]])
  })

  it('subtracts each deck’s new reviews, without counting learning or review repetitions', () => {
    const cards = [newCard(1), newCard(2), ...[3, 4, 5].map((i) => ({ ...newCard(i), deckId: 'botany' }))]
    const reviews = [review('deck'), review('deck', State.Learning), review('deck', State.Review), review('botany')]
    expect(selectStudyQueue(cards, reviews, 2, now)).toEqual([cards[0], cards[2]])
  })

  it('serves overdue reviews and learning cards even when the new-card allowance is exhausted', () => {
    const overdue = scheduledCard(1, '2026-09-02T12:00:00Z')
    const learning = scheduledCard(2, now.toISOString(), State.Learning)
    const future = scheduledCard(3, '2026-09-04T12:00:00Z')
    const paused = { ...overdue, id: 'paused', suspended: true }
    expect(selectStudyQueue([newCard(4), future, learning, paused, overdue], [review('deck')], 1, now))
      .toEqual([overdue, learning])
  })

  it('studies every remaining active new card ahead in creation order without pulling future reviews forward', () => {
    const cards = Array.from({ length: 60 }, (_, i) => newCard(i))
    const paused = { ...newCard(60), suspended: true }
    const future = scheduledCard(61, '2026-09-04T12:00:00Z')
    const source = [future, paused, ...[...cards].reverse()]
    const before = structuredClone(source)
    const selected = selectStudyQueue(source, [review('deck'), review('deck')], 1, now, 'ahead')
    expect(selected).toEqual(cards)
    expect(source).toEqual(before)
    expect(selectStudyQueue(source, [review('deck')], 1, now)).toEqual([])
    // Ahead selection passes the original card through the ordinary FSRS grading path.
    for (const rating of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const) {
      expect(scheduleReview(selected[0], rating, now)).toEqual(scheduleReview(cards[0], rating, now))
    }
  })

  it('keeps reviews that become due available during study ahead', () => {
    const due = scheduledCard(1, now.toISOString())
    expect(selectStudyQueue([newCard(2), due], [], 0, now, 'ahead')).toEqual([newCard(2), due])
  })

  it('puts the day’s new cards before recall, in both modes', () => {
    const overdue = scheduledCard(1, '2026-09-02T12:00:00Z')
    const learning = scheduledCard(2, now.toISOString(), State.Learning)
    const fresh = [newCard(3), newCard(4)]
    for (const mode of ['due', 'ahead'] as const) {
      expect(selectStudyQueue([learning, fresh[1], overdue, fresh[0]], [], 20, now, mode))
        .toEqual([...fresh, overdue, learning])
    }
  })

  it('shuffles a session without changing which cards are in it or putting recall before new cards', () => {
    const fresh = Array.from({ length: 12 }, (_, i) => newCard(i))
    const recall = Array.from({ length: 12 }, (_, i) => scheduledCard(20 + i, new Date(2026, 8, 1, 9, i).toISOString()))
    const queue = selectStudyQueue([...recall, ...fresh], [], 20, now)
    const before = structuredClone(queue)
    const ids = (cards: CardRecord[]) => cards.map((card) => card.id)
    const orders = new Set<string>()
    for (let seed = 1; seed <= 20; seed++) {
      const shuffled = shuffleStudyQueue(queue, seeded(seed))
      expect(ids(shuffled.slice(0, 12)).sort()).toEqual(ids(fresh).sort())
      expect(ids(shuffled.slice(12)).sort()).toEqual(ids(recall).sort())
      // Cards are passed through untouched, so grading and FSRS scheduling are unchanged.
      for (const card of shuffled) expect(card).toBe(queue.find((original) => original.id === card.id))
      orders.add(ids(shuffled).join())
    }
    expect(queue).toEqual(before)
    expect(orders.size).toBe(20)
    expect(orders.has(ids(queue).join())).toBe(false)
  })

  it('shuffles uniformly enough that no position is predictable', () => {
    const cards = Array.from({ length: 4 }, (_, i) => newCard(i))
    const random = seeded(42)
    const firstCounts = new Map<string, number>()
    for (let run = 0; run < 4000; run++) {
      const first = shuffleStudyQueue(cards, random)[0].id
      firstCounts.set(first, (firstCounts.get(first) ?? 0) + 1)
    }
    for (const card of cards) expect(firstCounts.get(card.id)).toBeGreaterThan(850)
  })

  it('only offers study ahead for active unseen cards', () => {
    expect(hasNewCards([])).toBe(false)
    expect(hasNewCards([{ ...newCard(1), suspended: true }, scheduledCard(2, now.toISOString())])).toBe(false)
    expect(hasNewCards([newCard(1)])).toBe(true)
  })
})
