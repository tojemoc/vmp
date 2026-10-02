import * as Sentry from '@sentry/nuxt';
import { useRuntimeConfig } from '#imports';
import { buildSentryInitOptions } from '~/utils/sentryOptions';

const config = useRuntimeConfig();
const baseOptions = buildSentryInitOptions(config.public.sentry);

if (baseOptions) {
  Sentry.init({
    ...baseOptions,
    // Sentry JS SDK 11 replaced sendDefaultPii with dataCollection; the v11 default
    // matches our previous sendDefaultPii: true behavior.
    debug: false,
  });
}
