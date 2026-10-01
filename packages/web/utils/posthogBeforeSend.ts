import type { BeforeSendFn } from 'posthog-js';

import { shouldDropPostHogExceptionEvent } from './analytics/noiseFilter';
import { isPostHogFlagshipCompiled } from './posthogFlagshipGate';

/** PostHog beforeSend hook that filters out benign abort errors from exception tracking. */
export const posthogBeforeSend: BeforeSendFn = (event) => {
  if (!event) return null;
  // Drop until Flagship hydration confirms `posthog` is compiled for this deployment.
  if (!isPostHogFlagshipCompiled()) return null;
  if (shouldDropPostHogExceptionEvent(event)) return null;
  return event;
};
