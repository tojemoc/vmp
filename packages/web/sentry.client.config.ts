import * as Sentry from '@sentry/nuxt';
import { useRuntimeConfig } from '#imports';
import { buildSentryInitOptions } from '~/utils/sentryOptions';

const config = useRuntimeConfig();
const baseOptions = buildSentryInitOptions(config.public.sentry);

if (baseOptions) {
  Sentry.init({
    ...baseOptions,
    // Session Replay is heavy on mobile CPUs; sample lightly and only on errors by default.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.1,
    integrations: [
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    // Sentry JS SDK 11 replaced sendDefaultPii with dataCollection; the v11 default
    // matches our previous sendDefaultPii: true behavior.
    debug: false,
  });
}
