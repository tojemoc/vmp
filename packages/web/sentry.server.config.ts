import * as Sentry from "@sentry/nuxt";
 
Sentry.init({
  dsn: "https://dc7f32b9ba036c0ae8d0346a937448b5@o4511548868198400.ingest.de.sentry.io/4511548881109072",

  // We recommend adjusting this value in production, or using tracesSampler
  // for finer control
  tracesSampleRate: 1.0,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Enable sending of user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nuxt/configuration/options/#sendDefaultPii
  sendDefaultPii: true,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,
});
