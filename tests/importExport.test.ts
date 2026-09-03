import { afterEach, describe, expect, it } from 'vitest'
import { createDeck, db } from '../src/lib/db'
import { importContentCards, makeAnkiTsv, makeBackup, parseDeckJson, parseTabularCards, restoreBackup } from '../src/lib/importExport'

afterEach(async () => {
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

  it('updates matching fronts instead of creating silent duplicates', async () => {
    const deck = await createDeck('Test')
    const first = await importContentCards(deck.id, [{ front: 'Question', back: 'Old' }])
    const second = await importContentCards(deck.id, [{ front: '  question ', back: 'New' }])
    expect(first.cardsAdded).toBe(1)
    expect(second.cardsUpdated).toBe(1)
    expect(await db.cards.count()).toBe(1)
    expect((await db.cards.toArray())[0]?.back).toBe('New')
  })

  it('exports a text file Anki can map without guessing fields', async () => {
    const deck = await createDeck('Research')
    await importContentCards(deck.id, [{ front: 'Prompt', back: 'Answer', tags: ['paper'] }])
    const text = await makeAnkiTsv(deck.id)
    expect(text).toContain('#separator:Tab')
    expect(text).toContain('#deck:Research')
    expect(text).toContain('Prompt\tAnswer\tpaper')
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
})
