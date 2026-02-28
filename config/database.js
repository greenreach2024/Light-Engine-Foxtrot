import path from 'path';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'data', 'light-engine.sqlite');

let db = null;

function getDb() {
  if (db) return db;
  sqlite3.verbose();
  db = new sqlite3.Database(DB_PATH);
  return db;
}

function normalizeSql(sql = '') {
  return String(sql)
    .replace(/\$(\d+)/g, '?')
    .replace(/\bNOW\(\)/gi, 'CURRENT_TIMESTAMP');
}

function stripReturningId(sql = '') {
  return String(sql).replace(/\s+RETURNING\s+id\s*;?\s*$/i, '');
}

function isReadQuery(sql = '') {
  return /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql);
}

async function runAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().all(sql, params, (error, rows) => {
      if (error) return reject(error);
      resolve(rows || []);
    });
  });
}

async function runExec(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().run(sql, params, function onRun(error) {
      if (error) return reject(error);
      resolve({ changes: this?.changes || 0, lastID: this?.lastID || null });
    });
  });
}

export async function query(text, params = []) {
  const normalized = normalizeSql(text);

  if (isReadQuery(normalized)) {
    const rows = await runAll(normalized, params);
    return {
      rows,
      rowCount: rows.length,
      command: 'SELECT',
      fields: []
    };
  }

  if (/\bRETURNING\s+id\b/i.test(normalized)) {
    const withoutReturning = stripReturningId(normalized);
    const result = await runExec(withoutReturning, params);
    const rows = result.lastID == null ? [] : [{ id: result.lastID }];
    return {
      rows,
      rowCount: result.changes,
      command: 'INSERT',
      fields: []
    };
  }

  const result = await runExec(normalized, params);
  return {
    rows: [],
    rowCount: result.changes,
    command: 'UPDATE',
    fields: []
  };
}

async function ensureTables() {
  await runExec(`
    CREATE TABLE IF NOT EXISTS wholesale_order_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sub_order_id TEXT,
      farm_id TEXT,
      action TEXT,
      details TEXT,
      performed_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export async function getClient() {
  return {
    query,
    release: () => {}
  };
}

export async function initDatabase() {
  getDb();
  await ensureTables();
  return true;
}

const pool = {
  query,
  connect: getClient,
  end: async () => {
    if (!db) return;
    await new Promise((resolve, reject) => {
      db.close((error) => {
        if (error) return reject(error);
        resolve();
      });
    });
    db = null;
  }
};

export default pool;
