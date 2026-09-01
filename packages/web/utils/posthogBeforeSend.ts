import type { BeforeSendFn } from 'posthog-js';

import { shouldDropPostHogExceptionEvent } from './analytics/noiseFilter';

export const posthogBeforeSend: BeforeSendFn = (event) => {
  if (!event) return null;
  if (shouldDropPostHogExceptionEvent(event)) return null;
  return event;
};
