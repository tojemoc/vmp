import type { PersonalDataPage } from '../types'

export const personalData: PersonalDataPage = {
  metaTitle: 'Spracovanie osobných údajov',
  metaDescription:
    'Ako VMP používa cookies, úložisko prehliadača a spracovateľov pri prehliadaní, prihlasovaní a sledovaní videí — pre návštevníkov v EÚ.',

  intro: [
    'Túto platformu sme vytvorili pre predplatiteľov v Európskej únii, najmä v Česku a na Slovensku. Klientske úložisko obmedzujeme na to, čo je potrebné na prevádzku služby, a všetko popisujeme nižšie zrozumiteľným jazykom.',
    'Táto stránka je informačným oznámením podľa GDPR a pravidiel ePrivacy. Nie je to marketingová cookie stena. Nevyhnutné úložisko nevyžaduje súhlas, ale máte právo byť informovaní pred jeho použitím.',
  ],

  bannerSummary:
    'Vyhýbame sa nepodstatným cookies. Pri prihlásení, platbe alebo používaní predvolieb prehrávača nevyhnutné cookies alebo úložisko prehliadača udržiavajú službu v chode — pozrite Informáciu o osobných údajoch.',

  sections: [
    {
      id: 'passive-browsing',
      title: 'Prehliadanie bez prihlásenia',
      paragraphs: [
        'Ak len čítate verejné stránky a neprihlásite sa, nenastavujeme autentifikačnú cookie. Anonymné ukážky videí sú poskytované cez naše API; pozícia prehrávania sa medzi návštevami neukladá.',
        'Používame analytiku zameranú na súkromie bez cookies (Umami Cloud, dátová oblasť EÚ) na meranie veľkosti publika. Umami v predvolenej konfigurácii nenastavuje marketingové cookies ani cross-site identifikátory. Pre tento obmedzený štatistický účel sa opierame o oprávnený záujem a môžete namietať (pozrite Vaše práva).',
      ],
    },
    {
      id: 'interaction',
      title: 'Keď interagujete so stránkou',
      paragraphs: [
        'Niektoré funkcie fungujú len vtedy, ak prehliadač uloží malé množstvo údajov. Sú nevyhnutné pre funkciu, o ktorú žiadate — nie na reklamu alebo profilovanie.',
        'Prihlásením, predplatením, povolením notifikácií, inštaláciou webovej aplikácie alebo zmenou rýchlosti prehrávania používate funkcie, ktoré vyžadujú úložisko uvedené v tabuľke nižšie. Väčšinu tohto úložiska sa môžete vyhnúť tým, že tieto funkcie nepoužijete (napríklad zostanete odhlásení a nemeníte nastavenia prehrávača).',
        'Vašu interakciu nepoužívame ako súhlas s nesúvisiacimi marketingovými trackermi. Ak niekedy pridáme voliteľnú analytiku alebo marketingové nástroje, ktoré nie sú nevyhnutné, najprv požiadame o súhlas.',
      ],
    },
    {
      id: 'storage-table',
      title: 'Cookies a úložisko prehliadača, ktoré používame',
      paragraphs: [
        'Kód aplikácie nižšie je pod našou kontrolou. Platobné stránky tretích strán (Stripe, GoCardless) môžu nastaviť vlastné cookies, keď začnete platbu na ich rozhraní.',
      ],
    },
    {
      id: 'processors',
      title: 'Kto spracúva údaje v našom mene',
      paragraphs: [
        'Primárne hosting používa Cloudflare (API Worker, databáza D1, médiá R2, frontend Pages). Prevádzka prebieha cez globálnu sieť Cloudflare; nemôžeme zaručiť, že každý bajt zostane v EÚ, ale minimalizujeme osobné údaje a kde je to možné používame analytiku so sídlom v EÚ.',
        'Záložná infraštruktúra môže bežať na Deno Deploy (API) a Vercel (frontend). Nasadenie na Vercel môže načítať Vercel Web Analytics pre prevádzkové štatistiky návštevnosti len na tejto doméne.',
        'Ďalší spracovatelia zahŕňajú: Umami Cloud (EÚ) pre anonymnú štatistiku; Stripe a GoCardless pre platby; Brevo pre transakčný e-mail; Sentry pre monitorovanie chýb na frontende a API. Spracovanie platieb a e-mailov prebieha len keď tieto funkcie použijete.',
      ],
      bullets: [
        'Cloudflare — hosting, CDN, bezpečnosť (globálny edge)',
        'Umami Cloud (región EÚ) — štatistika zobrazení stránok bez cookies',
        'Stripe / GoCardless — spracovanie platieb pri predplatení',
        'Brevo — magic-link a e-maily účtu',
        'Sentry — monitorovanie chýb a stability (technické logy)',
        'Deno Deploy / Vercel — záložné nasadenia API a frontendu',
      ],
    },
    {
      id: 'server-processing',
      title: 'Spracovanie na strane servera (bez cookie prehliadača)',
      paragraphs: [
        'Pri doručovaní video streamov naše API zaznamenáva anonymizované technické udalosti (napríklad hashovaná IP, krajina zo sieťových hlavičiek a buckety relácií sledovania) na prevádzku služby, prevenciu zneužitia a zobrazenie súhrnných štatistík administrátorom. Tieto logy sa nepoužívajú na reklamu voči vám a nezdieľajú sa s reklamnými sieťami.',
      ],
    },
    {
      id: 'rights',
      title: 'Vaše práva (návštevníci z EÚ / UK)',
      paragraphs: [
        'Podľa GDPR môžete požiadať o prístup, opravu, vymazanie, obmedzenie, prenosnosť alebo namietať proti spracovaniu na základe oprávneného záujmu. Súhlas môžete odvolať tam, kde je spracovanie založené na súhlase (dnes používame málo spracovania založeného na súhlase).',
        'Na uplatnenie práv nás kontaktujte cez podporný kanál zverejnený na tejto stránke. Môžete tiež podať sťažnosť u dozorného orgánu:',
      ],
      bullets: [
        'Česko — Úřad pro ochranu osobních údajů (ÚOOÚ), uoou.cz',
        'Slovensko — Úrad na ochranu osobných údajov SR (ÚOO SR), dataprotection.gov.sk',
      ],
    },
    {
      id: 'changes',
      title: 'Aktualizácie',
      paragraphs: [
        'Toto oznámenie môžeme aktualizovať pri zmene služby alebo právnych predpisov. Najnovšia verzia je vždy zverejnená na tejto URL. Podstatné zmeny budú v prípade potreby reflektované v banneri na stránke.',
      ],
    },
  ],

  storageRows: [
    {
      name: 'refresh_token',
      mechanism: 'HttpOnly cookie (first-party API)',
      purpose: 'Udržiava vás prihlásených medzi návštevami; obnovuje sa pri refresh',
      lifetime: 'Až 30 dní alebo do odhlásenia',
      necessary: 'Áno — autentifikácia',
    },
    {
      name: 'playbackRate',
      mechanism: 'localStorage',
      purpose: 'Pamätá si zvolenú rýchlosť prehrávania videa',
      lifetime: 'Kým nevymažete údaje stránky',
      necessary: 'Funkčné — len po zmene rýchlosti',
    },
    {
      name: 'nuxt-color-mode',
      mechanism: 'localStorage',
      purpose: 'Aplikuje svetlý/tmavý režim podľa systémovej preferencie',
      lifetime: 'Kým nevymažete údaje stránky',
      necessary: 'Funkčné — preferencia zobrazenia',
    },
    {
      name: 'vmp_pwa_device_token',
      mechanism: 'localStorage',
      purpose: 'Prepája push prihlásenie s prehliadačom na nainštalovanej iOS PWA',
      lifetime: 'Trvalé, kým sa nevymaže',
      necessary: 'Áno — len pri PWA push prihlásení',
    },
    {
      name: 'vmp_pwa_login_email',
      mechanism: 'localStorage',
      purpose: 'Predvyplní e-mail počas PWA prihlasovacieho sprievodcu',
      lifetime: 'Kým sa nevymaže alebo sa nevypne push',
      necessary: 'Funkčné — UX PWA prihlásenia',
    },
    {
      name: 'vmp-pwa-auth (IndexedDB)',
      mechanism: 'IndexedDB',
      purpose: 'Dočasný handoff kód medzi Safari a nainštalovanou PWA',
      lifetime: 'Krátkodobé; vymazané po uplatnení',
      necessary: 'Áno — iOS PWA autentifikácia',
    },
    {
      name: 'Service worker caches',
      mechanism: 'Cache API (PWA)',
      purpose: 'Offline shell a rýchlejšie opakované načítanie nainštalovanej aplikácie',
      lifetime: 'Počas inštalácie PWA / do vyčistenia cache',
      necessary: 'Áno — funkcionalita PWA',
    },
    {
      name: 'Session handoff keys',
      mechanism: 'sessionStorage',
      purpose: 'Krátkodobý auth a stav UI počas jednej karty',
      lifetime: 'Kým sa karta nezatvorí',
      necessary: 'Áno — bezpečnosť počas prihlasovacích tokov',
    },
    {
      name: 'vmp_personal_data_notice_ack',
      mechanism: 'localStorage',
      purpose: 'Zapamätá, že ste zavreli banner s informáciou o spracovaní osobných údajov',
      lifetime: 'Kým nevymažete údaje stránky',
      necessary: 'Funkčné — až po potvrdení informácie',
    },
  ],
}
