import { useState, useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { errorMessage } from '../lib/errors'

type Operation = 'setup' | 'install' | 'check' | 'apply'
type Failure = { operation: Operation; cause: string }
type Snapshot = { ready: boolean; unsupported: boolean; pending: Operation | ''; failure?: Failure; waiting: boolean; reload: boolean }
const titles: Record<Operation, string> = { setup: 'Offline setup', install: 'Offline install', check: 'Update check', apply: 'Applying update' }

// One document/view's optional worker lifecycle. Registration callbacks outlive effects,
// so attachment and attempt identity are separate from the current browser registration.
function offlineSupport(notify: (message: string, duration?: number) => void) {
  let snapshot: Snapshot = { ready: false, unsupported: false, pending: 'setup', waiting: false, reload: false }
  let changed = () => {}
  let attached = false
  let started = false
  let generation = 0
  let operationId = 0
  let registration: ServiceWorkerRegistration | undefined
  let application: { worker: ServiceWorker; deadline: number } | undefined
  let previousTarget: ServiceWorker | undefined
  let announced: ServiceWorker | undefined
  let retrying: Operation | undefined
  let timer: number | undefined
  let removers: (() => void)[] = []
  let workerRemovers: (() => void)[] = []
  const watched = new Set<ServiceWorker>()

  const publish = (patch: Partial<Snapshot>) => {
    if (!attached) return
    snapshot = { ...snapshot, ...patch }
    changed()
  }
  const fail = (operation: Operation, cause: unknown) => {
    operationId++
    application = undefined
    window.clearTimeout(timer)
    retrying = undefined
    publish({ pending: '', failure: { operation, cause: errorMessage(cause, 'The browser did not provide a cause.') } })
  }
  const listen = (target: EventTarget, event: string, listener: () => void, owners: (() => void)[]) => {
    target.addEventListener(event, listener)
    owners.push(() => target.removeEventListener(event, listener))
  }
  const markReady = (completedInstall: boolean) => {
    const first = !snapshot.ready
    const setup = completedInstall && retrying === snapshot.failure?.operation && (retrying === 'setup' || retrying === 'install')
    publish({ ready: true, pending: snapshot.pending === 'setup' || snapshot.pending === 'install' ? '' : snapshot.pending,
      ...(setup ? { failure: undefined } : {}) })
    if (first && attached) notify('Lumen is ready offline.')
  }
  const confirmApplication = () => {
    if (!attached || !application) return
    const { worker } = application
    if (worker.state === 'activated' && navigator.serviceWorker.controller === worker) {
      application = undefined
      window.clearTimeout(timer)
      window.location.reload()
    }
  }
  const armTimeout = () => {
    window.clearTimeout(timer)
    if (!application) return
    const request = application
    timer = window.setTimeout(() => {
      if (!attached || application !== request) return
      application = undefined
      fail('apply', new Error('The update has not finished. Retry when you are ready.'))
      reconcile()
    }, Math.max(0, request.deadline - Date.now()))
  }
  const watch = (worker: ServiceWorker) => {
    if (watched.has(worker)) return
    watched.add(worker)
    const attempt = generation
    let activated = worker.state === 'activated'
    listen(worker, 'statechange', () => {
      if (!attached || attempt !== generation) return
      if (worker.state === 'redundant' && !activated) {
        if (previousTarget === worker) {
          application = undefined
          window.clearTimeout(timer)
          fail('apply', new Error('The requested update became redundant before it finished. Check for an update again.'))
        } else fail('install', new Error('The service worker became redundant before installation completed.'))
      } else if (worker.state === 'installed' || worker.state === 'activated') {
        activated = worker.state === 'activated'
        // An installed worker has completed Workbox precaching; register() alone has not.
        markReady(true)
      }
      reconcile()
    }, workerRemovers)
  }
  function reconcile() {
    if (!attached || !registration) return
    const { installing, waiting, active } = registration
    if (installing) watch(installing)
    if (active && active.state !== 'activated') watch(active)
    if (waiting) {
      watch(waiting)
      if (waiting.state === 'installed') markReady(false)
      if (announced !== waiting) { announced = waiting; notify('An update is ready.', 12_000) }
    }
    if (active?.state === 'activated') markReady(false)
    publish({ waiting: Boolean(waiting), reload: Boolean(!application && previousTarget?.state === 'activated' && navigator.serviceWorker.controller === previousTarget) })
    confirmApplication()
  }
  const bindRegistration = () => {
    if (!registration) return
    const attempt = generation
    listen(registration, 'updatefound', () => { if (attempt === generation) reconcile() }, workerRemovers)
    reconcile()
  }
  const setup = () => {
    if (!attached || (started && snapshot.pending)) return
    started = true
    for (const remove of workerRemovers) remove()
    workerRemovers = []
    watched.clear()
    registration = undefined
    const attempt = ++generation
    publish({ pending: 'setup' })
    const current = () => attached && attempt === generation
    // The plugin's returned updater is fire-and-forget, not a registration retry
    // or activation acknowledgement. Each explicit setup retry creates a fresh instance.
    registerSW({
      onRegisteredSW: (_url, value) => {
        if (!current()) return
        if (!value) { fail('setup', new Error('The browser did not return a worker registration.')); return }
        registration = value
        publish({ pending: snapshot.ready ? '' : 'install' })
        if (value.active?.state === 'activated') markReady(true)
        bindRegistration()
      },
      onRegisterError: (error: unknown) => { if (current()) fail('setup', error) },
      onOfflineReady: () => { if (current()) markReady(false) },
      onNeedRefresh: () => { if (current()) reconcile() },
      // Always suppress the plugin's default reload, including from obsolete instances.
      onNeedReload: () => { if (current()) confirmApplication() }
    })
  }
  const check = () => {
    if (!attached || snapshot.pending || !registration) return
    const owner = registration
    const attempt = generation
    const request = ++operationId
    const failure = snapshot.failure
    publish({ pending: 'check' })
    void Promise.resolve().then(() => owner.update()).then(() => {
      if (!attached || attempt !== generation || request !== operationId) return
      publish({ pending: '', ...(failure?.operation === 'check' && snapshot.failure === failure ? { failure: undefined } : {}) })
      reconcile()
    }).catch((error: unknown) => { if (attached && attempt === generation && request === operationId) fail('check', error) })
  }
  const apply = () => {
    if (!attached || snapshot.pending) return
    const worker = registration?.waiting
    if (!worker) { check(); return }
    previousTarget = worker
    operationId++
    const request = { worker, deadline: Date.now() + 30_000 }
    application = request
    publish({ pending: 'apply' })
    armTimeout()
    // Keep the immediate lock through the current event even if native delivery throws.
    void Promise.resolve().then(() => {
      if (attached && application === request) worker.postMessage({ type: 'SKIP_WAITING' })
    }).catch((error: unknown) => {
      if (!attached || application !== request) return
      application = undefined
      window.clearTimeout(timer)
      fail('apply', error)
    })
  }
  const retry = () => {
    if (!attached || snapshot.pending) return
    if (snapshot.reload) { window.location.reload(); return }
    retrying = snapshot.failure?.operation
    // A failed first install leaves an empty, unusable native registration.
    // A fresh explicit registration is necessary; update() rejects InvalidStateError.
    if (snapshot.failure?.operation === 'setup' || (snapshot.failure?.operation === 'install' &&
      !registration?.active && !registration?.installing && !registration?.waiting)) setup()
    else if (snapshot.failure?.operation === 'apply' && registration?.waiting) apply()
    else check()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      changed = listener
      attached = true
      if (!navigator.serviceWorker) publish({ unsupported: true, pending: '' })
      else {
        listen(navigator.serviceWorker, 'controllerchange', reconcile, removers)
        listen(document, 'visibilitychange', () => {
          if (!snapshot.failure && document.visibilityState === 'visible' && navigator.onLine) check()
        }, removers)
        if (!started) setup()
        else bindRegistration()
        armTimeout()
      }
      return () => {
        attached = false
        changed = () => {}
        for (const remove of [...removers, ...workerRemovers]) remove()
        removers = []
        workerRemovers = []
        watched.clear()
        window.clearTimeout(timer)
      }
    },
    retry, apply
  }
}

export function useOfflineSupport(notify: (message: string, duration?: number) => void) {
  const [support] = useState(() => offlineSupport(notify))
  const state = useSyncExternalStore(support.subscribe, support.getSnapshot)
  const operation = state.failure?.operation
  const retryLabel = state.reload ? 'Reload app' : operation === 'apply' ? (state.waiting ? 'Retry update' : 'Retry update check')
    : operation === 'check' ? 'Retry update check' : operation === 'install' ? 'Retry offline install' : 'Retry offline setup'
  return {
    message: state.unsupported ? 'Offline support is unavailable in this browser.' : state.pending ? `${titles[state.pending]}…`
      : state.waiting ? 'An update is ready.' : state.ready ? 'Ready offline.' : 'Offline support has not finished.',
    error: state.failure ? `${titles[state.failure.operation]} failed: ${state.failure.cause}` : '',
    busy: Boolean(state.pending), retryLabel,
    needsAttention: !state.ready || state.unsupported || Boolean(state.pending || state.failure || state.waiting || state.reload),
    updateAvailable: state.waiting && operation !== 'apply', retry: support.retry, apply: support.apply
  }
}
