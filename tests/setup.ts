import '@testing-library/jest-dom/vitest'
// Node/jsdom has no browser IndexedDB; emulate that boundary for real Dexie paths.
// Playwright workflows in tests/e2e also exercise storage in real browsers.
import 'fake-indexeddb/auto'

if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => `test-${Math.random().toString(36).slice(2)}` }
  })
}

// Match browser structured-clone support for Blob in fake IndexedDB.
import { Blob } from 'node:buffer'
import { webcrypto } from 'node:crypto'
Object.defineProperty(globalThis, 'Blob', { value: Blob, configurable: true })
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
