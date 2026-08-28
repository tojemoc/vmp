/**
 * SSR exception capture for PostHog error tracking.
 *
 * `@posthog/nuxt`'s own `enableExceptionAutocapture` hooks Nitro's `error` hook
 * and captures unconditionally — including every 404 Nitro raises for an
 * unmatched route — and it has no filter hook we can reach: `serverConfig` goes
 * through `runtimeConfig`, which is JSON, so a `before_send` function cannot
 * survive the build. So autocapture stays off in `nuxt.config.ts` and this
 * plugin owns capture instead, keeping 5xx and dropping request-level 4xx.
 *
 * Requires `runtimeConfig.public.posthog.publicKey`; a build without a PostHog
 * key simply reports nothing.
 */
import { PostHog } from 'posthog-node';

import {
  anonymousServerErrorDistinctId,
  serverErrorProperties,
  shouldReportServerError,
} from '../../utils/serverErrorReporting';

export default defineNitroPlugin((nitroApp) => {
  const config = useRuntimeConfig();
  const publicKey = config.public.posthog?.publicKey;
  const host = config.public.posthog?.host;
  if (!publicKey) return;

  const environment = String(config.public.deployTier || '');

  // Built on first reportable error: most isolates never see a 5xx, and
  // `@posthog/nuxt` already constructs its own (now idle) server client.
  let client: PostHog | undefined;

  nitroApp.hooks.hook('error', async (error, { event }) => {
    if (!shouldReportServerError(error)) return;
    const request = event ? { path: event.path, method: event.method } : undefined;
    try {
      client ??= new PostHog(publicKey, { host });
      // Nitro passes this promise to `event.waitUntil`, so awaiting the send
      // does not delay the response.
      await client.captureExceptionImmediate(
        error,
        anonymousServerErrorDistinctId(),
        serverErrorProperties(error, request, environment),
      );
    } catch {
      // Never let error reporting turn a handled error into a second failure.
    }
  });

  nitroApp.hooks.hook('close', async () => {
    await client?.shutdown().catch(() => {});
  });
});
