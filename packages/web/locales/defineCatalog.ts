import type {
  LocaleCatalog,
  PersonalDataPage,
  Strings,
  StringsDefinition,
  UiLocale,
} from './types';

type StringMaps = {
  planNames: Record<string, string>;
  roleLabels: Record<string, string>;
};

export function defineCatalog(
  locale: UiLocale,
  htmlLang: string,
  stringsDef: StringsDefinition,
  maps: StringMaps,
  personalData: PersonalDataPage,
): LocaleCatalog {
  const strings: Strings = {
    ...stringsDef,
    planDisplayName(planType: string) {
      return maps.planNames[planType] ?? planType;
    },
    paymentProviderLabel(provider: string) {
      if (provider === 'stripe') return 'Stripe';
      if (provider === 'legacy') return 'Qerko';
      if (provider === 'gopay') return 'GoPay';
      if (provider === 'comgate') return 'Comgate';
      return provider;
    },
    checkoutPayWithGoPay(price: string) {
      if (locale === 'cs') return `Zaplatit přes GoPay (${price})`;
      if (locale === 'sk') return `Zaplatiť cez GoPay (${price})`;
      return `Pay with GoPay (${price})`;
    },
    checkoutPayWithComgate(price: string) {
      if (locale === 'cs') return `Zaplatit přes Comgate (${price})`;
      if (locale === 'sk') return `Zaplatiť cez Comgate (${price})`;
      return `Pay with Comgate (${price})`;
    },
    checkoutGoPayGatewayNote:
      locale === 'cs'
        ? 'Přesměruje na webovou bránu GoPay. Apple Pay / Google Pay jsou jen na bráně (žádný nativní one-click; nepoužívejte WebView).'
        : locale === 'sk'
          ? 'Presmeruje na webovú bránu GoPay. Apple Pay / Google Pay sú len na bráne (žiadny natívny one-click; nepoužívajte WebView).'
          : 'Redirects to the GoPay web gateway. Apple Pay / Google Pay are gateway-only (no native one-click; do not use WebView).',
    roleLabel(role: string | undefined) {
      return maps.roleLabels[role ?? ''] ?? maps.roleLabels.viewer ?? 'Viewer';
    },
  };

  return { locale, htmlLang, strings, personalData };
}
