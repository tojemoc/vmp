export function assertAllSettled(label: string, results: PromiseSettledResult<unknown>[]): void {
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failures.length === 0) return
  const detail = failures
    .map((failure) => (failure.reason instanceof Error ? failure.reason.message : String(failure.reason)))
    .join('; ')
  throw new Error(`${label} failed: ${detail}`)
}
