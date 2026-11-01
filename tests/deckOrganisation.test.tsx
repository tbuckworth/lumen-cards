import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createCard, createDeck, db } from '../src/lib/db'
import { DecksPage } from '../src/pages/DecksPage'

afterEach(async () => {
  cleanup()
  await db.delete()
  await db.open()
})

function renderDecks() {
  const started: (string | undefined)[] = []
  render(<DecksPage notify={() => {}} navigate={() => {}} startReview={(deckId) => started.push(deckId)} />)
  return started
}

describe('deck organisation', () => {
  it('lists named groups alphabetically, then ungrouped decks, and has no headings without groups', async () => {
    const loose = await createDeck('Loose notes')
    renderDecks()
    await screen.findByText(loose.title)
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()

    const muscles = await createDeck('Muscles')
    const month = await createDeck('This month')
    await db.decks.update(muscles.id, { group: 'Anatomy & Physiology' })
    await db.decks.update(month.id, { group: 'Materia Medica' })
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent))
      .toEqual(['Anatomy & Physiology', 'Materia Medica', 'Other decks']))
    expect(within(screen.getByRole('region', { name: 'Materia Medica' })).getByText('This month')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Other decks' })).getByText('Loose notes')).toBeTruthy()
  })

  it('saves a tag filter that narrows the deck count and sessions', async () => {
    const deck = await createDeck('Materia medica')
    await createCard(deck.id, 'Burdock part used', 'Root', { tags: ['batch-oct'] })
    await createCard(deck.id, 'Nettle part used', 'Leaf', { tags: ['batch-nov', 'examinable'] })
    await createCard(deck.id, 'Yarrow part used', 'Aerial parts', { tags: ['batch-nov'] })
    await createCard(deck.id, 'Lime flower part used', 'Flower', { tags: ['y2-botany'] })
    const started = renderDecks()
    fireEvent.click((await screen.findByText(deck.title)).closest('button')!)
    expect(await screen.findByText('Choose tags to narrow this deck’s sessions. Today still includes every card.')).toBeTruthy()
    await screen.findByRole('button', { name: 'Study 4 due' })

    fireEvent.click(screen.getByRole('button', { name: /#batch-nov/ }))
    await screen.findByRole('button', { name: 'Study 2 due' })
    expect(screen.getByText('Studying only #batch-nov')).toBeTruthy()
    expect(screen.getByText("This deck's sessions use 2 of 4 cards. Today still includes every card.")).toBeTruthy()
    expect(screen.getByRole('button', { name: /#batch-nov/ }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'All except these' }))
    await screen.findByRole('button', { name: 'Study 2 due' })
    fireEvent.click(screen.getByRole('button', { name: /#y2-botany/ }))
    await screen.findByRole('button', { name: 'Study 1 due' })
    expect(screen.getByText('Studying all except #batch-nov, #y2-botany')).toBeTruthy()
    expect((await db.decks.get(deck.id))?.studyTags).toEqual({ mode: 'except', tags: ['batch-nov', 'y2-botany'] })

    fireEvent.click(screen.getByRole('button', { name: 'Study 1 due' }))
    expect(started).toEqual([deck.id])
    fireEvent.click(screen.getByRole('button', { name: '← Decks' }))
    expect(await screen.findByText('1 due')).toBeTruthy()
  })
})
