import fs from 'fs';
import os from 'os';
import path from 'path';
import { readFile as readGcsFile, readJSON as readGcsJSON, writeJSON as writeGcsJSON } from '../services/gcs-storage.js';

const PROJECT_ROOT = process.cwd();
const IS_CLOUD_RUN = Boolean(process.env.K_SERVICE);
const RUNTIME_STATE_ROOT = IS_CLOUD_RUN ? path.join(os.tmpdir(), 'greenreach-runtime') : PROJECT_ROOT;
const pendingJsonMirrors = new Map();

export function normalizeProjectRelativePath(targetPath) {
  if (!targetPath) return '';

  if (path.isAbsolute(targetPath)) {
    const relativePath = path.relative(PROJECT_ROOT, targetPath);
    if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
      return relativePath;
    }
    return targetPath;
  }

  return String(targetPath).replace(/^\.\//, '');
}

export function resolveRuntimeStatePath(targetPath) {
  const normalizedPath = normalizeProjectRelativePath(targetPath);
  if (!IS_CLOUD_RUN) {
    return path.isAbsolute(targetPath) ? targetPath : path.resolve(normalizedPath);
  }
  return path.join(RUNTIME_STATE_ROOT, normalizedPath);
}

export async function hydrateRuntimeStateJson(targetPath, fallback = null) {
  const normalizedPath = normalizeProjectRelativePath(targetPath);
  const runtimePath = resolveRuntimeStatePath(normalizedPath);
  fs.mkdirSync(path.dirname(runtimePath), { recursive: true });

  if (!IS_CLOUD_RUN) {
    return runtimePath;
  }

  try {
    const data = await readGcsJSON(normalizedPath, fallback);
    if (data !== null && data !== undefined) {
      fs.writeFileSync(runtimePath, JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.warn(`[runtime-state] Failed to hydrate ${normalizedPath}:`, error?.message || error);
  }

  return runtimePath;
}

export async function hydrateRuntimeStateFile(targetPath) {
  const normalizedPath = normalizeProjectRelativePath(targetPath);
  const runtimePath = resolveRuntimeStatePath(normalizedPath);
  fs.mkdirSync(path.dirname(runtimePath), { recursive: true });

  if (!IS_CLOUD_RUN) {
    return runtimePath;
  }

  try {
    const contents = await readGcsFile(normalizedPath);
    if (contents) {
      fs.writeFileSync(runtimePath, contents);
    }
  } catch (error) {
    console.warn(`[runtime-state] Failed to hydrate ${normalizedPath}:`, error?.message || error);
  }

  return runtimePath;
}

export function scheduleRuntimeJsonMirror(targetPath, data, options = {}) {
  if (!IS_CLOUD_RUN) return;

  const { delayMs = 250 } = options;
  const normalizedPath = normalizeProjectRelativePath(targetPath);
  const existingTimer = pendingJsonMirrors.get(normalizedPath);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    pendingJsonMirrors.delete(normalizedPath);
    writeGcsJSON(normalizedPath, data).catch((error) => {
      console.warn(`[runtime-state] Failed to mirror ${normalizedPath}:`, error?.message || error);
    });
  }, delayMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  pendingJsonMirrors.set(normalizedPath, timer);
}

export { IS_CLOUD_RUN, PROJECT_ROOT, RUNTIME_STATE_ROOT };