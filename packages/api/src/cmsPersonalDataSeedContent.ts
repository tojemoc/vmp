import type { CmsBlock } from '@vmp/shared';

/** Locales that have a short personal-data CMS notice. One language per D1 for now. */
export type PersonalDataCmsLocale = 'en' | 'sk' | 'cs';

export const PERSONAL_DATA_CMS_LOCALES: readonly PersonalDataCmsLocale[] = ['en', 'sk', 'cs'];

/** Build a minimal TipTap JSON document from plain text nodes. */
export function tiptapDoc(...nodes: Record<string, unknown>[]) {
  return { type: 'doc', content: nodes };
}

export function tiptapParagraph(text: string) {
  return { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] };
}

export function tiptapHeading(level: number, text: string) {
  return { type: 'heading', attrs: { level }, content: [{ type: 'text', text }] };
}

export function tiptapBulletList(items: string[]) {
  return {
    type: 'bulletList',
    content: items.map((item) => ({
      type: 'listItem',
      content: [tiptapParagraph(item)],
    })),
  };
}

export function tiptapRichTextBlock(...nodes: Record<string, unknown>[]): CmsBlock {
  return { type: 'rich_text', content: tiptapDoc(...nodes) };
}

type PersonalDataCopy = {
  title: string;
  description: string;
  intro: [string, string];
  signedOutTitle: string;
  signedOutBody: string;
  activeTitle: string;
  activeBody: string;
  tableColumns: [string, string, string];
  tableRows: Array<{ what: string; purpose: string; lifetime: string }>;
  noAds: string;
  processorsTitle: string;
  processorsBody: string;
  playbackTitle: string;
  playbackBody: string;
  rightsTitle: string;
  rightsBody: string;
  rightsAppeal: string;
  rightsBullets: [string, string];
  updates: string;
};

