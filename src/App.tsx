import { useCallback, useEffect, useRef, useState } from 'react'
import { AppNotice } from './components/AppNotice'
import { BottomNav } from './components/BottomNav'
import { Logo } from './components/Logo'
import { Onboarding } from './components/Onboarding'
import { ErrorBoundary } from './components/ErrorBoundary'
import { db, getSetting, seedSampleDeck, setSetting } from './lib/db'
import { storageError } from './lib/errors'
import { useAsyncAction } from './hooks/useAsyncAction'
import { useOfflineSupport } from './hooks/useOfflineSupport'
import type { StudyMode } from './lib/studyQueue'
import { AddPage } from './pages/AddPage'
import { DecksPage } from './pages/DecksPage'
import { HomePage } from './pages/HomePage'
import { ReviewPage } from './pages/ReviewPage'
import { SettingsPage } from './pages/SettingsPage'
import type { Route } from './types'

const VALID_ROUTES: Route[] = ['home', 'decks', 'add', 'settings', 'review']

function routeFromHash(): Route {
  const value = window.location.hash.replace('#/', '') as Route
  return VALID_ROUTES.includes(value) ? value : 'home'
}

export default function App() {
  const [route, setRoute] = useState<Route>(routeFromHash)
  const [ready, setReady] = useState(false)
  const [startupError, setStartupError] = useState('')
  const [startupAttempt, setStartupAttempt] = useState(0)
  const protection = useAsyncAction()
  const [onboardingComplete, setOnboardingComplete] = useState(true)
  const [reviewDeckId, setReviewDeckId] = useState<string | undefined>()
  const [reviewMode, setReviewMode] = useState<StudyMode>('due')
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | undefined>(undefined)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; window.clearTimeout(toastTimer.current) }
  }, [])

  const notify = useCallback((message: string, duration = 3600) => {
    window.clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = window.setTimeout(() => setToast(''), duration)
  }, [])
  const offline = useOfflineSupport(notify)

  useEffect(() => {
    let current = true
    setStartupError('')
    void getSetting<boolean>('onboardingComplete').then((value) => {
      if (!current) return
      setOnboardingComplete(value)
      setReady(true)
    }).catch((error: unknown) => { if (current) setStartupError(storageError(error)) })
    return () => { current = false }
  }, [startupAttempt])

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash())
    window.addEventListener('hashchange', onHash)
    return () => { window.removeEventListener('hashchange', onHash) }
  }, [])

  const navigate = useCallback((next: Route) => {
    if (next === 'review') return
    window.location.hash = `/${next}`
    setRoute(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const startReview = useCallback((deckId?: string, mode: StudyMode = 'due') => {
    setReviewDeckId(deckId)
    setReviewMode(mode)
    setRoute('review')
  }, [])

  const requestProtection = useCallback(() => protection.run(async () => {
    if (navigator.storage?.persist) await navigator.storage.persist()
  }), [protection.run])

  async function finishOnboarding(withSample: boolean) {
    await db.transaction('rw', db.decks, db.cards, db.settings, async () => {
      if (withSample) await seedSampleDeck()
      await setSetting('onboardingComplete', true)
    })
    if (!mounted.current) return
    setOnboardingComplete(true)
    await requestProtection()
  }

  function resetOnboarding() {
    setOnboardingComplete(false)
    navigate('home')
  }

  const showOffline = offline.needsAttention || !onboardingComplete || route === 'settings'
  const notices = (showOffline || protection.error) && <div className="app-notices">
    {showOffline && <AppNotice label="Offline status" message={offline.message} error={offline.error} busy={offline.busy}
      retryLabel={offline.retryLabel} onRetry={offline.retry}>
      {offline.updateAvailable && <button className="text-button" type="button" disabled={offline.busy} onClick={offline.apply}>Update now</button>}
    </AppNotice>}
    {protection.error && <AppNotice label="Storage protection" error={`Storage protection could not be requested: ${protection.error}`}
      busy={protection.busy} retryLabel="Retry storage protection" onRetry={requestProtection} />}
  </div>

  if (!ready) return <>{notices}<div className="app-loading"><Logo />{startupError ? <>
    <p role="alert">Could not open your library: {startupError}</p>
    <button className="button button--primary" type="button" onClick={() => setStartupAttempt((attempt) => attempt + 1)}>Retry</button>
  </> : <span className="loading-line" />}</div></>
  if (!onboardingComplete) return <>{notices}<Onboarding onFinish={finishOnboarding} /></>

  return (
    <div className={`app-shell route-${route}`}>
      {route !== 'review' && <header className="desktop-brand"><Logo /></header>}
      <main className="app-main">
        {notices}
        <ErrorBoundary key={route} title="Could not load this page">
        {route === 'home' && <HomePage navigate={navigate} startReview={startReview} />}
        {route === 'decks' && <DecksPage navigate={navigate} startReview={startReview} notify={notify} />}
        {route === 'add' && <AddPage navigate={navigate} notify={notify} />}
        {route === 'settings' && <SettingsPage notify={notify} onReset={resetOnboarding} />}
        {route === 'review' && <ReviewPage deckId={reviewDeckId} mode={reviewMode} onClose={() => navigate('home')} />}
        </ErrorBoundary>
      </main>
      <BottomNav route={route} onNavigate={navigate} />
      <div className={`toast ${toast ? 'is-visible' : ''}`} role="status" aria-live="polite">
        <span>{toast}</span>
      </div>
    </div>
  )
}
