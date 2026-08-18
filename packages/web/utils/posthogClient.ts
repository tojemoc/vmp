import type { PostHog } from 'posthog-js';

let client: PostHog | null = null;

export function setPostHogClient(next: PostHog | null): void {
  client = next;
}

export function getPostHogClient(): PostHog | null {
  return client;
}

/** Capture a snake_case product event when the browser PostHog client is initialized. */
export function capturePostHogEvent(event: string, properties: Record<string, unknown> = {}): void {
  if (import.meta.server || !client) return;
  client.capture(event, properties);
}
