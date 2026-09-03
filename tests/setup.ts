import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'

if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => `test-${Math.random().toString(36).slice(2)}` }
  })
}
