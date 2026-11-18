/** The site's languages, in one place (the backend keeps the same list in schemas/settings.py). */
export const LANGUAGES: readonly string[] = ['fr', 'en'];
export const DEFAULT_LANG = 'fr';

/** The code when the site supports it, else null. */
export function supportedLang(code: unknown): string | null {
  return LANGUAGES.find((l) => l === code) ?? null;
}

/** At login: the account's language wins, else the one this browser had, else the default. Unsupported values are ignored. */
export function chooseLang(account: unknown, browser: unknown): string {
  return supportedLang(account) ?? supportedLang(browser) ?? DEFAULT_LANG;
}
