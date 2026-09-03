import { describe, expect, it } from 'vitest'
import { Rating, State, createEmptyCard } from 'ts-fsrs'
import { deserializeFsrsCard, formatInterval, makeScheduler, serializeFsrsCard } from '../src/lib/scheduler'

describe('FSRS scheduling', () => {
  it('round-trips cards through IndexedDB-safe dates', () => {
    const now = new Date('2026-09-03T09:00:00.000Z')
    const source = createEmptyCard(now)
    const restored = deserializeFsrsCard(serializeFsrsCard(source))
    expect(restored.due).toEqual(now)
    expect(restored.state).toBe(State.New)
  })

  it('offers all four outcomes and advances a correct new card', () => {
    const now = new Date('2026-09-03T09:00:00.000Z')
    const scheduler = makeScheduler(0.9)
    const card = createEmptyCard(now)
    const preview = scheduler.repeat(card, now)
    expect(preview[Rating.Again].card.due.getTime()).toBeGreaterThan(now.getTime())
    expect(preview[Rating.Easy].card.due.getTime()).toBeGreaterThan(preview[Rating.Good].card.due.getTime())
    const result = scheduler.next(card, now, Rating.Good)
    expect(result.card.reps).toBe(1)
    expect(result.card.state).not.toBe(State.New)
  })

  it('formats short and long intervals for review buttons', () => {
    const now = new Date('2026-09-03T09:00:00.000Z')
    expect(formatInterval(new Date('2026-09-03T09:01:00.000Z'), now)).toBe('1m')
    expect(formatInterval(new Date('2026-09-06T09:00:00.000Z'), now)).toBe('3d')
    expect(formatInterval(new Date('2027-09-03T09:00:00.000Z'), now)).toBe('1y')
  })
})
