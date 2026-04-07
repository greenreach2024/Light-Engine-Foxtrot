/**
 * Google Cloud Storage helper for Light Engine.
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
const USE_GCS = process.env.USE_GCS === 'true' || !!process.env.K_SERVICE;

let storage;
let bucket;

if (USE_GCS) {
  storage = new Storage();
  bucket = storage.bucket(GCS_BUCKET);
}

/**
 * Upload a binary file to GCS or local filesystem.
 * @param {string} relativePath - Path relative to project root (e.g. 'data/devices.nedb')
 * @param {Buffer|string} content - File content
 * @param {string} [contentType] - MIME type
 * @returns {Promise<string>} GCS URI or local path
 */
export async function uploadFile(relativePath, content, contentType) {
  if (USE_GCS) {
    const gcsPath = `le/${relativePath}`;
    const file = bucket.file(gcsPath);
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    await file.save(buf, {
      metadata: { contentType: contentType || 'application/octet-stream' },
      resumable: false,
    });
    return `gs://${GCS_BUCKET}/${gcsPath}`;
  }
  const fullPath = path.resolve(relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
  return fullPath;
}

/**
 * Read a file from GCS or local filesystem.
 * @param {string} relativePath - e.g. 'data/farm.json' or 'public/data/env.json'
 * @returns {Promise<Buffer|null>}
 */
export async function readFile(relativePath) {
  if (USE_GCS) {
    try {
      const gcsPath = `le/${relativePath}`;
      const [contents] = await bucket.file(gcsPath).download();
      return contents;
    } catch (err) {
      if (err.code === 404) return null;
      throw err;
    }
  }
  const fullPath = path.resolve(relativePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath);
}

/**
 * Write a text/JSON file to GCS or local filesystem.
 * @param {string} relativePath
 * @param {string} content
 * @returns {Promise<void>}
 */
export async function writeFile(relativePath, content) {
  if (USE_GCS) {
    const gcsPath = `le/${relativePath}`;
    await bucket.file(gcsPath).save(content, {
      metadata: { contentType: 'application/json' },
      resumable: false,
    });
    return;
  }
  const fullPath = path.resolve(relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const tmpPath = fullPath + '.tmp';
  fs.writeFileSync(tmpPath, content);
  fs.renameSync(tmpPath, fullPath);
}

/**
 * Read a JSON file.
 * @param {string} relativePath
 * @param {*} fallback
 * @returns {Promise<*>}
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
 * Write a JSON object.
 * @param {string} relativePath
 * @param {*} data
 * @returns {Promise<void>}
 */
export async function writeJSON(relativePath, data) {
  await writeFile(relativePath, JSON.stringify(data, null, 2));
}

/**
 * Delete a file.
 * @param {string} relativePath
 * @returns {Promise<void>}
 */
export async function deleteFile(relativePath) {
  if (USE_GCS) {
    try {
      await bucket.file(`le/${relativePath}`).delete();
    } catch (err) {
      if (err.code !== 404) throw err;
    }
    return;
  }
  const fullPath = path.resolve(relativePath);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
}

export { USE_GCS, GCS_BUCKET };
