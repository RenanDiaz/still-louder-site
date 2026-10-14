/**
 * Page language for JS-generated copy (docs/features/i18n-main-site-en.md, D4).
 * `/` (index.html) and `/en` (en.html) load the same bundle; the language is
 * whatever `<html lang>` the page declares.
 */

export const lang = document.documentElement.lang === 'en' ? 'en' : 'es';

/** Picks the current language from a `{ es, en }` dict, falling back to `es`. */
export const t = (dict) => dict[lang] ?? dict.es;
