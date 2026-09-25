<template>
  <div class="min-h-screen bg-gray-950 flex items-center justify-center px-4">
    <div class="w-full max-w-sm">
      <!-- Logo / Brand -->
      <div class="text-center mb-8">
        <div class="inline-flex items-center space-x-2 mb-4">
          <div class="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg"></div>
          <span class="text-xl font-bold text-white">{{ strings.siteNameShort }}</span>
        </div>
        <h1 class="text-2xl font-bold text-white">{{ strings.loginTitle }}</h1>
        <p class="text-gray-400 text-sm mt-1">{{ strings.loginSubtitle }}</p>
      </div>

      <!-- Form: email → confirmation code → optional TOTP (same as checkout / header) -->
      <div class="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <InlineAuthForm
          :redirect-path="redirectTo"
          surface="login"
          variant="panel"
          :bordered="false"
          @success="onAuthSuccess"
        />
      </div>

      <p class="text-center text-xs text-gray-600 mt-6">
        {{ strings.loginTerms }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { resolveAuthReturnPath } from '~/utils/authRedirect';
  import { isIosInstalledPwa } from '~/utils/pwa';
  import strings from '~/utils/strings';

  usePageSeo({ title: strings.loginTitle, noIndex: true });

  const route = useRoute();
  const { isLoggedIn } = useAuth();
  const { waitForAuthInitialised } = useLoginFlow();
  const { openPwaPushLoginWizard } = usePwaLoginWizardState();

  // Prefer ?redirect= from callers; otherwise stay on home (do not bounce to /login).
  const redirectTo = resolveAuthReturnPath(route.query.redirect, undefined) || '/';

  if (isLoggedIn.value) {
    await navigateTo(redirectTo);
  }

  onMounted(() => {
    void (async () => {
      await waitForAuthInitialised();
      if (!isLoggedIn.value && isIosInstalledPwa()) {
        openPwaPushLoginWizard();
      }
    })();
  });

  watch(isLoggedIn, (loggedIn) => {
    if (loggedIn) void navigateTo(redirectTo);
  });

  async function onAuthSuccess() {
    await navigateTo(redirectTo);
  }
</script>
