export function initialHydratedState(input: { isClient: boolean; isHydrating: boolean }): boolean {
  return input.isClient && !input.isHydrating;
}
