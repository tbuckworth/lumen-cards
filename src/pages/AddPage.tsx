import { FileJson, FileUp, Plus, Sparkles } from 'lucide-react'
import { useState, useRef } from 'react'
import { ImageField } from '../components/CardImage'
import { MAX_IMPORT_BYTES, storageError, contentKey, storeImage } from '../lib/images'
import { useLiveQuery } from 'dexie-react-hooks'
import { createCard, createDeck, db } from '../lib/db'
import { importContentCards, importDeckPack, parseDeckJson, parseTabularCards, restoreBackup } from '../lib/importExport'
import { DECK_COLORS, type Route } from '../types'

type Notice = (message: string) => void

export function AddPage({ navigate, notify }: { navigate: (route: Route) => void; notify: Notice }) {
  const decks = useLiveQuery(() => db.decks.orderBy('title').toArray(), [], [])
  const [mode, setMode] = useState<'card' | 'import'>('card')
  const [deckId, setDeckId] = useState('')
  const [newDeckTitle, setNewDeckTitle] = useState('')
  const [frontImage, setFrontImage] = useState<Blob>()
  const [backImage, setBackImage] = useState<Blob>()
  const [imageBusy, setImageBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [notes, setNotes] = useState('')
  const [tags, setTags] = useState('')
  const [source, setSource] = useState('')
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)

  const effectiveDeckId = deckId || decks[0]?.id || ''

  async function resolveDeck(): Promise<string> {
    if (newDeckTitle.trim()) {
      const deck = await createDeck(
        newDeckTitle,
        '',
        DECK_COLORS[decks.length % DECK_COLORS.length]
      )
      return deck.id
    }
    if (!effectiveDeckId || effectiveDeckId === '__new__') throw new Error('Choose a deck or name a new one.')
    return effectiveDeckId
  }

  async function addCard(event: React.FormEvent) {
    event.preventDefault()
    if (lock.current || imageBusy) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const key = await contentKey(front, frontImage, backImage)
      const storedFront = await storeImage(frontImage)
      const storedBack = await storeImage(backImage)
      const target = await db.transaction('rw', db.decks, db.cards, async () => {
        const target = await resolveDeck()
        await createCard(target, front, back, {
          notes,
          tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
          source, frontImage: storedFront, backImage: storedBack, contentKey: key
        })
        return target
      })
      setDeckId(target)
      setNewDeckTitle('')
      setFrontImage(undefined)
      setBackImage(undefined)
      setFront('')
      setBack('')
      setNotes('')
      setTags('')
      setSource('')
      notify('Card added.')
    } catch (error) {
      setError(storageError(error))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  async function importRaw(raw: string, filename = '') {
    if (new Blob([raw]).size > MAX_IMPORT_BYTES) throw new Error('Deck files must be 100 MB or smaller. Split this deck into smaller files.')
    if (!raw.trim()) throw new Error('Paste a deck or choose a file first.')
    const looksLikeJson = filename.endsWith('.json') || raw.trimStart().startsWith('{')
    if (looksLikeJson) {
      const parsed = parseDeckJson(raw)
      if ('backup' in parsed) {
        if (!window.confirm('Restore this backup? Matching cards and their review schedules will be replaced by the backup. Save a full backup first if you want to keep the current versions.')) return 'Restore cancelled.'
        const result = await restoreBackup(raw)
        return `${result.cardsAdded} cards restored from backup.`
      }
      const result = await importDeckPack(parsed)
      return `${result.cardsAdded} added${result.cardsUpdated ? `, ${result.cardsUpdated} updated` : ''} in “${parsed.deck.title}”.`
    }
    const cards = parseTabularCards(raw)
    if (newDeckTitle.trim()) {
      const result = await importDeckPack({ format: 'lumen-deck', version: 1, deck: { title: newDeckTitle.trim(), cards } })
      setDeckId(result.deckId ?? '')
      setNewDeckTitle('')
      return `${result.cardsAdded} added${result.cardsUpdated ? `, ${result.cardsUpdated} updated` : ''}.`
    }
    const target = await resolveDeck()
    const result = await importContentCards(target, cards)
    return `${result.cardsAdded} added${result.cardsUpdated ? `, ${result.cardsUpdated} updated` : ''}.`
  }

  async function importPasted() {
    if (lock.current || imageBusy) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      notify(await importRaw(paste))
      setPaste('')
      navigate('decks')
    } catch (error) {
      setError(storageError(error))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  async function importFile(file?: File) {
    if (!file) return
    if (lock.current || imageBusy) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error('Deck files must be 100 MB or smaller. Split this deck into smaller files.')
      notify(await importRaw(await file.text(), file.name.toLowerCase()))
      navigate('decks')
    } catch (error) {
      setError(storageError(error))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  return (
    <div className="page page--add">
      <header className="page-header"><div><p className="eyebrow">Grow your library</p><h1>Add cards</h1></div></header>
      <div className="segmented" role="tablist" aria-label="Add cards">
        <button className={mode === 'card' ? 'is-active' : ''} role="tab" aria-selected={mode === 'card'} disabled={busy || imageBusy} onClick={() => setMode('card')}>One card</button>
        <button className={mode === 'import' ? 'is-active' : ''} role="tab" aria-selected={mode === 'import'} disabled={busy || imageBusy} onClick={() => setMode('import')}>Import</button>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {busy && <p role="status">Saving… Keep Lumen open until this finishes.</p>}
      {mode === 'card' ? (
        <form className="stack-form add-card-form" onSubmit={addCard}>
          <DeckChooser decks={decks} deckId={effectiveDeckId} setDeckId={setDeckId} newDeckTitle={newDeckTitle} setNewDeckTitle={setNewDeckTitle} />
          <label>Question or prompt<textarea autoFocus value={front} onChange={(event) => setFront(event.target.value)} placeholder="What do I want to remember?" required={!frontImage} /></label>
          <ImageField side="Front" image={frontImage} onChange={setFrontImage} disabled={busy || imageBusy} onBusy={setImageBusy} />
          <label>Answer<textarea value={back} onChange={(event) => setBack(event.target.value)} placeholder="Keep it clear and atomic" required={!backImage} /></label>
          <ImageField side="Back" image={backImage} onChange={setBackImage} disabled={busy || imageBusy} onBusy={setImageBusy} />
          <details className="form-details">
            <summary>Notes, tags & source</summary>
            <label>Extra note<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Context or a helpful explanation" /></label>
            <label>Tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="paper, methods" /></label>
            <label>Source<input value={source} onChange={(event) => setSource(event.target.value)} placeholder="Paper, book, or URL" /></label>
          </details>
          <button className="button button--primary button--full" type="submit" disabled={busy || imageBusy || (!front.trim() && !frontImage) || (!back.trim() && !backImage)}>
            <Plus size={18} /> Add card
          </button>
        </form>
      ) : (
        <div className="import-layout">
          <section className="claude-callout">
            <Sparkles size={20} />
            <div><strong>From Claude</strong><p>Ask: “Make this a Lumen deck.” Then paste the JSON here, or import the <code>.lumen.json</code> file Claude creates.</p></div>
          </section>
          <label className="file-drop">
            <FileUp size={27} />
            <strong>Choose a deck file</strong>
            <span>Lumen JSON (with embedded images), Anki text, CSV or TSV · up to 100 MB</span>
            <input type="file" accept=".json,.txt,.csv,.tsv,.lumen.json,application/json,text/plain,text/csv" disabled={busy} onChange={(event) => { void importFile(event.target.files?.[0]); event.target.value = '' }} />
          </label>
          <div className="or-rule"><span>or paste from Claude</span></div>
          <label className="paste-field">
            <span className="sr-only">Paste deck JSON or tab-separated cards</span>
            <textarea value={paste} onChange={(event) => setPaste(event.target.value)} placeholder={'{\n  "format": "lumen-deck",\n  "version": 1,\n  "deck": { ... }\n}'} />
          </label>
          {!paste.trimStart().startsWith('{') && (
            <DeckChooser decks={decks} deckId={effectiveDeckId} setDeckId={setDeckId} newDeckTitle={newDeckTitle} setNewDeckTitle={setNewDeckTitle} compact />
          )}
          <button className="button button--ink button--full" type="button" disabled={busy || !paste.trim()} onClick={importPasted}>
            <FileJson size={18} /> Import pasted cards
          </button>
        </div>
      )}
    </div>
  )
}

function DeckChooser({
  decks,
  deckId,
  setDeckId,
  newDeckTitle,
  setNewDeckTitle,
  compact = false
}: {
  decks: { id: string; title: string }[]
  deckId: string
  setDeckId: (value: string) => void
  newDeckTitle: string
  setNewDeckTitle: (value: string) => void
  compact?: boolean
}) {
  return (
    <div className={compact ? 'deck-chooser deck-chooser--compact' : 'deck-chooser'}>
      {!!decks.length && (
        <label>Deck<select value={newDeckTitle ? '__new__' : deckId} onChange={(event) => { setDeckId(event.target.value); if (event.target.value !== '__new__') setNewDeckTitle('') }}>
          {decks.map((deck) => <option value={deck.id} key={deck.id}>{deck.title}</option>)}
          <option value="__new__">+ New deck</option>
        </select></label>
      )}
      {(!decks.length || deckId === '__new__' || newDeckTitle) && (
        <label>New deck name<input value={newDeckTitle} onChange={(event) => { setNewDeckTitle(event.target.value); setDeckId('__new__') }} placeholder="e.g. Memory & learning" required={!decks.length || deckId === '__new__'} /></label>
      )}
    </div>
  )
}
