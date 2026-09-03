export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`} aria-label="Lumen">
      <span className="brand__mark" aria-hidden="true">
        <span className="brand__sun" />
      </span>
      {!compact && <span className="brand__word">Lumen</span>}
    </div>
  )
}
