export function isAvailabilityError(err: unknown): boolean {
  const code = (err as { name?: string }).name
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
  if (code === 'NoSuchKey' || code === 'NotFound' || status === 404) return false
  if (
    code === 'TimeoutError'
    || code === 'RequestTimeout'
    || code === 'NetworkingError'
    || code === 'AbortError'
  ) {
    return true
  }
  if (typeof status === 'number' && status >= 500) return true
  if (err instanceof TypeError) return true
  if (err instanceof Error) {
    const message = err.message.toLowerCase()
    if (
      message.includes('network')
      || message.includes('timeout')
      || message.includes('timed out')
      || message.includes('abort')
    ) {
      return true
    }
  }
  return false
}
