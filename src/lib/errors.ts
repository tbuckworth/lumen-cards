export function storageError(error: unknown): string {
  if (error instanceof Error && /quota/i.test(error.name + error.message)) {
    return 'There is not enough storage. Free some device space or use smaller images, then try again.'
  }
  return error instanceof Error ? error.message : 'Could not save. Please try again.'
}
