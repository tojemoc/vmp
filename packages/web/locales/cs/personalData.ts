import type { PersonalDataPage } from '../types'

export const personalData: PersonalDataPage = {
  metaTitle: 'Zpracování osobních údajů',
  metaDescription:
    'Jak VMP používá cookies, úložiště prohlížeče a zpracovatele při prohlížení, přihlašování a sledování videí — pro návštěvníky v EU.',

  intro: [
    'Tuto platformu jsme vytvořili pro předplatitele v Evropské unii, zejména v Česku a na Slovensku. Klientské úložiště omezujeme na to, co je potřeba k provozu služby, a vše popisujeme níže srozumitelným jazykem.',
    'Tato stránka je informačním oznámením podle GDPR a pravidel ePrivacy. Není to marketingová cookie zeď. Nezbytné úložiště nevyžaduje souhlas, ale máte právo být informováni před jeho použitím.',
  ],

  bannerSummary:
    'Vyhýbáme se nepodstatným cookies. Při přihlášení, platbě nebo používání předvoleb přehrávače nezbytné cookies nebo úložiště prohlížeče udržují službu v chodu — viz Informace o osobních údajích.',

  sections: [
    {
      id: 'passive-browsing',
      title: 'Prohlížení bez přihlášení',
      paragraphs: [
        'Pokud jen čtete veřejné stránky a nepřihlásíte se, nenastavujeme autentifikační cookie. Anonymní ukázky videí jsou poskytovány přes naše API; pozice přehrávání se mezi návštěvami neukládá.',
        'Používáme analytiku zaměřenou na soukromí bez cookies (Umami Cloud, datová oblast EU) k měření velikosti publika. Umami ve výchozí konfiguraci nenastavuje marketingové cookies ani cross-site identifikátory. Pro tento omezený statistický účel se opíráme o oprávněný zájem a můžete namítat (viz Vaše práva).',
      ],
    },
    {
      id: 'interaction',
      title: 'Když interagujete se stránkou',
      paragraphs: [
        'Některé funkce fungují pouze tehdy, pokud prohlížeč uloží malé množství údajů. Jsou nezbytné pro funkci, o kterou žádáte — ne pro reklamu nebo profilování.',
        'Přihlášením, předplatným, povolením oznámení, instalací webové aplikace nebo změnou rychlosti přehrávání používáte funkce, které vyžadují úložiště uvedené v tabulce níže. Většině tohoto úložiště se můžete vyhnout tím, že tyto funkce nepoužijete (například zůstanete odhlášeni a neměníte nastavení přehrávače).',
        'Vaši interakci nepoužíváme jako souhlas s nesouvisejícími marketingovými trackery. Pokud někdy přidáme volitelnou analytiku nebo marketingové nástroje, které nejsou nezbytné, nejprve požádáme o souhlas.',
      ],
    },
    {
      id: 'storage-table',
      title: 'Cookies a úložiště prohlížeče, které používáme',
      paragraphs: [
        'Kód aplikace níže je pod naší kontrolou. Platební stránky třetích stran (Stripe) mohou nastavit vlastní cookies, když začnete platbu na jejich rozhraní.',
      ],
    },
    {
      id: 'processors',
      title: 'Kdo zpracovává údaje v našem jménu',
      paragraphs: [
        'Primární hosting používá Cloudflare (API Worker, databáze D1, média R2, frontend Pages). Provoz probíhá přes globální síť Cloudflare; nemůžeme zaručit, že každý bajt zůstane v EU, ale minimalizujeme osobní údaje a kde je to možné používáme analytiku se sídlem v EU.',
        'Záložní infrastruktura může běžet na Deno Deploy (API) a Vercel (frontend).',
        'Další zpracovatelé zahrnují: Umami Cloud (EU) pro anonymní statistiku; Stripe pro platby; Brevo pro transakční e-mail; Sentry pro monitorování chyb na frontendu a API. Zpracování plateb a e-mailů probíhá pouze když tyto funkce použijete.',
      ],
      bullets: [
        'Cloudflare — hosting, CDN, bezpečnost (globální edge)',
        'Umami Cloud (region EU) — statistika zobrazení stránek bez cookies',
        'Stripe — zpracování plateb při předplatném',
        'Brevo — magic-link a e-maily účtu',
        'Sentry — monitorování chyb a stability (technické logy)',
        'Deno Deploy / Vercel — záložní nasazení API a frontendu',
      ],
    },
    {
      id: 'server-processing',
      title: 'Zpracování na straně serveru (bez cookie prohlížeče)',
      paragraphs: [
        'Při doručování video streamů naše API zaznamenává anonymizované technické události (například hashovaná IP, země ze síťových hlaviček a buckety relací sledování) k provozu služby, prevenci zneužití a zobrazení souhrnných statistik administrátorům. Tyto logy se nepoužívají k reklamě vůči vám a nesdílejí se s reklamními sítěmi.',
      ],
    },
    {
      id: 'rights',
      title: 'Vaše práva (návštěvníci z EU / UK)',
      paragraphs: [
        'Podle GDPR můžete požádat o přístup, opravu, vymazání, omezení, přenositelnost nebo namítat proti zpracování na základě oprávněného zájmu. Souhlas můžete odvolat tam, kde je zpracování založeno na souhlasu (dnes používáme málo zpracování založeného na souhlasu).',
        'K uplatnění práv nás kontaktujte přes podpůrný kanál zveřejněný na této stránce. Můžete také podat stížnost u dozorového orgánu:',
      ],
      bullets: [
        'Česko — Úřad pro ochranu osobních údajů (ÚOOÚ), uoou.cz',
        'Slovensko — Úrad na ochranu osobných údajov SR (ÚOO SR), dataprotection.gov.sk',
      ],
    },
    {
      id: 'changes',
      title: 'Aktualizace',
      paragraphs: [
        'Toto oznámení můžeme aktualizovat při změně služby nebo právních předpisů. Nejnovější verze je vždy zveřejněna na této URL. Podstatné změny budou v případě potřeby reflektovány v banneru na stránce.',
      ],
    },
  ],

  storageRows: [
    {
      name: 'refresh_token',
      mechanism: 'HttpOnly cookie (first-party API)',
      purpose: 'Udržuje vás přihlášené mezi návštěvami; obnovuje se při refresh',
      lifetime: 'Až 30 dní nebo do odhlášení',
      necessary: 'Ano — autentifikace',
    },
    {
      name: 'playbackRate',
      mechanism: 'localStorage',
      purpose: 'Pamatuje si zvolenou rychlost přehrávání videa',
      lifetime: 'Dokud nevymažete údaje stránky',
      necessary: 'Funkční — pouze po změně rychlosti',
    },
    {
      name: 'nuxt-color-mode',
      mechanism: 'localStorage',
      purpose: 'Aplikuje světlý/tmavý režim podle systémové preference',
      lifetime: 'Dokud nevymažete údaje stránky',
      necessary: 'Funkční — preference zobrazení',
    },
    {
      name: 'vmp_pwa_device_token',
      mechanism: 'localStorage',
      purpose: 'Propojuje push přihlášení s prohlížečem na nainstalované iOS PWA',
      lifetime: 'Trvalé, dokud se nevymaže',
      necessary: 'Ano — pouze při PWA push přihlášení',
    },
    {
      name: 'vmp_pwa_login_email',
      mechanism: 'localStorage',
      purpose: 'Předvyplní e-mail během PWA přihlašovacího průvodce',
      lifetime: 'Dokud se nevymaže nebo se nevypne push',
      necessary: 'Funkční — UX PWA přihlášení',
    },
    {
      name: 'vmp-pwa-auth (IndexedDB)',
      mechanism: 'IndexedDB',
      purpose: 'Dočasný handoff kód mezi Safari a nainstalovanou PWA',
      lifetime: 'Krátkodobé; vymazáno po uplatnění',
      necessary: 'Ano — iOS PWA autentifikace',
    },
    {
      name: 'Service worker caches',
      mechanism: 'Cache API (PWA)',
      purpose: 'Offline shell a rychlejší opakované načtení nainstalované aplikace',
      lifetime: 'Po dobu instalace PWA / do vyčištění cache',
      necessary: 'Ano — funkcionalita PWA',
    },
    {
      name: 'Session handoff keys',
      mechanism: 'sessionStorage',
      purpose: 'Krátkodobý auth a stav UI během jedné záložky',
      lifetime: 'Dokud se záložka nezavře',
      necessary: 'Ano — bezpečnost během přihlašovacích toků',
    },
    {
      name: 'vmp_personal_data_notice_ack',
      mechanism: 'localStorage',
      purpose: 'Zapamatuje, že jste zavřeli banner s informací o zpracování osobních údajů',
      lifetime: 'Dokud nevymažete data stránky',
      necessary: 'Funkční — až po potvrzení informace',
    },
  ],
}
