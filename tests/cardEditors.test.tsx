import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { File } from 'node:buffer'
import { URL as NodeURL } from 'node:url'
import { Rating, State } from 'ts-fsrs'
import { AddPage } from '../src/pages/AddPage'
import { DecksPage } from '../src/pages/DecksPage'
import { createCard, createDeck, db } from '../src/lib/db'
import { blobDataUri, contentKey, imageBlob, MAX_IMPORT_BYTES } from '../src/lib/images'
import { scheduleReview, serializeFsrsCard } from '../src/lib/scheduler'

const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='
const imageFile = () => new File([Buffer.from(pixel.split(',')[1], 'base64')], 'pixel.png', { type: 'image/png' })

beforeEach(() => {
  // jsdom has no object-URL backend; use Node's real Blob URL implementation.
  vi.stubGlobal('URL', NodeURL)
})
afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  await db.delete()
  await db.open()
})

async function fillAdd() {
  const deck = await createDeck('Chosen deck')
  const notify = vi.fn()
  const navigate = vi.fn()
  const view = render(<AddPage notify={notify} navigate={navigate} />)
  await screen.findByRole('option', { name: deck.title })
  fireEvent.change(screen.getByLabelText('Question or prompt'), { target: { value: '  Prompt  ' } })
  fireEvent.change(screen.getByLabelText('Answer'), { target: { value: ' Answer ' } })
  fireEvent.click(screen.getByText('Notes, tags & source'))
  fireEvent.change(screen.getByLabelText('Extra note'), { target: { value: ' Note ' } })
  fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'Paper, methods' } })
  fireEvent.change(screen.getByLabelText('Source'), { target: { value: ' doi:source ' } })
  return { ...view, deck, notify, navigate }
}

async function attach(side: 'Front' | 'Back') {
  fireEvent.change(screen.getByLabelText(`${side} image (optional)`), { target: { files: [imageFile()] } })
  await screen.findByRole('button', { name: `Remove ${side.toLowerCase()} image` })
}

async function openEditor() {
  const deck = await createDeck('Reviewed deck')
  const card = await createCard(deck.id, 'Original prompt', 'Original answer', { source: 'doi:original', notes: 'Old note', tags: ['old'] })
  const scheduled = scheduleReview(card, Rating.Good, new Date('2026-10-29T09:00:00.000Z'))
  const fsrs = serializeFsrsCard(scheduled.card)
  await db.cards.update(card.id, { fsrs, due: fsrs.due })
  await db.reviews.add({ id: 'history', cardId: card.id, deckId: deck.id, rating: Rating.Good, state: State.New, reviewedAt: card.createdAt, durationMs: 30, scheduledDays: 1, elapsedDays: 0 })
  const notify = vi.fn()
  render(<DecksPage notify={notify} navigate={() => {}} startReview={() => {}} />)
  fireEvent.click((await screen.findByText(deck.title)).closest('button')!)
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Original prompt' }))
  return { card: (await db.cards.get(card.id))!, notify }
}

