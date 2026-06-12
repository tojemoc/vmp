import * as Sentry from '@sentry/nuxt'
import { buildSentryInitOptions } from './utils/sentryOptions'

const config = useRuntimeConfig()
const initOptions = buildSentryInitOptions(config.public.sentry)

if (initOptions) {
  Sentry.init(initOptions)
}
