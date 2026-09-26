import type { MagicLinkClient } from '@vmp/shared';
import { resolveMagicLinkClient } from '~/utils/magicLinkClient';
import { capturePostHogEvent } from '~/utils/posthogClient';
import strings from '~/utils/strings';

export type InlineAuthStep = 'email' | 'code' | 'totp';

/**
 * Shared email → confirmation code → optional TOTP flow.
 * Always stamps magic-link `redirect` + `client` the same way `/login` and
 * `signIn()` already do, so a user who taps the email link (instead of typing
 * the code) still returns to the video / article / account / checkout origin.
 */
export function useInlineAuth(options?: {
  /** Default return path passed to POST /api/auth/magic-link. */
  redirectPath?: MaybeRefOrGetter<string | undefined>;
  /** Override surface; default resolves browser vs installed PWA. */
  client?: MaybeRefOrGetter<MagicLinkClient | undefined>;
  /** Analytics surface label (checkout | login | header | …). */
  surface?: string;
}) {
  const { signIn, verifyCode, verifyTotp, isLoggedIn } = useAuth();

  const step = ref<InlineAuthStep>('email');
  const email = ref('');
  const code = ref('');
  const totp = ref('');
  const pendingToken = ref('');
  const busy = ref(false);
  const error = ref<string | null>(null);

  function reset() {
    step.value = 'email';
    code.value = '';
    totp.value = '';
    pendingToken.value = '';
    error.value = null;
  }

  function currentRedirect(): string | undefined {
    const raw = options?.redirectPath != null ? toValue(options.redirectPath) : undefined;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
  }

  function currentClient(): MagicLinkClient {
    const raw = options?.client != null ? toValue(options.client) : undefined;
    return resolveMagicLinkClient(raw);
  }

  async function sendCode(redirectOverride?: string) {
    error.value = null;
    const normalized = email.value.trim().toLowerCase();
    if (!normalized) return;
    busy.value = true;
    try {
      const redirect = redirectOverride ?? currentRedirect();
      const client = currentClient();
      await signIn(normalized, redirect, client);
      email.value = normalized;
      step.value = 'code';
      code.value = '';
      capturePostHogEvent('magic_link_requested', {
        client,
        surface: options?.surface ?? 'inline_auth',
      });
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : strings.loginErrorGeneric;
    } finally {
      busy.value = false;
    }
  }

  async function submitCode(): Promise<boolean> {
    error.value = null;
    const digits = code.value.trim();
    if (digits.length < 6) return false;
    busy.value = true;
    try {
      const result = await verifyCode(email.value.trim().toLowerCase(), digits);
      if ('requiresTwoFactor' in result && result.requiresTwoFactor) {
        pendingToken.value = result.pendingToken;
        step.value = 'totp';
        totp.value = '';
        return false;
      }
      reset();
      return true;
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : strings.loginErrorGeneric;
      return false;
    } finally {
      busy.value = false;
    }
  }

  async function submitTotp(): Promise<boolean> {
    error.value = null;
    const digits = totp.value.trim();
    if (digits.length < 6 || !pendingToken.value) return false;
    busy.value = true;
    try {
      await verifyTotp(digits, pendingToken.value);
      reset();
      return true;
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : strings.totpInvalidCode;
      return false;
    } finally {
      busy.value = false;
    }
  }

  return {
    step,
    email,
    code,
    totp,
    busy,
    error,
    isLoggedIn,
    reset,
    sendCode,
    submitCode,
    submitTotp,
    currentClient,
    currentRedirect,
  };
}
