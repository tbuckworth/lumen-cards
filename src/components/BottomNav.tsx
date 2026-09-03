import { BookOpen, Home, Plus, Settings } from 'lucide-react'
import type { Route } from '../types'

const ITEMS = [
  { route: 'home' as const, label: 'Today', icon: Home },
  { route: 'decks' as const, label: 'Decks', icon: BookOpen },
  { route: 'add' as const, label: 'Add', icon: Plus },
  { route: 'settings' as const, label: 'Settings', icon: Settings }
]

export function BottomNav({ route, onNavigate }: { route: Route; onNavigate: (route: Route) => void }) {
  if (route === 'review') return null
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {ITEMS.map(({ route: itemRoute, label, icon: Icon }) => (
        <button
          className={route === itemRoute ? 'bottom-nav__item is-active' : 'bottom-nav__item'}
          type="button"
          onClick={() => onNavigate(itemRoute)}
          aria-current={route === itemRoute ? 'page' : undefined}
        >
          <Icon size={21} strokeWidth={1.8} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
