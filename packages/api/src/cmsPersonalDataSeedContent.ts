import type { CmsBlock } from '@vmp/shared';

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

/**
 * Slovak personal-data page content for CMS seed / SK migration 0053.
 * Matches the short public notice (Čo / Na čo / Ako dlho table).
 * Applied to D1 only when ui_locale=sk or site_support_email is @tjm.sk
 * (see packages/api/migrations/0053_cms_personal_data_sk_short_notice.sql).
 */
export function buildPersonalDataCmsBlocks(): CmsBlock[] {
  return [
    tiptapRichTextBlock(
      tiptapParagraph(
        'Túto službu prevádzkujeme pre predplatiteľov v EÚ, najmä v Česku a na Slovensku. Nižšie je stručný prehľad toho, aké dáta o vás ukladáme a prečo.',
      ),
      tiptapParagraph(
        'Táto stránka vás neblokuje ani nenúti k rozhodnutiu — je len informačná. Kým sa neprihlásite, nekúpite si predplatné, alebo nezmeníte nastavenia prehrávača (napríklad rýchlosť prehrávania), žiadne dáta nad rámec striktne potrebných o Vás neukladáme.',
      ),
    ),
    tiptapRichTextBlock(
      tiptapHeading(2, 'Neprihlásení používatelia'),
      tiptapParagraph(
        'Bez prihlásenia si môžete prezerať verejné stránky a náhľady videí bez toho, aby sme čokoľvek ukladali vo vašom prehliadači. Návštevnosť meriame anonymne cez Umami (EÚ) — bez cookies, bez sledovania naprieč stránkami.',
      ),
    ),
    tiptapRichTextBlock(
      tiptapHeading(2, 'Keď niečo aktívne použijete'),
      tiptapParagraph(
        'Prihlásenie, predplatné, notifikácie, inštalácia webovej aplikácie (PWA) alebo zmena rýchlosti prehrávania vyžadujú uloženie malého množstva dát v prehliadači. Bez použitia týchto funkcií sa ich uloženiu viete úplne vyhnúť.',
      ),
    ),
    {
      type: 'table',
      columns: ['Čo', 'Na čo', 'Ako dlho'],
      columnKeys: ['what', 'purpose', 'lifetime'],
      rows: [
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
    },
    tiptapRichTextBlock(tiptapParagraph('Nič z tohto nepoužívame na reklamu ani profilovanie.')),
    tiptapRichTextBlock(
      tiptapHeading(2, 'Kto s dátami pracuje'),
      tiptapParagraph(
        'Hosting beží na Cloudflare (prípadne záložne na Deno Deploy / Vercel). Platby rieši Stripe, e-maily Brevo, chyby aplikácie sledujeme cez Sentry, návštevnosť cez Umami (EÚ). Každý z nich vidí len dáta potrebné pre svoju úlohu.',
      ),
    ),
    tiptapRichTextBlock(
      tiptapHeading(2, 'Sledovanie prehrávania'),
      tiptapParagraph(
        'Ak ste prihlásení, ukladáme si, kde ste video naposledy prestali sledovať, aby ste mohli pokračovať. Túto pozíciu môžete kedykoľvek zmazať v sekcii „Pokračovať v sledovaní“ vo svojom účte.',
      ),
    ),
    tiptapRichTextBlock(
      tiptapHeading(2, 'Vaše práva'),
      tiptapParagraph(
        'Máte právo na prístup k svojim údajom, ich opravu, vymazanie, obmedzenie spracúvania alebo prenos inde. Stačí napísať na vmp@tjm.sk — vrátane žiadosti o úplné zmazanie účtu.',
      ),
      tiptapParagraph(
        'Ak nie ste spokojní s tým, ako vašu žiadosť vybavíme, môžete sa obrátiť na:',
      ),
      tiptapBulletList(['Česko — ÚOOÚ (uoou.cz)', 'Slovensko — ÚOO SR (dataprotection.gov.sk)']),
    ),
    tiptapRichTextBlock(
      tiptapParagraph('Túto stránku môžeme časom aktualizovať; aktuálna verzia je vždy tu.'),
    ),
  ];
}

export const PERSONAL_DATA_CMS_PAGE = {
  id: 'cms-page-personal-data',
  title: 'Osobné údaje a súkromie',
  slug: 'personal-data',
  description:
    'Stručný prehľad toho, aké dáta o vás ukladáme a prečo — pre predplatiteľov v EÚ, najmä v Česku a na Slovensku.',
};
