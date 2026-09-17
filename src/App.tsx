import { useCallback, useEffect, useRef, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { BottomNav } from './components/BottomNav'
import { Logo } from './components/Logo'
import { Onboarding } from './components/Onboarding'
import { getSetting, seedSampleDeck, setSetting } from './lib/db'
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
  const [onboardingComplete, setOnboardingComplete] = useState(true)
  const [reviewDeckId, setReviewDeckId] = useState<string | undefined>()
  const [reviewMode, setReviewMode] = useState<StudyMode>('due')
  const [toast, setToast] = useState('')
  const [updateAction, setUpdateAction] = useState<(() => void) | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const notify = useCallback((message: string, duration = 3600) => {
    window.clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = window.setTimeout(() => setToast(''), duration)
  }, [])

  useEffect(() => {
    void getSetting<boolean>('onboardingComplete').then((value) => {
      setOnboardingComplete(value)
      setReady(true)
    })
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

  async function finishOnboarding(withSample: boolean) {
    if (withSample) await seedSampleDeck()
    await setSetting('onboardingComplete', true)
    setOnboardingComplete(true)
    if (navigator.storage?.persist) void navigator.storage.persist()
  }

  function resetOnboarding() {
    setOnboardingComplete(false)
    navigate('home')
  }

  if (!ready) return <div className="app-loading"><Logo /><span className="loading-line" /></div>
  if (!onboardingComplete) return <Onboarding onFinish={finishOnboarding} />

  return (
    <div className={`app-shell route-${route}`}>
      {route !== 'review' && <header className="desktop-brand"><Logo /></header>}
      <main className="app-main">
        {route === 'home' && <HomePage navigate={navigate} startReview={startReview} />}
        {route === 'decks' && <DecksPage navigate={navigate} startReview={startReview} notify={notify} />}
        {route === 'add' && <AddPage navigate={navigate} notify={notify} />}
        {route === 'settings' && <SettingsPage notify={notify} onReset={resetOnboarding} />}
        {route === 'review' && <ReviewPage deckId={reviewDeckId} mode={reviewMode} onClose={() => navigate('home')} />}
      </main>
      <BottomNav route={route} onNavigate={navigate} />
      <div className={`toast ${toast || updateAction ? 'is-visible' : ''}`} role="status" aria-live="polite">
        <span>{toast || (updateAction ? 'An update is ready.' : '')}</span>
        {updateAction && <button type="button" onClick={updateAction}>Update now</button>}
      </div>
    </div>
  )
}
