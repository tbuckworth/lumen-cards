import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export function Modal({
  title,
  children,
  onClose,
  wide = false
}: {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
}) {
  return (
    <div className="modal-shell" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal ${wide ? 'modal--wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header className="modal__header">
          <h2 id="modal-title">{title}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={21} />
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}
