import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import type { CardImageData } from '../types'
import { asBlob, readImageFile, storageError } from '../lib/images'

export function CardImage({ image, side, thumbnail = false }: { image?: CardImageData; side: string; thumbnail?: boolean }) {
  const [resource, setResource] = useState<{ image: CardImageData; url: string }>()
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    setFailed(false)
    setExpanded(false)
    if (!image) { setResource(undefined); return }
    const url = URL.createObjectURL(asBlob(image))
    setResource({ image, url })
    return () => URL.revokeObjectURL(url)
  }, [image])
  if (!image || resource?.image !== image) return null
  if (failed) return <p role="alert">This {side.toLowerCase()} image could not be displayed. Edit the card to replace it.</p>
  return <>
    <button className={`card-image-button ${thumbnail ? 'card-image-button--thumbnail' : ''}`} type="button" aria-label={`Enlarge ${side.toLowerCase()} image`} onClick={() => setExpanded(true)}>
      <img className="card-image" src={resource.url} alt={`${side} image`} onError={() => setFailed(true)} />
      {!thumbnail && <span>Tap to enlarge</span>}
    </button>
    {expanded && <Modal title={`${side} image`} wide onClose={() => setExpanded(false)}>
      <p className="muted">Pinch to zoom, or scroll to inspect the full image.</p>
      <div className="image-detail"><img src={resource.url} alt={`${side} image enlarged`} /></div>
    </Modal>}
  </>
}

export function ImageField({ side, image, onChange, disabled = false, onBusy }: {
  side: string; image?: CardImageData; onChange: (image?: Blob) => void; disabled?: boolean; onBusy?: (busy: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function choose(file?: File) {
    if (!file) return
    setBusy(true)
    onBusy?.(true)
    setError('')
    try { onChange(await readImageFile(file)) }
    catch (err) { setError(storageError(err)) }
    finally { setBusy(false); onBusy?.(false) }
  }
  return <div className="image-field">
    <label>{side} image (optional)
      <input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled || busy} onChange={(event) => {
        void choose(event.target.files?.[0]); event.target.value = ''
      }} />
    </label>
    <small>PNG, JPEG or WebP · up to 10 MB. Text can be empty when an image is attached.</small>
    {busy && <p role="status">Reading image…</p>}
    {error && <p role="alert">{error}</p>}
    <CardImage image={image} side={side} thumbnail />
    {image && <button className="text-button" type="button" disabled={disabled || busy} onClick={() => onChange(undefined)}>Remove {side.toLowerCase()} image</button>}
  </div>
}
