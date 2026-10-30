import { ArrowRight, CloudOff, Sparkles } from 'lucide-react'
import { Logo } from './Logo'
import { useAsyncAction } from '../hooks/useAsyncAction'

export function Onboarding({
  onFinish
}: {
  onFinish: (withSample: boolean) => Promise<void>
}) {
  const { busy, error, run } = useAsyncAction()
  return (
    <div className="onboarding">
      <div className="onboarding__glow" aria-hidden="true" />
      <main className="onboarding__card">
        <Logo />
        <p className="eyebrow">Remember beautifully</p>
        <h1>Less repetition.<br />More remembering.</h1>
        <p className="onboarding__lede">
          A calm, private place for the things you want to keep. Lumen learns when each card should return, so you do not have to.
        </p>
        <div className="onboarding__points">
          <div>
            <Sparkles size={19} aria-hidden="true" />
            <span><strong>Efficient by design</strong>Modern FSRS scheduling adapts after every answer.</span>
          </div>
          <div>
            <CloudOff size={19} aria-hidden="true" />
            <span><strong>Yours alone</strong>Your cards stay on this device and work offline.</span>
          </div>
        </div>
        {error && <p role="alert">Could not finish setup: {error}</p>}
        {busy && <p role="status">Setting up your library…</p>}
        <button className="button button--primary button--full" type="button" disabled={busy} onClick={() => run(() => onFinish(true))}>
          Begin with three sample cards <ArrowRight size={18} />
        </button>
        <button className="button button--quiet button--full" type="button" disabled={busy} onClick={() => run(() => onFinish(false))}>
          Start with an empty library
        </button>
      </main>
    </div>
  )
}
