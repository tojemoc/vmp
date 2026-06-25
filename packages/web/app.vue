<template>
  <div class="overflow-x-hidden min-h-screen flex flex-col">
    <PersonalDataNoticeBanner />
    <DevLocalePreview v-if="isDev" />
    <PwaLoginWizard
      :open="isPwaPushLoginWizardOpen"
      @dismiss="closePwaPushLoginWizard"
    />
    <div class="flex-1">
      <NuxtPage />
    </div>
    <AppFooter />
  </div>
</template>

<script setup lang="ts">
const isDev = import.meta.dev
const { isPwaPushLoginWizardOpen, closePwaPushLoginWizard } = usePwaLoginWizardState()
const { htmlLang } = useUiLocale()

useHead({
  htmlAttrs: {
    lang: htmlLang,
  },
})
</script>
