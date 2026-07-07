export class StorageNotFoundError extends Error {
  readonly key: string

  constructor(key: string) {
    super(`Object not found: ${key}`)
    this.name = 'StorageNotFoundError'
    this.key = key
  }
}

export class StorageAvailabilityError extends Error {
  readonly key: string
  readonly status?: number

  constructor(key: string, message: string, status?: number) {
    super(message)
    this.name = 'StorageAvailabilityError'
    this.key = key
    if (status !== undefined) this.status = status
  }
}

export function isAvailabilityError(err: unknown): boolean {
  if (err instanceof StorageNotFoundError) return false
  if (err instanceof StorageAvailabilityError) return true
  if (err instanceof TypeError) return true
  if (err instanceof Error) {
    const message = err.message.toLowerCase()
    if (message.includes('network') || message.includes('timeout') || message.includes('abort')) {
      return true
    }
  }
  return false
}

export function isNotFoundHttpStatus(status: number): boolean {
  return status === 404 || status === 410
}
