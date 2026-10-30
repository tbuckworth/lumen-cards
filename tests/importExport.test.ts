import { afterEach, describe, expect, it, vi } from 'vitest'
import { Rating, State, type Grade } from 'ts-fsrs'
import { createCard, createDeck, db } from '../src/lib/db'
import { checkDeckSize, importContentCards, importDeckPack, makeAnkiTsv, makeBackup, makeDeckExport, makeDeckPack, makeLearningReport, parseDeckJson, parseTabularCards, restoreBackup } from '../src/lib/importExport'
import { MAX_IMPORT_BYTES } from '../src/lib/images'
import { BACKUP_FORMAT, DECK_FORMAT, RETENTION_BOUNDS } from '../src/types'
import learningReport from '../src/config/learning-report.json'

afterEach(async () => {
  vi.useRealTimers()
  await db.delete()
  await db.open()
})

describe('deck interchange', () => {
  it('accepts the compact shape Claude can naturally produce', () => {
    const parsed = parseDeckJson(JSON.stringify({
      title: 'Memory',
      cards: [{ front: 'What is retrieval practice?', back: 'Actively recalling information.' }]
    }))
    expect('backup' in parsed).toBe(false)
    if (!('backup' in parsed)) {
      expect(parsed.format).toBe('lumen-deck')
      expect(parsed.deck.title).toBe('Memory')
      expect(parsed.deck.cards).toHaveLength(1)
    }
  })

  it('reads Anki tab text and safely turns simple HTML into text', () => {
    const cards = parseTabularCards([
      '#separator:Tab',
      '#html:true',
      '#columns:Front\tBack\tTags\tNotes',
      'One\tLine one<br>Line two\tmethods paper\t<b>Context</b>'
    ].join('\n'))
    expect(cards).toEqual([{ front: 'One', back: 'Line one\nLine two', tags: ['methods', 'paper'], notes: 'Context' }])
  })

  it.each([
    ['unterminated quotes', 'Front,Back\nValid,Answer\n"Broken,Answer'],
    ['malformed quotes', 'Front,Back\nValid,Answer\n"Broken"tail,Answer'],
    ['missing answer', 'Front,Back\nValid,Answer\nMissing,'],
    ['missing prompt', 'Front,Back\nValid,Answer\n,Missing'],
    ['HTML-only empty answer', 'Front,Back\nValid,Answer\nMissing,<b></b>']
  ])('rejects %s with the bad row before importing any cards', async (_name, raw) => {
    const deck = await createDeck('Keep unchanged')
    await importContentCards(deck.id, [{ front: 'Valid', back: 'Original' }])
    const before = await db.cards.toArray()
    await expect((async () => importContentCards(deck.id, parseTabularCards(raw)))()).rejects.toThrow(/row 3/i)
    expect(await db.cards.toArray()).toEqual(before)
  })

  it('keeps blanks, comments, declared columns and quoted multiline text', () => {
    expect(parseTabularCards([
      '\uFEFF#separator:Semicolon', '# A comment', '#columns:Back;Front;Notes;Tags', '',
      'Answer;"Two\nlines";Context;paper methods', ';;;', '', 'Next;Prompt;;'
    ].join('\n'))).toEqual([
      { front: 'Two\nlines', back: 'Answer', notes: 'Context', tags: ['paper', 'methods'] },
      { front: 'Prompt', back: 'Next', notes: '', tags: [] }
    ])
    expect(parseTabularCards('One,Answer,tag\nTwo,Answer')).toHaveLength(2)
    expect(() => parseTabularCards('#separator:Tab\n\n  ')).toThrow('does not contain any cards')
    expect(() => parseTabularCards('Front,Back,Tags\nValid,Answer,paper\n,,orphan')).toThrow(/row 3/i)
  })

  it('updates matching fronts instead of creating silent duplicates', async () => {
    const deck = await createDeck('Test')
    const first = await importContentCards(deck.id, [{ front: 'Question', back: 'Old' }])
    const second = await importContentCards(deck.id, [{ front: '  question ', back: 'New' }])
    expect(first.cardsAdded).toBe(1)
    expect(second.cardsUpdated).toBe(1)
    expect(await db.cards.count()).toBe(1)
    expect((await db.cards.toArray())[0]?.back).toBe('New')
  })

  it('matches legacy text-only cards without changing normalization or scheduling', async () => {
    const deck = await createDeck('Legacy')
    const card = await createCard(deck.id, '  Mixed\n  CASE  ', 'Old')
    await db.cards.update(card.id, { contentKey: undefined })
    expect((await importContentCards(deck.id, [{ front: ' mixed case ', back: 'New' }])).cardsUpdated).toBe(1)
    expect(await db.cards.get(card.id)).toMatchObject({ id: card.id, fsrs: card.fsrs, back: 'New' })
    expect((await db.cards.get(card.id))?.contentKey).toBe('["mixed case","",""]')
  })

  it('creates an imported deck with its final identity and the normal default color', async () => {
    const result = await importDeckPack({ ...DECK_FORMAT, deck: { id: 'final-id', title: ' Named ', description: ' Description ', cards: [{ id: 'final-card', front: 'Q', back: 'A' }] } })
    const ordinary = await createDeck('Ordinary')
    expect(result).toMatchObject({ deckId: 'final-id', decksAdded: 1, cardsAdded: 1 })
    expect(await db.decks.get('final-id')).toMatchObject({ title: 'Named', description: 'Description', color: ordinary.color })
    expect(await db.cards.get('final-card')).toMatchObject({ deckId: 'final-id' })
    expect((await importDeckPack({ ...DECK_FORMAT, deck: { id: 'final-id', title: 'Named', cards: [{ id: 'final-card', front: 'Q', back: 'Updated' }] } })).decksAdded).toBe(0)
    expect(await db.decks.count()).toBe(2)
  })

  it('exports a text file Anki can map without guessing fields', async () => {
    const deck = await createDeck('Research')
    await importContentCards(deck.id, [{ front: 'Prompt', back: 'Answer', tags: ['paper'] }])
    const text = await makeAnkiTsv(deck.id)
    expect(text).toContain('#separator:Tab')
    expect(text).toContain('#deck:Research')
    expect(text).toContain('Prompt\tAnswer\tpaper')
  })

  it('prepares both export formats with unchanged filenames, MIME types and Anki escaping', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-30T09:00:00.000Z'))
    const deck = await createDeck('Café & Research')
    await createCard(deck.id, 'A&B <tag>\tX\r\nY', 'Answer > 2', { id: 'stable', tags: ['Paper', 'methods'], notes: 'N\t1\nN&2', source: 'doi:example' })
    const anki = await makeDeckExport(deck, 'anki')
    expect(anki).toEqual({
      filename: 'cafe-research-anki.txt', mimeType: 'text/plain;charset=utf-8', successMessage: 'Anki file exported.',
      contents: '#separator:Tab\n#html:true\n#deck:Café & Research\n#columns:Front\tBack\tTags\tNotes\nA&amp;B &lt;tag&gt; X<br>Y\tAnswer &gt; 2\tpaper methods\tN 1<br>N&amp;2'
    })
    const lumen = await makeDeckExport(deck, 'lumen')
    expect(lumen).toMatchObject({ filename: 'cafe-research.lumen.json', mimeType: 'application/json', successMessage: 'Deck exported.' })
    expect(lumen.contents).toBe(JSON.stringify(await makeDeckPack(deck.id), null, 2))
    const pack = parseDeckJson(lumen.contents)
    expect(pack).toMatchObject({ ...DECK_FORMAT, deck: { id: deck.id, cards: [{ id: 'stable', source: 'doi:example' }] } })
    if ('backup' in pack) throw new Error('Expected a deck')
    await db.decks.clear()
    await db.cards.clear()
    await importDeckPack(pack)
    expect(await db.cards.get('stable')).toMatchObject({ deckId: deck.id, source: 'doi:example', front: 'A&B <tag>\tX\r\nY' })
  })

  it('retains independent deck and backup format validation', async () => {
    const deck = await createDeck('Formats')
    await createCard(deck.id, 'Q', 'A')
    const pack = await makeDeckPack(deck.id)
    const backup = JSON.parse(await makeBackup())
    expect(pack).toMatchObject({ format: 'lumen-deck', version: 1 })
    expect(backup).toMatchObject({ format: 'lumen-backup', version: 1 })
    for (const value of [pack, backup]) {
      expect(() => parseDeckJson(JSON.stringify({ ...value, version: 2 }))).toThrow('version')
      expect(() => parseDeckJson(JSON.stringify({ ...value, format: 'unsupported' }))).toThrow('unsupported format')
    }
  })

  it('checks deck byte limits while permitting larger full backups through restore', async () => {
    expect(() => checkDeckSize({ size: MAX_IMPORT_BYTES })).not.toThrow()
    expect(() => checkDeckSize({ size: MAX_IMPORT_BYTES + 1 })).toThrow('100 MB')
    expect(() => checkDeckSize('é'.repeat(MAX_IMPORT_BYTES / 2 + 1))).toThrow('100 MB')
    const padding = ' '.repeat(MAX_IMPORT_BYTES)
    expect(() => parseDeckJson(JSON.stringify({ cards: [{ front: 'Q', back: 'A' }] }) + padding)).toThrow('100 MB')
    const backup = JSON.stringify({ ...BACKUP_FORMAT, exportedAt: new Date().toISOString(), decks: [], cards: [], reviews: [], settings: [] }) + padding
    expect((await restoreBackup(backup)).cardsAdded).toBe(0)
  })

  it.each([RETENTION_BOUNDS.min, RETENTION_BOUNDS.max])('accepts retention boundary %s and rejects values outside the range', async (value) => {
    const backup = JSON.parse(await makeBackup())
    backup.settings = [{ key: 'desiredRetention', value }]
    await expect(restoreBackup(JSON.stringify(backup))).resolves.toMatchObject({ cardsAdded: 0 })
    expect((await db.settings.get('desiredRetention'))?.value).toBe(value)
    for (const invalid of [RETENTION_BOUNDS.min - 0.001, RETENTION_BOUNDS.max + 0.001]) {
      backup.settings[0].value = invalid
      await expect(restoreBackup(JSON.stringify(backup))).rejects.toThrow('settings')
      expect((await db.settings.get('desiredRetention'))?.value).toBe(value)
    }
  })

  it('round-trips a complete local backup with scheduling data', async () => {
    const deck = await createDeck('Keep me')
    await importContentCards(deck.id, [{ front: 'Question', back: 'Answer' }])
    const backup = await makeBackup()
    await db.decks.clear()
    await db.cards.clear()
    const result = await restoreBackup(backup)
    expect(result.cardsAdded).toBe(1)
    expect((await db.decks.toArray())[0]?.title).toBe('Keep me')
    expect((await db.cards.toArray())[0]?.fsrs.due).toBeTruthy()
  })

  it.each(['deck duplicate', 'card duplicate', 'review duplicate', 'missing deck', 'missing card', 'wrong review deck'])('rejects a backup with %s without changing any stored records', async (defect) => {
    const deck = await createDeck('Saved')
    const other = await createDeck('Other')
    const card = await createCard(deck.id, 'Q', 'A')
    await db.reviews.add({ id: 'review', cardId: card.id, deckId: deck.id, rating: Rating.Again, state: State.New, reviewedAt: card.createdAt, durationMs: 20, scheduledDays: 1, elapsedDays: 0 })
    const raw = await makeBackup()
    const snapshot = await Promise.all([db.decks.toArray(), db.cards.toArray(), db.reviews.toArray(), db.settings.toArray()])
    const backup = JSON.parse(raw)
    backup.cards[0].back = 'Must not be saved'
    if (defect === 'deck duplicate') backup.decks.push(backup.decks[0])
    if (defect === 'card duplicate') backup.cards.push(backup.cards[0])
    if (defect === 'review duplicate') backup.reviews.push(backup.reviews[0])
    if (defect === 'missing deck') backup.cards[0].deckId = 'missing'
    if (defect === 'missing card') backup.reviews[0].cardId = 'missing'
    if (defect === 'wrong review deck') backup.reviews[0].deckId = other.id
    await expect(restoreBackup(JSON.stringify(backup))).rejects.toThrow(/duplicate|missing|mismatched/i)
    expect(await Promise.all([db.decks.toArray(), db.cards.toArray(), db.reviews.toArray(), db.settings.toArray()])).toEqual(snapshot)
  })

  it('preserves report counts, ranking, stable ties, scope, limit and instructions', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const now = new Date('2026-10-30T09:00:00.000Z')
    vi.setSystemTime(now)
    const deck = await createDeck('Report')
    const other = await createDeck('Other')
    const cards = await Promise.all(Array.from({ length: 15 }, (_, i) => createCard(deck.id, `Prompt ${i}`, `Answer ${i}`, { id: `card-${String(i).padStart(2, '0')}`, notes: i === 2 ? 'Context' : '' })))
    const outside = await createCard(other.id, 'Outside', 'Other')
    const unseen = await createCard(deck.id, 'Unreviewed', 'No reviews')
    for (const [index, card] of [...cards, outside].entries()) {
      const ratings: Grade[] = index === 2 ? [Rating.Again, Rating.Again] : index === 1 ? [Rating.Again, Rating.Good, Rating.Easy] : [Rating.Again]
      await db.reviews.bulkAdd(ratings.map((rating, i) => ({ id: `review-${index}-${i}`, cardId: card.id, deckId: card.deckId, rating, state: State.Review, reviewedAt: new Date(now.getTime() - i * 60000).toISOString(), durationMs: 30, scheduledDays: 1, elapsedDays: 0 })))
    }
    const report = await makeLearningReport(deck.id)
    expect(report).toContain(`Cards: 16 · Reviews: 18`)
    const ranked = [...report.matchAll(/\*\*Prompt (\d+)\*\*/g)].map((match) => Number(match[1]))
    expect(ranked).toEqual([2, 1, 0, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(report).toContain('Again: 2/2; next due')
    expect(report).toContain('Again: 1/3; next due')
    expect(report).toContain('  - Note: Context')
    expect(report).not.toContain(outside.front)
    expect(report).not.toContain(unseen.front)
    expect(report.endsWith(`## Prompt for Claude\n\n${learningReport.prompt}`)).toBe(true)
    expect(await makeLearningReport()).toContain('Cards: 17 · Reviews: 19')
    const empty = await createDeck('Empty')
    expect(await makeLearningReport(empty.id)).toBe([
      '# Lumen learning report', 'Deck: Empty', `Generated: ${now.toLocaleString()}`, 'Cards: 0 · Reviews: 0',
      '## Cards needing the most attention', 'No reviews yet.', '## Prompt for Claude', learningReport.prompt
    ].join('\n\n'))
  })
})
