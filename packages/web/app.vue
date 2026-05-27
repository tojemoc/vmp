<template>
  <div class="overflow-x-hidden">
    <PwaLoginWizard
      :open="isPwaPushLoginWizardOpen"
      @dismiss="closePwaPushLoginWizard"
    />
    <NuxtPage />
  </div>
</template>

<script setup lang="ts">
const { isPwaPushLoginWizardOpen, closePwaPushLoginWizard } = usePwaLoginWizardState()
</script>