import * as Sentry from '@sentry/nuxt'
import { useRuntimeConfig } from '#imports'
import { buildSentryInitOptions } from '~/utils/sentryOptions'

const config = useRuntimeConfig()
const baseOptions = buildSentryInitOptions(config.public.sentry)

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
    sendDefaultPii: true,
    debug: false,
  })
}
