/**
 * Server-side PostHog exception capture, replacing `@posthog/nuxt`'s
 * `serverConfig.enableExceptionAutocapture` (disabled in `nuxt.config.ts`).
 *
 * The module captures everything Nitro reports and exposes no filter hook — its
 * `serverConfig` travels through `runtimeConfig`, which is serialized, so a callback
 * cannot reach it. Owning the hook here lets 4xx be dropped before capture; see
 * `utils/posthogServerExceptions.ts` for why that matters.
 */
import { PostHog } from 'posthog-node';
import { isPostHogConfigured } from '../../utils/posthogPublicKey';
import {
  httpStatusFromError,
  newServerExceptionDistinctId,
  serverExceptionProperties,
  shouldCaptureServerException,
} from '../../utils/posthogServerExceptions';

/** The bits of the H3 event Nitro hands the `error` hook that we use. */
type ErrorHookEvent = {
  path?: string;
  method?: string;
  waitUntil?: (promise: Promise<unknown>) => void;
};

export default defineNitroPlugin((nitroApp) => {
  const config = useRuntimeConfig();
  if (!isPostHogConfigured(config)) return;
  const publicKey = (config.public.posthog?.publicKey ?? '').trim();

  const host = (config.public.posthog?.host ?? '').trim() || undefined;
  const environment = (config.public.deployTier ?? '').trim() || undefined;

  // Built on the first real fault, so healthy isolates never pay for a second client.
  let client: PostHog | undefined;

  nitroApp.hooks.hook('error', (error, context) => {
    if (!shouldCaptureServerException(error)) return;

    const event = context?.event as ErrorHookEvent | undefined;
    try {
      client ??= new PostHog(publicKey, { host, flushAt: 1, flushInterval: 0 });
      const sent = client
        .captureExceptionImmediate(
          error,
          newServerExceptionDistinctId(),
          serverExceptionProperties({
            path: event?.path,
            method: event?.method,
            status: httpStatusFromError(error),
            environment,
          }),
        )
        .catch((err) => {
          console.error('[PostHog] server exception capture failed', err);
        });
      // Nitro does not await this hook, and a Worker isolate can end before the
      // request finishes — keep it alive when the runtime supports it.
      event?.waitUntil?.(sent);
    } catch (err) {
      console.error('[PostHog] server exception capture failed', err);
    }
  });

  nitroApp.hooks.hook('close', async () => {
    await client?.shutdown();
  });
});
