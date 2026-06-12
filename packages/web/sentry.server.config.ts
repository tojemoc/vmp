import * as Sentry from '@sentry/nuxt'

const dsn = process.env.SENTRY_DSN || process.env.NUXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 1.0,
    enableLogs: true,
  })
}
