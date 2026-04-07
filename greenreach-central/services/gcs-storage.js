/**
 * Google Cloud Storage helper for GreenReach Central.
 * Replaces local fs.writeFileSync/readFileSync operations for Cloud Run stateless compatibility.
 *
 * On Cloud Run: Uses GCS bucket (greenreach-storage).
 * Locally: Falls back to filesystem if GCS_BUCKET env var is not set.
 */
import { Storage } from '@google-cloud/storage';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GCS_BUCKET = process.env.GCS_BUCKET || 'greenreach-storage';
const USE_GCS = process.env.USE_GCS === 'true' || process.env.K_SERVICE; // K_SERVICE is set by Cloud Run

let storage;
let bucket;

if (USE_GCS) {
  storage = new Storage();
  bucket = storage.bucket(GCS_BUCKET);
}

/**
 * Upload a binary file (e.g. image) to GCS or local filesystem.
 * @param {string} relativePath - Path relative to project root (e.g. 'product-images/FARM-123/sku.webp')
 * @param {Buffer} buffer - File content
 * @param {string} [contentType] - MIME type (e.g. 'image/webp')
 * @returns {Promise<string>} Public URL or local path
 */
export async function uploadFile(relativePath, buffer, contentType) {
  if (USE_GCS) {
    const gcsPath = `central/${relativePath}`;
    const file = bucket.file(gcsPath);
    await file.save(buffer, {
      metadata: { contentType: contentType || 'application/octet-stream' },
      resumable: false,
    });
    return `gs://${GCS_BUCKET}/${gcsPath}`;
  }
  // Fallback: local filesystem
  const fullPath = path.join(__dirname, '..', 'public', relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, buffer);
  return fullPath;
}

/**
 * Read a file from GCS or local filesystem.
 * @param {string} relativePath - Path relative to public/ (e.g. 'data/crop-pricing.json')
 * @returns {Promise<Buffer|null>} File content or null if not found
 */
export async function readFile(relativePath) {
  if (USE_GCS) {
    try {
      const gcsPath = `central/${relativePath}`;
      const [contents] = await bucket.file(gcsPath).download();
      return contents;
    } catch (err) {
      if (err.code === 404) return null;
      throw err;
    }
  }
  // Fallback: local filesystem
  const fullPath = path.join(__dirname, '..', 'public', relativePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath);
}

/**
 * Write a text/JSON file to GCS or local filesystem.
 * @param {string} relativePath - Path relative to public/ (e.g. 'data/crop-pricing.json')
 * @param {string} content - File content as string
 * @returns {Promise<void>}
 */
export async function writeFile(relativePath, content) {
  if (USE_GCS) {
    const gcsPath = `central/${relativePath}`;
    const file = bucket.file(gcsPath);
    await file.save(content, {
      metadata: { contentType: 'application/json' },
      resumable: false,
    });
    return;
  }
  // Fallback: local filesystem (atomic write via tmp + rename)
  const fullPath = path.join(__dirname, '..', 'public', relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const tmpPath = fullPath + '.tmp';
  fs.writeFileSync(tmpPath, content);
  fs.renameSync(tmpPath, fullPath);
}

/**
 * Read a JSON file from GCS or local filesystem.
 * @param {string} relativePath - Path relative to public/
 * @param {*} fallback - Default value if file not found
 * @returns {Promise<*>} Parsed JSON or fallback
 */
export async function readJSON(relativePath, fallback = null) {
  const buf = await readFile(relativePath);
  if (!buf) return fallback;
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Write a JSON object to GCS or local filesystem.
 * @param {string} relativePath - Path relative to public/
 * @param {*} data - Object to serialize
 * @returns {Promise<void>}
 */
export async function writeJSON(relativePath, data) {
  await writeFile(relativePath, JSON.stringify(data, null, 2));
}

/**
 * Delete a file from GCS or local filesystem.
 * @param {string} relativePath
 * @returns {Promise<void>}
 */
export async function deleteFile(relativePath) {
  if (USE_GCS) {
    try {
      const gcsPath = `central/${relativePath}`;
      await bucket.file(gcsPath).delete();
    } catch (err) {
      if (err.code !== 404) throw err;
    }
    return;
  }
  const fullPath = path.join(__dirname, '..', 'public', relativePath);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
}

/**
 * Generate a signed URL for direct browser access to a GCS file.
 * Falls back to the local static path for development.
 * @param {string} relativePath
 * @param {number} [expiresMinutes=60]
 * @returns {Promise<string>} URL
 */
export async function getSignedUrl(relativePath, expiresMinutes = 60) {
  if (USE_GCS) {
    const gcsPath = `central/${relativePath}`;
    const [url] = await bucket.file(gcsPath).getSignedUrl({
      action: 'read',
      expires: Date.now() + expiresMinutes * 60 * 1000,
    });
    return url;
  }
  // Local: return relative path for static serving
  return `/${relativePath}`;
}

export { USE_GCS, GCS_BUCKET };
