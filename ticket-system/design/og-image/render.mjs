// Renders og-image.html to ../../public/og-image.jpg (1200x630).
// Usage (repo root): node ticket-system/design/og-image/render.mjs
// Uses the locally installed Google Chrome in headless mode (override with
// CHROME=/path/to/chrome) and `sharp` from the main site's node_modules for the
// JPEG, so nothing extra has to be installed.
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const png = join(here, 'og-image.png');
const chrome =
  process.env.CHROME ||
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(
    existsSync
  );
if (!chrome) throw new Error('Chrome not found; set CHROME=/path/to/chrome');

execFileSync(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--allow-file-access-from-files',
  '--window-size=1200,630',
  '--virtual-time-budget=3000',
  `--screenshot=${png}`,
  `file://${join(here, 'og-image.html')}`
]);
await sharp(png).jpeg({ quality: 86, progressive: true, mozjpeg: true }).toFile(join(here, '../../public/og-image.jpg'));
rmSync(png);
