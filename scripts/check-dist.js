// Checks that the build output is self-consistent: the files that must be
// served at fixed URLs exist, and every local reference in dist/*.html, the
// service worker's PRECACHE_URLS and the manifest icons resolves to a file in
// dist/. Run after `npm run build` (npm run check:dist). Exits 1 on any miss.
import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '..', 'dist');

const REQUIRED = [
  '/sw.js',
  '/offline.html',
  '/robots.txt',
  '/sitemap.xml',
  '/.well-known/security.txt'
];

let failures = 0;

const check = (label, url) => {
  if (/^(https?:|data:|mailto:|#|\/\/)/.test(url)) {
    return;
  }
  const pathname = decodeURIComponent(new URL(url, 'http://local/').pathname);
  const file = path.join(dist, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
  const ok = existsSync(file);
  if (!ok) {
    failures++;
  }
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}: ${url}`);
};

if (!existsSync(dist)) {
  console.error('dist/ not found. Run `npm run build` first.');
  process.exit(1);
}

REQUIRED.forEach((url) => check('required', url));

for (const html of readdirSync(dist).filter((f) => f.endsWith('.html'))) {
  const src = readFileSync(path.join(dist, html), 'utf8');
  for (const [, url] of src.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) {
    check(`${html} <script>`, url);
  }
  for (const [, url] of src.matchAll(/<link\b[^>]*\bhref="([^"]+)"/g)) {
    check(`${html} <link>`, url);
  }
}

const swFile = path.join(dist, 'sw.js');
if (existsSync(swFile)) {
  const precache = readFileSync(swFile, 'utf8').match(/const PRECACHE_URLS = \[([\s\S]*?)\];/);
  if (precache) {
    for (const [, url] of precache[1].matchAll(/'([^']+)'/g)) {
      check('sw.js PRECACHE_URLS', url);
    }
  } else {
    failures++;
    console.log('FAIL sw.js: PRECACHE_URLS not found');
  }
}

check('manifest', '/site.webmanifest');
const manifestFile = path.join(dist, 'site.webmanifest');
if (existsSync(manifestFile)) {
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  manifest.icons.forEach((icon) => check('manifest icon', icon.src));
  (manifest.shortcuts ?? []).forEach((shortcut) =>
    (shortcut.icons ?? []).forEach((icon) => check('manifest shortcut icon', icon.src))
  );
}

console.log(failures ? `\n${failures} missing file(s) in dist/` : '\nAll references resolve.');
process.exit(failures ? 1 : 0);
