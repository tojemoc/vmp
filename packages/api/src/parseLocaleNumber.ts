/**
 * Parse admin-entered currency amounts. Accepts both `.` and `,` decimal separators
 * (e.g. `9.99` and `9,99`) and common thousands groupings (`1.234,56` / `1,234.56`).
 */
export function parseLocaleNumber(value: unknown): number | null {
  if (value === '' || value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let raw = String(value).trim().replace(/\s/g, '').replace(/^\+/, '');
  if (!raw) return null;

  const hasComma = raw.includes(',');
  const hasDot = raw.includes('.');
  if (hasComma && hasDot) {
    if (raw.lastIndexOf(',') > raw.lastIndexOf('.')) {
      // European: 1.234,56
      raw = raw.replace(/\./g, '').replace(',', '.');
    } else {
      // US: 1,234.56
      raw = raw.replace(/,/g, '');
    }
  } else if (hasComma) {
    // Lone comma → decimal separator (European locales)
    raw = raw.replace(',', '.');
  }

  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : null;
}
