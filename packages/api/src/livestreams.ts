const LIVESTREAM_STATUSES = new Set([
  'draft',
  'provisioning',
  'ready',
  'live',
  'ended',
  'failed',
  'scheduled',
  'vod_attached',
  'replaced_with_vod',
])

export function normalizeLivestreamStatus(value: unknown, fallback = 'draft') {
  if (typeof value !== 'string') return fallback
  const status = value.trim().toLowerCase()
  return LIVESTREAM_STATUSES.has(status) ? status : fallback
}