const COPY: Record<PersonalDataCmsLocale, PersonalDataCopy> = {
  en: {
    title: 'Personal data and privacy',
    description:
      'A short overview of what data we store about you and why — for subscribers in the EU, mainly in Czechia and Slovakia.',
    intro: [
      'We run this service for subscribers in the EU, mainly in Czechia and Slovakia. Below is a short overview of what data we store about you and why.',
      "This page does not block you or force a decision — it's informational only. Until you sign in, subscribe, or change player settings (e.g. playback speed), we don't store anything beyond the strict technical minimum.",
    ],
    signedOutTitle: 'Signed-out visitors',
    signedOutBody:
      'Without signing in, you can browse public pages and video previews without us storing anything in your browser. We measure traffic anonymously via Umami (EU) — no cookies, no cross-site tracking.',
    activeTitle: 'When you use active features',
    activeBody:
      'Signing in, subscribing, notifications, installing the web app (PWA), or changing playback speed require storing a small amount of data in your browser. You can avoid this entirely by not using these features.',
    tableColumns: ['What', 'For', 'How long'],
    tableRows: [
      {
        what: 'refresh_token',
        purpose: 'keeps you signed in',
        lifetime: 'up to 30 days / until logout',
      },
      {
        what: 'playbackRate',
        purpose: 'remembers your playback speed',
        lifetime: 'until you clear site data',
      },
      {
        what: 'nuxt-color-mode',
        purpose: 'light/dark display mode',
        lifetime: 'until you clear site data',
      },
      {
        what: 'vmp_pwa_device_token, vmp_pwa_login_email, vmp-pwa-auth',
        purpose: 'sign-in via installed iOS app',
        lifetime: 'until logout / cleared',
      },
      {
        what: 'service worker cache',
        purpose: 'faster offline app loading',
        lifetime: 'while the app is installed',
      },
      {
        what: 'session data (sessionStorage)',
        purpose: 'security during sign-in',
        lifetime: 'until tab is closed',
      },
      {
        what: 'vmp_personal_data_notice_ack',
        purpose: 'stops this banner reappearing',
        lifetime: 'until you clear site data',
      },
    ],
    noAds: "We don't use any of this for advertising or profiling.",
    processorsTitle: 'Who processes data',
    processorsBody:
      'Hosting runs on Cloudflare (with Deno Deploy / Vercel as backup). Payments go through Stripe, emails through Brevo, error tracking through Sentry, traffic stats through Umami (EU). Each one only sees the data needed for its job.',
    playbackTitle: 'Playback tracking',
    playbackBody:
      'If you\'re signed in, we store where you last stopped watching a video so you can resume. You can delete this position anytime from "Continue watching" in your account.',
    rightsTitle: 'Your rights',
    rightsBody:
      'You have the right to access, correct, delete, restrict, or transfer your data. Just email vmp@tjm.sk — including requests to fully delete your account.',
    rightsAppeal: "If you're not satisfied with how we handle your request, you can contact:",
    rightsBullets: ['Czechia — ÚOOÚ (uoou.cz)', 'Slovakia — ÚOO SR (dataprotection.gov.sk)'],
    updates: 'We may update this page over time; the current version is always here.',
  },
  sk: {
    title: 'Osobné údaje a súkromie',
    description:
      'Stručný prehľad toho, aké dáta o vás ukladáme a prečo — pre predplatiteľov v EÚ, najmä v Česku a na Slovensku.',
    intro: [
      'Túto službu prevádzkujeme pre predplatiteľov v EÚ, najmä v Česku a na Slovensku. Nižšie je stručný prehľad toho, aké dáta o vás ukladáme a prečo.',
      'Táto stránka vás neblokuje ani nenúti k rozhodnutiu — je len informačná. Kým sa neprihlásite, nekúpite si predplatné, alebo nezmeníte nastavenia prehrávača (napríklad rýchlosť prehrávania), žiadne dáta nad rámec striktne potrebných o Vás neukladáme.',
    ],
    signedOutTitle: 'Neprihlásení používatelia',
    signedOutBody:
      'Bez prihlásenia si môžete prezerať verejné stránky a náhľady videí bez toho, aby sme čokoľvek ukladali vo vašom prehliadači. Návštevnosť meriame anonymne cez Umami (EÚ) — bez cookies, bez sledovania naprieč stránkami.',
    activeTitle: 'Keď niečo aktívne použijete',
    activeBody:
      'Prihlásenie, predplatné, notifikácie, inštalácia webovej aplikácie (PWA) alebo zmena rýchlosti prehrávania vyžadujú uloženie malého množstva dát v prehliadači. Bez použitia týchto funkcií sa ich uloženiu viete úplne vyhnúť.',
    tableColumns: ['Čo', 'Na čo', 'Ako dlho'],
    tableRows: [
      {
        what: 'refresh_token',
        purpose: 'zapamätá si prihlásenie',
        lifetime: 'max. 30 dní / do odhlásenia',
      },
      {
        what: 'playbackRate',
        purpose: 'zapamätá si rýchlosť prehrávania',
        lifetime: 'do vymazania dát stránky',
      },
      {
        what: 'nuxt-color-mode',
        purpose: 'svetlý/tmavý režim',
        lifetime: 'do vymazania dát stránky',
      },
      {
        what: 'vmp_pwa_device_token, vmp_pwa_login_email, vmp-pwa-auth',
        purpose: 'prihlásenie cez nainštalovanú iOS appku',
        lifetime: 'do odhlásenia / vymazania',
      },
      {
        what: 'cache service workera',
        purpose: 'rýchlejšie načítanie appky offline',
        lifetime: 'kým je appka nainštalovaná',
      },
      {
        what: 'dáta relácie (sessionStorage)',
        purpose: 'bezpečnosť počas prihlasovania',
        lifetime: 'do zatvorenia karty',
      },
      {
        what: 'vmp_personal_data_notice_ack',
        purpose: 'aby sa vám tento banner nezobrazoval opakovane',
        lifetime: 'do vymazania dát stránky',
      },
    ],
    noAds: 'Nič z tohto nepoužívame na reklamu ani profilovanie.',
    processorsTitle: 'Kto s dátami pracuje',
    processorsBody:
      'Hosting beží na Cloudflare (prípadne záložne na Deno Deploy / Vercel). Platby rieši Stripe, e-maily Brevo, chyby aplikácie sledujeme cez Sentry, návštevnosť cez Umami (EÚ). Každý z nich vidí len dáta potrebné pre svoju úlohu.',
    playbackTitle: 'Sledovanie prehrávania',
    playbackBody:
      'Ak ste prihlásení, ukladáme si, kde ste video naposledy prestali sledovať, aby ste mohli pokračovať. Túto pozíciu môžete kedykoľvek zmazať v sekcii „Pokračovať v sledovaní“ vo svojom účte.',
    rightsTitle: 'Vaše práva',
    rightsBody:
      'Máte právo na prístup k svojim údajom, ich opravu, vymazanie, obmedzenie spracúvania alebo prenos inde. Stačí napísať na vmp@tjm.sk — vrátane žiadosti o úplné zmazanie účtu.',
    rightsAppeal: 'Ak nie ste spokojní s tým, ako vašu žiadosť vybavíme, môžete sa obrátiť na:',
    rightsBullets: ['Česko — ÚOOÚ (uoou.cz)', 'Slovensko — ÚOO SR (dataprotection.gov.sk)'],
    updates: 'Túto stránku môžeme časom aktualizovať; aktuálna verzia je vždy tu.',
  },
  cs: {
    title: 'Osobní údaje a soukromí',
    description:
      'Stručný přehled toho, jaká data o vás ukládáme a proč — pro předplatitele v EU, zejména v Česku a na Slovensku.',
    intro: [
      'Tuto službu provozujeme pro předplatitele v EU, zejména v Česku a na Slovensku. Níže je stručný přehled toho, jaká data o vás ukládáme a proč.',
      'Tato stránka vás neblokuje ani nenutí k rozhodnutí — je jen informační. Dokud se nepřihlásíte, nekoupíte si předplatné nebo nezměníte nastavení přehrávače (například rychlost přehrávání), žádná data nad rámec technického minima o vás neukládáme.',
    ],
    signedOutTitle: 'Nepřihlášení uživatelé',
    signedOutBody:
      'Bez přihlášení si můžete prohlížet veřejné stránky a náhledy videí, aniž bychom cokoliv ukládali ve vašem prohlížeči. Návštěvnost měříme anonymně přes Umami (EU) — bez cookies, bez sledování napříč weby.',
    activeTitle: 'Aktivní funkce',
    activeBody:
      'Přihlášení, předplatné, notifikace, instalace webové aplikace (PWA) nebo změna rychlosti přehrávání vyžadují uložení malého množství dat v prohlížeči. Bez využití těchto funkcí se jejich ukládání zcela vyhnete.',
    tableColumns: ['Co', 'K čemu', 'Jak dlouho'],
    tableRows: [
      {
        what: 'refresh_token',
        purpose: 'udrží vás přihlášené',
        lifetime: 'max. 30 dní / do odhlášení',
      },
      {
        what: 'playbackRate',
        purpose: 'zapamatuje si rychlost přehrávání',
        lifetime: 'do vymazání dat webu',
      },
      {
        what: 'nuxt-color-mode',
        purpose: 'světlý/tmavý režim',
        lifetime: 'do vymazání dat webu',
      },
      {
        what: 'vmp_pwa_device_token, vmp_pwa_login_email, vmp-pwa-auth',
        purpose: 'přihlášení přes nainstalovanou iOS appku',
        lifetime: 'do odhlášení / vymazání',
      },
      {
        what: 'cache service workeru',
        purpose: 'rychlejší načítání appky offline',
        lifetime: 'dokud je appka nainstalovaná',
      },
      {
        what: 'data relace (sessionStorage)',
        purpose: 'bezpečnost během přihlašování',
        lifetime: 'do zavření karty',
      },
      {
        what: 'vmp_personal_data_notice_ack',
        purpose: 'aby se vám tento banner nezobrazoval opakovaně',
        lifetime: 'do vymazání dat webu',
      },
    ],
    noAds: 'Nic z toho nepoužíváme na reklamu ani profilování.',
    processorsTitle: 'Kdo s daty pracuje',
    processorsBody:
      'Hosting běží na Cloudflare (případně záložně na Deno Deploy / Vercel). Platby řeší Stripe, e-maily Brevo, chyby aplikace sledujeme přes Sentry, návštěvnost přes Umami (EU). Každý z nich vidí jen data potřebná pro svůj úkol.',
    playbackTitle: 'Sledování přehrávání',
    playbackBody:
      'Pokud jste přihlášeni, ukládáme si, kde jste video naposledy přestali sledovat, abyste mohli pokračovat. Tuto pozici můžete kdykoliv smazat v sekci „Pokračovat ve sledování“ ve svém účtu.',
    rightsTitle: 'Vaše práva',
    rightsBody:
      'Máte právo na přístup ke svým údajům, jejich opravu, výmaz, omezení zpracování nebo přenos jinam. Stačí napsat na vmp@tjm.sk — včetně žádosti o úplné smazání účtu.',
    rightsAppeal: 'Pokud nejste spokojeni s tím, jak vaši žádost vyřídíme, můžete se obrátit na:',
    rightsBullets: ['Česko — ÚOOÚ (uoou.cz)', 'Slovensko — ÚOO SR (dataprotection.gov.sk)'],
    updates: 'Tuto stránku můžeme časem aktualizovat; aktuální verze je vždy zde.',
  },
};

