export function storageError(error: unknown): string {
  // Browser exceptions can cross realms, so inspect only their string diagnostics.
  const details = error && typeof error === 'object' ? error as { name?: unknown; message?: unknown } : undefined
  const name = typeof details?.name === 'string' ? details.name : ''
  const message = typeof details?.message === 'string' ? details.message : ''
  if (/quota/i.test(name + message)) {
    return 'There is not enough storage. Free some device space or use smaller images, then try again.'
  }
  return message || 'Could not save. Please try again.'
}
