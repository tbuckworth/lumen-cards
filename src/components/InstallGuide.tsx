import { Check, Share, Smartphone } from 'lucide-react'

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
}

export function InstallGuide() {
  const installed = isStandalone()
  return (
    <section className="panel install-guide">
      <span className="panel__icon"><Smartphone size={21} /></span>
      <div>
        <p className="eyebrow">iPhone setup</p>
        <h2>{installed ? 'Installed and ready' : 'Put Lumen on your Home Screen'}</h2>
        {installed ? (
          <p className="muted"><Check size={16} /> Lumen is open as an app. It will keep working without a connection.</p>
        ) : (
          <ol>
            <li>Open this page in <strong>Safari</strong>.</li>
            <li>Tap <Share size={15} aria-label="Share" /> <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</li>
            <li>Keep <strong>Open as Web App</strong> on, then tap <strong>Add</strong>.</li>
          </ol>
        )}
      </div>
    </section>
  )
}
