/**
 * TV pairing helpers — local format gate + poll budget (native-clients-plan).
 * Keep UI non-validating: unknown/malformed codes look the same as pending.
 */

/** Matches server normalizePairingCode (packages/api/src/nativeClients.ts). */
export function normalizePairingCode(raw: string): string | null {
  const normalized = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (normalized.length < 6 || normalized.length > 12) return null;
  return normalized;
}

/** Max poll attempts from start response timing (ceil of TTL / interval). */
export function pairingMaxAttempts(
  expiresAt: string,
  startedAtMs: number,
  pollIntervalSeconds: number,
): number {
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs) || pollIntervalSeconds <= 0) return 1;
  const ttlMs = Math.max(0, expiresMs - startedAtMs);
  return Math.max(1, Math.ceil(ttlMs / (pollIntervalSeconds * 1000)));
}

export function pairingBudgetExhausted(opts: {
  expiresAt: string;
  startedAtMs: number;
  attempt: number;
  maxAttempts: number;
  nowMs?: number;
}): boolean {
  const now = opts.nowMs ?? Date.now();
  const expiresMs = Date.parse(opts.expiresAt);
  if (Number.isFinite(expiresMs) && now >= expiresMs) return true;
  return opts.attempt >= opts.maxAttempts;
}

export type TvPairingTerminalReason = 'expired' | 'already_used' | 'timeout';

export type TvPairingPollDecision =
  | { action: 'continue'; delayMs: number }
  | { action: 'ready' }
  | { action: 'terminal'; reason: TvPairingTerminalReason }
  | { action: 'backoff'; delayMs: number };

/**
 * Decide the next poll step from an API outcome without revealing code validity.
 */
export function decideTvPairingPoll(opts: {
  status?: string;
  httpStatus?: number;
  code?: string;
  pollIntervalSeconds: number;
  budgetExhausted: boolean;
}): TvPairingPollDecision {
  if (opts.httpStatus === 429 || opts.code === 'rate_limited') {
    return { action: 'backoff', delayMs: Math.max(2000, opts.pollIntervalSeconds * 2000) };
  }
  if (opts.httpStatus === 409 || opts.code === 'already_used') {
    return { action: 'terminal', reason: 'already_used' };
  }
  if (opts.status === 'ready') {
    return { action: 'ready' };
  }
  if (opts.status === 'expired') {
    return { action: 'terminal', reason: 'expired' };
  }
  if (opts.budgetExhausted) {
    return { action: 'terminal', reason: 'timeout' };
  }
  // pending, unknown, or transient — keep waiting with the same UX
  return {
    action: 'continue',
    delayMs: Math.max(1000, opts.pollIntervalSeconds * 1000),
  };
}
