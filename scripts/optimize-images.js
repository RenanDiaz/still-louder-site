import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');

// Configuration
const QUALITY_WEBP = 85;
const QUALITY_AVIF = 75;
const QUALITY_JPEG = 85;

// Directories to process
const imageDirs = [
  path.join(publicDir, 'assets', 'images', 'sponsors'),
  path.join(publicDir, 'assets')
];

// QR codes in root
const qrCodes = [
  path.join(projectRoot, 'stilllouder-qr.png'),
  path.join(projectRoot, 'stilllouder-qr-transparent.png')
];

async function optimizeImage(imagePath, options = {}) {
  // maxWidth: downscale to this width before encoding (responsive sources).
  // jpgFallback: also emit a resized, version-controlled `<name>.jpg` fallback
  //   (used by <picture>/<img> when avif/webp aren't supported).
  // skipOptimizedJpg: don't emit the gitignored `<name>-optimized.jpg` extra.
  const { maxWidth, jpgFallback = false, skipOptimizedJpg = false } = options;
  const origExt = path.extname(imagePath);
  const ext = origExt.toLowerCase();
  if (!['.jpg', '.jpeg', '.png'].includes(ext)) {
    return;
  }

  const dir = path.dirname(imagePath);
  // Strip the extension in its original case so uppercase .JPG/.JPEG sources
  // still produce clean output names (e.g. IMG_2434.webp, not IMG_2434.JPEG.webp).
  const basename = path.basename(imagePath, origExt);

  // Skip our own generated fallbacks so re-runs don't process derivatives of derivatives.
  if (basename.endsWith('-optimized')) {
    return;
  }

  console.log(`Optimizing: ${path.basename(imagePath)}${maxWidth ? ` (resize → ${maxWidth}px)` : ''}`);

  // Build a fresh sharp pipeline, applying an optional max-width downscale.
  const pipeline = () => {
    const p = sharp(imagePath);
    return maxWidth ? p.resize({ width: maxWidth, withoutEnlargement: true }) : p;
  };

  try {
    // Original optimized (same format as source)
    if (ext === '.jpg' || ext === '.jpeg') {
      if (!skipOptimizedJpg) {
        await pipeline()
          .jpeg({ quality: QUALITY_JPEG, progressive: true, mozjpeg: true })
          .toFile(path.join(dir, `${basename}-optimized.jpg`));
      }
      if (jpgFallback) {
        await pipeline()
          .jpeg({ quality: QUALITY_JPEG, progressive: true, mozjpeg: true })
          .toFile(path.join(dir, `${basename}.jpg`));
      }
    } else if (ext === '.png') {
      await pipeline()
        .png({ quality: 85, compressionLevel: 9 })
        .toFile(path.join(dir, `${basename}-optimized.png`));
    }

    // WebP version
    await pipeline()
      .webp({ quality: QUALITY_WEBP, effort: 6 })
      .toFile(path.join(dir, `${basename}.webp`));

    // AVIF version (best compression, modern browsers)
    await pipeline()
      .avif({ quality: QUALITY_AVIF, effort: 6 })
      .toFile(path.join(dir, `${basename}.avif`));

    // Get file sizes for reporting
    const originalStats = await fs.stat(imagePath);
    const webpStats = await fs.stat(path.join(dir, `${basename}.webp`));
    const avifStats = await fs.stat(path.join(dir, `${basename}.avif`));

    const originalSize = (originalStats.size / 1024).toFixed(2);
    const webpSize = (webpStats.size / 1024).toFixed(2);
    const avifSize = (avifStats.size / 1024).toFixed(2);
    const webpSavings = ((1 - webpStats.size / originalStats.size) * 100).toFixed(1);
    const avifSavings = ((1 - avifStats.size / originalStats.size) * 100).toFixed(1);

    console.log(`  Original: ${originalSize}KB`);
    console.log(`  WebP: ${webpSize}KB (${webpSavings}% smaller)`);
    console.log(`  AVIF: ${avifSize}KB (${avifSavings}% smaller)`);

  } catch (error) {
    console.error(`Error optimizing ${imagePath}:`, error.message);
  }
}

