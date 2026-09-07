import '@testing-library/jest-dom/vitest'
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
