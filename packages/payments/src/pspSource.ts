import { dbProviderToProviderId, type DbPaymentProvider, providerIdToDbProvider } from './ids.js';

/** Public / middleware PSP identity. `mor` is reserved (not implemented). */
export type PspSource = 'stripe' | 'qerko' | 'gopay' | 'comgate' | 'mor';

const PSP_SOURCES: readonly PspSource[] = ['stripe', 'qerko', 'gopay', 'comgate', 'mor'];

export function isPspSource(value: string): value is PspSource {
  return (PSP_SOURCES as readonly string[]).includes(value);
}

/** Map D1 `subscriptions.provider` → public PspSource (`legacy` → `qerko`). */
export function dbProviderToPspSource(dbProvider: string): PspSource {
  const id = dbProviderToProviderId(dbProvider);
  return id;
}

/** Map PspSource → D1 column value (`qerko` → `legacy`). */
export function pspSourceToDbProvider(source: PspSource): DbPaymentProvider {
  if (source === 'mor') {
    throw new Error('Merchant of Record (mor) is not implemented');
  }
  return providerIdToDbProvider(source);
}

/** Accept API body aliases (`legacy` → `qerko`). */
export function normalizePspSource(raw: string): PspSource | null {
  const id = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (id === 'legacy' || id === 'qerko') return 'qerko';
  if (id === 'stripe' || id === 'gopay' || id === 'comgate' || id === 'mor') return id;
  return null;
}
