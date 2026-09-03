export function startOfLocalDay(date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function greeting(date = new Date()): string {
  const hour = date.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function relativeDate(iso: string): string {
  const date = new Date(iso)
  const today = startOfLocalDay()
  const target = startOfLocalDay(date)
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  if (days > 1 && days < 7) return `in ${days} days`
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function calculateStreak(reviewDates: string[], now = new Date()): number {
  if (!reviewDates.length) return 0
  const uniqueDays = new Set(
    reviewDates.map((iso) => {
      const value = new Date(iso)
      return `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`
    })
  )
  let cursor = startOfLocalDay(now)
  const todayKey = `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`
  if (!uniqueDays.has(todayKey)) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (uniqueDays.has(`${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`)) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}
