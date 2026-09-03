import { ArrowRight, CloudOff, Sparkles } from 'lucide-react'
import { Logo } from './Logo'

export function Onboarding({
  onFinish
}: {
  onFinish: (withSample: boolean) => Promise<void>
}) {
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
        <button className="button button--primary button--full" type="button" onClick={() => onFinish(true)}>
          Begin with three sample cards <ArrowRight size={18} />
        </button>
        <button className="button button--quiet button--full" type="button" onClick={() => onFinish(false)}>
          Start with an empty library
        </button>
      </main>
    </div>
  )
}
