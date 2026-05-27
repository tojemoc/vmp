const pwaLoginWizardOpen = ref(false)

export function usePwaLoginWizardState() {
  function openPwaPushLoginWizard() {
    pwaLoginWizardOpen.value = true
  }

  function closePwaPushLoginWizard() {
    pwaLoginWizardOpen.value = false
  }

  return {
    isPwaPushLoginWizardOpen: readonly(pwaLoginWizardOpen),
    openPwaPushLoginWizard,
    closePwaPushLoginWizard,
  }
}
