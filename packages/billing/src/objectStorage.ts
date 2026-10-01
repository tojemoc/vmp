/**
 * Optional object storage for e-invoice XML. Billing Worker may bind R2 later;
 * without it, invoice row creation still works and XML storage is skipped.
 */

export type BillingObjectStorage = {
  putObject: (
    key: string,
    body: string | ArrayBuffer | Uint8Array,
    opts?: { contentType?: string },
  ) => Promise<void>;
  getObject: (key: string) => Promise<{ body: ReadableStream | null } | null>;
};

export function hasObjectStorage(_env: unknown): boolean {
  return false;
}

export function getObjectStorage(_env: unknown): BillingObjectStorage | null {
  return null;
}
