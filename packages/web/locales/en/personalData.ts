import type { PersonalDataPage } from '../types';

export const personalData: PersonalDataPage = {
  metaTitle: 'Personal data processing',
  metaDescription:
    'How VMP uses cookies, browser storage, and processors when you browse, sign in, and watch videos — written for visitors in the EU.',

  intro: [
    'We built this platform for subscribers in the European Union, especially Czechia and Slovakia. We keep client-side storage to what is needed to run the service, and we describe everything below in plain language.',
    'This page is an information notice under the GDPR and the ePrivacy rules. It is not a marketing cookie wall. Strictly necessary storage does not require consent, but you have the right to be informed before it is used.',
  ],

  bannerSummary:
    'We avoid non-essential cookies. When you sign in, pay, or use player preferences, strictly necessary cookies or browser storage keep the service working — see our Personal data notice.',

  sections: [
    {
      id: 'passive-browsing',
      title: 'Browsing without signing in',
      paragraphs: [
        'If you only read public pages and do not sign in, we do not set an authentication cookie. Anonymous video previews are served through our API; playback position is not saved between visits.',
        'We use privacy-oriented, cookieless pageview analytics (Umami Cloud, EU data region) to measure audience size. Umami does not set marketing cookies or cross-site identifiers in its default configuration. We rely on legitimate interest for this limited statistical purpose and you can object (see Your rights).',
        'We also use PostHog (EU cloud) for product analytics. Before you sign in, a small set of anonymous events may be recorded (for example requesting a magic link). Those events use an anonymous browser id and do not create a PostHog person profile. After you sign in, events are tied to your internal account ID only — we do not send your email address to PostHog. Person profiles are created only for signed-in users.',
        'Our API may send technical exception events to PostHog for reliability analysis. Unauthenticated errors use a short-lived random id (not your account). Event retention follows our PostHog EU project retention settings.',
      ],
    },
    {
      id: 'interaction',
      title: 'When you interact with the site',
      paragraphs: [
        'Certain features only work if the browser stores a small amount of data. These are strictly necessary for the feature you request — not for advertising or profiling.',
        'By signing in, subscribing, enabling notifications, installing the web app, or changing playback speed, you use features that require the storage listed in the table below. You can avoid most of this storage by not using those features (for example, stay logged out and do not change player settings).',
        'We do not use your interaction as consent to unrelated marketing trackers. Optional advertising tools that are not strictly necessary would require consent first. PostHog product analytics (anonymous pre-auth events and signed-in account-id events) is disclosed under processors below.',
      ],
    },
    {
      id: 'storage-table',
      title: 'Cookies and browser storage we use',
      paragraphs: [
        'The application code below is under our control. Third-party payment pages (Stripe) may set their own cookies when you start checkout on their surfaces.',
      ],
    },
    {
      id: 'processors',
      title: 'Who processes data on our behalf',
      paragraphs: [
        'Primary hosting uses Cloudflare (API Worker, D1 database, R2 media, Pages frontend). Traffic is served from Cloudflare’s global network; we cannot guarantee that every byte stays inside the EU, but we minimise personal data and use EU-based analytics where possible.',
        'Backup infrastructure may run on Deno Deploy (API) and Vercel (frontend).',
        'Other processors include: Umami Cloud (EU) for anonymous statistics; PostHog (EU) for product analytics (anonymous pre-auth events without person profiles; signed-in events keyed by account ID only, no email; API exception events); Stripe for payments; Brevo for transactional email; Sentry for error monitoring on the frontend and API. Payment and email processing happen only when you use those features.',
      ],
      bullets: [
        'Cloudflare — hosting, CDN, security (global edge)',
        'Umami Cloud (EU region) — cookieless pageview statistics',
        'PostHog (EU cloud) — product analytics and technical exceptions (account ID after sign-in; no email)',
        'Stripe — payment processing when you subscribe',
        'Brevo — magic-link and account email',
        'Sentry — error and stability monitoring (technical logs)',
        'Deno Deploy / Vercel — backup API and frontend deployments',
      ],
    },
    {
      id: 'server-processing',
      title: 'Server-side processing (no browser cookie)',
      paragraphs: [
        'When video streams are delivered, our API logs anonymised technical events (for example hashed IP, country from network headers, and viewing session buckets) to operate the service, prevent abuse, and show aggregate statistics to administrators. These logs are not used to advertise to you and are not shared with ad networks.',
        'If you are signed in, we also store your last playback position per on-demand video (VOD) on our servers so we can resume where you left off. Positions are updated occasionally while you watch and when you leave the page — not on every scrub of the timeline. Anonymous visitors do not get server-side resume. You can remove a saved position for any currently available video from Continue watching on your account page. To request erasure of your account and related personal data — including all saved playback positions — email the support address shown at the bottom of this page.',
      ],
    },
    {
      id: 'rights',
      title: 'Your rights (EU / UK visitors)',
      paragraphs: [
        'Under the GDPR you may request access, rectification, erasure, restriction, portability, or object to processing based on legitimate interest. You may withdraw consent where processing is consent-based (we use little consent-based processing today).',
        'To exercise rights, email the support address shown at the bottom of this page. You may also lodge a complaint with your supervisory authority:',
      ],
      bullets: [
        'Czechia — Úřad pro ochranu osobních údajů (ÚOOÚ), uoou.cz',
        'Slovakia — Úrad na ochranu osobných údajov SR (ÚOO SR), dataprotection.gov.sk',
      ],
    },
    {
      id: 'changes',
      title: 'Updates',
      paragraphs: [
        'We may update this notice when the service or law changes. The latest version is always published at this URL. Material changes will be reflected in the on-site notice banner when appropriate.',
      ],
    },
  ],

  storageRows: [
    {
      name: 'refresh_token',
      mechanism: 'HttpOnly cookie (first-party API)',
      purpose: 'Keeps you signed in between visits; rotated on refresh',
      lifetime: 'Up to 30 days, or until logout',
      necessary: 'Yes — authentication',
    },
    {
      name: 'playbackRate',
      mechanism: 'localStorage',
      purpose: 'Remembers your chosen video playback speed',
      lifetime: 'Until you clear site data',
      necessary: 'Functional — only after you change speed',
    },
    {
      name: 'nuxt-color-mode',
      mechanism: 'localStorage',
      purpose: 'Applies light/dark display matching your system preference',
      lifetime: 'Until you clear site data',
      necessary: 'Functional — display preference',
    },
    {
      name: 'vmp_pwa_device_token',
      mechanism: 'localStorage',
      purpose: 'Links push-login handoff to your browser on installed iOS PWA',
      lifetime: 'Persistent until cleared',
      necessary: 'Yes — only when you use PWA push sign-in',
    },
    {
      name: 'vmp_pwa_login_email',
      mechanism: 'localStorage',
      purpose: 'Prefills email during PWA sign-in wizard',
      lifetime: 'Until cleared or push disabled',
      necessary: 'Functional — PWA login UX',
    },
    {
      name: 'vmp-pwa-auth (IndexedDB)',
      mechanism: 'IndexedDB',
      purpose: 'Temporary handoff code between Safari and installed PWA',
      lifetime: 'Short-lived; cleared after redeem',
      necessary: 'Yes — iOS PWA authentication',
    },
    {
      name: 'Service worker caches',
      mechanism: 'Cache API (PWA)',
      purpose: 'Offline shell and faster repeat loads for installed app',
      lifetime: 'While PWA installed / until cache purge',
      necessary: 'Yes — PWA functionality',
    },
    {
      name: 'Session handoff keys',
      mechanism: 'sessionStorage',
      purpose: 'Short-lived auth and UI state during a single tab session',
      lifetime: 'Until tab closes',
      necessary: 'Yes — security during login flows',
    },
    {
      name: 'PostHog persistence (ph_*)',
      mechanism: 'localStorage / first-party cookies',
      purpose:
        'Product analytics session/distinct id (anonymous before sign-in; linked to account id after). Does not store your email. Retention follows our PostHog EU project settings.',
      lifetime: 'Until you clear site data or sign out resets identity',
      necessary: 'Functional — product analytics (disclosed)',
    },
    {
      name: 'vmp_personal_data_notice_ack',
      mechanism: 'localStorage',
      purpose: 'Remembers that you dismissed the personal data notice banner',
      lifetime: 'Until you clear site data',
      necessary: 'Functional — only after you acknowledge the notice',
    },
  ],
};