describe('card editor behavior', () => {
  it('creates once, preserves content and fresh scheduling, then clears the whole draft and keeps its deck', async () => {
    const { container, deck, notify, navigate } = await fillAdd()
    expect(screen.getByLabelText('Source').closest('details')).not.toBeNull()
    expect(screen.getByLabelText('Question or prompt')).toHaveAttribute('placeholder', 'What do I want to remember?')
    await attach('Front')
    await attach('Back')
    act(() => {
      fireEvent.submit(container.querySelector('form')!)
      fireEvent.submit(container.querySelector('form')!)
    })
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Card added.'))
    expect(notify).toHaveBeenCalledTimes(1)
    expect(navigate).not.toHaveBeenCalled()
    const cards = await db.cards.toArray()
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ deckId: deck.id, front: 'Prompt', back: 'Answer', notes: 'Note', tags: ['paper', 'methods'], source: 'doi:source', fsrs: { state: State.New, reps: 0 } })
    expect(await blobDataUri(cards[0].frontImage)).toBe(pixel)
    expect(await blobDataUri(cards[0].backImage)).toBe(pixel)
    for (const label of ['Question or prompt', 'Answer', 'Extra note', 'Tags', 'Source']) expect(screen.getByLabelText(label)).toHaveValue('')
    expect(screen.queryByRole('button', { name: /Remove .* image/ })).toBeNull()
    expect(screen.getByLabelText('Deck')).toHaveValue(deck.id)
    expect(screen.getByRole('button', { name: 'Add card' })).toBeDisabled()
  })

  it('retains every draft value and image after a failed storage write, then permits a retry', async () => {
    const { container, notify } = await fillAdd()
    await attach('Front')
    await attach('Back')
    // The IndexedDB emulator cannot exhaust browser quota; inject that failure at the real Dexie write boundary.
    const rejectWrite = () => { throw new DOMException('Storage quota exhausted', 'QuotaExceededError') }
    db.cards.hook('creating', rejectWrite)
    try {
      fireEvent.submit(container.querySelector('form')!)
      expect(await screen.findByRole('alert')).toHaveTextContent(/storage|quota/i)
      expect(await db.cards.count()).toBe(0)
      expect(notify).not.toHaveBeenCalled()
      for (const [label, value] of [['Question or prompt', '  Prompt  '], ['Answer', ' Answer '], ['Extra note', ' Note '], ['Tags', 'Paper, methods'], ['Source', ' doi:source ']]) expect(screen.getByLabelText(label)).toHaveValue(value)
      expect(screen.getAllByRole('button', { name: /Remove .* image/ })).toHaveLength(2)
    } finally { db.cards.hook('creating').unsubscribe(rejectWrite) }
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Card added.'))
    expect(await db.cards.count()).toBe(1)
  })

  it('edits once without exposing or rewriting source, schedule, identity or review history', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-29T09:00:00.000Z'))
    const { card, notify } = await openEditor()
    const reviews = await db.reviews.toArray()
    const changes: object[] = []
    const capture = (update: object) => { changes.push(update) }
    db.cards.hook('updating', capture)
    try {
      expect(screen.queryByLabelText('Source')).toBeNull()
      expect(screen.getByLabelText('Extra note').closest('details')).toBeNull()
      fireEvent.change(screen.getByLabelText('Front'), { target: { value: ' Revised prompt ' } })
      fireEvent.change(screen.getByLabelText('Back'), { target: { value: ' Revised answer ' } })
      fireEvent.change(screen.getByLabelText('Extra note'), { target: { value: ' Revised note ' } })
      fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'New, Tag' } })
      await attach('Front')
      await attach('Back')
      const now = new Date('2026-10-30T09:00:00.000Z')
      vi.setSystemTime(now)
      const form = screen.getByRole('button', { name: 'Save card' }).closest('form')!
      act(() => { fireEvent.submit(form); fireEvent.submit(form) })
      await waitFor(() => expect(notify).toHaveBeenCalledWith('Card saved.'))
      const saved = (await db.cards.get(card.id))!
      expect(saved).toEqual({ ...card, front: 'Revised prompt', back: 'Revised answer', notes: 'Revised note', tags: ['new', 'tag'], frontImage: saved.frontImage, backImage: saved.backImage, contentKey: await contentKey('Revised prompt', imageBlob(pixel), imageBlob(pixel)), updatedAt: now.toISOString() })
      expect(await blobDataUri(saved.frontImage)).toBe(pixel)
      expect(await blobDataUri(saved.backImage)).toBe(pixel)
      expect(await db.reviews.toArray()).toEqual(reviews)
      expect(changes).toHaveLength(1)
      expect(changes[0]).not.toHaveProperty('source')
      expect(notify).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('dialog', { name: 'Edit card' })).toBeNull()
    } finally { db.cards.hook('updating').unsubscribe(capture) }
  })

  it.each(['create', 'edit'] as const)('requires content on both %s sides and accepts image-only sides', async (mode) => {
    const { notify } = mode === 'create' ? await fillAdd() : await openEditor()
    const front = screen.getByLabelText(mode === 'create' ? 'Question or prompt' : 'Front')
    const back = screen.getByLabelText(mode === 'create' ? 'Answer' : 'Back')
    fireEvent.change(front, { target: { value: '' } })
    fireEvent.change(back, { target: { value: '' } })
    const form = front.closest('form')!
    expect(form.checkValidity()).toBe(false)
    await attach('Front')
    expect(front).not.toBeRequired()
    expect(back).toBeRequired()
    expect(form.checkValidity()).toBe(false)
    await attach('Back')
    expect(form.checkValidity()).toBe(true)
    fireEvent.submit(form)
    await waitFor(() => expect(notify).toHaveBeenCalledWith(mode === 'create' ? 'Card added.' : 'Card saved.'))
    expect((await db.cards.toArray())[0]).toMatchObject({ front: '', back: '' })
  })

  it('releases the image guard after a failed file read and shows its error', async () => {
    const { container, notify } = await fillAdd()
    const file = imageFile()
    // Browser file-read failure is unavailable in jsdom; fail only the real File I/O boundary.
    vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('File could not be read'))
    fireEvent.change(screen.getByLabelText('Front image (optional)'), { target: { files: [file] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('File could not be read')
    expect(screen.getByRole('button', { name: 'Add card' })).toBeEnabled()
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Card added.'))
    expect((await db.cards.toArray())[0].frontImage).toBeUndefined()
  })

  it.each(['create', 'edit'] as const)('blocks an immediate %s submission while the image read is pending', async (mode) => {
    if (mode === 'create') await fillAdd()
    else await openEditor()
    const before = await db.cards.toArray()
    const file = imageFile()
    const originalRead = file.arrayBuffer.bind(file)
    let release!: (bytes: ArrayBuffer) => void
    const button = screen.getByRole('button', { name: mode === 'create' ? 'Add card' : 'Save card' })
    // Hold the real File I/O boundary; jsdom cannot reproduce a slow browser file read itself.
    vi.spyOn(file, 'arrayBuffer').mockImplementation(() => {
      // Submit reentrantly before React commits the image-busy state update.
      fireEvent.submit(button.closest('form')!)
      return new Promise((resolve) => { release = resolve })
    })
    const input = screen.getByLabelText('Front image (optional)')
    try {
      fireEvent.change(input, { target: { files: [file] } })
      expect(button).toBeInTheDocument()
      expect(screen.queryByText('Saving… Keep Lumen open until this finishes.')).toBeNull()
      await act(async () => { await Promise.resolve() })
      expect(await db.cards.toArray()).toEqual(before)
    } finally {
      await act(async () => { release(await originalRead()) })
    }
    await screen.findByRole('button', { name: 'Remove front image' })
  })

  it.each(['Pause', 'Delete'])('blocks immediate edit %s and close actions while an image read is pending', async (action) => {
    const { card, notify } = await openEditor()
    const before = await db.cards.toArray()
    const reviews = await db.reviews.toArray()
    const file = imageFile()
    const originalRead = file.arrayBuffer.bind(file)
    let release!: (bytes: ArrayBuffer) => void
    // Browser file timing and the native confirmation dialog are unavailable in jsdom.
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(file, 'arrayBuffer').mockImplementation(() => {
      fireEvent.click(screen.getByRole('button', { name: action }))
      fireEvent.keyDown(document, { key: 'Escape' })
      return new Promise((resolve) => { release = resolve })
    })
    fireEvent.change(screen.getByLabelText('Front image (optional)'), { target: { files: [file] } })
    try {
      await act(async () => { await Promise.resolve() })
      expect(await db.cards.toArray()).toEqual(before)
      expect(await db.reviews.toArray()).toEqual(reviews)
      expect(screen.getByRole('dialog', { name: 'Edit card' })).toBeInTheDocument()
      expect(confirm).not.toHaveBeenCalled()
      expect(notify).not.toHaveBeenCalled()
    } finally { await act(async () => { release(await originalRead()) }) }
    await waitFor(() => expect(screen.getByRole('button', { name: action })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: action }))
    await waitFor(() => expect(notify).toHaveBeenCalledWith(action === 'Pause' ? 'Card paused.' : 'Card deleted.'))
    if (action === 'Pause') expect((await db.cards.get(card.id))?.suspended).toBe(true)
    else { expect(await db.cards.count()).toBe(0); expect(await db.reviews.count()).toBe(0) }
  })

  it.each(['paste', 'file'])('runs an immediate repeated %s import once with one notification and navigation', async (mode) => {
    const { container, notify, navigate } = await fillAdd()
    fireEvent.click(screen.getByRole('tab', { name: 'Import' }))
    const raw = JSON.stringify({ title: 'Imported', cards: [{ front: 'Imported front', back: 'Imported back' }] })
    const paste = screen.getByLabelText('Paste deck JSON or tab-separated cards')
    fireEvent.change(paste, { target: { value: raw } })
    const file = new File([raw], 'deck.json', { type: 'application/json' })
    const input = container.querySelector('.file-drop input')!
    act(() => {
      if (mode === 'paste') {
        fireEvent.click(screen.getByRole('button', { name: 'Import pasted cards' }))
        fireEvent.click(screen.getByRole('button', { name: 'Import pasted cards' }))
      } else {
        fireEvent.change(input, { target: { files: [file] } })
        fireEvent.change(input, { target: { files: [file] } })
      }
    })
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('decks'))
    expect(notify).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(await db.cards.count()).toBe(1)
    if (mode === 'paste') expect(paste).toHaveValue('')
  })

  it('keeps failed pasted input and checks file size before reading file contents', async () => {
    const { container, notify, navigate } = await fillAdd()
    fireEvent.click(screen.getByRole('tab', { name: 'Import' }))
    const paste = screen.getByLabelText('Paste deck JSON or tab-separated cards')
    fireEvent.change(paste, { target: { value: 'Front,Back\nIncomplete,' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import pasted cards' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Row 2')
    expect(paste).toHaveValue('Front,Back\nIncomplete,')
    const file = new File([' '.repeat(MAX_IMPORT_BYTES + 1)], 'large.json')
    const read = vi.spyOn(file, 'text')
    fireEvent.change(container.querySelector('.file-drop input')!, { target: { files: [file] } })
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('100 MB'))
    expect(read).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
    expect(await db.cards.count()).toBe(0)
  })
})
