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

async function optimizeImage(imagePath) {
  const ext = path.extname(imagePath).toLowerCase();
  if (!['.jpg', '.jpeg', '.png'].includes(ext)) {
    return;
  }

  const dir = path.dirname(imagePath);
  const basename = path.basename(imagePath, ext);

  console.log(`Optimizing: ${path.basename(imagePath)}`);

  try {
    const image = sharp(imagePath);
    const metadata = await image.metadata();

    // Original optimized
    if (ext === '.jpg' || ext === '.jpeg') {
      await image
        .jpeg({ quality: QUALITY_JPEG, progressive: true, mozjpeg: true })
        .toFile(path.join(dir, `${basename}-optimized.jpg`));
    } else if (ext === '.png') {
      await image
        .png({ quality: 85, compressionLevel: 9 })
        .toFile(path.join(dir, `${basename}-optimized.png`));
    }

    // WebP version
    await sharp(imagePath)
      .webp({ quality: QUALITY_WEBP, effort: 6 })
      .toFile(path.join(dir, `${basename}.webp`));

    // AVIF version (best compression, modern browsers)
    await sharp(imagePath)
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

  // Optimize QR codes
  await optimizeQRCodes();

  console.log('\n=== Optimization Complete ===');
  console.log('\nNext steps:');
  console.log('1. Update HTML to use <picture> elements with WebP/AVIF sources');
  console.log('2. Add width/height attributes to all images');
  console.log('3. Implement lazy loading for non-critical images');
}

main().catch(console.error);
