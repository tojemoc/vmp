import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { ApiError, pollDevicePairing, startDevicePairing } from '../api/client';
import { completePairingLogin } from '../auth/session';
import { decideTvPairingPoll, pairingBudgetExhausted, pairingMaxAttempts } from '../auth/tvPairing';
import { Focusable } from './Focusable';

type Props = {
  onAuthenticated: () => void;
  setSession: (session: Awaited<ReturnType<typeof completePairingLogin>>) => void;
};

type Phase = 'starting' | 'waiting' | 'terminal';

/**
 * Android TV / tvOS login: show pairing code, poll until phone/web approves.
 * Never reveals whether a code is unknown vs unapproved (plan poll guidance).
 */
export function TvPairingLogin({ onAuthenticated, setSession }: Props) {
  const [phase, setPhase] = useState<Phase>('starting');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [hint, setHint] = useState('Starting device pairing…');
  const [busy, setBusy] = useState(false);
  const cancelledRef = useRef(false);
  const generationRef = useRef(0);

  const beginPairing = useCallback(async () => {
    const generation = ++generationRef.current;
    cancelledRef.current = false;
    setBusy(true);
    setPhase('starting');
    setPairingCode(null);
    setHint('Starting device pairing…');
    try {
      const started = await startDevicePairing({
        deviceName: 'VMP TV',
        devicePlatform: 'android_tv',
      });
      if (cancelledRef.current || generation !== generationRef.current) return;

      const code = started.pairingCode;
      const startedAtMs = Date.now();
      const interval = Math.max(1, started.pollIntervalSeconds || 2);
      const maxAttempts = pairingMaxAttempts(started.expiresAt, startedAtMs, interval);
      let attempt = 0;

      setPairingCode(code);
      setPhase('waiting');
      setHint('On your phone, open VMP → Settings → Approve a TV and enter this code.');

      while (!cancelledRef.current && generation === generationRef.current) {
        attempt += 1;
        const budgetExhausted = pairingBudgetExhausted({
          expiresAt: started.expiresAt,
          startedAtMs,
          attempt,
          maxAttempts,
        });

        try {
          const poll = await pollDevicePairing(code);
          if (cancelledRef.current || generation !== generationRef.current) return;

          const decision = decideTvPairingPoll({
            status: poll.status,
            pollIntervalSeconds: interval,
            budgetExhausted: budgetExhausted && poll.status !== 'ready',
          });

          if (decision.action === 'ready') {
            if (poll.status === 'ready') {
              const session = await completePairingLogin(poll);
              if (cancelledRef.current || generation !== generationRef.current) return;
              setSession(session);
              onAuthenticated();
            }
            return;
          }
          if (decision.action === 'terminal') {
            setPhase('terminal');
            setHint(
              decision.reason === 'already_used'
                ? 'This code was already used. Start again for a new code.'
                : 'Pairing timed out. Start again for a new code.',
            );
            return;
          }
          await sleep(decision.delayMs);
        } catch (err) {
          if (cancelledRef.current || generation !== generationRef.current) return;
          if (err instanceof ApiError) {
            const decision = decideTvPairingPoll({
              httpStatus: err.status,
              code: err.code,
              pollIntervalSeconds: interval,
              budgetExhausted,
            });
            if (decision.action === 'terminal') {
              setPhase('terminal');
              setHint(
                decision.reason === 'already_used'
                  ? 'This code was already used. Start again for a new code.'
                  : 'Pairing timed out. Start again for a new code.',
              );
              return;
            }
            if (decision.action === 'backoff') {
              await sleep(decision.delayMs);
              continue;
            }
          }
          // Transient network/5xx — keep waiting without calling start again.
          await sleep(Math.max(2000, interval * 1000));
          if (budgetExhausted) {
            setPhase('terminal');
            setHint('Pairing timed out. Start again for a new code.');
            return;
          }
        }
      }
    } catch (err) {
      if (cancelledRef.current || generation !== generationRef.current) return;
      setPhase('terminal');
      setHint(err instanceof Error ? err.message : 'Could not start pairing');
    } finally {
      if (generation === generationRef.current) setBusy(false);
    }
  }, [onAuthenticated, setSession]);

  useEffect(() => {
    void beginPairing();
    return () => {
      cancelledRef.current = true;
      generationRef.current += 1;
    };
  }, [beginPairing]);

  return (
    <View style={styles.container}>
      <Text style={styles.brand}>VMP</Text>
      <Text style={styles.heading}>Sign in on TV</Text>
      <Text style={styles.copy}>{hint}</Text>
      {pairingCode ? (
        <View style={styles.codeBox}>
          <Text style={styles.code} accessibilityRole="header">
            {formatCodeForDisplay(pairingCode)}
          </Text>
        </View>
      ) : (
        <ActivityIndicator color="#38bdf8" size="large" />
      )}
      {phase === 'waiting' ? <Text style={styles.muted}>Waiting for approval…</Text> : null}
      {phase === 'terminal' ? (
        <Focusable
          preferredFocus
          style={styles.primaryBtn}
          focusedStyle={styles.primaryBtnFocused}
          disabled={busy}
          onPress={() => void beginPairing()}
        >
          {busy ? (
            <ActivityIndicator color="#0f172a" />
          ) : (
            <Text style={styles.primaryBtnText}>Get a new code</Text>
          )}
        </Focusable>
      ) : null}
    </View>
  );
}

function formatCodeForDisplay(code: string): string {
  // Groups of 4 for remote readability (e.g. ABCD-2345-XY).
  return code.replace(/(.{4})(?=.)/g, '$1-');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 64,
    paddingVertical: 48,
    gap: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  brand: {
    color: '#38bdf8',
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: 4,
  },
  heading: { color: '#f8fafc', fontSize: 32, fontWeight: '700' },
  copy: {
    color: '#94a3b8',
    fontSize: 20,
    lineHeight: 28,
    textAlign: 'center',
    maxWidth: 720,
  },
  codeBox: {
    backgroundColor: '#0f172a',
    borderWidth: 2,
    borderColor: '#334155',
    borderRadius: 16,
    paddingHorizontal: 40,
    paddingVertical: 28,
    minWidth: 420,
    alignItems: 'center',
  },
  code: {
    color: '#f8fafc',
    fontSize: 48,
    fontWeight: '700',
    letterSpacing: 6,
    fontVariant: ['tabular-nums'],
  },
  muted: { color: '#64748b', fontSize: 18 },
  primaryBtn: {
    backgroundColor: '#38bdf8',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 32,
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'transparent',
    minWidth: 240,
  },
  primaryBtnFocused: {
    borderColor: '#f8fafc',
    transform: [{ scale: 1.05 }],
  },
  primaryBtnText: { color: '#0f172a', fontWeight: '700', fontSize: 20 },
});
