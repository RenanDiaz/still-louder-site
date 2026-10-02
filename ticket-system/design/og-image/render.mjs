// Renders og-image.html to ../../public/og-image.jpg (1200x630).
// Usage (repo root): node ticket-system/design/og-image/render.mjs
// Needs Playwright + Chromium (not a dependency of this app) and ImageMagick for the JPEG.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const png = join(here, 'og-image.png');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(`file://${join(here, 'og-image.html')}`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: png });
await browser.close();
execFileSync('convert', [png, '-strip', '-quality', '86', '-interlace', 'JPEG', join(here, '../../public/og-image.jpg')]);
execFileSync('rm', [png]);
