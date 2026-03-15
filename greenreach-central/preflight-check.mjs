#!/usr/bin/env node
/**
 * GreenReach Central — Pre-flight Deployment Checklist
 *
 * Run before deployments: node preflight-check.mjs
 * Exit code 0 = all critical checks pass, 1 = failures found.
 */
import dotenv from 'dotenv';
dotenv.config();

const PASS = '\x1b[32m✔\x1b[0m';
const FAIL = '\x1b[31m✘\x1b[0m';
const WARN = '\x1b[33m⚠\x1b[0m';

let failures = 0;
let warnings = 0;

function check(label, value, required = true) {
  if (value) {
    console.log(`  ${PASS} ${label}`);
  } else if (required) {
    console.log(`  ${FAIL} ${label} — MISSING (required)`);
    failures++;
  } else {
    console.log(`  ${WARN} ${label} — not set (optional)`);
    warnings++;
  }
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(1, 50 - title.length))}`);
}

console.log('\n🔍 GreenReach Central — Pre-flight Check\n');

// ── Core ──────────────────────────────────────────────────
section('Core');
check('NODE_ENV',           process.env.NODE_ENV);
check('PORT',               process.env.PORT, false);
check('BASE_URL',           process.env.BASE_URL);

// ── Authentication ────────────────────────────────────────
section('Authentication');
check('JWT_SECRET',         process.env.JWT_SECRET);

if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
  console.log(`  ${WARN} JWT_SECRET is short (${process.env.JWT_SECRET.length} chars) — use ≥ 32`);
  warnings++;
}

check('WHOLESALE_JWT_SECRET', process.env.WHOLESALE_JWT_SECRET);
check('ADMIN_API_KEY',         process.env.ADMIN_API_KEY, false);
check('ADMIN_EMAIL',           process.env.ADMIN_EMAIL, false);
check('ADMIN_PASSWORD',        process.env.ADMIN_PASSWORD, false);

// ── Database ──────────────────────────────────────────────
section('Database');
check('DATABASE_URL',       process.env.DATABASE_URL);
check('DB_SSL',             process.env.DB_SSL, false);

if (process.env.NODE_ENV === 'production' && process.env.DB_SSL === 'false') {
  console.log(`  ${WARN} DB_SSL=false in production — enable SSL for production`);
  warnings++;
}

// ── Square Payments ───────────────────────────────────────
// Square vars are required for checkout but don't block server startup.
// Treat as warnings unless SQUARE_ENVIRONMENT=production.
section('Square Payments');
const squareRequired = process.env.SQUARE_ENVIRONMENT === 'production';
check('SQUARE_ACCESS_TOKEN',  process.env.SQUARE_ACCESS_TOKEN, squareRequired);
check('SQUARE_LOCATION_ID',   process.env.SQUARE_LOCATION_ID, squareRequired);
check('SQUARE_ENVIRONMENT',   process.env.SQUARE_ENVIRONMENT, false);
check('SQUARE_APP_ID',        process.env.SQUARE_APP_ID, false);

// ── Wholesale ─────────────────────────────────────────────
section('Wholesale');
check('WHOLESALE_COMMISSION_RATE', process.env.WHOLESALE_COMMISSION_RATE, false);
check('WHOLESALE_REQUIRE_DB_FOR_CRITICAL', process.env.WHOLESALE_REQUIRE_DB_FOR_CRITICAL, false);

// ── Procurement ───────────────────────────────────────────
section('Procurement');
check('PROCUREMENT_COMMISSION_RATE', process.env.PROCUREMENT_COMMISSION_RATE, false);

// ── External Services (Optional) ─────────────────────────
section('External Services (Optional)');
check('OPENAI_API_KEY',       process.env.OPENAI_API_KEY, false);
check('AWS_ACCESS_KEY_ID',    process.env.AWS_ACCESS_KEY_ID, false);
check('AWS_REGION',           process.env.AWS_REGION, false);
check('SES_ENABLED',          process.env.SES_ENABLED, false);

// ── Database connectivity ─────────────────────────────────
section('Database Connectivity');
if (process.env.DATABASE_URL) {
  try {
    const pg = await import('pg');
    const pool = new pg.default.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
    });
    const result = await pool.query('SELECT NOW() AS now, current_database() AS db');
    console.log(`  ${PASS} Connected to "${result.rows[0].db}" at ${result.rows[0].now}`);
    const tables = await pool.query(`SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = 'public'`);
    console.log(`  ${PASS} ${tables.rows[0].count} tables in public schema`);
    await pool.end();
  } catch (err) {
    console.log(`  ${FAIL} Database connection failed: ${err.message}`);
    failures++;
  }
} else {
  console.log(`  ${FAIL} Skipped — DATABASE_URL not set`);
  failures++;
}

// ── Summary ───────────────────────────────────────────────
console.log(`\n${'═'.repeat(55)}`);
if (failures === 0) {
  console.log(`${PASS} All critical checks passed. ${warnings} warning(s).`);
  console.log('  Ready for deployment.\n');
  process.exit(0);
} else {
  console.log(`${FAIL} ${failures} critical failure(s), ${warnings} warning(s).`);
  console.log('  Fix failures before deploying.\n');
  process.exit(1);
}
