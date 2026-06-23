import type { CmsBlock } from '@vmp/shared'

/** Build a minimal TipTap JSON document from plain text nodes. */
export function tiptapDoc(...nodes: Record<string, unknown>[]) {
  return { type: 'doc', content: nodes }
}

export function tiptapParagraph(text: string) {
  return { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }
}

export function tiptapHeading(level: number, text: string) {
  return { type: 'heading', attrs: { level }, content: [{ type: 'text', text }] }
}

export function tiptapBulletList(items: string[]) {
  return {
    type: 'bulletList',
    content: items.map((item) => ({
      type: 'listItem',
      content: [tiptapParagraph(item)],
    })),
  }
}

export function tiptapRichTextBlock(...nodes: Record<string, unknown>[]): CmsBlock {
  return { type: 'rich_text', content: tiptapDoc(...nodes) }
}

/** English personal-data page content for CMS seed (matches locales/en/personalData.ts). */
export function buildPersonalDataCmsBlocks(): CmsBlock[] {
  return [
    tiptapRichTextBlock(
      tiptapParagraph(
        'We built this platform for subscribers in the European Union, especially Czechia and Slovakia. We keep client-side storage to what is needed to run the service, and we describe everything below in plain language.',
      ),
      tiptapParagraph(
        'This page is an information notice under the GDPR and the ePrivacy rules. It is not a marketing cookie wall. Strictly necessary storage does not require consent, but you have the right to be informed before it is used.',
      ),
    ),
    tiptapRichTextBlock(
      tiptapHeading(2, 'Browsing without signing in'),
      tiptapParagraph(
        'If you only read public pages and do not sign in, we do not set an authentication cookie. Anonymous video previews are served through our API; playback position is not saved between visits.',
      ),
      tiptapParagraph(
        'We use privacy-oriented, cookieless pageview analytics (Umami Cloud, EU data region) to measure audience size. Umami does not set marketing cookies or cross-site identifiers in its default configuration. We rely on legitimate interest for this limited statistical purpose and you can object (see Your rights).',
      ),
    ),
    tiptapRichTextBlock(
      tiptapHeading(2, 'When you interact with the site'),
      tiptapParagraph(
        'Certain features only work if the browser stores a small amount of data. These are strictly necessary for the feature you request — not for advertising or profiling.',
      ),
      tiptapParagraph(
        'By signing in, subscribing, enabling notifications, installing the web app, or changing playback speed, you use features that require the storage listed in the table below. You can avoid most of this storage by not using those features (for example, stay logged out and do not change player settings).',
      ),
      tiptapParagraph(
        'We do not use your interaction as consent to unrelated marketing trackers. If we ever add optional analytics or marketing tools that are not strictly necessary, we will ask for consent first.',
      ),
    ),
    tiptapRichTextBlock(
      tiptapHeading(2, 'Cookies and browser storage we use'),
      tiptapParagraph(
        'The application code below is under our control. Third-party payment pages (Stripe) may set their own cookies when you start checkout on their surfaces.',
      ),
    ),
    {
      type: 'table',
      columns: ['Name / key', 'Mechanism', 'Purpose', 'Lifetime', 'Strictly necessary?'],
      columnKeys: ['name', 'mechanism', 'purpose', 'lifetime', 'necessary'],
      rows: [
        { name: 'refresh_token', mechanism: 'HttpOnly cookie (first-party API)', purpose: 'Keeps you signed in between visits; rotated on refresh', lifetime: 'Up to 30 days, or until logout', necessary: 'Yes — authentication' },
        { name: 'playbackRate', mechanism: 'localStorage', purpose: 'Remembers your chosen video playback speed', lifetime: 'Until you clear site data', necessary: 'Functional — only after you change speed' },
        { name: 'nuxt-color-mode', mechanism: 'localStorage', purpose: 'Applies light/dark display matching your system preference', lifetime: 'Until you clear site data', necessary: 'Functional — display preference' },
        { name: 'vmp_pwa_device_token', mechanism: 'localStorage', purpose: 'Links push-login handoff to your browser on installed iOS PWA', lifetime: 'Persistent until cleared', necessary: 'Yes — only when you use PWA push sign-in' },
        { name: 'vmp_pwa_login_email', mechanism: 'localStorage', purpose: 'Prefills email during PWA sign-in wizard', lifetime: 'Until cleared or push disabled', necessary: 'Functional — PWA login UX' },
        { name: 'vmp-pwa-auth (IndexedDB)', mechanism: 'IndexedDB', purpose: 'Temporary handoff code between Safari and installed PWA', lifetime: 'Short-lived; cleared after redeem', necessary: 'Yes — iOS PWA authentication' },
        { name: 'Service worker caches', mechanism: 'Cache API (PWA)', purpose: 'Offline shell and faster repeat loads for installed app', lifetime: 'While PWA installed / until cache purge', necessary: 'Yes — PWA functionality' },
        { name: 'Session handoff keys', mechanism: 'sessionStorage', purpose: 'Short-lived auth and UI state during a single tab session', lifetime: 'Until tab closes', necessary: 'Yes — security during login flows' },
        { name: 'vmp_personal_data_notice_ack', mechanism: 'localStorage', purpose: 'Remembers that you dismissed the personal data notice banner', lifetime: 'Until you clear site data', necessary: 'Functional — only after you acknowledge the notice' },
      ],
    },
    tiptapRichTextBlock(
      tiptapHeading(2, 'Who processes data on our behalf'),
      tiptapParagraph(
        'Primary hosting uses Cloudflare (API Worker, D1 database, R2 media, Pages frontend). Traffic is served from Cloudflare’s global network; we cannot guarantee that every byte stays inside the EU, but we minimise personal data and use EU-based analytics where possible.',
      ),
      tiptapParagraph(
        'Backup infrastructure may run on Deno Deploy (API) and Vercel (frontend). The Vercel deployment may load Vercel Web Analytics for operational traffic statistics on that hostname only.',
      ),
      tiptapParagraph(
        'Other processors include: Umami Cloud (EU) for anonymous statistics; Stripe for payments; Brevo for transactional email; Sentry for error monitoring on the frontend and API. Payment and email processing happen only when you use those features.',
      ),
      tiptapBulletList([
        'Cloudflare — hosting, CDN, security (global edge)',
        'Umami Cloud (EU region) — cookieless pageview statistics',
        'Stripe — payment processing when you subscribe',
        'Brevo — magic-link and account email',
        'Sentry — error and stability monitoring (technical logs)',
        'Deno Deploy / Vercel — backup API and frontend deployments',
      ]),
    ),
    tiptapRichTextBlock(
      tiptapHeading(2, 'Server-side processing (no browser cookie)'),
      tiptapParagraph(
        'When video streams are delivered, our API logs anonymised technical events (for example hashed IP, country from network headers, and viewing session buckets) to operate the service, prevent abuse, and show aggregate statistics to administrators. These logs are not used to advertise to you and are not shared with ad networks.',
      ),
    ),
    tiptapRichTextBlock(
      tiptapHeading(2, 'Your rights (EU / UK visitors)'),
      tiptapParagraph(
        'Under the GDPR you may request access, rectification, erasure, restriction, portability, or object to processing based on legitimate interest. You may withdraw consent where processing is consent-based (we use little consent-based processing today).',
      ),
      tiptapParagraph(
        'To exercise rights, contact us using the support channel published on this site. You may also lodge a complaint with your supervisory authority:',
      ),
      tiptapBulletList([
        'Czechia — Úřad pro ochranu osobních údajů (ÚOOÚ), uoou.cz',
        'Slovakia — Úrad na ochranu osobných údajov SR (ÚOO SR), dataprotection.gov.sk',
      ]),
    ),
    tiptapRichTextBlock(
      tiptapHeading(2, 'Updates'),
      tiptapParagraph(
        'We may update this notice when the service or law changes. The latest version is always published at this URL. Material changes will be reflected in the on-site notice banner when appropriate.',
      ),
    ),
  ]
}

export const PERSONAL_DATA_CMS_PAGE = {
  id: 'cms-page-personal-data',
  title: 'Personal data processing',
  slug: 'personal-data',
  description:
    'How VMP uses cookies, browser storage, and processors when you browse, sign in, and watch videos — written for visitors in the EU.',
}