async function processDirectory(dir) {
  try {
    const files = await fs.readdir(dir);

    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = await fs.stat(filePath);

      if (stat.isFile()) {
        await optimizeImage(filePath);
      }
    }
  } catch (error) {
    console.error(`Error processing directory ${dir}:`, error.message);
  }
}

async function optimizeQRCodes() {
  console.log('\n=== Optimizing QR Codes ===\n');

  for (const qrPath of qrCodes) {
    try {
      const exists = await fs.access(qrPath).then(() => true).catch(() => false);
      if (!exists) {
        console.log(`Skipping ${path.basename(qrPath)} (not found)`);
        continue;
      }

      await optimizeImage(qrPath);
    } catch (error) {
      console.error(`Error optimizing QR code ${qrPath}:`, error.message);
    }
  }
}

async function main() {
  console.log('=== Starting Image Optimization ===\n');

  // Process sponsor images
  console.log('=== Optimizing Sponsor Images ===\n');
  await processDirectory(path.join(publicDir, 'assets', 'images', 'sponsors'));

  // Process favicon and other assets
  console.log('\n=== Optimizing Asset Images ===\n');
  const assetImages = [
    path.join(publicDir, 'assets', 'favicon.jpeg'),
    path.join(publicDir, 'assets', 'favicon-96x96.png'),
    path.join(publicDir, 'assets', 'apple-touch-icon.png'),
    path.join(publicDir, 'assets', 'web-app-manifest-192x192.png'),
    path.join(publicDir, 'assets', 'web-app-manifest-512x512.png')
  ];

  for (const imgPath of assetImages) {
    try {
      const exists = await fs.access(imgPath).then(() => true).catch(() => false);
      if (exists) {
        await optimizeImage(imgPath);
      }
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }
  }

  // Process Skirlaz album cover (square, used in hero + social/OG).
  // The committed source skirlaz.jpeg (640px, ~170KB) doubles as the <img> fallback,
  // so we only need to emit the modern webp/avif siblings.
  console.log('\n=== Optimizing Album Covers ===\n');
  const albumCovers = [
    { path: path.join(publicDir, 'assets', 'images', 'album_covers', 'skirlaz.jpeg'), maxWidth: 1200 }
  ];
  for (const { path: imgPath, maxWidth } of albumCovers) {
    const exists = await fs.access(imgPath).then(() => true).catch(() => false);
    if (exists) {
      await optimizeImage(imgPath, { maxWidth, skipOptimizedJpg: true });
    }
  }

  // Process the Skirlaz photoshoot photos used on the site. The multi-MB studio RAWs
  // are NOT committed; only these web-sized derivatives are. Run this against the RAWs
  // (e.g. from the `skirlaz` archive branch) to regenerate.
  console.log('\n=== Optimizing Skirlaz Photoshoot ===\n');
  const photoshootDir = path.join(publicDir, 'assets', 'images', 'photoshoot', 'skirlaz');
  const photoshoot = [
    // Hero background (CSS image-set: avif + webp). No jpg fallback needed.
    { file: 'IMG_2434.JPEG', maxWidth: 1920, jpgFallback: false },
    // About/band section <picture>: needs a resized jpg fallback too.
    { file: 'IMG_2433.JPEG', maxWidth: 1280, jpgFallback: true }
  ];
  for (const { file, maxWidth, jpgFallback } of photoshoot) {
    const imgPath = path.join(photoshootDir, file);
    const exists = await fs.access(imgPath).then(() => true).catch(() => false);
    if (exists) {
      await optimizeImage(imgPath, { maxWidth, jpgFallback, skipOptimizedJpg: true });
    } else {
      console.log(`Skipping ${file} (RAW not present — using committed derivatives)`);
    }
  }

  // Optimize QR codes
  await optimizeQRCodes();

  console.log('\n=== Optimization Complete ===');
  console.log('\nNext steps:');
  console.log('1. Update HTML to use <picture> elements with WebP/AVIF sources');
  console.log('2. Add width/height attributes to all images');
  console.log('3. Implement lazy loading for non-critical images');
}

main().catch(console.error);
