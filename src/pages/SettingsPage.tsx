import { ArchiveRestore, Brain, CloudOff, Database, Download, HardDrive, Share2, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { storageError } from '../lib/images'
import { InstallGuide } from '../components/InstallGuide'
import { getSetting, resetDatabase, setSetting } from '../lib/db'
import { downloadText, makeBackup, makeLearningReport, restoreBackup, shareTextFile } from '../lib/importExport'

type Notice = (message: string) => void

export function SettingsPage({ notify, onReset }: { notify: Notice; onReset: () => void }) {
  const [retention, setRetention] = useState(90)
  const [dailyNew, setDailyNew] = useState(20)
  const [lastBackup, setLastBackup] = useState<string | null>(null)
  const [persistent, setPersistent] = useState<boolean | null>(null)

  useEffect(() => {
    void Promise.all([
      getSetting<number>('desiredRetention'),
      getSetting<number>('dailyNewCards'),
      getSetting<string | null>('lastBackupAt'),
      navigator.storage?.persisted?.() ?? Promise.resolve(null)
    ]).then(([storedRetention, storedDailyNew, storedBackup, isPersistent]) => {
      setRetention(Math.round(storedRetention * 100))
      setDailyNew(storedDailyNew)
      setLastBackup(storedBackup)
      setPersistent(isPersistent)
    })
  }, [])

  async function changeRetention(value: number) {
    setRetention(value)
    await setSetting('desiredRetention', value / 100)
  }

  async function changeDailyNew(value: number) {
    setDailyNew(value)
    await setSetting('dailyNewCards', value)
  }

  async function requestPersistence() {
    if (!navigator.storage?.persist) {
      notify('This browser does not offer persistent storage. Keep regular backups instead.')
      return
    }
    const granted = await navigator.storage.persist()
    setPersistent(granted)
    notify(granted ? 'Extra storage protection is on.' : 'iPhone decides this automatically. Installing Lumen and using it regularly helps.')
  }

  async function backup() {
    try {
      const contents = await makeBackup()
      downloadText(contents, `lumen-backup-${new Date().toISOString().slice(0, 10)}.json`)
      setLastBackup(new Date().toISOString())
      notify('Backup downloaded. Keep it in iCloud Drive.')
    } catch (error) { notify(storageError(error)) }
  }

  async function restore(file?: File) {
    if (!file) return
    if (!window.confirm('Restore this backup? Matching cards and their review schedules will be replaced. Save a full backup first if you want to keep the current versions.')) return
    try {
      const result = await restoreBackup(await file.text())
      notify(`Restored ${result.cardsAdded} cards.`)
    } catch (error) {
      notify(storageError(error))
    }
  }

  async function shareWithClaude() {
    const report = await makeLearningReport()
    const result = await shareTextFile(report, 'lumen-learning-report.md', 'Lumen learning report')
    notify(result === 'shared' ? 'Choose Claude in the share sheet.' : 'Learning report downloaded.')
  }

  async function erase() {
    if (!window.confirm('Erase every Lumen deck, card, and review on this device? This cannot be undone.')) return
    if (!window.confirm('Final check: have you saved a backup if you need one?')) return
    await resetDatabase()
    onReset()
  }

  return (
    <div className="page page--settings">
      <header className="page-header"><div><p className="eyebrow">Make it yours</p><h1>Settings</h1></div></header>

      <InstallGuide />

      <section className="settings-group">
        <div className="settings-title"><Brain size={19} /><div><h2>Learning rhythm</h2><p>FSRS adapts the exact interval for every card.</p></div></div>
        <label className="range-setting">
          <span><strong>Desired retention</strong><output>{retention}%</output></span>
          <input type="range" min="80" max="95" step="1" value={retention} onChange={(event) => changeRetention(Number(event.target.value))} />
          <small>Higher recall means more reviews. 90% is a balanced default.</small>
        </label>
        <label className="select-setting">
          <span><strong>New cards per day, per deck</strong><small>Each deck has its own allowance. Study ahead for more.</small></span>
          <select value={dailyNew} onChange={(event) => changeDailyNew(Number(event.target.value))}>
            {[5, 10, 15, 20, 30, 40, 50].map((value) => <option value={value} key={value}>{value}</option>)}
          </select>
        </label>
      </section>

      <section className="settings-group">
        <div className="settings-title"><Database size={19} /><div><h2>Your data</h2><p>Private on this device; no account or API key.</p></div></div>
        <button className="settings-row" type="button" onClick={backup}>
          <Download size={18} /><span><strong>Save a full backup</strong><small>{lastBackup ? `Last saved ${new Date(lastBackup).toLocaleDateString()}` : 'Recommended before changing phones'}</small></span><span>›</span>
        </button>
        <label className="settings-row settings-row--file">
          <ArchiveRestore size={18} /><span><strong>Restore a backup</strong><small>Restores matching cards and schedules; keeps other cards</small></span><span>›</span>
          <input type="file" accept=".json,application/json" onChange={(event) => { void restore(event.target.files?.[0]); event.target.value = '' }} />
        </label>
        <button className="settings-row" type="button" onClick={shareWithClaude}>
          <Share2 size={18} /><span><strong>Share progress with Claude</strong><small>Missed cards and review history</small></span><span>›</span>
        </button>
        <button className="settings-row" type="button" onClick={requestPersistence}>
          <HardDrive size={18} /><span><strong>Storage protection</strong><small>{persistent === true ? 'Persistent storage granted' : persistent === false ? 'Tap to request extra protection' : 'Browser-managed'}</small></span><span>›</span>
        </button>
      </section>

      <section className="privacy-note">
        <CloudOff size={19} />
        <div><strong>No cloud by default</strong><p>Lumen cannot read your Claude conversations, and Claude cannot read Lumen silently. You choose what moves between them by importing a deck or sharing a learning report.</p></div>
      </section>

      <section className="settings-group settings-group--danger">
        <button className="settings-row danger" type="button" onClick={erase}>
          <Trash2 size={18} /><span><strong>Erase all Lumen data</strong><small>Only data on this device</small></span><span>›</span>
        </button>
      </section>

      <footer className="app-footer"><span className="mini-sun" /> Lumen 1.2 · FSRS scheduling · made to last</footer>
    </div>
  )
}
