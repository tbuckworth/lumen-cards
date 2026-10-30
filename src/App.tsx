import { useCallback, useEffect, useRef, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { BottomNav } from './components/BottomNav'
import { Logo } from './components/Logo'
import { Onboarding } from './components/Onboarding'
import { ErrorBoundary } from './components/ErrorBoundary'
import { db, getSetting, seedSampleDeck, setSetting } from './lib/db'
import { storageError } from './lib/errors'
import { useAsyncAction } from './hooks/useAsyncAction'
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
  const [updateAction, setUpdateAction] = useState<(() => void) | null>(null)
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
    let registration: ServiceWorkerRegistration | undefined
    const checkUpdate = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void registration?.update().catch(() => {})
    }
    document.addEventListener('visibilitychange', checkUpdate)
    const updateSW = registerSW({
      onRegisteredSW: (_url, value) => { registration = value; checkUpdate() },
      onOfflineReady: () => notify('Lumen is ready offline.'),
      onNeedRefresh: () => {
        setUpdateAction(() => () => {
          setUpdateAction(null)
          void updateSW(true)
        })
        notify('An update is ready.', 12_000)
      },
      onRegisterError: () => notify('Offline setup could not finish. Lumen still works while connected.')
    })
    return () => { window.removeEventListener('hashchange', onHash); document.removeEventListener('visibilitychange', checkUpdate) }
  }, [notify])

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

  if (!ready) return <div className="app-loading"><Logo />{startupError ? <>
    <p role="alert">Could not open your library: {startupError}</p>
    <button className="button button--primary" type="button" onClick={() => setStartupAttempt((attempt) => attempt + 1)}>Retry</button>
  </> : <span className="loading-line" />}</div>
  if (!onboardingComplete) return <Onboarding onFinish={finishOnboarding} />

  return (
    <div className={`app-shell route-${route}`}>
      {route !== 'review' && <header className="desktop-brand"><Logo /></header>}
      <main className="app-main">
        {protection.error && <div><p role="alert">Storage protection could not be requested: {protection.error}</p>
          <button type="button" disabled={protection.busy} onClick={requestProtection}>Retry storage protection</button></div>}
        <ErrorBoundary key={route} title="Could not load this page">
        {route === 'home' && <HomePage navigate={navigate} startReview={startReview} />}
        {route === 'decks' && <DecksPage navigate={navigate} startReview={startReview} notify={notify} />}
        {route === 'add' && <AddPage navigate={navigate} notify={notify} />}
        {route === 'settings' && <SettingsPage notify={notify} onReset={resetOnboarding} />}
        {route === 'review' && <ReviewPage deckId={reviewDeckId} mode={reviewMode} onClose={() => navigate('home')} />}
        </ErrorBoundary>
      </main>
      <BottomNav route={route} onNavigate={navigate} />
      <div className={`toast ${toast || updateAction ? 'is-visible' : ''}`} role="status" aria-live="polite">
        <span>{toast || (updateAction ? 'An update is ready.' : '')}</span>
        {updateAction && <button type="button" onClick={updateAction}>Update now</button>}
      </div>
    </div>
  )
}
