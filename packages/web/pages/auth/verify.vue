<!-- packages/web/pages/auth/verify.vue -->
<!--
  Landing page for magic link clicks.
  URL: /auth/verify?token=…&client=browser|pwa|native
    or /auth/verify?handoff=…&client=…&redirect=…

  The email link carries `client` from the surface that requested the magic link
  (website, installed PWA, or native app). Verify must not guess from UA /
  display-mode — that mixed PWA and native paths.

  - client=browser (default): redeem in this browser.
  - client=pwa + ?pwa=1: push-login deliver prompt (Home Screen iOS).
  - client=pwa (no pwa=1): iOS Safari → short-lived handoff for Home Screen redeem.
  - client=native: Android intent:// before web redeem; iOS Safari explains missing Universal Links
    (staging may offer acknowledged vmp:// SideStore escape hatch — never on production).
-->
<template>
  <div class="min-h-screen bg-gray-950 flex items-center justify-center px-4">
    <div class="w-full max-w-sm text-center">
      <!-- Verifying -->
      <div
        v-if="state === 'verifying'"
        class="flex flex-col items-center gap-4"
        role="status"
        aria-live="polite"
      >
        <span
          class="block w-10 h-10 border-4 border-gray-700 border-t-blue-500 rounded-full animate-spin shrink-0"
          aria-hidden="true"
        />
        <p class="text-gray-400 text-sm">{{ strings.authVerifySigningIn }}</p>
      </div>

      <!-- PWA push-login: sending sign-in to installed app -->
      <div
        v-else-if="state === 'pwa_push_sending'"
        class="flex flex-col items-center gap-4"
        role="status"
        aria-live="polite"
      >
        <span
          class="block w-10 h-10 border-4 border-gray-700 border-t-blue-500 rounded-full animate-spin shrink-0"
          aria-hidden="true"
        />
        <p class="text-gray-400 text-sm">{{ strings.authVerifyPwaPushSending }}</p>
      </div>

      <!-- PWA push-login: confirm signing into Home Screen app -->
      <div v-else-if="state === 'pwa_push_prompt'" class="space-y-6 text-left">
        <div>
          <h2 class="text-lg font-semibold text-white mb-2">
            {{ strings.authVerifyPwaPushTitle }}
          </h2>
        </div>
        <p v-if="errorMessage" class="text-red-400 text-sm leading-relaxed">{{ errorMessage }}</p>
        <div class="flex flex-col gap-3">
          <button
            type="button"
            class="w-full px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            @click="deliverToInstalledPwa"
          >
            {{ strings.authVerifyPwaPushYes }}
          </button>
          <button
            type="button"
            class="w-full px-5 py-2.5 border border-gray-600 hover:border-gray-500 text-gray-200 text-sm font-medium rounded-lg transition-colors"
            @click="signInHereInstead"
          >
            {{ strings.authVerifyPwaPushNo }}
          </button>
        </div>
      </div>

      <div
        v-else-if="state === 'pwa_push_done' || state === 'pwa_2fa_done'"
        class="space-y-4 text-left"
      >
        <p class="text-gray-300 text-sm leading-relaxed">{{ strings.authVerifyPwaPushDone }}</p>
        <p class="text-gray-500 text-xs leading-relaxed">{{ strings.authVerifyPwaPushDoneHint }}</p>
      </div>

      <!-- Android: open installed native APK before consuming the single-use token -->
      <div v-else-if="state === 'native_app_handoff'" class="space-y-6 text-left">
        <div>
          <h2 class="text-lg font-semibold text-white mb-2">
            {{ strings.authVerifyNativeAppTitle }}
          </h2>
          <p class="text-gray-400 text-sm leading-relaxed">{{ strings.authVerifyNativeAppBody }}</p>
        </div>
        <div class="flex flex-col gap-3">
          <button
            type="button"
            class="w-full px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            @click="openInstalledNativeApp"
          >
            {{ strings.authVerifyNativeAppOpen }}
          </button>
          <button
            type="button"
            class="w-full px-5 py-2.5 border border-gray-600 hover:border-gray-500 text-gray-200 text-sm font-medium rounded-lg transition-colors"
            @click="continueNativeAppInBrowser"
          >
            {{ strings.authVerifyNativeAppContinueBrowser }}
          </button>
        </div>
      </div>

      <!-- iOS: native-tagged link landed in Safari (Universal Links not configured yet) -->
      <div v-else-if="state === 'native_ios_safari'" class="space-y-6 text-left">
        <div>
          <h2 class="text-lg font-semibold text-white mb-2">
            {{ strings.authVerifyNativeIosSafariTitle }}
          </h2>
          <p class="text-gray-400 text-sm leading-relaxed">
            {{ strings.authVerifyNativeIosSafariBody }}
          </p>
        </div>
        <div class="flex flex-col gap-3">
          <button
            type="button"
            class="w-full px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            @click="continueNativeIosInSafari"
          >
            {{ strings.authVerifyNativeIosSafariContinue }}
          </button>
          <button
            v-if="insecureSchemeStatus?.allowed"
            type="button"
            class="w-full px-5 py-2.5 border border-amber-700/80 hover:border-amber-600 text-amber-200 text-sm font-medium rounded-lg transition-colors"
            @click="beginInsecureNativeSchemeWarn"
          >
            {{ strings.authVerifyNativeIosInsecureOffer }}
          </button>
        </div>
      </div>

      <!-- Staging SideStore: first of two confirms for claimable vmp:// -->
      <div v-else-if="state === 'native_ios_insecure_warn'" class="space-y-6 text-left">
        <div>
          <h2 class="text-lg font-semibold text-amber-200 mb-2">
            {{ strings.authVerifyNativeIosInsecureWarnTitle }}
          </h2>
          <p class="text-gray-400 text-sm leading-relaxed">
            {{ strings.authVerifyNativeIosInsecureWarnBody }}
          </p>
        </div>
        <div class="flex flex-col gap-3">
          <button
            type="button"
            class="w-full px-5 py-2.5 bg-amber-700 hover:bg-amber-600 text-white text-sm font-medium rounded-lg transition-colors"
            @click="beginInsecureNativeSchemeConfirm"
          >
            {{ strings.authVerifyNativeIosInsecureWarnContinue }}
          </button>
          <button
            type="button"
            class="w-full px-5 py-2.5 border border-gray-600 hover:border-gray-500 text-gray-200 text-sm font-medium rounded-lg transition-colors"
            @click="cancelInsecureNativeScheme"
          >
            {{ strings.authVerifyNativeIosInsecureWarnCancel }}
          </button>
        </div>
      </div>

      <!-- Staging SideStore: checkbox + confirm, then D1 ack + vmp:// open -->
      <div v-else-if="state === 'native_ios_insecure_confirm'" class="space-y-6 text-left">
        <div>
          <h2 class="text-lg font-semibold text-amber-200 mb-2">
            {{ strings.authVerifyNativeIosInsecureConfirmTitle }}
          </h2>
          <p class="text-gray-400 text-sm leading-relaxed">
            {{ strings.authVerifyNativeIosInsecureConfirmBody }}
          </p>
        </div>
        <p v-if="errorMessage" class="text-red-400 text-sm leading-relaxed">{{ errorMessage }}</p>
        <label class="flex items-start gap-3 cursor-pointer">
          <input
            v-model="insecureSchemeAckChecked"
            type="checkbox"
            class="mt-1 h-4 w-4 shrink-0 rounded border-gray-600 bg-gray-900 text-amber-600 focus:ring-amber-500"
          >
          <span class="text-gray-300 text-sm leading-relaxed">
            {{ strings.authVerifyNativeIosInsecureCheckbox }}
          </span>
        </label>
        <div class="flex flex-col gap-3">
          <button
            type="button"
            class="w-full px-5 py-2.5 bg-amber-700 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            :disabled="!insecureSchemeAckChecked || insecureSchemeWorking"
            @click="confirmInsecureNativeSchemeAndOpen"
          >
            {{ insecureSchemeWorking
                ? strings.authVerifyNativeIosInsecureWorking
                : strings.authVerifyNativeIosInsecureConfirm }}
          </button>
          <button
            type="button"
            class="w-full px-5 py-2.5 border border-gray-600 hover:border-gray-500 text-gray-200 text-sm font-medium rounded-lg transition-colors"
            :disabled="insecureSchemeWorking"
            @click="cancelInsecureNativeScheme"
          >
            {{ strings.authVerifyNativeIosInsecureWarnCancel }}
          </button>
        </div>
      </div>

      <!-- iOS Safari after PWA-tagged magic link: wait for Home Screen or Safari -->
      <div v-else-if="state === 'handoff_wait'" class="space-y-6 text-left">
        <div>
          <h2 class="text-lg font-semibold text-white mb-2">
            {{ strings.authVerifyHandoffTitle }}
          </h2>
          <p class="text-gray-400 text-sm leading-relaxed">{{ strings.authVerifyHandoffBody }}</p>
        </div>
        <div class="flex flex-col gap-3">
          <button
            type="button"
            class="w-full px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            @click="finishInSafari"
          >
            {{ strings.authVerifyHandoffContinueSafari }}
          </button>
          <button
            type="button"
            class="w-full px-5 py-2.5 border border-gray-600 hover:border-gray-500 text-gray-200 text-sm font-medium rounded-lg transition-colors"
            @click="copyHandoffUrl"
          >
            {{ copyHint }}
          </button>
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="state === 'error'" class="space-y-6">
        <div
          class="w-14 h-14 mx-auto rounded-full bg-red-950 border border-red-800 flex items-center justify-center"
        >
          <svg class="w-7 h-7 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </div>
        <div>
          <h2 class="text-lg font-semibold text-white mb-1">{{ strings.authVerifyLinkInvalid }}</h2>
          <p class="text-gray-400 text-sm leading-relaxed">{{ errorMessage }}</p>
        </div>
        <button
          type="button"
          class="inline-block px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          @click="requestNewLink"
        >
          {{ strings.authVerifyRequestNewLink }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import {
    INSECURE_NATIVE_SCHEME_CONFIRM_PHRASE,
    type MagicLinkClient,
    normalizeMagicLinkClient,
  } from '@vmp/shared';
  import { navigateTo, useRoute, useRuntimeConfig } from '#app';
  import { resolveDeployTier } from '~/utils/buildInfo';
  import {
    isNativeAppFallbackQuery,
    openAndroidNativeApp,
    openIosInsecureNativeScheme,
    resolveMobileAndroidPackage,
  } from '~/utils/nativeAppHandoff';
  import { capturePostHogEvent } from '~/utils/posthogClient';
  import { isAndroidChromium, isInstalledPwa, isIosLike as isIosLikeUa } from '~/utils/pwa';
  import strings from '~/utils/strings';

  const route = useRoute();
  const runtimeConfig = useRuntimeConfig();
  const { verify, magicPwaHandoff, redeemPwaHandoff, canEditContent, user } = useAuth();
  const { deliverMagicLinkToPwa } = usePwaPushLogin();
  const { startLoginFlow } = useLoginFlow();

  function mobileAndroidPackage(): string {
    return resolveMobileAndroidPackage(String(runtimeConfig.public.mobileAndroidPackage || ''));
  }

  /** SideStore vmp:// escape hatch is staging web only (never production/beta). */
  function isStagingWebDeploy(): boolean {
    return resolveDeployTier(String(runtimeConfig.public.deployTier || '')) === 'staging';
  }

  type InsecureSchemeStatus = {
    allowed: boolean;
    confirmPhrase: string | null;
  };

  const insecureSchemeStatus = ref<InsecureSchemeStatus | null>(null);
  const insecureSchemeAckChecked = ref(false);
  const insecureSchemeWorking = ref(false);

  async function refreshInsecureSchemeStatus(): Promise<void> {
    insecureSchemeStatus.value = null;
    if (!isStagingWebDeploy() || import.meta.server) return;
    const apiUrl = String(runtimeConfig.public.apiUrl || '').replace(/\/$/, '');
    if (!apiUrl) return;
    try {
      const res = await fetch(`${apiUrl}/api/auth/native/insecure-scheme/status`);
      if (!res.ok) return;
      const body = (await res.json()) as {
        allowed?: unknown;
        confirmPhrase?: unknown;
      };
      insecureSchemeStatus.value = {
        allowed: body.allowed === true,
        confirmPhrase: typeof body.confirmPhrase === 'string' ? body.confirmPhrase : null,
      };
    } catch {
      insecureSchemeStatus.value = null;
    }
  }

  function isDisplayStandalone() {
    if (import.meta.server) return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  }

  function isIosLike() {
    if (import.meta.server) return false;
    return isIosLikeUa();
  }

  function magicLinkClient(): MagicLinkClient {
    return normalizeMagicLinkClient(route.query.client);
  }

  /** PWA-tagged link opened in iOS Safari (not the Home Screen app). */
  function shouldUseIosPwaHandoff(): boolean {
    return magicLinkClient() === 'pwa' && isIosLike() && !isDisplayStandalone();
  }

  /** Defer redeem of an existing handoff code only for PWA-tagged iOS Safari. */
  function shouldDeferPwaHandoffRedeem(): boolean {
    return magicLinkClient() === 'pwa' && isIosLike() && !isDisplayStandalone();
  }

  /**
   * Native-tagged link on Android Chromium (not the installed PWA): offer
   * package-targeted intent:// before web redeem consumes the token.
   * Firefox for Android cannot open intent://, so it falls through to web redeem.
   */
  function shouldOfferAndroidNativeAppHandoff(): boolean {
    if (import.meta.server) return false;
    if (magicLinkClient() !== 'native') return false;
    if (!isAndroidChromium() || isInstalledPwa()) return false;
    if (isNativeAppFallbackQuery(route.query.native_fallback)) return false;
    return true;
  }

  /**
   * Native-tagged link on iOS Safari: Universal Links would have opened the app
   * already when AASA is live. Landing here means association is missing / SideStore
   * re-sign — explain website session, and on staging offer acknowledged vmp://.
   */
  function shouldExplainIosNativeInSafari(): boolean {
    if (import.meta.server) return false;
    if (magicLinkClient() !== 'native') return false;
    if (!isIosLike() || isDisplayStandalone()) return false;
    if (isNativeAppFallbackQuery(route.query.native_fallback)) return false;
    return true;
  }

  // Must start with a single slash; rejects //evil.com and external URLs.
  function safeRedirect(value: unknown, fallback: string): string {
    if (typeof value !== 'string') return fallback;
    const t = value.trim();
    if (!t.startsWith('/') || t.startsWith('//') || t.length > 1024) return fallback;
    return t;
  }

  function firstQueryString(v: unknown): string {
    if (typeof v === 'string') return v.trim();
    if (Array.isArray(v) && typeof v[0] === 'string') return v[0].trim();
    return '';
  }

  type State =
    | 'verifying'
    | 'error'
    | 'handoff_wait'
    | 'native_app_handoff'
    | 'native_ios_safari'
    | 'native_ios_insecure_warn'
    | 'native_ios_insecure_confirm'
    | 'pwa_push_prompt'
    | 'pwa_push_sending'
    | 'pwa_push_done'
    | 'pwa_2fa_done';

  /**
   * SSR-safe initial state only. Never branch on navigator / display-mode here —
   * that diverges from the server HTML and reintroduces hydration mismatches.
   * Client `watch` (immediate) sets handoff / PWA prompt states after mount.
   */
  function initialVerifyState(): State {
    if (firstQueryString(route.query.pwa_done) === '1') return 'pwa_2fa_done';
    return 'verifying';
  }

  const state = ref<State>(initialVerifyState());
  const errorMessage = ref('');
  const copyHint = ref<string>(strings.authVerifyHandoffCopyLink);
  const handoffCodeForSafari = ref<string | null>(null);
  const magicTokenForFlow = ref<string | null>(null);
  const didAutoOpenNative = ref(false);

  function captureAuthEvent(event: string, properties: Record<string, unknown> = {}) {
    capturePostHogEvent(event, {
      client: magicLinkClient(),
      ...properties,
    });
  }

  async function navigateAfterFullSession(redirect: string) {
    const u = user.value;
    if (!u) {
      await navigateTo(redirect);
      return;
    }
    if (canEditContent.value && u.totpRequired && !u.totpEnabled) {
      await navigateTo(`/auth/2fa/setup?redirect=${encodeURIComponent(redirect)}`);
      return;
    }
    await navigateTo(redirect);
  }

  async function finishInSafari() {
    const code = handoffCodeForSafari.value;
    if (!code) return;
    state.value = 'verifying';
    try {
      const redirect = safeRedirect(route.query.redirect, '/');
      await redeemPwaHandoff(code);
      if (!user.value) throw new Error(strings.authVerifySignInIncomplete);
      captureAuthEvent('magic_link_redeem_succeeded', { surface: 'pwa_handoff_safari' });
      await navigateAfterFullSession(redirect);
    } catch (e: any) {
      state.value = 'error';
      errorMessage.value = e?.message || strings.authVerifyErrorGeneric;
      captureAuthEvent('magic_link_redeem_failed', {
        surface: 'pwa_handoff_safari',
        reason: 'redeem_error',
      });
    }
  }

  function isPwaPushLoginLink(): boolean {
    const pwa = firstQueryString(route.query.pwa);
    return pwa === '1' && !isInstalledPwa();
  }

  function pwaPushDeliverErrorMessage(code: string | undefined): string {
    switch (code) {
      case 'attempt_not_found':
        return strings.authVerifyPwaPushAttemptNotFound;
      case 'no_push_subscription':
        return strings.authVerifyPwaPushNoPushSubscription;
      case 'push_failed':
        return strings.authVerifyPwaPushPushFailed;
      default:
        return strings.authVerifyPwaPushDeliverFailed;
    }
  }

  async function deliverToInstalledPwa() {
    const token = magicTokenForFlow.value;
    if (!token) return;
    state.value = 'pwa_push_sending';
    errorMessage.value = '';
    try {
      const result = await deliverMagicLinkToPwa(token);
      if (result.code === 'requires_2fa' && result.pendingToken) {
        const redirect = safeRedirect(route.query.redirect, '/');
        if (import.meta.client && token) {
          try {
            sessionStorage.setItem('vmp_pwa_magic_token', token);
          } catch {
            /* ignore */
          }
        }
        await navigateTo(
          `/auth/2fa?pending=${encodeURIComponent(result.pendingToken)}&redirect=${encodeURIComponent(redirect)}&pwa=1&client=pwa`,
        );
        return;
      }
      if (!result.delivered) {
        state.value = 'pwa_push_prompt';
        errorMessage.value = pwaPushDeliverErrorMessage(result.code);
        return;
      }
      state.value = 'pwa_push_done';
    } catch (e: unknown) {
      state.value = 'error';
      errorMessage.value = e instanceof Error ? e.message : strings.authVerifyPwaPushDeliverFailed;
    }
  }

  async function signInHereInstead() {
    const token = magicTokenForFlow.value;
    if (!token) return;
    state.value = 'verifying';
    await runNormalTokenVerify(token);
  }

  function openInstalledNativeApp() {
    if (import.meta.server) return;
    captureAuthEvent('magic_link_handoff_attempted', { platform: 'android', method: 'intent' });
    openAndroidNativeApp(window.location.href, mobileAndroidPackage());
  }

  async function continueNativeAppInBrowser() {
    const token = magicTokenForFlow.value;
    if (!token) return;
    captureAuthEvent('magic_link_handoff_browser_fallback', { platform: 'android' });
    // Stay on this page with native_fallback so a reload does not auto-bounce again.
    if (import.meta.client && !isNativeAppFallbackQuery(route.query.native_fallback)) {
      state.value = 'verifying';
      const next = new URL(window.location.href);
      next.searchParams.set('native_fallback', '1');
      await navigateTo(
        { path: next.pathname, query: Object.fromEntries(next.searchParams.entries()) },
        { replace: true },
      );
      return;
    }
    state.value = 'verifying';
    await runNormalTokenVerify(token);
  }

  async function continueNativeIosInSafari() {
    const token = magicTokenForFlow.value;
    if (!token) return;
    captureAuthEvent('magic_link_handoff_browser_fallback', { platform: 'ios' });
    state.value = 'verifying';
    if (import.meta.client && !isNativeAppFallbackQuery(route.query.native_fallback)) {
      const next = new URL(window.location.href);
      next.searchParams.set('native_fallback', '1');
      await navigateTo(
        { path: next.pathname, query: Object.fromEntries(next.searchParams.entries()) },
        { replace: true },
      );
      return;
    }
    await runNormalTokenVerify(token);
  }

  function beginInsecureNativeSchemeWarn() {
    if (!insecureSchemeStatus.value?.allowed) return;
    errorMessage.value = '';
    insecureSchemeAckChecked.value = false;
    state.value = 'native_ios_insecure_warn';
  }

  function beginInsecureNativeSchemeConfirm() {
    errorMessage.value = '';
    insecureSchemeAckChecked.value = false;
    state.value = 'native_ios_insecure_confirm';
  }

  function cancelInsecureNativeScheme() {
    errorMessage.value = '';
    insecureSchemeAckChecked.value = false;
    insecureSchemeWorking.value = false;
    state.value = 'native_ios_safari';
  }

  async function confirmInsecureNativeSchemeAndOpen() {
    const token = magicTokenForFlow.value;
    if (!token || !insecureSchemeAckChecked.value || !insecureSchemeStatus.value?.allowed) return;
    if (import.meta.server) return;

    const apiUrl = String(runtimeConfig.public.apiUrl || '').replace(/\/$/, '');
    const confirmPhrase =
      insecureSchemeStatus.value.confirmPhrase || INSECURE_NATIVE_SCHEME_CONFIRM_PHRASE;

    insecureSchemeWorking.value = true;
    errorMessage.value = '';
    try {
      const res = await fetch(`${apiUrl}/api/auth/native/insecure-scheme/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          acknowledgedRisk: true,
          doubleConfirmed: true,
          confirmPhrase,
        }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: unknown; error?: unknown } | null;
      if (!res.ok || body?.ok !== true) {
        errorMessage.value =
          typeof body?.error === 'string' && body.error.trim()
            ? body.error
            : strings.authVerifyNativeIosInsecureFailed;
        return;
      }
      if (!openIosInsecureNativeScheme(window.location.href)) {
        errorMessage.value = strings.authVerifyNativeIosInsecureFailed;
        captureAuthEvent('magic_link_handoff_attempted', {
          platform: 'ios',
          method: 'vmp_scheme',
          outcome: 'failed',
        });
      } else {
        captureAuthEvent('magic_link_handoff_attempted', {
          platform: 'ios',
          method: 'vmp_scheme',
          outcome: 'opened',
        });
      }
    } catch {
      errorMessage.value = strings.authVerifyNativeIosInsecureFailed;
    } finally {
      insecureSchemeWorking.value = false;
    }
  }

  async function runNormalTokenVerify(token: string) {
    const redirect = safeRedirect(route.query.redirect, '/');
    const client = magicLinkClient();
    try {
      // Only PWA-tagged links use the iOS Safari → Home Screen handoff dance.
      if (shouldUseIosPwaHandoff()) {
        const mh = await magicPwaHandoff(token);
        if (mh.kind === '2fa') {
          captureAuthEvent('magic_link_redeem_succeeded', {
            surface: 'pwa_handoff',
            outcome: 'totp_required',
          });
          await navigateTo(
            `/auth/2fa?pending=${encodeURIComponent(mh.pendingToken)}&redirect=${encodeURIComponent(redirect)}&client=pwa`,
          );
          return;
        }
        if (mh.kind === 'handoff') {
          captureAuthEvent('magic_link_handoff_shown', {
            platform: 'ios',
            method: 'pwa_handoff_code',
          });
          await navigateTo(
            {
              path: '/auth/verify',
              query: { handoff: mh.handoffCode, redirect, client: 'pwa' },
            },
            { replace: true },
          );
          return;
        }
        if (mh.kind === 'session') {
          captureAuthEvent('magic_link_redeem_succeeded', {
            surface: 'pwa_handoff',
            outcome: 'session',
          });
          if (canEditContent.value && mh.user.totpRequired && !mh.user.totpEnabled) {
            await navigateTo(`/auth/2fa/setup?redirect=${encodeURIComponent(redirect)}`);
            return;
          }
          await navigateTo(redirect);
        }
        return;
      }

      const result = await verify(token);
      if ('requiresTwoFactor' in result) {
        captureAuthEvent('magic_link_redeem_succeeded', {
          surface: 'web_verify',
          outcome: 'totp_required',
        });
        await navigateTo(
          `/auth/2fa?pending=${encodeURIComponent(result.pendingToken)}&redirect=${encodeURIComponent(redirect)}&client=${client}`,
        );
        return;
      }
      captureAuthEvent('magic_link_redeem_succeeded', {
        surface: 'web_verify',
        outcome: 'session',
      });
      if (canEditContent.value && result.totpRequired && !result.totpEnabled) {
        await navigateTo(`/auth/2fa/setup?redirect=${encodeURIComponent(redirect)}`);
        return;
      }
      await navigateTo(redirect);
    } catch (err: unknown) {
      state.value = 'error';
      errorMessage.value = err instanceof Error ? err.message : strings.authVerifyErrorGeneric;
      captureAuthEvent('magic_link_redeem_failed', {
        surface: shouldUseIosPwaHandoff() ? 'pwa_handoff' : 'web_verify',
        reason: 'verify_error',
      });
    }
  }

  async function copyHandoffUrl() {
    const code = handoffCodeForSafari.value;
    if (!code || import.meta.server) return;
    const client = magicLinkClient();
    const path = `/auth/verify?handoff=${encodeURIComponent(code)}&client=${client}&redirect=${encodeURIComponent(safeRedirect(route.query.redirect, '/'))}`;
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      copyHint.value = strings.authVerifyHandoffCopied;
    } catch {
      copyHint.value = url;
    }
  }

  async function requestNewLink() {
    await startLoginFlow();
  }

  watch(
    () => route.fullPath,
    async () => {
      if (import.meta.server) return;

      errorMessage.value = '';

      const redirect = safeRedirect(firstQueryString(route.query.redirect) || undefined, '/');
      const handoff = firstQueryString(route.query.handoff) || undefined;
      const token = firstQueryString(route.query.token) || undefined;
      const pwaDone = firstQueryString(route.query.pwa_done);

      if (pwaDone === '1') {
        state.value = 'pwa_2fa_done';
        return;
      }

      if (handoff) {
        handoffCodeForSafari.value = handoff;

        if (shouldDeferPwaHandoffRedeem()) {
          state.value = 'handoff_wait';
          captureAuthEvent('magic_link_handoff_shown', {
            platform: 'ios',
            method: 'pwa_handoff_wait',
          });
          return;
        }

        // Standalone PWA or browser: redeem the PWA handoff cookie session here.
        state.value = 'verifying';
        try {
          await redeemPwaHandoff(handoff);
          if (!user.value) throw new Error(strings.authVerifySignInIncomplete);
          captureAuthEvent('magic_link_redeem_succeeded', { surface: 'pwa_handoff_redeem' });
          await navigateAfterFullSession(redirect);
        } catch (e: any) {
          state.value = 'error';
          errorMessage.value = e?.message || strings.authVerifyErrorGeneric;
          captureAuthEvent('magic_link_redeem_failed', {
            surface: 'pwa_handoff_redeem',
            reason: 'redeem_error',
          });
        }
        return;
      }

      if (!token) {
        state.value = 'error';
        errorMessage.value = strings.authVerifyNoToken;
        captureAuthEvent('magic_link_redeem_failed', {
          surface: 'web_verify',
          reason: 'missing_token',
        });
        return;
      }

      magicTokenForFlow.value = token;

      if (isPwaPushLoginLink()) {
        state.value = 'pwa_push_prompt';
        captureAuthEvent('magic_link_handoff_shown', {
          platform: 'ios',
          method: 'pwa_push',
        });
        return;
      }

      if (shouldOfferAndroidNativeAppHandoff()) {
        state.value = 'native_app_handoff';
        captureAuthEvent('magic_link_handoff_shown', {
          platform: 'android',
          method: 'intent',
        });
        // Android: bounce intent:// with the HTTPS token URL still intact.
        if (!didAutoOpenNative.value) {
          didAutoOpenNative.value = true;
          openInstalledNativeApp();
        }
        return;
      }

      if (shouldExplainIosNativeInSafari()) {
        await refreshInsecureSchemeStatus();
        state.value = 'native_ios_safari';
        captureAuthEvent('magic_link_handoff_shown', {
          platform: 'ios',
          method: 'native_safari_explain',
        });
        return;
      }

      state.value = 'verifying';
      await runNormalTokenVerify(token);
    },
    { immediate: true },
  );
</script>
