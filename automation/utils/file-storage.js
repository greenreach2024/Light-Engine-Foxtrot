import fs from 'fs';
import path from 'path';
import {
  hydrateRuntimeStateJson,
  normalizeProjectRelativePath,
  resolveRuntimeStatePath,
  scheduleRuntimeJsonMirror,
} from '../../lib/runtime-state.js';

const AUTOMATION_RUNTIME_FILES = [
  { path: 'data/automation/env-state.json', fallback: { scopes: {}, targets: {}, rooms: {}, updatedAt: null } },
  { path: 'data/automation/rules.json', fallback: { rules: [] } },
  { path: 'data/automation/plugs.json', fallback: { plugs: [] } }
];

function resolveStoragePath(filePath) {
  return resolveRuntimeStatePath(normalizeProjectRelativePath(filePath));
}

export async function hydrateAutomationStorageCache() {
  await Promise.all(
    AUTOMATION_RUNTIME_FILES.map((entry) => hydrateRuntimeStateJson(entry.path, entry.fallback))
  );
}

export function ensureDirSync(dirPath) {
  if (!dirPath) return;
  try {
    fs.mkdirSync(resolveStoragePath(dirPath), { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

export function readJsonFileSync(filePath, defaultValue) {
  try {
    const runtimePath = resolveStoragePath(filePath);
    if (!fs.existsSync(runtimePath)) {
      return defaultValue;
    }
    const contents = fs.readFileSync(runtimePath, 'utf8');
    if (!contents.trim()) {
      return defaultValue;
    }
    return JSON.parse(contents);
  } catch (error) {
    console.warn(`[automation] Failed to read JSON file ${filePath}:`, error.message);
    return defaultValue;
  }
}

export function writeJsonFileSync(filePath, data) {
  const storageKey = normalizeProjectRelativePath(filePath);
  const runtimePath = resolveStoragePath(storageKey);
  const dir = path.dirname(runtimePath);
  ensureDirSync(dir);
  try {
    fs.writeFileSync(runtimePath, JSON.stringify(data, null, 2));
    scheduleRuntimeJsonMirror(storageKey, data);
  } catch (error) {
    console.warn(`[automation] Failed to write JSON file ${filePath}:`, error.message);
  }
}

export function appendNdjsonLine(filePath, payload) {
  const storageKey = normalizeProjectRelativePath(filePath);
  const runtimePath = resolveStoragePath(storageKey);
  const dir = path.dirname(runtimePath);
  ensureDirSync(dir);
  const line = typeof payload === 'string' ? payload : JSON.stringify(payload);
  try {
    fs.appendFileSync(runtimePath, line + '\n');
  } catch (error) {
    console.warn(`[automation] Failed to append NDJSON line ${filePath}:`, error.message);
  }
}
