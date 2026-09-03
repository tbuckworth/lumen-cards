import { Archive, Download, MoreHorizontal, Pause, Pencil, Play, Search, Share2, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { EmptyState } from '../components/EmptyState'
import { Modal } from '../components/Modal'
import { db, deleteDeck } from '../lib/db'
import { getSetting } from '../lib/db'
import { downloadText, makeAnkiTsv, makeDeckPack, makeLearningReport, safeFilename, shareTextFile } from '../lib/importExport'
import { startOfLocalDay } from '../lib/dates'
import { selectStudyQueue } from '../lib/studyQueue'
import type { CardRecord, DeckRecord, Route } from '../types'

type Notice = (message: string) => void

export function DecksPage({
  navigate,
  startReview,
  notify
}: {
  navigate: (route: Route) => void
  startReview: (deckId?: string) => void
  notify: Notice
}) {
  const data = useLiveQuery(async () => ({
    decks: await db.decks.orderBy('updatedAt').reverse().toArray(),
    cards: await db.cards.toArray(),
    todaysReviews: await db.reviews.where('reviewedAt').aboveOrEqual(startOfLocalDay().toISOString()).toArray(),
    dailyNewCards: await getSetting<number>('dailyNewCards')
  }), [], { decks: [], cards: [], todaysReviews: [], dailyNewCards: 20 })
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<CardRecord | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const selectedDeck = data.decks.find((deck) => deck.id === selectedDeckId)
  const selectedCards = useMemo(() => {
    const query = search.trim().toLowerCase()
    return data.cards
      .filter((card) => card.deckId === selectedDeckId)
      .filter((card) => !query || `${card.front} ${card.back} ${card.tags.join(' ')}`.toLowerCase().includes(query))
  }, [data.cards, search, selectedDeckId])

  if (selectedDeck) {
    const allDeckCards = data.cards.filter((card) => card.deckId === selectedDeck.id)
    const due = selectStudyQueue(allDeckCards, data.todaysReviews, data.dailyNewCards).length
    return (
      <div className="page">
        <header className="page-header deck-detail-header">
          <button className="back-button" type="button" onClick={() => { setSelectedDeckId(null); setMenuOpen(false) }}>← Decks</button>
          <button className="icon-button" type="button" onClick={() => setMenuOpen((value) => !value)} aria-label="Deck options">
            <MoreHorizontal />
          </button>
          {menuOpen && (
            <DeckMenu deck={selectedDeck} notify={notify} onDeleted={() => setSelectedDeckId(null)} />
          )}
        </header>
        <section className="deck-hero" style={{ '--deck-color': selectedDeck.color } as React.CSSProperties}>
          <span className="deck-hero__orb" />
          <p className="eyebrow">{selectedCards.length} {selectedCards.length === 1 ? 'card' : 'cards'}</p>
          <h1>{selectedDeck.title}</h1>
          {selectedDeck.description && <p>{selectedDeck.description}</p>}
          <button className="button button--ink" type="button" disabled={!due} onClick={() => startReview(selectedDeck.id)}>
            {due ? `Study ${due} due` : 'Nothing due'}
          </button>
        </section>

        <label className="search-field">
          <Search size={18} />
          <span className="sr-only">Search cards</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this deck" />
        </label>

        <div className="card-list">
          {selectedCards.map((card) => (
            <article className={`library-card ${card.suspended ? 'is-suspended' : ''}`} key={card.id}>
              <div>
                <p>{card.front}</p>
                <span>{card.back}</span>
                {!!card.tags.length && <small>{card.tags.map((tag) => `#${tag}`).join('  ')}</small>}
              </div>
              <button className="icon-button" type="button" onClick={() => setEditing(card)} aria-label={`Edit ${card.front}`}>
                <Pencil size={17} />
              </button>
            </article>
          ))}
        </div>
        <button className="floating-add" type="button" onClick={() => navigate('add')} aria-label="Add a card">+</button>
        {editing && <EditCardModal card={editing} onClose={() => setEditing(null)} notify={notify} />}
      </div>
    )
  }

  if (!data.decks.length) {
    return (
      <div className="page">
        <header className="page-header"><div><p className="eyebrow">Your library</p><h1>Decks</h1></div></header>
        <EmptyState icon={Archive} title="A quiet shelf" action={<button className="button button--primary" onClick={() => navigate('add')}>Create your first deck</button>}>
          Your decks will live here. Each can hold cards from Claude, Anki, or your own notes.
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="page">
      <header className="page-header"><div><p className="eyebrow">Your library</p><h1>Decks</h1></div></header>
      <div className="deck-list">
        {data.decks.map((deck) => {
          const cards = data.cards.filter((card) => card.deckId === deck.id)
          const due = selectStudyQueue(cards, data.todaysReviews, data.dailyNewCards).length
          return (
            <button className="deck-row" type="button" key={deck.id} onClick={() => setSelectedDeckId(deck.id)}>
              <span className="deck-row__swatch" style={{ backgroundColor: deck.color }} />
              <span className="deck-row__main"><strong>{deck.title}</strong><small>{cards.length} {cards.length === 1 ? 'card' : 'cards'}</small></span>
              <span className={due ? 'due-pill' : 'due-pill due-pill--quiet'}>{due ? `${due} due` : 'Resting'}</span>
              <span aria-hidden="true">›</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function DeckMenu({ deck, notify, onDeleted }: { deck: DeckRecord; notify: Notice; onDeleted: () => void }) {
  async function exportLumen() {
    const pack = await makeDeckPack(deck.id)
    downloadText(JSON.stringify(pack, null, 2), `${safeFilename(deck.title)}.lumen.json`)
    notify('Deck exported.')
  }

  async function exportAnki() {
    downloadText(await makeAnkiTsv(deck.id), `${safeFilename(deck.title)}-anki.txt`, 'text/plain;charset=utf-8')
    notify('Anki file exported.')
  }

  async function shareReport() {
    const report = await makeLearningReport(deck.id)
    const result = await shareTextFile(report, `${safeFilename(deck.title)}-learning-report.md`, `${deck.title} learning report`)
    notify(result === 'shared' ? 'Ready to share.' : 'Report downloaded.')
  }

  async function remove() {
    if (!window.confirm(`Delete “${deck.title}” and all of its cards? This cannot be undone.`)) return
    await deleteDeck(deck.id)
    onDeleted()
    notify('Deck deleted.')
  }

  return (
    <div className="popover-menu">
      <button type="button" onClick={exportLumen}><Download size={17} /> Export Lumen deck</button>
      <button type="button" onClick={exportAnki}><Download size={17} /> Export for Anki</button>
      <button type="button" onClick={shareReport}><Share2 size={17} /> Share learning report</button>
      <button className="danger" type="button" onClick={remove}><Trash2 size={17} /> Delete deck</button>
    </div>
  )
}

function EditCardModal({ card, onClose, notify }: { card: CardRecord; onClose: () => void; notify: Notice }) {
  const [front, setFront] = useState(card.front)
  const [back, setBack] = useState(card.back)
  const [notes, setNotes] = useState(card.notes)
  const [tags, setTags] = useState(card.tags.join(', '))

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!front.trim() || !back.trim()) return
    await db.cards.update(card.id, {
      front: front.trim(),
      back: back.trim(),
      notes: notes.trim(),
      tags: tags.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean),
      updatedAt: new Date().toISOString()
    })
    notify('Card saved.')
    onClose()
  }

  async function toggleSuspended() {
    await db.cards.update(card.id, { suspended: !card.suspended, updatedAt: new Date().toISOString() })
    notify(card.suspended ? 'Card returned to study.' : 'Card paused.')
    onClose()
  }

  async function remove() {
    if (!window.confirm('Delete this card?')) return
    await db.transaction('rw', db.cards, db.reviews, async () => {
      await db.reviews.where('cardId').equals(card.id).delete()
      await db.cards.delete(card.id)
    })
    notify('Card deleted.')
    onClose()
  }

  return (
    <Modal title="Edit card" onClose={onClose}>
      <form className="stack-form" onSubmit={save}>
        <label>Front<textarea value={front} onChange={(event) => setFront(event.target.value)} required /></label>
        <label>Back<textarea value={back} onChange={(event) => setBack(event.target.value)} required /></label>
        <label>Extra note<textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        <label>Tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="paper, methods" /></label>
        <button className="button button--primary button--full" type="submit">Save card</button>
      </form>
      <div className="modal-actions">
        <button className="text-button" type="button" onClick={toggleSuspended}>{card.suspended ? <Play size={16} /> : <Pause size={16} />}{card.suspended ? 'Resume' : 'Pause'}</button>
        <button className="text-button danger" type="button" onClick={remove}><Trash2 size={16} /> Delete</button>
      </div>
    </Modal>
  )
}
