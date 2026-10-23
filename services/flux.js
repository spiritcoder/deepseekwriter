import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const storageImagesDir = path.join(rootDir, 'storage', 'images');

if (!fs.existsSync(storageImagesDir)) {
  fs.mkdirSync(storageImagesDir, { recursive: true });
}

const IMAGE_API_URL = (process.env.IMAGE_API_URL || '').trim();
const IMAGE_API_KEY = (process.env.IMAGE_API_KEY || '').trim();

/**
 * Aspect ratio dimension mapping
 */
export function getDimensions(aspectRatio = '16:9') {
  switch (aspectRatio) {
    case '9:16':
      return { width: 576, height: 1024 };
    case '1:1':
      return { width: 768, height: 768 };
    case '4:3':
      return { width: 1024, height: 768 };
    case '16:9':
    default:
      return { width: 1024, height: 576 };
  }
}

/**
 * Polish prompt for realistic, culturally grounded visual fidelity
 */
export function polishFluxPrompt(prompt, style = 'photorealistic') {
  let clean = (prompt || '').trim();
  if (!clean) return '';

  // Remove trailing periods and quotes
  clean = clean.replace(/^["]|["]$/g, '').trim();

  // Add realistic quality anchors and anti-CGI cues if missing
  if (!clean.toLowerCase().includes('no text')) {
    clean += ', strictly NO text, NO watermarks, NO CGI, natural skin textures and pores, authentic African cultural details, 35mm photography';
  }

  return clean;
}

/**
 * Generate image via Cloudflare Worker Flux endpoint and persist to local storage
 */
export async function generateFluxImage(rawPrompt, {
  aspectRatio = '16:9',
  articleSlug = '',
  referenceImages = [],
  apiKey = null
} = {}) {
  const targetUrl = (process.env.IMAGE_API_URL || IMAGE_API_URL || '').trim();
  if (!targetUrl) {
    throw new Error('IMAGE_API_URL is required in .env');
  }

  const cleanKey = (apiKey || IMAGE_API_KEY || process.env.IMAGE_API_KEY || '').trim();
  if (!cleanKey) {
    throw new Error('IMAGE_API_KEY is required in .env');
  }

  const prompt = polishFluxPrompt(rawPrompt);
  const { width, height } = getDimensions(aspectRatio);

  const payload = {
    prompt,
    width,
    height
  };

  if (Array.isArray(referenceImages) && referenceImages.length > 0) {
    payload.reference_images = referenceImages;
  }

  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cleanKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Flux Image Generation API error (${response.status}): ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Generate safe unique filename
  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  const safeSlug = articleSlug ? articleSlug.substring(0, 30).replace(/[^a-z0-9-]/gi, '') : 'img';
  const filename = `flux-${safeSlug}-${timestamp}-${randomSuffix}.jpg`;
  const filePath = path.join(storageImagesDir, filename);

  fs.writeFileSync(filePath, buffer);

  return {
    filename,
    url: `/images/${filename}`,
    filePath,
    prompt,
    width,
    height,
    aspectRatio,
    sizeBytes: buffer.length
  };
}

/**
 * List all generated / uploaded images in local storage
 */
export function getSavedImages() {
  if (!fs.existsSync(storageImagesDir)) return [];
  const files = fs.readdirSync(storageImagesDir);
  return files
    .filter(file => /\.(jpe?g|png|webp|gif|svg)$/i.test(file))
    .map(filename => {
      const filePath = path.join(storageImagesDir, filename);
      const stat = fs.statSync(filePath);
      return {
        filename,
        url: `/images/${filename}`,
        sizeBytes: stat.size,
        createdAt: stat.birthtime
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}
