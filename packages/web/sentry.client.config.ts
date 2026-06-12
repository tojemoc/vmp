import * as Sentry from '@sentry/nuxt'

const config = useRuntimeConfig()
const dsn = config.public.sentry.dsn

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 1.0,
    enableLogs: true,
  })
}
