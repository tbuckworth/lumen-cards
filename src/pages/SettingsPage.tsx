import { ArchiveRestore, Brain, CloudOff, Database, Download, HardDrive, Share2, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { InstallGuide } from '../components/InstallGuide'
import { getSetting, resetDatabase, setSetting } from '../lib/db'
import { downloadText, makeBackup, makeLearningReport, restoreBackup, shareTextFile } from '../lib/importExport'
import { DEFAULT_SETTINGS, RETENTION_BOUNDS } from '../types'

type Notice = (message: string) => void

export function SettingsPage({ notify, onReset }: { notify: Notice; onReset: () => void }) {
  const displayVersion = __APP_VERSION__.split('.').slice(0, 2).join('.')
  const [settings, setSettings] = useState<{ retention: number; dailyNew: number; lastBackup: string | null } | null>(null)
  const [persistent, setPersistent] = useState<'checking' | 'unsupported' | boolean>('checking')
  const mounted = useRef(false)
  const loading = useAsyncAction()
  const { busy: writing, run: write } = useAsyncAction()
  const retentionAction = useAsyncAction()
  const dailyNewAction = useAsyncAction()
  const storageStatus = useAsyncAction()
  const protection = useAsyncAction()
  const backupAction = useAsyncAction()
  const restoreAction = useAsyncAction()
  const shareAction = useAsyncAction()
  const eraseAction = useAsyncAction()

  const readPreferences = useCallback(() => loading.run(async () => {
    const [retention, dailyNew, lastBackup] = await Promise.all([
      getSetting<number>('desiredRetention'), getSetting<number>('dailyNewCards'), getSetting<string | null>('lastBackupAt')
    ])
    if (mounted.current) setSettings({ retention: Math.round(retention * 100), dailyNew, lastBackup })
  }), [loading.run])

  const checkStorage = useCallback(() => storageStatus.run(async () => {
    const value = navigator.storage?.persisted ? await navigator.storage.persisted() : 'unsupported'
    if (mounted.current) setPersistent(value)
  }), [storageStatus.run])

  useEffect(() => {
    mounted.current = true
    void readPreferences()
    void checkStorage()
    return () => { mounted.current = false }
  }, [readPreferences, checkStorage])

  async function changeRetention(value: number) {
    await write(() => retentionAction.run(async () => {
      await setSetting('desiredRetention', value / 100)
      if (mounted.current) setSettings((current) => current && { ...current, retention: value })
    }))
  }

  async function changeDailyNew(value: number) {
    await write(() => dailyNewAction.run(async () => {
      await setSetting('dailyNewCards', value)
      if (mounted.current) setSettings((current) => current && { ...current, dailyNew: value })
    }))
  }

  async function requestPersistence() {
    await protection.run(async () => {
      if (!navigator.storage?.persist) {
        setPersistent('unsupported')
        return
      }
      const granted = await navigator.storage.persist()
      if (!mounted.current) return
      setPersistent(granted)
      notify(granted ? 'Extra storage protection is on.' : 'iPhone decides this automatically. Installing Lumen and using it regularly helps.')
    })
  }

  async function backup() {
    await write(() => backupAction.run(async () => {
      const contents = await makeBackup()
      const lastBackup = await getSetting<string | null>('lastBackupAt')
      if (!mounted.current) return
      downloadText(contents, `lumen-backup-${new Date().toISOString().slice(0, 10)}.json`)
      setSettings((current) => current && { ...current, lastBackup })
      notify('Backup downloaded. Keep it in iCloud Drive.')
    }))
  }

  async function restore(file?: File) {
    if (!file) return
    await write(() => restoreAction.run(async () => {
      if (!window.confirm('Restore this backup? Matching cards and their review schedules will be replaced. Save a full backup first if you want to keep the current versions.')) return
      const result = await restoreBackup(await file.text())
      if (!mounted.current) return
      notify(`Restored ${result.cardsAdded} cards.`)
      setSettings(null)
      await readPreferences()
    }))
  }

  async function shareWithClaude() {
    await shareAction.run(async () => {
      const report = await makeLearningReport()
      if (!mounted.current) return
      const result = await shareTextFile(report, 'lumen-learning-report.md', 'Lumen learning report')
      if (mounted.current && result !== 'cancelled') notify(result === 'shared' ? 'Choose Claude in the share sheet.' : 'Learning report downloaded.')
    })
  }

  async function erase() {
    await write(() => eraseAction.run(async () => {
      if (!window.confirm('Erase every Lumen deck, card, and review on this device? This cannot be undone.')) return
      if (!window.confirm('Final check: have you saved a backup if you need one?')) return
      await resetDatabase()
      if (mounted.current) onReset()
    }))
  }

  if (!settings) return <div className="page page--settings">
    <h1>Settings</h1>
    {loading.error ? <><p role="alert">Could not load preferences: {loading.error}</p><button type="button" className="button button--primary" disabled={loading.busy} onClick={readPreferences}>Retry</button></> : <p role="status">Loading preferences…</p>}
  </div>
  const { retention, dailyNew, lastBackup } = settings
  const errors = [
    ['Could not save desired retention', retentionAction.error], ['Could not save new-card allowance', dailyNewAction.error],
    ['Could not check storage protection', storageStatus.error],
    ['Could not request storage protection', protection.error], ['Could not save backup', backupAction.error],
    ['Could not restore backup', restoreAction.error], ['Could not share progress', shareAction.error], ['Could not erase library', eraseAction.error]
  ]
  return (
    <div className="page page--settings">
      <header className="page-header"><div><p className="eyebrow">Make it yours</p><h1>Settings</h1></div></header>

      <InstallGuide />
      {errors.map(([operation, error]) => error && <p role="alert" key={operation}>{operation}: {error}</p>)}
      {writing && <p role="status">Saving changes… Keep Lumen open until this finishes.</p>}
      {storageStatus.error && <button type="button" disabled={storageStatus.busy} onClick={checkStorage}>Retry storage check</button>}

      <section className="settings-group">
        <div className="settings-title"><Brain size={19} /><div><h2>Learning rhythm</h2><p>FSRS adapts the exact interval for every card.</p></div></div>
        <label className="range-setting">
          <span><strong>Desired retention</strong><output>{retention}%</output></span>
          <input type="range" disabled={writing} min={RETENTION_BOUNDS.min * 100} max={RETENTION_BOUNDS.max * 100} step="1" value={retention} onChange={(event) => changeRetention(Number(event.target.value))} />
          <small>Higher recall means more reviews. {Math.round(DEFAULT_SETTINGS.desiredRetention * 100)}% is a balanced default.</small>
        </label>
        <label className="select-setting">
          <span><strong>New cards per day, per deck</strong><small>Each deck has its own allowance. Study ahead for more.</small></span>
          <select disabled={writing} value={dailyNew} onChange={(event) => changeDailyNew(Number(event.target.value))}>
            {[5, 10, 15, 20, 30, 40, 50].map((value) => <option value={value} key={value}>{value}</option>)}
          </select>
        </label>
      </section>

      <section className="settings-group">
        <div className="settings-title"><Database size={19} /><div><h2>Your data</h2><p>Private on this device; no account or API key.</p></div></div>
        <button className="settings-row" type="button" disabled={writing} onClick={backup}>
          <Download size={18} /><span><strong>Save a full backup</strong><small>{lastBackup ? `Last saved ${new Date(lastBackup).toLocaleDateString()}` : 'Recommended before changing phones'}</small></span><span>›</span>
        </button>
        <label className="settings-row settings-row--file">
          <ArchiveRestore size={18} /><span><strong>Restore a backup</strong><small>Restores matching cards and schedules; keeps other cards</small></span><span>›</span>
          <input type="file" disabled={writing} accept=".json,application/json" onChange={(event) => { void restore(event.target.files?.[0]); event.target.value = '' }} />
        </label>
        <button className="settings-row" type="button" disabled={shareAction.busy} onClick={shareWithClaude}>
          <Share2 size={18} /><span><strong>Share progress with Claude</strong><small>Missed cards and review history</small></span><span>›</span>
        </button>
        <button className="settings-row" type="button" disabled={protection.busy || storageStatus.busy} onClick={requestPersistence}>
          <HardDrive size={18} /><span><strong>Storage protection</strong><small>{storageStatus.error ? 'Storage status could not be checked' : persistent === true ? 'Persistent storage granted' : persistent === false ? 'Tap to request extra protection' : persistent === 'unsupported' ? 'This browser does not offer persistent storage. Keep regular backups instead.' : 'Checking storage protection…'}</small></span><span>›</span>
        </button>
      </section>

      <section className="privacy-note">
        <CloudOff size={19} />
        <div><strong>No cloud by default</strong><p>Lumen cannot read your Claude conversations, and Claude cannot read Lumen silently. You choose what moves between them by importing a deck or sharing a learning report.</p></div>
      </section>

      <section className="settings-group settings-group--danger">
        <button className="settings-row danger" type="button" disabled={writing} onClick={erase}>
          <Trash2 size={18} /><span><strong>Erase all Lumen data</strong><small>Only data on this device</small></span><span>›</span>
        </button>
      </section>

      <footer className="app-footer"><span className="mini-sun" /> Lumen {displayVersion} · FSRS scheduling · made to last</footer>
    </div>
  )
}
