import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { File, resolveObjectURL } from 'node:buffer'
import { URL as NodeURL } from 'node:url'
import App from '../src/App'
import { ErrorBoundary } from '../src/components/ErrorBoundary'
import { SettingsPage } from '../src/pages/SettingsPage'
import { createCard, createDeck, db, setSetting } from '../src/lib/db'
import { makeBackup, shareTextFile } from '../src/lib/importExport'

const descriptors = new Map<string, PropertyDescriptor | undefined>()
function browserApi(name: string, value: unknown) {
  if (!descriptors.has(name)) descriptors.set(name, Object.getOwnPropertyDescriptor(navigator, name))
  Object.defineProperty(navigator, name, { value, configurable: true })
}

// Inject only browser/IndexedDB failures: native quota, device I/O and OS dialogs cannot be forced safely in Node CI.
function failSettingWrite(key: string, message: string, name: string) {
  const original = IDBObjectStore.prototype.put
  return vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, ...args) {
    if (this.name === 'settings' && value.key === key) throw new DOMException(message, name)
    return original.call(this, value, ...args)
  })
}

beforeEach(() => {
  window.location.hash = ''
  // jsdom has no CSS media-query/device-display implementation.
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('scrollTo', () => {})
})
afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(navigator, name, descriptor)
    else Reflect.deleteProperty(navigator, name)
  }
  descriptors.clear()
  await db.delete()
  await db.open()
})

async function savedLibrary() {
  const deck = await createDeck('Keep this deck')
  await createCard(deck.id, 'Keep this question', 'Keep this answer', { source: 'source' })
  await setSetting('onboardingComplete', true)
  await setSetting('desiredRetention', 0.85)
  await setSetting('dailyNewCards', 20)
}
const snapshot = () => Promise.all([db.decks.toArray(), db.cards.toArray(), db.reviews.toArray(), db.settings.toArray()])

