import { describe, expect, it } from 'vitest'
import { calculateStreak } from '../src/lib/dates'

describe('review streak', () => {
  it('continues through today', () => {
    const now = new Date(2026, 8, 3, 15)
    expect(calculateStreak([
      new Date(2026, 8, 1, 9).toISOString(),
      new Date(2026, 8, 2, 9).toISOString(),
      new Date(2026, 8, 3, 9).toISOString()
    ], now)).toBe(3)
  })

  it('allows today to be unfinished without losing yesterday’s streak', () => {
    const now = new Date(2026, 8, 3, 8)
    expect(calculateStreak([
      new Date(2026, 8, 1, 9).toISOString(),
      new Date(2026, 8, 2, 9).toISOString()
    ], now)).toBe(2)
  })
})
