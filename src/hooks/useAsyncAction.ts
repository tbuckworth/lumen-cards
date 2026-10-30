import { useCallback, useRef, useState } from 'react'
import { storageError } from '../lib/errors'

export function useAsyncAction(isBlocked?: () => boolean) {
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = useCallback(async (operation: () => Promise<void>): Promise<void> => {
    if (lock.current || isBlocked?.()) return
    lock.current = true
    setBusy(true)
    setError('')
    try { await operation() }
    catch (error) { setError(storageError(error)) }
    finally { lock.current = false; setBusy(false) }
  }, [isBlocked])

  return { busy, error, run }
}
