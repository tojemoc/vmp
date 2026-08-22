import * as Sentry from '@sentry/nuxt';
import { useRuntimeConfig } from '#imports';
import { buildSentryInitOptions } from '~/utils/sentryOptions';

const config = useRuntimeConfig();
const baseOptions = buildSentryInitOptions(config.public.sentry);

if (baseOptions) {
  Sentry.init({
    ...baseOptions,
    sendDefaultPii: true,
    debug: false,
  });
}