/**
 * Short personal-data CMS notice for the given deployment locale.
 * Migrations apply each locale only when `admin_settings.ui_locale` matches
 * (SK also bootstraps from exact `site_support_email = vmp@tjm.sk`).
 * Not used at Worker runtime to upsert pages — content ships via SQL migrations.
 */
export function buildPersonalDataCmsBlocks(locale: PersonalDataCmsLocale = 'en'): CmsBlock[] {
  const c = COPY[locale];
  return [
    tiptapRichTextBlock(tiptapParagraph(c.intro[0]), tiptapParagraph(c.intro[1])),
    tiptapRichTextBlock(tiptapHeading(2, c.signedOutTitle), tiptapParagraph(c.signedOutBody)),
    tiptapRichTextBlock(tiptapHeading(2, c.activeTitle), tiptapParagraph(c.activeBody)),
    {
      type: 'table',
      columns: [...c.tableColumns],
      columnKeys: ['what', 'purpose', 'lifetime'],
      rows: c.tableRows.map((row) => ({ ...row })),
    },
    tiptapRichTextBlock(tiptapParagraph(c.noAds)),
    tiptapRichTextBlock(tiptapHeading(2, c.processorsTitle), tiptapParagraph(c.processorsBody)),
    tiptapRichTextBlock(tiptapHeading(2, c.playbackTitle), tiptapParagraph(c.playbackBody)),
    tiptapRichTextBlock(
      tiptapHeading(2, c.rightsTitle),
      tiptapParagraph(c.rightsBody),
      tiptapParagraph(c.rightsAppeal),
      tiptapBulletList([...c.rightsBullets]),
    ),
    tiptapRichTextBlock(tiptapParagraph(c.updates)),
  ];
}

export function getPersonalDataCmsPageMeta(locale: PersonalDataCmsLocale = 'en') {
  const c = COPY[locale];
  return {
    id: 'cms-page-personal-data' as const,
    title: c.title,
    slug: 'personal-data' as const,
    description: c.description,
  };
}

/** @deprecated Prefer `getPersonalDataCmsPageMeta(locale)` — defaults to English. */
export const PERSONAL_DATA_CMS_PAGE = getPersonalDataCmsPageMeta('en');
