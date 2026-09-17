import { CardImage } from '../components/CardImage'
import { storageError } from '../lib/images'
import { ArrowLeft, Check, RotateCcw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Rating, State, type Grade } from 'ts-fsrs'
import { db, getSetting } from '../lib/db'
import { startOfLocalDay } from '../lib/dates'
import { makeReviewId } from '../lib/importExport'
import { formatInterval, previewRatings, RATINGS, RATING_LABELS, scheduleReview, serializeFsrsCard } from '../lib/scheduler'
import { selectStudyQueue, type StudyMode } from '../lib/studyQueue'
import type { CardRecord } from '../types'

interface SessionResult {
  cardId: string
  rating: Grade
  reviewId: string
  previousCard: CardRecord
  savedAt: string
}

export function ReviewPage({ deckId, mode = 'due', onClose }: { deckId?: string; mode?: StudyMode; onClose: () => void }) {
  const [queue, setQueue] = useState<CardRecord[] | null>(null)
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [results, setResults] = useState<SessionResult[]>([])
  const [retention, setRetention] = useState(0.9)
  const shownAt = useRef(Date.now())
  const saving = useRef(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadQueue() {
      const [allCards, dailyNewCards, desiredRetention, todaysReviews] = await Promise.all([
        deckId ? db.cards.where('deckId').equals(deckId).toArray() : db.cards.toArray(),
        getSetting<number>('dailyNewCards'),
        getSetting<number>('desiredRetention'),
        db.reviews.where('reviewedAt').aboveOrEqual(startOfLocalDay().toISOString()).toArray()
      ])
      setRetention(desiredRetention)
      const reviews = deckId ? todaysReviews.filter((review) => review.deckId === deckId) : todaysReviews
      setQueue(selectStudyQueue(allCards, reviews, dailyNewCards, new Date(), mode))
      shownAt.current = Date.now()
    }
    void loadQueue().catch((error) => setError(storageError(error)))
  }, [deckId, mode])

  const current = queue?.[index]
  const previews = useMemo(
    () => current ? previewRatings(current, new Date(), retention) : [],
    [current, retention, revealed]
  )

  const rate = useCallback(async (rating: Grade) => {
    if (!current || !revealed || saving.current) return
    saving.current = true
    setError('')
    try {
      const now = new Date()
      const result = scheduleReview(current, rating, now, retention)
      const stored = serializeFsrsCard(result.card)
      const reviewId = makeReviewId()
      await db.transaction('rw', db.cards, db.reviews, async () => {
        const latest = await db.cards.get(current.id)
        if (!latest || latest.updatedAt !== current.updatedAt) throw new Error('This card changed in another window. End this review and start again to load the latest version.')
        await db.cards.update(current.id, {
          fsrs: stored,
          due: stored.due,
          updatedAt: now.toISOString()
        })
        await db.reviews.add({
          id: reviewId,
          cardId: current.id,
          deckId: current.deckId,
          rating,
          state: result.log.state,
          reviewedAt: now.toISOString(),
          durationMs: Math.max(0, Date.now() - shownAt.current),
          scheduledDays: result.log.scheduled_days,
          elapsedDays: result.log.elapsed_days
        })
      })
      setResults((items) => [...items, { cardId: current.id, rating, reviewId, previousCard: current, savedAt: now.toISOString() }])
      setIndex((value) => value + 1)
      setRevealed(false)
      shownAt.current = Date.now()
    } catch (error) { setError(storageError(error)) }
    finally { saving.current = false }
  }, [current, retention, revealed])

  const undoLast = useCallback(async () => {
    const previous = results.at(-1)
    if (!previous || saving.current) return
    saving.current = true
    setError('')
    try {
      await db.transaction('rw', db.cards, db.reviews, async () => {
        const latest = await db.cards.get(previous.cardId)
        if (!latest || latest.updatedAt !== previous.savedAt || !await db.reviews.get(previous.reviewId)) throw new Error('This card or review was changed elsewhere. End this review and start again.')
        await db.cards.put({ ...latest, fsrs: previous.previousCard.fsrs, due: previous.previousCard.due, updatedAt: new Date().toISOString() })
        await db.reviews.delete(previous.reviewId)
      })
      const restored = await db.cards.get(previous.cardId)
      if (restored) setQueue((cards) => cards?.map((card) => card.id === restored.id ? restored : card) ?? null)
      setResults((items) => items.slice(0, -1))
      setIndex((value) => Math.max(0, value - 1))
      setRevealed(true)
      shownAt.current = Date.now()
    } catch (error) { setError(storageError(error)) }
    finally { saving.current = false }
  }, [results])

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.repeat || document.querySelector('[role=dialog]') || (event.target instanceof HTMLElement && event.target.matches('button, input, textarea, select'))) return
      if (event.key === 'Escape') onClose()
      if ((event.key === ' ' || event.key === 'Enter') && current && !revealed) {
        event.preventDefault()
        setRevealed(true)
      }
      if (revealed && ['1', '2', '3', '4'].includes(event.key)) {
        void rate(RATINGS[Number(event.key) - 1])
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [current, onClose, rate, revealed])

  if (!queue && error) return <div className="review-shell"><p role="alert">{error}</p><button className="button" onClick={onClose}>Return home</button></div>

  if (!queue) {
    return <div className="review-shell"><div className="loading-orb" aria-label="Preparing your cards" /></div>
  }

  if (!queue.length || index >= queue.length) {
    const again = results.filter((result) => result.rating === Rating.Again).length
    const remembered = results.length - again
    return (
      <div className="review-shell review-complete">
        {error && <p role="alert">{error}</p>}
        <div className="review-complete__mark"><Check size={32} /></div>
        <p className="eyebrow">Session complete</p>
        <h1>{results.length ? 'Well remembered.' : 'Nothing due just now.'}</h1>
        <p>{results.length ? `${remembered} of ${results.length} recalled. ${again ? `${again} will return soon.` : 'A clean sweep.'}` : 'Come back when the next card is ready.'}</p>
        {!!results.length && (
          <div className="session-dots" aria-label={`${remembered} remembered, ${again} missed`}>
            {results.map((result, resultIndex) => <span className={result.rating === Rating.Again ? 'is-missed' : ''} key={`${result.cardId}-${resultIndex}`} />)}
          </div>
        )}
        <div className="review-complete__actions">
          {!!results.length && <button className="button button--quiet" type="button" onClick={undoLast}><ArrowLeft size={16} /> Undo last</button>}
          <button className="button button--ink" type="button" onClick={onClose}>Return home</button>
        </div>
      </div>
    )
  }

  if (!current) return null

  const percent = Math.round((index / queue.length) * 100)
  return (
    <div className="review-shell">
      <header className="review-header">
        <button className="icon-button" type="button" onClick={onClose} aria-label="End review"><X /></button>
        <div className="review-progress" role="progressbar" aria-label="Review progress" aria-valuemin={0} aria-valuemax={queue.length} aria-valuenow={index}>
          <span style={{ width: `${percent}%` }} />
        </div>
        {results.length ? (
          <button className="review-undo" type="button" onClick={undoLast} aria-label="Undo last answer"><ArrowLeft size={14} /> Undo</button>
        ) : <span className="review-count">{index + 1}/{queue.length}</span>}
      </header>

      {error && <p role="alert">{error}</p>}
      <section className={`review-card ${revealed ? 'is-revealed' : ''}`} aria-live="polite">
        <p className="eyebrow">{current.fsrs.state === State.New ? 'New card' : 'Recall'}</p>
        <section className="review-card__front">
          <h1>{current.front || 'Identify the image'}</h1>
          <CardImage key={`${current.id}-front`} image={current.frontImage} side="Front" />
        </section>
        {revealed && (
          <section className="review-card__answer">
            <span className="answer-rule" />
            <p>{current.back}</p>
            <CardImage key={`${current.id}-back`} image={current.backImage} side="Back" />
            {current.notes && <aside><strong>Note</strong>{current.notes}</aside>}
            {current.source && <small>Source: {current.source}</small>}
          </section>
        )}
      </section>

      {!revealed ? (
        <footer className="review-footer">
          <p>Try to answer before revealing.</p>
          <button className="button button--ink button--full" type="button" onClick={() => setRevealed(true)}>Show answer</button>
        </footer>
      ) : (
        <footer className="rating-footer">
          <p>How did that feel?</p>
          <div className="rating-grid">
            {RATINGS.map((rating, ratingIndex) => (
              <button className={`rating rating--${RATING_LABELS[rating].toLowerCase()}`} type="button" key={rating} onClick={() => rate(rating)}>
                <span>{rating === Rating.Again && <RotateCcw size={16} />}{RATING_LABELS[rating]}</span>
                <small>{previews[ratingIndex] ? formatInterval(previews[ratingIndex].card.due) : '—'}</small>
              </button>
            ))}
          </div>
        </footer>
      )}
    </div>
  )
}
