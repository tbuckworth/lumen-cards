import { Archive, Download, MoreHorizontal, Pause, Pencil, Play, Search, Share2, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CardImage } from '../components/CardImage'
import { CardContentFields, useCardDraft } from '../components/CardContentFields'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { contentKey, storeImage } from '../lib/images'
import { storageError } from '../lib/errors'
import { useLiveQuery } from 'dexie-react-hooks'
import { EmptyState } from '../components/EmptyState'
import { Modal } from '../components/Modal'
import { db, deleteDeck, updateStudyTags } from '../lib/db'
import { getSetting } from '../lib/db'
import { downloadText, makeDeckExport, makeLearningReport, safeFilename, shareTextFile, type DeckExportFormat } from '../lib/importExport'
import { startOfLocalDay } from '../lib/dates'
import { deckStudyCards, hasNewCards, selectDeckStudyQueue, type StudyMode } from '../lib/studyQueue'
import type { CardRecord, DeckRecord, Route, StudyTagFilter } from '../types'

type Notice = (message: string) => void

export function DecksPage({
  navigate,
  startReview,
  notify
}: {
  navigate: (route: Route) => void
  startReview: (deckId?: string, mode?: StudyMode) => void
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
    const studyCards = deckStudyCards(selectedDeck, data.cards)
    const due = selectDeckStudyQueue(selectedDeck, data.cards, data.todaysReviews, data.dailyNewCards, new Date(), 'due').length
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
          {!!selectedDeck.studyTags?.tags.length && <p className="deck-hero__filter">{describeStudyTags(selectedDeck.studyTags)}</p>}
          <button className="button button--ink" type="button" disabled={!due} onClick={() => startReview(selectedDeck.id)}>
            {due ? `Study ${due} due` : 'Nothing due'}
          </button>
          {!due && hasNewCards(studyCards) && (
            <button className="text-button study-ahead" type="button" onClick={() => startReview(selectedDeck.id, 'ahead')}>
              Study ahead
            </button>
          )}
        </section>

        <StudyTagsPanel key={selectedDeck.id} deck={selectedDeck} cards={allDeckCards} studyCount={studyCards.length} />

        <label className="search-field">
          <Search size={18} />
          <span className="sr-only">Search cards</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this deck" />
        </label>

        <div className="card-list">
          {selectedCards.map((card) => (
            <article className={`library-card ${card.suspended ? 'is-suspended' : ''}`} key={card.id}>
              <div>
                <p>{card.front || 'Image prompt'}</p>
                <CardImage image={card.frontImage} side="Front" thumbnail />
                <span>{card.back}</span>
                <CardImage image={card.backImage} side="Back" thumbnail />
                {!!card.tags.length && <small>{card.tags.map((tag) => `#${tag}`).join('  ')}</small>}
              </div>
              <button className="icon-button" type="button" onClick={() => setEditing(card)} aria-label={`Edit ${card.front || 'image card'}`}>
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

  const sections = groupDecks(data.decks)
  const headed = sections.some(({ group }) => group !== undefined)
  return (
    <div className="page">
      <header className="page-header"><div><p className="eyebrow">Your library</p><h1>Decks</h1></div></header>
      {sections.map(({ group, decks }) => (
        <section className="deck-group" key={group ?? ''} aria-label={headed ? group ?? 'Other decks' : undefined}>
          {headed && <h2 className="deck-group__title">{group ?? 'Other decks'}</h2>}
          <div className="deck-list">
            {decks.map((deck) => {
              const count = data.cards.filter((card) => card.deckId === deck.id).length
              const due = selectDeckStudyQueue(deck, data.cards, data.todaysReviews, data.dailyNewCards, new Date(), 'due').length
              return (
                <button className="deck-row" type="button" key={deck.id} onClick={() => setSelectedDeckId(deck.id)}>
                  <span className="deck-row__swatch" style={{ backgroundColor: deck.color }} />
                  <span className="deck-row__main"><strong>{deck.title}</strong><small>{count} {count === 1 ? 'card' : 'cards'}</small></span>
                  <span className={due ? 'due-pill' : 'due-pill due-pill--quiet'}>{due ? `${due} due` : 'Resting'}</span>
                  <span aria-hidden="true">›</span>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

// One section per named group, alphabetically, then ungrouped decks. Decks keep
// their list order within a section.
function groupDecks(decks: DeckRecord[]): { group?: string; decks: DeckRecord[] }[] {
  const byGroup = new Map<string | undefined, DeckRecord[]>()
  for (const deck of decks) byGroup.set(deck.group, [...(byGroup.get(deck.group) ?? []), deck])
  return [...byGroup.entries()]
    .sort(([a], [b]) => a === undefined ? 1 : b === undefined ? -1 : a.localeCompare(b))
    .map(([group, members]) => ({ group, decks: members }))
}

function describeStudyTags(filter: StudyTagFilter): string {
  const tags = filter.tags.map((tag) => `#${tag}`).join(', ')
  return filter.mode === 'only' ? `Studying only ${tags}` : `Studying all except ${tags}`
}

// Chooses which of the deck's tags narrow its study sessions. Today's combined
// queue is unaffected.
function StudyTagsPanel({ deck, cards, studyCount }: { deck: DeckRecord; cards: CardRecord[]; studyCount: number }) {
  // No action lock: updateStudyTags composes each change with the stored filter,
  // so a tap made while an earlier one is saving still counts.
  const [error, setError] = useState('')
  const save = (change: (current: StudyTagFilter) => StudyTagFilter) => {
    setError('')
    updateStudyTags(deck.id, change).catch((failure: unknown) => setError(storageError(failure)))
  }
  const filter = deck.studyTags
  const counts = new Map<string, number>()
  for (const card of cards) for (const tag of card.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  // A chosen tag stays visible after its last card loses it, so it can be cleared.
  for (const tag of filter?.tags ?? []) if (!counts.has(tag)) counts.set(tag, 0)
  if (!counts.size) return null
  const tags = [...counts.keys()].sort((a, b) => a.localeCompare(b))
  const chosen = new Set(filter?.tags ?? [])
  const mode = filter?.mode ?? 'only'

  const setMode = (next: StudyTagFilter['mode']) => save((current) => ({ ...current, mode: next }))
  const toggle = (tag: string) => save((current) => ({
    ...current,
    tags: current.tags.includes(tag) ? current.tags.filter((item) => item !== tag) : [...current.tags, tag]
  }))

  return (
    <section className="study-tags" aria-labelledby="study-tags-title">
      <p className="eyebrow" id="study-tags-title">Study by tag</p>
      {error && <p role="alert">{error}</p>}
      <div className="segmented" role="group" aria-label="Tag filter mode">
        <button type="button" className={mode === 'only' ? 'is-active' : ''} aria-pressed={mode === 'only'} onClick={() => setMode('only')}>Only these</button>
        <button type="button" className={mode === 'except' ? 'is-active' : ''} aria-pressed={mode === 'except'} onClick={() => setMode('except')}>All except these</button>
      </div>
      <div className="tag-chips">
        {tags.map((tag) => (
          <button className="tag-chip" type="button" key={tag} aria-pressed={chosen.has(tag)} onClick={() => toggle(tag)}>
            #{tag} <small>{counts.get(tag)}</small>
          </button>
        ))}
      </div>
      <p className="study-tags__summary">
        {chosen.size
          ? `This deck’s sessions use ${studyCount} of ${cards.length} cards. Today still includes every card.`
          : 'Choose tags to narrow this deck’s sessions. Today still includes every card.'}
      </p>
    </section>
  )
}

function DeckMenu({ deck, notify, onDeleted }: { deck: DeckRecord; notify: Notice; onDeleted: () => void }) {
  async function run(action: () => Promise<void>) {
    try { await action() } catch (error) { notify(storageError(error)) }
  }

  async function exportDeck(format: DeckExportFormat) {
    const file = await makeDeckExport(deck, format)
    downloadText(file.contents, file.filename, file.mimeType)
    notify(file.successMessage)
  }

  async function shareReport() {
    const report = await makeLearningReport(deck.id)
    const result = await shareTextFile(report, `${safeFilename(deck.title)}-learning-report.md`, `${deck.title} learning report`)
    if (result === 'cancelled') return
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
      <button type="button" onClick={() => run(() => exportDeck('lumen'))}><Download size={17} /> Export Lumen deck</button>
      <button type="button" onClick={() => run(() => exportDeck('anki'))}><Download size={17} /> Export for Anki</button>
      <button type="button" onClick={() => run(shareReport)}><Share2 size={17} /> Share learning report</button>
      <button className="danger" type="button" onClick={() => run(remove)}><Trash2 size={17} /> Delete deck</button>
    </div>
  )
}

function EditCardModal({ card, onClose, notify }: { card: CardRecord; onClose: () => void; notify: Notice }) {
  const { draft, updateDraft, canSave, imageBusy, isImageBusy, onImageBusyChange } = useCardDraft(card)
  const { front, back, notes, tags, frontImage, backImage } = draft
  const { busy, error, run } = useAsyncAction(isImageBusy)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!canSave) return
    await run(async () => {
      await db.cards.update(card.id, {
        frontImage: await storeImage(frontImage), backImage: await storeImage(backImage), contentKey: await contentKey(front, frontImage, backImage),
        front: front.trim(),
        back: back.trim(),
        notes: notes.trim(),
        tags: tags.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean),
        updatedAt: new Date().toISOString()
      })
      notify('Card saved.')
      onClose()
    })
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
    <Modal title="Edit card" onClose={() => { if (!busy && !isImageBusy()) onClose() }}>
      {error && <p role="alert">{error}</p>}
      <form className="stack-form" onSubmit={save}>
        <CardContentFields draft={draft} onChange={updateDraft} mode="edit" disabled={busy || imageBusy} onImageBusyChange={onImageBusyChange} />
        <button className="button button--primary button--full" type="submit" disabled={busy || imageBusy}>Save card</button>
      </form>
      <div className="modal-actions">
        <button className="text-button" type="button" disabled={busy || imageBusy} onClick={() => run(toggleSuspended)}>{card.suspended ? <Play size={16} /> : <Pause size={16} />}{card.suspended ? 'Resume' : 'Pause'}</button>
        <button className="text-button danger" type="button" disabled={busy || imageBusy} onClick={() => run(remove)}><Trash2 size={16} /> Delete</button>
      </div>
    </Modal>
  )
}
