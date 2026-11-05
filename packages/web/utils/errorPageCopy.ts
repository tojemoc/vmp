import type { Strings } from '~/locales';

type ErrorPageStrings = Pick<
  Strings,
  | 'errorPageNotFoundTitle'
  | 'errorPageNotFoundDescription'
  | 'errorPageGenericTitle'
  | 'errorPageGenericDescription'
>;

export interface ErrorPageCopy {
  statusCode: number;
  title: string;
  description: string;
}

/**
 * Copy for `error.vue`, derived only from the status code and the locale catalog.
 *
 * The server renders the error page and the client hydrates it from the payload, so
 * every rendered value must be identical on both sides. Error messages are not: they
 * can carry upstream or stack-dependent text, and leak internals to visitors.
 */
export function errorPageCopy(statusCode: unknown, strings: ErrorPageStrings): ErrorPageCopy {
  const parsed = Number(statusCode);
  const code = Number.isInteger(parsed) && parsed >= 400 && parsed <= 599 ? parsed : 500;
  if (code === 404) {
    return {
      statusCode: code,
      title: strings.errorPageNotFoundTitle,
      description: strings.errorPageNotFoundDescription,
    };
  }
  return {
    statusCode: code,
    title: strings.errorPageGenericTitle,
    description: strings.errorPageGenericDescription,
  };
}
