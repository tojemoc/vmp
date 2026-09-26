<template>
  <div
    class="text-left space-y-3"
    :class="[
      bordered
        ? variant === 'popup'
          ? ''
          : `rounded-lg border p-3 ${embedded ? 'border-gray-200 dark:border-gray-700' : 'border-gray-700'}`
        : '',
    ]"
  >
    <p
      v-if="hint"
      class="text-sm"
      :class="embedded ? 'text-gray-600 dark:text-gray-400' : mutedClass"
    >
      {{ hint }}
    </p>

    <div v-if="step === 'email'" class="space-y-2">
      <label
        class="text-xs uppercase tracking-wide block"
        :class="embedded ? 'text-gray-500 dark:text-gray-400' : labelClass"
      >
        {{ strings.checkoutAuthEmailLabel }}
      </label>
      <input
        v-model="email"
        type="email"
        autocomplete="email"
        :placeholder="strings.checkoutAuthEmailPlaceholder"
        class="w-full px-3 py-2 rounded-lg border text-sm placeholder-gray-500"
        :class="inputClass"
        :disabled="busy"
        @keydown.enter="onSend"
      >
      <p v-if="error" class="text-xs text-red-400">{{ error }}</p>
      <button
        type="button"
        class="w-full py-2.5 px-4 text-sm font-semibold rounded-lg text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
        :disabled="busy || !email.trim()"
        @click="onSend"
      >
        {{ busy ? strings.checkoutAuthSending : strings.checkoutAuthSendCode }}
      </button>
    </div>

    <div v-else-if="step === 'code'" class="space-y-2">
      <p class="text-sm text-emerald-500 dark:text-emerald-400">
        {{ strings.checkoutAuthCodeSent }}
      </p>
      <label
        class="text-xs uppercase tracking-wide block"
        :class="embedded ? 'text-gray-500 dark:text-gray-400' : labelClass"
      >
        {{ strings.checkoutAuthCodeLabel }}
      </label>
      <input
        v-model="code"
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="6"
        :placeholder="strings.checkoutAuthCodePlaceholder"
        class="w-full px-3 py-2 rounded-lg border text-sm tracking-widest placeholder-gray-500"
        :class="inputClass"
        :disabled="busy"
        @keydown.enter="onVerifyCode"
      >
      <p v-if="error" class="text-xs text-red-400">{{ error }}</p>
      <button
        type="button"
        class="w-full py-2.5 px-4 text-sm font-semibold rounded-lg text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
        :disabled="busy || code.trim().length < 6"
        @click="onVerifyCode"
      >
        {{ busy ? strings.checkoutAuthVerifying : strings.checkoutAuthVerifyCode }}
      </button>
      <div class="flex flex-wrap gap-3 text-xs">
        <button
          type="button"
          class="text-blue-500 dark:text-blue-400 hover:underline"
          :disabled="busy"
          @click="onSend"
        >
          {{ strings.checkoutAuthResend }}
        </button>
        <button
          type="button"
          class="text-gray-500 dark:text-gray-400 hover:underline"
          :disabled="busy"
          @click="reset()"
        >
          {{ strings.checkoutAuthChangeEmail }}
        </button>
      </div>
    </div>

    <div v-else-if="step === 'totp'" class="space-y-2">
      <p class="text-sm" :class="embedded ? 'text-gray-600 dark:text-gray-400' : mutedClass">
        {{ strings.checkoutAuthTotpHint }}
      </p>
      <label
        class="text-xs uppercase tracking-wide block"
        :class="embedded ? 'text-gray-500 dark:text-gray-400' : labelClass"
      >
        {{ strings.checkoutAuthTotpLabel }}
      </label>
      <input
        v-model="totp"
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="6"
        :placeholder="strings.totpCodePlaceholder"
        class="w-full px-3 py-2 rounded-lg border text-sm tracking-widest placeholder-gray-500"
        :class="inputClass"
        :disabled="busy"
        @keydown.enter="onVerifyTotp"
      >
      <p v-if="error" class="text-xs text-red-400">{{ error }}</p>
      <button
        type="button"
        class="w-full py-2.5 px-4 text-sm font-semibold rounded-lg text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
        :disabled="busy || totp.trim().length < 6"
        @click="onVerifyTotp"
      >
        {{ busy ? strings.checkoutAuthVerifying : strings.totpVerifyButton }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
  import type { MagicLinkClient } from '@vmp/shared';
  import { useInlineAuth } from '~/composables/useInlineAuth';
  import strings from '~/utils/strings';

  const props = withDefaults(
    defineProps<{
      redirectPath?: string;
      client?: MagicLinkClient;
      /** Analytics + PostHog surface (checkout | login | header). */
      surface?: string;
      /** Light account-page styling vs dark modal. */
      embedded?: boolean;
      /** `popup` = header dropdown; `panel` = bordered checkout/login card. */
      variant?: 'panel' | 'popup';
      bordered?: boolean;
      hint?: string;
    }>(),
    {
      embedded: false,
      variant: 'panel',
      bordered: true,
      surface: 'inline_auth',
    },
  );

  const emit = defineEmits<{
    success: [];
  }>();

  const { step, email, code, totp, busy, error, reset, sendCode, submitCode, submitTotp } =
    useInlineAuth({
      redirectPath: () => props.redirectPath,
      client: () => props.client,
      surface: props.surface,
    });

  const mutedClass = computed(() =>
    props.variant === 'popup' ? 'text-gray-600 dark:text-gray-400' : 'text-gray-400',
  );
  const labelClass = computed(() =>
    props.variant === 'popup' ? 'text-gray-500 dark:text-gray-400' : 'text-gray-500',
  );
  const inputClass = computed(() => {
    if (props.embedded || props.variant === 'popup') {
      return 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white';
    }
    return 'border-gray-700 bg-gray-800 text-white';
  });

  async function onSend() {
    await sendCode(props.redirectPath);
  }

  async function onVerifyCode() {
    if (await submitCode()) emit('success');
  }

  async function onVerifyTotp() {
    if (await submitTotp()) emit('success');
  }

  defineExpose({ reset, step });
</script>
