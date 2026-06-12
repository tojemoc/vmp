import * as Sentry from '@sentry/nuxt'
import { buildSentryInitOptions, parseEnvBoolean, parseTracesSampleRate } from './utils/sentryOptions'

const sentry = useRuntimeConfig().public.sentry
const initOptions = buildSentryInitOptions({
  dsn: sentry.dsn || '',
  tracesSampleRate: parseTracesSampleRate(String(sentry.tracesSampleRate ?? '')),
  environment: sentry.environment || '',
  enableLogs: parseEnvBoolean(String(sentry.enableLogs ?? '')),
})

if (initOptions) {
  Sentry.init(initOptions)
}
