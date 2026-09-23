/**
 * Concurrent playback sessions for club entitlements (#649).
 *
 * Mint a server-issued session before premium video-access, heartbeat while
 * playing, and release on pause / navigate-away so another device can take the slot.
 * Must ship before flipping `concurrent_playback_enforced` to `1`.
 */

/** Must match API `PLAYBACK_SESSION_HEADER_NAME` / CORS Allow-Headers. */
export const PLAYBACK_SESSION_HEADER = 'X-VMP-Playback-Session';

/** Plan default: heartbeat every 30s while a session is active (stale window ≈ 90s). */
export const PLAYBACK_SESSION_HEARTBEAT_MS = 30_000;

export type ConcurrentPlaybackErrorCode = 'concurrent_playback_limit' | 'playback_session_required';

export type ConcurrentPlaybackError = {
  code: ConcurrentPlaybackErrorCode;
  limit?: number;
  message: string;
};

export type MintPlaybackSessionResult =
  | { ok: true; sessionId: string }
  | { ok: false; error: ConcurrentPlaybackError };

type PlaybackSessionApiErrorBody = {
  error?: string;
  code?: string;
  limit?: number;
};

/** True when this account should claim a concurrent-playback slot (subscribers, not staff). */
export function shouldClaimPlaybackSession(opts: {
  isLoggedIn: boolean;
  isPremium: boolean;
  role: string | null | undefined;
}): boolean {
  if (!opts.isLoggedIn || !opts.isPremium) return false;
  const role = (opts.role ?? 'viewer').trim().toLowerCase();
  // Staff bypass concurrent limits on video-access; do not mint slots for them.
  return role === 'viewer' || role === '';
}

export function parseConcurrentPlaybackError(
  status: number,
  body: unknown,
): ConcurrentPlaybackError | null {
  if (status !== 409 && status !== 404) return null;
  const data = (body && typeof body === 'object' ? body : {}) as PlaybackSessionApiErrorBody;
  const code = typeof data.code === 'string' ? data.code : '';
  if (code !== 'concurrent_playback_limit' && code !== 'playback_session_required') {
    return null;
  }
  const limit =
    typeof data.limit === 'number' && Number.isFinite(data.limit) && data.limit > 0
      ? data.limit
      : undefined;
  const message =
    typeof data.error === 'string' && data.error.trim()
      ? data.error.trim()
      : code === 'concurrent_playback_limit'
        ? 'Concurrent stream limit reached'
        : 'Playback session required';
  return { code, limit, message };
}

