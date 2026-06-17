<template>
  <div class="overflow-x-hidden">
    <PersonalDataNoticeBanner />
    <PwaLoginWizard
      :open="isPwaPushLoginWizardOpen"
      @dismiss="closePwaPushLoginWizard"
    />
    <NuxtPage />
  </div>
</template>

<script setup lang="ts">
const { isPwaPushLoginWizardOpen, closePwaPushLoginWizard } = usePwaLoginWizardState()
const { htmlLang } = useUiLocale()

useHead({
  htmlAttrs: {
    lang: htmlLang,
  },
})
</script>