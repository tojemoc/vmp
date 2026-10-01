/**
 * Module-level Flagship gate for PostHog capture paths that cannot use composables
 * (`before_send`, early capture helpers). Plugins set this after hydration.
 *
 * `null` = not yet confirmed → stay opted out / drop events.
 */
let posthogFlagshipCompiled: boolean | null = null;

export function setPostHogFlagshipCompiled(compiled: boolean): void {
  posthogFlagshipCompiled = compiled;
}

/** True only after hydration confirmed Flagship `posthog` is compiled on. */
export function isPostHogFlagshipCompiled(): boolean {
  return posthogFlagshipCompiled === true;
}
