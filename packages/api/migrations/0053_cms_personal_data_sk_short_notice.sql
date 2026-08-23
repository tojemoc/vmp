-- Rewrite personal-data CMS page to short SK notice.
-- Regenerated from packages/api/src/cmsPersonalDataSeedContent.ts (sk).
--
-- Locale guard (one language per D1 / deployment — see docs/i18n-prep.md):
-- Applies only when admin_settings.ui_locale = 'sk', or when site_support_email is exactly vmp@tjm.sk (SK monorepo ops).
-- Other locales leave this page unchanged. Safe to ship all three migrations together.

-- Bootstrap ui_locale for the SK instance when the exact ops support email is set.
INSERT OR IGNORE INTO admin_settings (key, value, updated_at)
SELECT 'ui_locale', 'sk', CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1 FROM admin_settings
  WHERE key = 'site_support_email'
    AND LOWER(TRIM(value)) = 'vmp@tjm.sk'
);

UPDATE cms_pages
SET title = 'Osobné údaje a súkromie',
    description = 'Stručný prehľad toho, aké dáta o vás ukladáme a prečo — pre predplatiteľov v EÚ, najmä v Česku a na Slovensku.',
    content = '[{"type":"rich_text","content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Túto službu prevádzkujeme pre predplatiteľov v EÚ, najmä v Česku a na Slovensku. Nižšie je stručný prehľad toho, aké dáta o vás ukladáme a prečo."}]},{"type":"paragraph","content":[{"type":"text","text":"Táto stránka vás neblokuje ani nenúti k rozhodnutiu — je len informačná. Kým sa neprihlásite, nekúpite si predplatné, alebo nezmeníte nastavenia prehrávača (napríklad rýchlosť prehrávania), žiadne dáta nad rámec striktne potrebných o Vás neukladáme."}]}]}},{"type":"rich_text","content":{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Neprihlásení používatelia"}]},{"type":"paragraph","content":[{"type":"text","text":"Bez prihlásenia si môžete prezerať verejné stránky a náhľady videí bez toho, aby sme čokoľvek ukladali vo vašom prehliadači. Návštevnosť meriame anonymne cez Umami (EÚ) — bez cookies, bez sledovania naprieč stránkami."}]}]}},{"type":"rich_text","content":{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Keď niečo aktívne použijete"}]},{"type":"paragraph","content":[{"type":"text","text":"Prihlásenie, predplatné, notifikácie, inštalácia webovej aplikácie (PWA) alebo zmena rýchlosti prehrávania vyžadujú uloženie malého množstva dát v prehliadači. Bez použitia týchto funkcií sa ich uloženiu viete úplne vyhnúť."}]}]}},{"type":"table","columns":["Čo","Na čo","Ako dlho"],"columnKeys":["what","purpose","lifetime"],"rows":[{"what":"refresh_token","purpose":"zapamätá si prihlásenie","lifetime":"max. 30 dní / do odhlásenia"},{"what":"playbackRate","purpose":"zapamätá si rýchlosť prehrávania","lifetime":"do vymazania dát stránky"},{"what":"nuxt-color-mode","purpose":"svetlý/tmavý režim","lifetime":"do vymazania dát stránky"},{"what":"vmp_pwa_device_token, vmp_pwa_login_email, vmp-pwa-auth","purpose":"prihlásenie cez nainštalovanú iOS appku","lifetime":"do odhlásenia / vymazania"},{"what":"cache service workera","purpose":"rýchlejšie načítanie appky offline","lifetime":"kým je appka nainštalovaná"},{"what":"dáta relácie (sessionStorage)","purpose":"bezpečnosť počas prihlasovania","lifetime":"do zatvorenia karty"},{"what":"vmp_personal_data_notice_ack","purpose":"aby sa vám tento banner nezobrazoval opakovane","lifetime":"do vymazania dát stránky"}]},{"type":"rich_text","content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Nič z tohto nepoužívame na reklamu ani profilovanie."}]}]}},{"type":"rich_text","content":{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Kto s dátami pracuje"}]},{"type":"paragraph","content":[{"type":"text","text":"Hosting beží na Cloudflare (prípadne záložne na Deno Deploy / Vercel). Platby rieši Stripe, e-maily Brevo, chyby aplikácie sledujeme cez Sentry, návštevnosť cez Umami (EÚ). Každý z nich vidí len dáta potrebné pre svoju úlohu."}]}]}},{"type":"rich_text","content":{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Sledovanie prehrávania"}]},{"type":"paragraph","content":[{"type":"text","text":"Ak ste prihlásení, ukladáme si, kde ste video naposledy prestali sledovať, aby ste mohli pokračovať. Túto pozíciu môžete kedykoľvek zmazať v sekcii „Pokračovať v sledovaní“ vo svojom účte."}]}]}},{"type":"rich_text","content":{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Vaše práva"}]},{"type":"paragraph","content":[{"type":"text","text":"Máte právo na prístup k svojim údajom, ich opravu, vymazanie, obmedzenie spracúvania alebo prenos inde. Stačí napísať na vmp@tjm.sk — vrátane žiadosti o úplné zmazanie účtu."}]},{"type":"paragraph","content":[{"type":"text","text":"Ak nie ste spokojní s tým, ako vašu žiadosť vybavíme, môžete sa obrátiť na:"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Česko — ÚOOÚ (uoou.cz)"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Slovensko — ÚOO SR (dataprotection.gov.sk)"}]}]}]}]}},{"type":"rich_text","content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Túto stránku môžeme časom aktualizovať; aktuálna verzia je vždy tu."}]}]}}]',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'cms-page-personal-data'
  AND (
    EXISTS (
      SELECT 1 FROM admin_settings
      WHERE key = 'ui_locale' AND TRIM(value) = 'sk'
    )
    OR EXISTS (
      SELECT 1 FROM admin_settings
      WHERE key = 'site_support_email'
        AND LOWER(TRIM(value)) = 'vmp@tjm.sk'
    )
  );
