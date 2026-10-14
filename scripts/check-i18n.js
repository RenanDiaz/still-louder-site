// Parity check between the two language versions of the landing:
// public/index.html (es, `/`) and public/en.html (en, `/en`).
// Spec: docs/features/i18n-main-site-en.md (Decision 2).
//
// The pages are hand-edited copies, so this fails when their STRUCTURE drifts:
// same element ids (and so the same sections, in the same order), same links,
// images, data-* attributes and dates, the same number of show cards / FAQ
// entries / links, the same non-text meta tags, and JSON-LD blocks that only
// differ in free-text fields. It cannot tell whether a translation is faithful.
// Run by `npm run validate`. Exits 1 on any difference.
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', 'public');

const PAGES = { es: 'index.html', en: 'en.html' };

// Elements whose count must match (show cards, FAQ entries, list items, links...)
const COUNTED_TAGS = [
  'section',
  'article',
  'details',
  'li',
  'a',
  'img',
  'picture',
  'source',
  'form',
  'input',
  'textarea',
  'button',
  'time'
];

// Meta tags that carry data, not copy: identical in both languages.
const SHARED_META =
  /^(og:type|og:site_name|og:image(:(secure_url|type|width|height))?|music:.*|twitter:(card|site|creator|image|data\d))$/;

// JSON-LD fields that are free text and may be translated. Everything else
// (types, ids, URLs, dates, prices, proper names) must be identical.
const isTranslatable = (key, node) =>
  key === 'description' ||
  key === 'roleName' ||
  (key === 'name' && node['@type'] === 'Offer') ||
  (key === 'inLanguage' && node['@type'] === 'WebSite');

const stripTranslatable = (node) => {
  if (Array.isArray(node)) {
    return node.map(stripTranslatable);
  }
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => !isTranslatable(key, node))
        .map(([key, value]) => [key, stripTranslatable(value)])
    );
  }
  return node;
};

const parseAttrs = (raw) => {
  const attrs = {};
  for (const [, name, value] of raw.matchAll(/([\w:-]+)(?:\s*=\s*"([^"]*)")?/g)) {
    attrs[name.toLowerCase()] = value ?? '';
  }
  return attrs;
};

const extract = (file) => {
  const html = readFileSync(path.join(root, file), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const tags = [...html.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*)>/g)].map(([, name, raw]) => ({
    name: name.toLowerCase(),
    attrs: parseAttrs(raw)
  }));

  // The language switch, hreflang alternates and the canonical point at the
  // page itself or its counterpart, so they legitimately differ.
  const linking = tags.filter(
    ({ attrs }) => !('hreflang' in attrs) && attrs.rel !== 'canonical' && 'href' in attrs
  );

  const jsonLd = [
    ...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)
  ].map(([, body], i) => {
    try {
      return JSON.stringify(stripTranslatable(JSON.parse(body)));
    } catch (error) {
      return `invalid JSON in block ${i + 1}: ${error.message}`;
    }
  });

  return {
    'html lang': tags.filter((t) => t.name === 'html').map((t) => t.attrs.lang),
    'section ids': tags.filter((t) => t.name === 'section').map((t) => t.attrs.id ?? '(none)'),
    'element ids': tags.filter((t) => 'id' in t.attrs).map((t) => `${t.name}#${t.attrs.id}`),
    hrefs: linking.map((t) => t.attrs.href),
    'src/srcset': tags.flatMap(({ attrs }) =>
      ['src', 'srcset'].filter((a) => a in attrs).map((a) => `${a}=${attrs[a]}`)
    ),
    'data-* attributes': tags.flatMap(({ attrs }) =>
      Object.entries(attrs)
        .filter(([name]) => name.startsWith('data-'))
        .map(([name, value]) => `${name}=${value}`)
    ),
    datetimes: tags.filter((t) => 'datetime' in t.attrs).map((t) => t.attrs.datetime),
    'tag counts': COUNTED_TAGS.map(
      (name) => `${name}: ${tags.filter((t) => t.name === name).length}`
    ),
    'shared meta': tags
      .filter((t) => t.name === 'meta' && SHARED_META.test(t.attrs.property ?? t.attrs.name ?? ''))
      .map((t) => `${t.attrs.property ?? t.attrs.name}=${t.attrs.content}`),
    'JSON-LD (non-text fields)': jsonLd
  };
};

const es = extract(PAGES.es);
const en = extract(PAGES.en);
let failures = 0;

const fail = (label, detail) => {
  failures++;
  console.log(`FAIL ${label}: ${detail}`);
};

// <html lang> is the one value that MUST differ
if (es['html lang'][0] !== 'es' || en['html lang'][0] !== 'en') {
  fail('html lang', `expected es/en, got ${es['html lang'][0]}/${en['html lang'][0]}`);
}
delete es['html lang'];
delete en['html lang'];

for (const label of Object.keys(es)) {
  const a = es[label];
  const b = en[label];
  const max = Math.max(a.length, b.length);
  const i = [...Array(max).keys()].find((k) => a[k] !== b[k]);
  if (i === undefined) {
    console.log(`OK   ${label} (${a.length})`);
    continue;
  }
  fail(
    label,
    `first difference at #${i + 1} of ${a.length} vs ${b.length}\n` +
      `       ${PAGES.es}: ${a[i] ?? '(missing)'}\n` +
      `       ${PAGES.en}: ${b[i] ?? '(missing)'}`
  );
}

console.log(
  failures
    ? `\n${failures} difference(s) between ${PAGES.es} and ${PAGES.en}. Every content change ` +
        'goes in BOTH files (docs/features/i18n-main-site-en.md).'
    : `\n${PAGES.es} and ${PAGES.en} are in sync.`
);
process.exit(failures ? 1 : 0);
