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

/**
 * Soft poll-attempt budget from start timing.
 * Valid `expiresAt` stays the hard deadline in `pairingBudgetExhausted`; this
 * only sizes a fallback when expiry is unusable. `floor(ttl/interval) + 1`
 * keeps a last attempt available near expiry.
 */
export function pairingMaxAttempts(
  expiresAt: string,
  startedAtMs: number,
  pollIntervalSeconds: number,
): number {
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs) || pollIntervalSeconds <= 0) return 1;
  const ttlMs = Math.max(0, expiresMs - startedAtMs);
  return Math.max(1, Math.floor(ttlMs / (pollIntervalSeconds * 1000)) + 1);
}

/**
 * Stop polling when the session TTL has elapsed.
 * When `expiresAt` is valid it is authoritative — do not time out solely because
 * `attempt` reached `maxAttempts`. Invalid expiry falls back to maxAttempts.
 */
export function pairingBudgetExhausted(opts: {
  expiresAt: string;
  startedAtMs: number;
  attempt: number;
  maxAttempts: number;
  nowMs?: number;
}): boolean {
  const now = opts.nowMs ?? Date.now();
  const expiresMs = Date.parse(opts.expiresAt);
  if (Number.isFinite(expiresMs)) {
    return now >= expiresMs;
  }
  return opts.attempt >= opts.maxAttempts;
}

export type TvPairingTerminalReason = 'expired' | 'already_used' | 'timeout';

export type TvPairingPollDecision =
  | { action: 'continue'; delayMs: number }
  | { action: 'ready' }
  | { action: 'terminal'; reason: TvPairingTerminalReason }
  | { action: 'backoff'; delayMs: number };

/** Remaining ms until a valid `expiresAt`, or `null` when expiry is missing/invalid. */
function remainingUntilExpiryMs(expiresAt: string | undefined, nowMs?: number): number | null {
  if (!expiresAt) return null;
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs)) return null;
  return expiresMs - (nowMs ?? Date.now());
}

/**
 * Decide the next poll step from an API outcome without revealing code validity.
 * When `expiresAt` is valid, continue/backoff delays are clamped so polling can
 * still reach the deadline instead of sleeping past it.
 */
export function decideTvPairingPoll(opts: {
  status?: string;
  httpStatus?: number;
  code?: string;
  pollIntervalSeconds: number;
  budgetExhausted: boolean;
  expiresAt?: string;
  nowMs?: number;
}): TvPairingPollDecision {
  const remainingMs = remainingUntilExpiryMs(opts.expiresAt, opts.nowMs);
  const pastDeadline = opts.budgetExhausted || (remainingMs !== null && remainingMs <= 0);

  if (opts.httpStatus === 429 || opts.code === 'rate_limited') {
    // Do not keep backing off after the pairing deadline — same timeout UX.
    if (pastDeadline) {
      return { action: 'terminal', reason: 'timeout' };
    }
    const baseBackoff = Math.max(2000, opts.pollIntervalSeconds * 2000);
    return {
      action: 'backoff',
      delayMs: remainingMs !== null ? Math.min(baseBackoff, remainingMs) : baseBackoff,
    };
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
  if (pastDeadline) {
    return { action: 'terminal', reason: 'timeout' };
  }

  const baseDelay = Math.max(1000, opts.pollIntervalSeconds * 1000);
  // pending, unknown, or transient — keep waiting with the same UX
  return {
    action: 'continue',
    delayMs: remainingMs !== null ? Math.min(baseDelay, remainingMs) : baseDelay,
  };
}
