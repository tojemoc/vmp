import { readBuildInfoDefaults } from './utils/buildInfoSource'
import { parseEnvBoolean, parseTracesSampleRate } from './utils/sentryOptions'

const buildInfo = readBuildInfoDefaults()

export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },

  sourcemap: { client: 'hidden' },

  modules: [
    '@nuxtjs/tailwindcss',
    '@nuxtjs/color-mode',
    '@vite-pwa/nuxt',
    '@sentry/nuxt/module',
  ],

  sentry: {
    org: 'tojemoc',
    project: 'vmp-fe-primary',
    authToken: process.env.SENTRY_AUTH_TOKEN,
  },

  nitro: {
    // Workbox navigateFallback requires "/" in the precache manifest (SSR builds).
    prerender: {
      routes: ['/'],
    },
  },

  colorMode: {
    preference: 'system', // default value of $colorMode.preference
    fallback: 'dark', // fallback value if not system preference found
    classSuffix: '', // use just 'dark' and 'light' classes
  },

  vite: {
    optimizeDeps: {
      include: [
        '@vue/devtools-core',
        '@vue/devtools-kit',
        'media-chrome',
        'videojs-video-element',
      ]
    }
  },

  runtimeConfig: {
    public: {
      apiUrl: process.env.API_URL || 'https://vmp-api.tjm.sk',
      /** Canonical site origin for og:url and absolute og:image (defaults to request origin). */
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || 'https://vmp.tjm.sk',
      /** UI language for this deployment: `en`, `sk`, or `cs` (one locale per instance). */
      uiLocale: process.env.NUXT_PUBLIC_UI_LOCALE || 'en',
      sentry: {
        dsn: process.env.NUXT_PUBLIC_SENTRY_DSN || '',
        tracesSampleRate: parseTracesSampleRate(process.env.NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE),
        environment: process.env.NUXT_PUBLIC_SENTRY_ENVIRONMENT || '',
        enableLogs: parseEnvBoolean(process.env.NUXT_PUBLIC_SENTRY_ENABLE_LOGS),
      },
      /** staging | beta | production | development — controls admin footer build label. */
      deployTier: buildInfo.deployTier,
      /** Release tag or package version (production / beta). */
      appVersion: buildInfo.appVersion,
      /** Full git SHA baked in at build time (staging footer shows short form). */
      gitCommit: buildInfo.gitCommit,
      gitRepoUrl: buildInfo.gitRepoUrl,
    },
  },

  app: {
    head: {
      title: 'Video Monetization Platform',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'Premium video content platform' },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'Video Monetization Platform' },
        { name: 'twitter:card', content: 'summary_large_image' },
        // Required by Chrome's PWA installability check
        { name: 'theme-color', content: '#0f172a' },
      ],
      link: [
        // Belt-and-suspenders: @vite-pwa/nuxt injects this automatically, but
        // some Nitro presets miss the injection step — add it explicitly too.
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'icon', type: 'image/png', href: '/icons/pwa-192.png' },
        // iOS home screen icon (Safari ignores the web manifest icons array)
        { rel: 'apple-touch-icon', href: '/icons/pwa-192.png' },
      ],
    }
  },

  pwa: {
    // Keep the old precache alive for already-open tabs; they may still import
    // route chunks from the previous deployment until a close or refresh.
    registerType: 'prompt',
    // 'auto' lets vite-plugin-pwa choose the best registration strategy for
    // the current environment (inline script in <head> during SSR builds).
    injectRegister: 'auto',
    manifest: {
      name: 'VMP',
      short_name: 'VMP',
      description: 'Premium video content',
      start_url: '/',
      scope: '/',
      theme_color: '#0f172a',
      background_color: '#0f172a',
      display: 'standalone',
      // Prefer routing magic-link / handoff URLs into an already-installed PWA (Chromium; iOS may still open Safari).
      launch_handler: {
        client_mode: 'navigate-existing',
      },
      icons: [
        { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        // Separate maskable entry required by Chrome's installability audit
        { src: '/icons/pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      navigateFallback: '/',
      // The prerendered "/" shell must not be served for deep links — Workbox would
      // hydrate the homepage on /auth/verify and Nuxt eventually rewrites to /?token=…,
      // so magic-link login never runs.  Only the bare homepage uses the fallback.
      navigateFallbackDenylist: [/^\/(?!$)/],
      globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
      cleanupOutdatedCaches: true,
      // Keep push handlers in a tiny sidecar file so GenerateSW can still be used.
      importScripts: ['/sw-push.js'],
    },
    client: {
      installPrompt: true,
    },
    devOptions: {
      // Set to true locally if you need to test the service worker in dev mode.
      // Leave false for production — the module handles that path separately.
      enabled: false,
      type: 'classic', // Workbox uses importScripts(); must not be 'module'
    },
  },
})