export function usePlaybackSession(options: {
  apiUrl: () => string;
  authHeader: () => Record<string, string>;
  enabled: () => boolean;
  videoId: () => string;
}) {
  let sessionId: string | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;
  let releaseChain: Promise<void> = Promise.resolve();
  let mintInFlight: Promise<MintPlaybackSessionResult> | null = null;

  function getSessionId(): string | null {
    return sessionId;
  }

  function sessionHeaders(): Record<string, string> {
    if (!sessionId) return {};
    return { [PLAYBACK_SESSION_HEADER]: sessionId };
  }

  function stopHeartbeats() {
    if (heartbeatTimer != null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  async function mint(overrideVideoId?: string): Promise<MintPlaybackSessionResult> {
    const videoId = (overrideVideoId ?? options.videoId()).trim();
    if (!options.enabled() || !videoId) {
      return {
        ok: false,
        error: { code: 'playback_session_required', message: 'Playback session not available' },
      };
    }
    const headers = options.authHeader();
    if (!headers.Authorization) {
      return {
        ok: false,
        error: { code: 'playback_session_required', message: 'Unauthorized' },
      };
    }

    // One active slot per player tab: drop any prior session before claiming again.
    if (sessionId) {
      await release();
    }

    try {
      const res = await fetch(`${options.apiUrl()}/api/account/playback-sessions`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ videoId }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok || res.status === 201) {
        const id =
          typeof (body as { sessionId?: unknown }).sessionId === 'string'
            ? String((body as { sessionId: string }).sessionId).trim()
            : '';
        if (!id) {
          return {
            ok: false,
            error: { code: 'playback_session_required', message: 'Invalid session response' },
          };
        }
        sessionId = id;
        return { ok: true, sessionId: id };
      }
      const parsed = parseConcurrentPlaybackError(res.status, body);
      if (parsed) return { ok: false, error: parsed };
      return {
        ok: false,
        error: {
          code: 'playback_session_required',
          message:
            typeof (body as PlaybackSessionApiErrorBody).error === 'string'
              ? String((body as PlaybackSessionApiErrorBody).error)
              : 'Failed to create playback session',
        },
      };
    } catch {
      return {
        ok: false,
        error: { code: 'playback_session_required', message: 'Failed to create playback session' },
      };
    }
  }

  async function heartbeat(): Promise<boolean> {
    const id = sessionId;
    const videoId = options.videoId().trim();
    if (!id || !videoId || !options.enabled()) return false;
    const headers = options.authHeader();
    if (!headers.Authorization) return false;
    try {
      const res = await fetch(
        `${options.apiUrl()}/api/account/playback-sessions/${encodeURIComponent(id)}`,
        {
          method: 'PUT',
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ videoId }),
        },
      );
      if (res.status === 404) {
        // Only clear if this heartbeat's id is still the active session.
        if (sessionId === id) {
          sessionId = null;
          stopHeartbeats();
        }
        return false;
      }
      return res.ok;
    } catch {
      return false;
    }
  }

  async function release(opts: { keepalive?: boolean; ended?: boolean } = {}): Promise<void> {
    stopHeartbeats();
    const id = sessionId;
    sessionId = null;
    if (!id) return;

    const headers = options.authHeader();
    if (!headers.Authorization) return;

    const task = async () => {
      try {
        if (opts.ended) {
          await fetch(
            `${options.apiUrl()}/api/account/playback-sessions/${encodeURIComponent(id)}`,
            {
              method: 'PUT',
              headers: {
                ...headers,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ ended: true }),
              keepalive: opts.keepalive === true,
            },
          );
          return;
        }
        await fetch(`${options.apiUrl()}/api/account/playback-sessions/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers,
          keepalive: opts.keepalive === true,
        });
      } catch {
        // Best-effort; stale TTL will expire the row.
      }
    };

    releaseChain = releaseChain.then(task, task);
    return releaseChain;
  }

  function startHeartbeats() {
    stopHeartbeats();
    if (!import.meta.client || disposed || !sessionId || !options.enabled()) return;
    heartbeatTimer = setInterval(() => {
      void heartbeat();
    }, PLAYBACK_SESSION_HEARTBEAT_MS);
  }

  /** Mint if needed, then start heartbeats. Used on play / resume after pause. */
  async function ensureSessionAndHeartbeat(
    overrideVideoId?: string,
  ): Promise<MintPlaybackSessionResult | { ok: true; sessionId: string; reused: true }> {
    if (!options.enabled()) {
      return {
        ok: false,
        error: { code: 'playback_session_required', message: 'Playback session not available' },
      };
    }
    if (sessionId) {
      startHeartbeats();
      void heartbeat();
      return { ok: true, sessionId, reused: true };
    }
    if (!mintInFlight) {
      mintInFlight = mint(overrideVideoId).finally(() => {
        mintInFlight = null;
      });
    }
    const minted = await mintInFlight;
    if (minted.ok) startHeartbeats();
    return minted;
  }

  function dispose() {
    disposed = true;
    void release({ keepalive: true });
  }

  if (import.meta.client) {
    const onPageHide = () => {
      void release({ keepalive: true });
    };
    onMounted(() => {
      window.addEventListener('pagehide', onPageHide);
    });
    onUnmounted(() => {
      window.removeEventListener('pagehide', onPageHide);
      dispose();
    });
  }

  return {
    getSessionId,
    sessionHeaders,
    mint,
    heartbeat,
    release,
    startHeartbeats,
    stopHeartbeats,
    ensureSessionAndHeartbeat,
    dispose,
  };
}
