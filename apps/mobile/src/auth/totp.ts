export class TotpVerifyError extends Error {
  code?: string;
  status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function isTotpSessionExpired(err: unknown): boolean {
  if (!(err instanceof TotpVerifyError)) return false;
  if (err.code === 'session_expired') return true;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('expired') || msg.includes('sign in again') || msg.includes('already been used')
  );
}

/** Strip non-digits and enforce a 6-digit TOTP code. */
export function normalizeTotpCode(code: string): string | null {
  const digits = code.replace(/\D/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}
