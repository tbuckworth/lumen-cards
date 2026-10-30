import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useAsyncAction } from '../src/hooks/useAsyncAction'
import { useCardDraft } from '../src/components/CardContentFields'
import { createCard, createDeck, db } from '../src/lib/db'

afterEach(async () => { cleanup(); await db.delete(); await db.open() })

describe('editor hooks', () => {
  it('locks before awaiting or rerendering, releases after success or failure, and reports errors', async () => {
    const { result, rerender } = renderHook(() => useAsyncAction())
    const run = result.current.run
    rerender()
    expect(result.current.run).toBe(run)
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    let calls = 0
    let first!: Promise<void>
    act(() => {
      first = result.current.run(async () => { calls += 1; await pending })
      void result.current.run(async () => { calls += 1 })
      expect(calls).toBe(1)
    })
    expect(result.current.busy).toBe(true)
    expect(result.current.run).toBe(run)
    await act(async () => { finish(); await first })
    expect(result.current.busy).toBe(false)
    await act(async () => { await result.current.run(async () => { throw new Error('Write failed') }) })
    expect(result.current.error).toBe('Write failed')
    expect(result.current.busy).toBe(false)
    await act(async () => { await result.current.run(async () => { calls += 1 }) })
    expect(calls).toBe(2)
    expect(result.current.error).toBe('')
  })

  it('reads its synchronous blocking predicate before changing state or starting an operation', async () => {
    let blocked = false
    let calls = 0
    const { result } = renderHook(() => useAsyncAction(() => blocked))
    await act(async () => { await result.current.run(async () => { throw new Error('Keep this error') }) })
    blocked = true
    await act(async () => { await result.current.run(async () => { calls += 1 }) })
    expect(calls).toBe(0)
    expect(result.current.busy).toBe(false)
    expect(result.current.error).toBe('Keep this error')
    blocked = false
    await act(async () => { await result.current.run(async () => { calls += 1 }) })
    expect(calls).toBe(1)
    expect(result.current.error).toBe('')
  })

  it('validates text-or-image sides and resets all fields to an empty create draft', () => {
    const { result } = renderHook(() => useCardDraft())
    expect(result.current.canSave).toBe(false)
    const image = new Blob(['image bytes'], { type: 'image/png' })
    act(() => result.current.updateDraft({ front: '   ', back: 'Answer', notes: 'Note', tags: 'paper', source: 'source' }))
    expect(result.current.canSave).toBe(false)
    act(() => result.current.updateDraft({ frontImage: image }))
    expect(result.current.canSave).toBe(true)
    act(() => result.current.updateDraft({ back: '', backImage: image }))
    expect(result.current.canSave).toBe(true)
    act(() => result.current.resetDraft())
    expect(result.current.draft).toEqual({ front: '', back: '', notes: '', tags: '', source: '', frontImage: undefined, backImage: undefined })
    expect(result.current.canSave).toBe(false)
  })

  it('keeps an edit draft stable across live-query refreshes and resets to the original seed', async () => {
    const deck = await createDeck('Draft')
    const card = await createCard(deck.id, 'Front', 'Back', { notes: 'Note', tags: ['one', 'two'], source: 'Source' })
    const { result, rerender } = renderHook(({ seed }) => useCardDraft(seed), { initialProps: { seed: card } })
    expect(result.current.draft.tags).toBe('one, two')
    act(() => result.current.updateDraft({ front: 'Edited' }))
    rerender({ seed: { ...card, front: 'Refreshed elsewhere' } })
    expect(result.current.draft.front).toBe('Edited')
    act(() => result.current.resetDraft())
    expect(result.current.draft).toMatchObject({ front: card.front, back: card.back, notes: card.notes, tags: 'one, two', source: card.source })
  })
})
