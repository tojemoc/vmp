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
  - client=native: Android intent:// before web redeem; iOS Safari explains missing Universal Links.
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
        <button
          type="button"
          class="w-full px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          @click="continueNativeIosInSafari"
        >
          {{ strings.authVerifyNativeIosSafariContinue }}
        </button>
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
  import { normalizeMagicLinkClient, type MagicLinkClient } from '@vmp/shared';
  import { navigateTo, useRoute, useRuntimeConfig } from '#app';
  import {
    isNativeAppFallbackQuery,
    openAndroidNativeApp,
    resolveMobileAndroidPackage,
  } from '~/utils/nativeAppHandoff';
  import { isAndroid, isInstalledPwa, isIosLike as isIosLikeUa } from '~/utils/pwa';
  import strings from '~/utils/strings';

  const route = useRoute();
  const runtimeConfig = useRuntimeConfig();
  const { verify, magicPwaHandoff, redeemPwaHandoff, canEditContent, user } = useAuth();
  const { deliverMagicLinkToPwa } = usePwaPushLogin();
  const { startLoginFlow } = useLoginFlow();

  function mobileAndroidPackage(): string {
    return resolveMobileAndroidPackage(String(runtimeConfig.public.mobileAndroidPackage || ''));
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
   * Native-tagged link on Android (not the installed PWA): offer package-targeted
   * intent:// before web redeem consumes the token.
   */
  function shouldOfferAndroidNativeAppHandoff(): boolean {
    if (import.meta.server) return false;
    if (magicLinkClient() !== 'native') return false;
    if (!isAndroid() || isInstalledPwa()) return false;
    if (isNativeAppFallbackQuery(route.query.native_fallback)) return false;
    return true;
  }

  /**
   * Native-tagged link on iOS Safari: Universal Links would have opened the app
   * already when AASA is live. Landing here means association is missing / SideStore
   * re-sign — explain and offer a website session (no claimable vmp://).
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
    | 'pwa_push_prompt'
    | 'pwa_push_sending'
    | 'pwa_push_done'
    | 'pwa_2fa_done';

  function initialVerifyState(): State {
    if (firstQueryString(route.query.pwa_done) === '1') return 'pwa_2fa_done';
    if (firstQueryString(route.query.handoff) && shouldDeferPwaHandoffRedeem()) {
      return 'handoff_wait';
    }
    const token = firstQueryString(route.query.token);
    if (token && isPwaPushLoginLink()) return 'pwa_push_prompt';
    if (token && shouldOfferAndroidNativeAppHandoff()) return 'native_app_handoff';
    if (token && shouldExplainIosNativeInSafari()) return 'native_ios_safari';
    return 'verifying';
  }

  const state = ref<State>(initialVerifyState());
  const errorMessage = ref('');
  const copyHint = ref<string>(strings.authVerifyHandoffCopyLink);
  const handoffCodeForSafari = ref<string | null>(null);
  const magicTokenForFlow = ref<string | null>(null);
  const didAutoOpenNative = ref(false);

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
      await navigateAfterFullSession(redirect);
    } catch (e: any) {
      state.value = 'error';
      errorMessage.value = e?.message || strings.authVerifyErrorGeneric;
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
    openAndroidNativeApp(window.location.href, mobileAndroidPackage());
  }

  async function continueNativeAppInBrowser() {
    const token = magicTokenForFlow.value;
    if (!token) return;
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

  async function runNormalTokenVerify(token: string) {
    const redirect = safeRedirect(route.query.redirect, '/');
    const client = magicLinkClient();
    try {
      // Only PWA-tagged links use the iOS Safari → Home Screen handoff dance.
      if (shouldUseIosPwaHandoff()) {
        const mh = await magicPwaHandoff(token);
        if (mh.kind === '2fa') {
          await navigateTo(
            `/auth/2fa?pending=${encodeURIComponent(mh.pendingToken)}&redirect=${encodeURIComponent(redirect)}&client=pwa`,
          );
          return;
        }
        if (mh.kind === 'handoff') {
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
        await navigateTo(
          `/auth/2fa?pending=${encodeURIComponent(result.pendingToken)}&redirect=${encodeURIComponent(redirect)}&client=${client}`,
        );
        return;
      }
      if (canEditContent.value && result.totpRequired && !result.totpEnabled) {
        await navigateTo(`/auth/2fa/setup?redirect=${encodeURIComponent(redirect)}`);
        return;
      }
      await navigateTo(redirect);
    } catch (err: unknown) {
      state.value = 'error';
      errorMessage.value = err instanceof Error ? err.message : strings.authVerifyErrorGeneric;
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
          return;
        }

        // Standalone PWA or browser: redeem the PWA handoff cookie session here.
        state.value = 'verifying';
        try {
          await redeemPwaHandoff(handoff);
          if (!user.value) throw new Error(strings.authVerifySignInIncomplete);
          await navigateAfterFullSession(redirect);
        } catch (e: any) {
          state.value = 'error';
          errorMessage.value = e?.message || strings.authVerifyErrorGeneric;
        }
        return;
      }

      if (!token) {
        state.value = 'error';
        errorMessage.value = strings.authVerifyNoToken;
        return;
      }

      magicTokenForFlow.value = token;

      if (isPwaPushLoginLink()) {
        state.value = 'pwa_push_prompt';
        return;
      }

      if (shouldOfferAndroidNativeAppHandoff()) {
        state.value = 'native_app_handoff';
        // Android: bounce intent:// with the HTTPS token URL still intact.
        if (!didAutoOpenNative.value) {
          didAutoOpenNative.value = true;
          openInstalledNativeApp();
        }
        return;
      }

      if (shouldExplainIosNativeInSafari()) {
        state.value = 'native_ios_safari';
        return;
      }

      state.value = 'verifying';
      await runNormalTokenVerify(token);
    },
    { immediate: true },
  );
</script>
