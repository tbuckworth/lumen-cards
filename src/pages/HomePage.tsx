import { ArrowRight, BookOpen, CloudOff, Flame, Layers3 } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { getSetting } from '../lib/db'
import { calculateStreak, greeting, relativeDate, startOfLocalDay } from '../lib/dates'
import { hasNewCards, selectStudyQueue, type StudyMode } from '../lib/studyQueue'
import type { Route } from '../types'
import { EmptyState } from '../components/EmptyState'

export function HomePage({
  navigate,
  startReview
}: {
  navigate: (route: Route) => void
  startReview: (deckId?: string, mode?: StudyMode) => void
}) {
  const data = useLiveQuery(async () => {
    const [decks, cards, reviews, dailyNewCards] = await Promise.all([
      db.decks.orderBy('updatedAt').reverse().toArray(),
      db.cards.toArray(),
      db.reviews.toArray(),
      getSetting<number>('dailyNewCards')
    ])
    return { decks, cards, reviews, dailyNewCards }
  }, [], { decks: [], cards: [], reviews: [], dailyNewCards: 20 })

  const now = new Date()
  const todaysReviews = data.reviews.filter(
    (review) => new Date(review.reviewedAt) >= startOfLocalDay(now)
  )
  const dueCards = selectStudyQueue(data.cards, todaysReviews, data.dailyNewCards, now)
  const reviewedToday = todaysReviews.length
  const totalToday = dueCards.length + reviewedToday
  const progress = totalToday ? Math.round((reviewedToday / totalToday) * 100) : 100
  const streak = calculateStreak(data.reviews.map((review) => review.reviewedAt))
  const nextDue = data.cards
    .filter((card) => !card.suspended && new Date(card.due) > now)
    .sort((a, b) => a.due.localeCompare(b.due))[0]

  const deckRows = data.decks.map((deck) => {
    const cards = data.cards.filter((card) => card.deckId === deck.id)
    const reviews = todaysReviews.filter((review) => review.deckId === deck.id)
    return {
      deck,
      count: cards.length,
      due: selectStudyQueue(cards, reviews, data.dailyNewCards, now).length
    }
  })

  return (
    <div className="page page--home">
      <header className="page-header home-header">
        <div>
          <p className="eyebrow">{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1>{greeting()}.</h1>
        </div>
        <span className="privacy-dot" title="Stored privately on this device"><CloudOff size={17} /></span>
      </header>

      {data.cards.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Your first card is waiting"
          action={<button className="button button--primary" onClick={() => navigate('add')}>Create a card</button>}
        >
          Write one yourself, or ask Claude to make a deck and import it in a few taps.
        </EmptyState>
      ) : (
        <>
          <section className="today-card">
            <div className="progress-ring" style={{ '--progress': `${progress * 3.6}deg` } as React.CSSProperties}>
              <span>{dueCards.length}</span>
              <small>due</small>
            </div>
            <div className="today-card__copy">
              <p className="eyebrow">Today’s practice</p>
              <h2>{dueCards.length ? `${dueCards.length} ${dueCards.length === 1 ? 'card' : 'cards'} ready` : 'All caught up'}</h2>
              <p>{reviewedToday ? `${reviewedToday} reviewed today` : nextDue ? `Next card ${relativeDate(nextDue.due)}` : 'A clear slate'}</p>
            </div>
            <div className="today-card__actions">
              <button
                className="button button--ink today-card__button"
                type="button"
                disabled={!dueCards.length}
                onClick={() => startReview()}
              >
                {dueCards.length ? 'Begin' : <span><span className="checkmark">✓</span> Done</span>}
                {dueCards.length > 0 && <ArrowRight size={18} />}
              </button>
              {!dueCards.length && hasNewCards(data.cards) && (
                <button className="text-button study-ahead" type="button" onClick={() => startReview(undefined, 'ahead')}>
                  Study ahead
                </button>
              )}
            </div>
          </section>

          <section className="stat-grid" aria-label="Learning summary">
            <div className="stat-card">
              <Flame size={18} />
              <strong>{streak}</strong>
              <span>day streak</span>
            </div>
            <div className="stat-card">
              <Layers3 size={18} />
              <strong>{data.cards.length}</strong>
              <span>cards kept</span>
            </div>
            <div className="stat-card">
              <BookOpen size={18} />
              <strong>{data.decks.length}</strong>
              <span>{data.decks.length === 1 ? 'deck' : 'decks'}</span>
            </div>
          </section>

          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Your library</p>
                <h2>Continue learning</h2>
              </div>
              <button className="text-button" type="button" onClick={() => navigate('decks')}>See all</button>
            </div>
            <div className="deck-strip">
              {deckRows.slice(0, 4).map(({ deck, count, due }) => (
                <button className="deck-tile" type="button" key={deck.id} onClick={() => due ? startReview(deck.id) : navigate('decks')}>
                  <span className="deck-tile__wash" style={{ backgroundColor: deck.color }} />
                  <span className="deck-tile__count">{due ? `${due} due` : 'Resting'}</span>
                  <strong>{deck.title}</strong>
                  <span>{count} {count === 1 ? 'card' : 'cards'}</span>
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
