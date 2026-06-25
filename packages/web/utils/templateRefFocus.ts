export type TemplateRefValue<T> = T | (T | null | undefined)[] | null | undefined

export function firstTemplateRef<T>(value: TemplateRefValue<T>): T | null {
  if (Array.isArray(value)) {
    return value.find((candidate): candidate is T => candidate != null) ?? null
  }

  return value ?? null
}

export function focusAndSelectTemplateRef<T extends { focus: () => void, select?: () => void }>(
  value: TemplateRefValue<T>,
): boolean {
  const element = firstTemplateRef(value)
  if (!element) return false

  element.focus()
  element.select?.()
  return true
}
