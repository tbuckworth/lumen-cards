import type { ReactNode } from 'react'

export function AppNotice({ label, message, error, busy, retryLabel, onRetry, children }: {
  label: string; message?: string; error: string; busy: boolean; retryLabel: string; onRetry: () => void; children?: ReactNode
}) {
  return <section className="app-notice" aria-label={label}>
    {message && <p role="status">{message}</p>}
    {error && <><p role="alert">{error}</p>
      <button className="text-button" type="button" disabled={busy} onClick={onRetry}>{retryLabel}</button></>}
    {children}
  </section>
}
