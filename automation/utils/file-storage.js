import fs from 'fs';
import path from 'path';

export function ensureDirSync(dirPath) {
  if (!dirPath) return;
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

export function readJsonFileSync(filePath, defaultValue) {
  try {
    if (!fs.existsSync(filePath)) {
      return defaultValue;
    }
    const contents = fs.readFileSync(filePath, 'utf8');
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
  const dir = path.dirname(filePath);
  ensureDirSync(dir);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.warn(`[automation] Failed to write JSON file ${filePath}:`, error.message);
  }
}

export function appendNdjsonLine(filePath, payload) {
  const dir = path.dirname(filePath);
  ensureDirSync(dir);
  const line = typeof payload === 'string' ? payload : JSON.stringify(payload);
  try {
    fs.appendFileSync(filePath, line + '\n');
  } catch (error) {
    console.warn(`[automation] Failed to append NDJSON line ${filePath}:`, error.message);
  }
}
