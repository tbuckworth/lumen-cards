import { useState } from 'react'
import { ImageField } from './CardImage'
import type { CardImageData, CardRecord } from '../types'

export type CardDraft = {
  front: string
  back: string
  notes: string
  tags: string
  source: string
  frontImage?: CardImageData
  backImage?: CardImageData
}

type CardDraftSeed = Pick<CardRecord, 'front' | 'back' | 'notes' | 'tags' | 'source' | 'frontImage' | 'backImage'>

export function useCardDraft(initial?: CardDraftSeed) {
  const [seed] = useState<CardDraft>(() => ({
    front: initial?.front ?? '', back: initial?.back ?? '', notes: initial?.notes ?? '',
    tags: initial?.tags.join(', ') ?? '', source: initial?.source ?? '',
    frontImage: initial?.frontImage, backImage: initial?.backImage
  }))
  const [draft, setDraft] = useState(seed)
  const updateDraft = (patch: Partial<CardDraft>) => setDraft((previous) => ({ ...previous, ...patch }))
  const resetDraft = () => setDraft(seed)
  const canSave = Boolean((draft.front.trim() || draft.frontImage) && (draft.back.trim() || draft.backImage))
  return { draft, updateDraft, resetDraft, canSave }
}

export function CardContentFields({ draft, onChange, mode, disabled, onImageBusyChange }: {
  draft: CardDraft
  onChange: (patch: Partial<CardDraft>) => void
  mode: 'create' | 'edit'
  disabled: boolean
  onImageBusyChange: (busy: boolean) => void
}) {
  const creating = mode === 'create'
  const notesAndTags = <>
    <label>Extra note<textarea value={draft.notes} onChange={(event) => onChange({ notes: event.target.value })} placeholder={creating ? 'Context or a helpful explanation' : undefined} /></label>
    <label>Tags<input value={draft.tags} onChange={(event) => onChange({ tags: event.target.value })} placeholder="paper, methods" /></label>
  </>
  return <>
    <label>{creating ? 'Question or prompt' : 'Front'}<textarea autoFocus={creating} value={draft.front} onChange={(event) => onChange({ front: event.target.value })} placeholder={creating ? 'What do I want to remember?' : undefined} required={!draft.frontImage} /></label>
    <ImageField side="Front" image={draft.frontImage} onChange={(frontImage) => onChange({ frontImage })} disabled={disabled} onBusy={onImageBusyChange} />
    <label>{creating ? 'Answer' : 'Back'}<textarea value={draft.back} onChange={(event) => onChange({ back: event.target.value })} placeholder={creating ? 'Keep it clear and atomic' : undefined} required={!draft.backImage} /></label>
    <ImageField side="Back" image={draft.backImage} onChange={(backImage) => onChange({ backImage })} disabled={disabled} onBusy={onImageBusyChange} />
    {creating ? <details className="form-details">
      <summary>Notes, tags & source</summary>
      {notesAndTags}
      <label>Source<input value={draft.source} onChange={(event) => onChange({ source: event.target.value })} placeholder="Paper, book, or URL" /></label>
    </details> : notesAndTags}
  </>
}
