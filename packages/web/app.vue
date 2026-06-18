<template>
  <div class="overflow-x-hidden">
    <PersonalDataNoticeBanner />
    <DevLocalePreview v-if="isDev" />
    <PwaLoginWizard
      :open="isPwaPushLoginWizardOpen"
      @dismiss="closePwaPushLoginWizard"
    />
    <NuxtPage />
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