describe('visible storage and action failures', () => {
  it('shows failed startup and manually recovers without replacing any records', async () => {
    await savedLibrary()
    const before = await snapshot()
    const original = IDBObjectStore.prototype.get
    const fault = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
      if (this.name === 'settings' && key === 'onboardingComplete') throw new DOMException('Startup read failed', 'UnknownError')
      return original.call(this, key)
    })
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Startup read failed')
    expect(screen.queryByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeNull()
    fault.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('heading', { name: /Good (morning|afternoon|evening)/ })
    expect(await snapshot()).toEqual(before)
  })

  it('shows a live-query failure with navigation intact and remounts only on manual retry', async () => {
    await savedLibrary()
    const original = IDBObjectStore.prototype.getAll
    const fault = vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'cards') throw new DOMException('Card query failed', 'UnknownError')
      return original.apply(this, args)
    })
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Card query failed')
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(await screen.findByRole('slider')).toHaveValue('85')
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Card query failed')
    fault.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('Keep this deck')
    expect(await db.cards.count()).toBe(1)
  })

  it('keeps the confirmed preference on failed save, surfaces database AbortError, then accepts explicit retry', async () => {
    await savedLibrary()
    render(<SettingsPage notify={() => {}} onReset={() => {}} />)
    const slider = await screen.findByRole('slider')
    await waitFor(() => expect(slider).toHaveValue('85'))
    const fault = failSettingWrite('desiredRetention', 'Preference write interrupted', 'AbortError')
    fireEvent.change(slider, { target: { value: '90' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Preference write interrupted')
    expect(slider).toHaveValue('85')
    expect((await db.settings.get('desiredRetention'))?.value).toBe(0.85)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '30' } })
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('30'))
    expect(screen.getByRole('alert')).toHaveTextContent('Preference write interrupted')
    expect(fault.mock.calls.filter(([value]) => value.key === 'desiredRetention')).toHaveLength(1)
    fault.mockRestore()
    fireEvent.change(slider, { target: { value: '90' } })
    await waitFor(() => expect(slider).toHaveValue('90'))
    expect((await db.settings.get('desiredRetention'))?.value).toBe(0.9)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows no default preferences after a failed read and recovers only when retried', async () => {
    await savedLibrary()
    const before = await snapshot()
    const original = IDBObjectStore.prototype.get
    const fault = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
      if (this.name === 'settings' && key === 'desiredRetention') throw new DOMException('Preference read failed', 'UnknownError')
      return original.call(this, key)
    })
    render(<SettingsPage notify={() => {}} onReset={() => {}} />)
    expect(screen.queryByRole('slider')).toBeNull()
    expect(await screen.findByRole('alert')).toHaveTextContent('Preference read failed')
    expect(screen.queryByRole('combobox')).toBeNull()
    fault.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('slider')).toHaveValue('85')
    expect(await snapshot()).toEqual(before)
  })

  it('serializes immediate preference writes without queueing the second request', async () => {
    await savedLibrary()
    render(<SettingsPage notify={() => {}} onReset={() => {}} />)
    const slider = await screen.findByRole('slider')
    await waitFor(() => expect(slider).toHaveValue('85'))
    act(() => {
      fireEvent.change(slider, { target: { value: '90' } })
      fireEvent.change(screen.getByRole('combobox'), { target: { value: '30' } })
    })
    await waitFor(() => expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('90'))
    expect((await db.settings.get('dailyNewCards'))?.value).toBe(20)
    expect(screen.getByRole('combobox')).toHaveValue('20')
  })

  it('rolls back onboarding samples and completion together and excludes immediate repeated choices', async () => {
    const fault = failSettingWrite('onboardingComplete', 'Setup write failed', 'QuotaExceededError')
    render(<App />)
    const begin = await screen.findByRole('button', { name: /Begin with three sample cards/ })
    act(() => { fireEvent.click(begin); fireEvent.click(begin) })
    expect(await screen.findByRole('alert')).toHaveTextContent(/storage/i)
    expect(await db.decks.count()).toBe(0)
    expect(await db.cards.count()).toBe(0)
    expect(await db.settings.get('onboardingComplete')).toBeUndefined()
    fault.mockRestore()
    fireEvent.click(begin)
    await screen.findByRole('heading', { name: /Good (morning|afternoon|evening)/ })
    expect(await db.decks.count()).toBe(1)
    expect(await db.cards.count()).toBe(3)
  })

  it('preserves all records and avoids reset when erasure fails', async () => {
    await savedLibrary()
    const before = await snapshot()
    const onReset = vi.fn()
    // Native confirmation is not available in jsdom; only approve this test's synthetic records.
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const original = IDBObjectStore.prototype.clear
    const fault = vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(function (this: IDBObjectStore) {
      if (this.name === 'settings') throw new DOMException('Erase interrupted', 'AbortError')
      return original.call(this)
    })
    render(<SettingsPage notify={() => {}} onReset={onReset} />)
    fireEvent.click(await screen.findByRole('button', { name: /Erase all Lumen data/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Erase interrupted')
    expect(onReset).not.toHaveBeenCalled()
    expect(await snapshot()).toEqual(before)
    fault.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: /Erase all Lumen data/ }))
    await waitFor(() => expect(onReset).toHaveBeenCalledTimes(1))
    expect(await db.cards.count()).toBe(0)
  })

  it('loads preferences independently of a failed storage-status check and permits its explicit retry', async () => {
    await savedLibrary()
    const persisted = vi.fn().mockRejectedValue(new DOMException('Protection status failed', 'UnknownError'))
    browserApi('storage', { persisted })
    render(<SettingsPage notify={() => {}} onReset={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Protection status failed')
    expect(screen.getByRole('slider')).toHaveValue('85')
    persisted.mockResolvedValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Retry storage check' }))
    await screen.findByText('Tap to request extra protection')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reports native persistence-request failure and distinguishes a later denial from success', async () => {
    await savedLibrary()
    const persist = vi.fn().mockRejectedValue(new DOMException('Protection request failed', 'UnknownError'))
    browserApi('storage', { persisted: async () => false, persist })
    render(<SettingsPage notify={() => {}} onReset={() => {}} />)
    const button = await screen.findByRole('button', { name: /Storage protection/ })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('Protection request failed')
    expect(button).toHaveTextContent('Tap to request extra protection')
    persist.mockResolvedValue(false)
    fireEvent.click(button)
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(button).not.toHaveTextContent('Persistent storage granted')
    persist.mockResolvedValue(true)
    fireEvent.click(button)
    await screen.findByText('Persistent storage granted')
  })

  it('retries optional post-onboarding protection without repeating setup under StrictMode', async () => {
    const persist = vi.fn().mockRejectedValue(new Error('Optional protection failed'))
    browserApi('storage', { persist })
    render(<StrictMode><App /></StrictMode>)
    fireEvent.click(await screen.findByRole('button', { name: /Begin with three sample cards/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Optional protection failed')
    expect((await db.settings.get('onboardingComplete'))?.value).toBe(true)
    expect(await db.cards.count()).toBe(3)
    persist.mockResolvedValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Retry storage protection' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(await db.decks.count()).toBe(1)
    expect(await db.cards.count()).toBe(3)
  })

  it('shows share failure persistently and leaves cancellation silent without a download', async () => {
    await savedLibrary()
    const notify = vi.fn()
    const share = vi.fn().mockRejectedValue(new Error('Share unavailable'))
    browserApi('share', share)
    browserApi('canShare', () => true)
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<SettingsPage notify={notify} onReset={() => {}} />)
    const button = await screen.findByRole('button', { name: /Share progress with Claude/ })
    fireEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('Share unavailable')
    share.mockRejectedValue(new DOMException('Cancelled by user', 'AbortError'))
    fireEvent.click(button)
    await waitFor(() => expect(share).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(notify).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
  })

  it('returns expected OS share cancellation without swallowing other failures', async () => {
    browserApi('share', vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError')))
    await expect(shareTextFile('report', 'report.md', 'Report')).resolves.toBe('cancelled')
    browserApi('share', vi.fn().mockRejectedValue(new Error('Real failure')))
    await expect(shareTextFile('report', 'report.md', 'Report')).rejects.toThrow('Real failure')
  })

  it.each(['missing', 'unsupported files'])('keeps the actual download path when native sharing is %s', async (capability) => {
    vi.stubGlobal('URL', NodeURL)
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const share = vi.fn()
    browserApi('share', capability === 'missing' ? undefined : share)
    browserApi('canShare', () => false)
    let downloaded: ReturnType<typeof resolveObjectURL>
    // jsdom has no native download dialog; inspect the real generated Blob URL at that boundary.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('report.md')
      downloaded = resolveObjectURL(this.href)
    })
    await expect(shareTextFile('report contents', 'report.md', 'Report')).resolves.toBe('downloaded')
    expect(await downloaded?.text()).toBe('report contents')
    expect(downloaded?.type).toBe('text/plain')
    expect(share).not.toHaveBeenCalled()
    vi.runOnlyPendingTimers()
  })

  it('reports database AbortErrors for report and backup independently without modifying records', async () => {
    await savedLibrary()
    const before = await snapshot()
    const original = IDBObjectStore.prototype.getAll
    const fault = vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'cards') throw new DOMException('Data read interrupted', 'AbortError')
      return original.apply(this, args)
    })
    const notify = vi.fn()
    render(<SettingsPage notify={notify} onReset={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Share progress with Claude/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Data read interrupted')
    fireEvent.click(screen.getByRole('button', { name: /Save a full backup/ }))
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
    expect(notify).not.toHaveBeenCalled()
    fault.mockRestore()
    expect(await snapshot()).toEqual(before)
  })

  it('delivers a generated backup without requiring a timestamp read', async () => {
    await savedLibrary()
    vi.stubGlobal('URL', NodeURL)
    const notify = vi.fn()
    render(<SettingsPage notify={notify} onReset={() => {}} />)
    await screen.findByRole('slider')
    // Native storage reads can fail independently of backup generation; fault only the optional timestamp key.
    const original = IDBObjectStore.prototype.get
    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
      if (this.name === 'settings' && key === 'lastBackupAt') throw new DOMException('Timestamp unavailable', 'UnknownError')
      return original.call(this, key)
    })
    let contents: ReturnType<typeof resolveObjectURL>
    // jsdom cannot open the native download dialog; inspect the real generated Blob at that boundary.
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      contents = resolveObjectURL(this.href)
    })
    fireEvent.click(screen.getByRole('button', { name: /Save a full backup/ }))
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    expect(JSON.parse((await contents?.text()) ?? '').cards[0].front).toBe('Keep this question')
    expect(notify).toHaveBeenCalledWith('Backup downloaded. Keep it in iCloud Drive.')
    expect(screen.queryByRole('alert')).toBeNull()
    // Let the actual download helper release its object URL before restoring jsdom's URL implementation.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1100)) })
  })

  it('keeps restore failures visible and atomically preserves every record', async () => {
    await savedLibrary()
    const backup = JSON.parse(await makeBackup())
    backup.cards[0].back = 'Restored answer'
    const before = await snapshot()
    const fault = failSettingWrite('desiredRetention', 'Restore interrupted', 'AbortError')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const notify = vi.fn()
    const { container } = render(<SettingsPage notify={notify} onReset={() => {}} />)
    await screen.findByRole('slider')
    const file = new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' })
    fireEvent.change(container.querySelector('.settings-row--file input')!, { target: { files: [file] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Restore interrupted')
    expect(notify).not.toHaveBeenCalled()
    expect(await snapshot()).toEqual(before)
    fault.mockRestore()
    fireEvent.change(container.querySelector('.settings-row--file input')!, { target: { files: [file] } })
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Restored 1 cards.'))
    expect((await db.cards.toArray())[0].back).toBe('Restored answer')
  })

  it('renders an explicit root reload fallback for unexpected render errors', () => {
    // Throw at React's rendering boundary to exercise the real reusable boundary.
    function Broken(): never { throw new Error('Unexpected render failure') }
    render(<ErrorBoundary title="Lumen could not start" reload><Broken /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent('Unexpected render failure')
    expect(screen.getByRole('button', { name: 'Reload app' })).toBeInTheDocument()
  })

  it('does not notify after a delayed persistence request outlives Settings', async () => {
    await savedLibrary()
    let finish!: (value: boolean) => void
    browserApi('storage', { persisted: async () => false, persist: () => new Promise<boolean>((resolve) => { finish = resolve }) })
    const notify = vi.fn()
    const { unmount } = render(<SettingsPage notify={notify} onReset={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Storage protection/ }))
    unmount()
    await act(async () => { finish(true) })
    expect(notify).not.toHaveBeenCalled()
  })
})
