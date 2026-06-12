import * as Sentry from '@sentry/nuxt'
import { buildSentryInitOptions, parseEnvBoolean, parseTracesSampleRate } from './utils/sentryOptions'

const initOptions = buildSentryInitOptions({
  dsn: process.env.NUXT_PUBLIC_SENTRY_DSN || '',
  tracesSampleRate: parseTracesSampleRate(process.env.NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE),
  environment: process.env.NUXT_PUBLIC_SENTRY_ENVIRONMENT || '',
  enableLogs: parseEnvBoolean(process.env.NUXT_PUBLIC_SENTRY_ENABLE_LOGS),
})

if (initOptions) {
  Sentry.init(initOptions)
}
