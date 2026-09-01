import type { BeforeSendFn } from 'posthog-js';

import { shouldDropPostHogExceptionEvent } from './analytics/noiseFilter';

/** PostHog beforeSend hook that filters out benign abort errors from exception tracking. */
export const posthogBeforeSend: BeforeSendFn = (event) => {
  if (!event) return null;
  if (shouldDropPostHogExceptionEvent(event)) return null;
  return event;
};
