export type FocusableSelectableRef<T extends { focus: () => void }> =
  | T
  | readonly (T | null | undefined)[]
  | null
  | undefined

export function firstTemplateRef<T>(value: FocusableSelectableRef<T & { focus: () => void }>): T | null {
  if (Array.isArray(value)) {
    return value.find((candidate): candidate is T & { focus: () => void } => Boolean(candidate)) ?? null
  }

  return value ?? null
}

export function focusAndSelectTemplateRef<T extends { focus: () => void, select?: () => void }>(
  value: FocusableSelectableRef<T>,
): boolean {
  const element = firstTemplateRef(value)
  if (!element) return false

  element.focus()
  element.select?.()
  return true
}
