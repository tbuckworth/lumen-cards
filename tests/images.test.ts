import { afterEach, describe, expect, it } from 'vitest'
import { createCard, createDeck, db } from '../src/lib/db'
import { importContentCards, importDeckPack, makeAnkiTsv, makeBackup, makeDeckPack, parseDeckJson, parseTabularCards, restoreBackup } from '../src/lib/importExport'
import { blobDataUri, imageBlob } from '../src/lib/images'

const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='
const image = (index = 0) => `data:image/png;base64,${btoa(atob(pixel) + String(index))}`
const pack = (cards: { id?: string; front: string; back: string; frontImage?: string; backImage?: string }[]) => ({
  format: 'lumen-deck' as const, version: 1 as const, deck: { id: 'botany', title: 'Botanical plates', cards }
})
afterEach(async () => { await db.delete(); await db.open() })

describe('image deck safety', () => {
  it('keeps all 23 distinct images with identical prompts and reimports idempotently', async () => {
    const cards = Array.from({ length: 23 }, (_, i) => ({ front: 'Identify this plant', back: `Plant ${i}`, frontImage: image(i) }))
    expect((await importDeckPack(pack(cards))).cardsAdded).toBe(23)
    expect((await importDeckPack(pack(cards))).cardsUpdated).toBe(23)
    expect(await db.cards.count()).toBe(23)
    expect(await db.decks.count()).toBe(1)
    const saved = await db.cards.toArray()
    expect(new Set(saved.map((card) => card.contentKey)).size).toBe(23)
    expect(saved.every((card) => card.frontImage && 'data' in card.frontImage && card.frontImage.data.byteLength > 0)).toBe(true)
  })

  it('honours distinct IDs even for the exact same prompt and image, preserving scheduling on update', async () => {
    await importDeckPack(pack(['a', 'b'].map((id) => ({ id, front: 'Identify', back: id, frontImage: image() }))))
    const original = (await db.cards.get('a'))!
    await db.cards.update('a', { fsrs: { ...original.fsrs, reps: 5 }, suspended: true })
    await importDeckPack(pack([{ id: 'a', front: 'Changed', back: 'New answer', frontImage: image(2) }]))
    expect(await db.cards.count()).toBe(2)
    expect(await db.cards.get('a')).toMatchObject({ back: 'New answer', suspended: true, fsrs: { reps: 5 } })
  })

  it('round-trips image-only sides through a deck and full backup without losing bytes or reviews', async () => {
    await importDeckPack(pack([{ id: 'a', front: '', back: '', frontImage: image(), backImage: image(1) }]))
    const original = (await db.cards.get('a'))!
    await db.reviews.add({ id: 'r', cardId: 'a', deckId: 'botany', rating: 3, state: 0, reviewedAt: new Date().toISOString(), durationMs: 123, scheduledDays: 1, elapsedDays: 0 })
    const exported = await makeDeckPack('botany')
    expect(exported.deck.cards[0]).toMatchObject({ front: '', back: '', frontImage: image(), backImage: image(1) })
    const backup = await makeBackup()
    await db.delete(); await db.open()
    await restoreBackup(backup)
    const restored = (await db.cards.get('a'))!
    expect(await blobDataUri(restored.frontImage)).toBe(image())
    expect(await blobDataUri(restored.backImage)).toBe(image(1))
    expect(restored.fsrs).toEqual(original.fsrs)
    expect(await db.reviews.count()).toBe(1)
    await db.delete(); await db.open()
    await importDeckPack(exported)
    expect(await blobDataUri((await db.cards.get('a'))!.frontImage)).toBe(image())
  })

  it('rejects invalid or remote images and unsupported versions before changing the library', async () => {
    for (const invalid of ['https://example.com/tracker.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,AAAA', 'data:image/png;base64,%%%']) {
      await expect(importDeckPack(pack([{ front: 'Valid', back: 'First' }, { front: 'Bad', back: 'Second', frontImage: invalid }]))).rejects.toThrow()
      expect(await db.cards.count()).toBe(0)
      expect(await db.decks.count()).toBe(0)
    }
    expect(() => parseDeckJson(JSON.stringify({ ...pack([{ front: 'A', back: 'B' }]), version: 2, cards: [{ front: 'A', back: 'B' }] })) ).toThrow()
  })

  it('rolls back earlier updates and new decks when an ID belongs to another deck', async () => {
    const deck = await createDeck('Existing')
    await createCard(deck.id, 'Keep', 'Original', { id: 'conflict' })
    await expect(importDeckPack(pack([{ id: 'new', front: 'One', back: '1' }, { id: 'conflict', front: 'Two', back: '2' }]))).rejects.toThrow('another deck')
    expect(await db.cards.count()).toBe(1)
    expect(await db.decks.count()).toBe(1)
    expect((await db.cards.get('conflict'))?.back).toBe('Original')
  })

  it('rejects duplicate IDs and ambiguous matches rather than silently overwriting', async () => {
    await expect(importDeckPack(pack([{ id: 'a', front: 'A', back: '1' }, { id: 'a', front: 'B', back: '2' }]))).rejects.toThrow('Duplicate')
    await importDeckPack(pack([{ id: 'a', front: 'A', back: '1' }, { id: 'b', front: 'A', back: '2' }]))
    await expect(importContentCards('botany', [{ front: 'A', back: '3' }])).rejects.toThrow('distinct card IDs')
    expect(await db.cards.count()).toBe(2)
  })

  it('distinguishes back images and does not silently export away media', async () => {
    await importDeckPack(pack([{ front: 'A', back: '', backImage: image() }, { front: 'A', back: '', backImage: image(1) }]))
    expect(await db.cards.count()).toBe(2)
    await expect(makeAnkiTsv('botany')).rejects.toThrow('cannot preserve images')
    expect(() => parseTabularCards('Front\tBack\nIdentify <img src="plate.jpg">\tRose')).toThrow('media')
  })

  it('rejects malformed backups atomically, including missing references and invalid schedules', async () => {
    await importDeckPack(pack([{ id: 'a', front: 'A', back: 'B', frontImage: image() }]))
    const backup = JSON.parse(await makeBackup())
    backup.cards[0].deckId = 'missing'
    await expect(restoreBackup(JSON.stringify(backup))).rejects.toThrow('missing')
    expect((await db.cards.get('a'))?.deckId).toBe('botany')
    backup.cards[0].deckId = 'botany'
    backup.cards[0].fsrs.due = 'yesterday-ish'
    await expect(restoreBackup(JSON.stringify(backup))).rejects.toThrow('Invalid date')
  })

  it('matches a manually created image card without losing it on import', async () => {
    const deck = await createDeck('Manual')
    await createCard(deck.id, '', 'Answer', { frontImage: imageBlob(image()) })
    expect((await importContentCards(deck.id, [{ front: '', back: 'Updated', frontImage: image() }])).cardsUpdated).toBe(1)
    expect(await db.cards.count()).toBe(1)
  })
})
