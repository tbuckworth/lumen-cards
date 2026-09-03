import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function EmptyState({
  icon: Icon,
  title,
  children,
  action
}: {
  icon: LucideIcon
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon"><Icon size={25} /></span>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  )
}
