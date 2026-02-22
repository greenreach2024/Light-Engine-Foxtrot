/**
 * Run database migrations (production-compatible).
 * Usage: node dist/scripts/migrate.js
 */
import fs from "fs";
import path from "path";
import { db } from "../config/database.js";
import { logger } from "../shared/utils/logger.js";

async function migrate() {
  const migrationsDir = path.resolve(__dirname, "../db/migrations");
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

  // Ensure migrations tracking table exists
  await db.raw(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = await db("_migrations").select("name");
  const appliedSet = new Set(applied.map((r: any) => r.name));

  for (const file of files) {
    if (appliedSet.has(file)) {
      logger.info(`⏭  ${file} (already applied)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    logger.info(`▶  Applying ${file}...`);

    await db.raw(sql);
    await db("_migrations").insert({ name: file });

    logger.info(`✅ ${file} applied`);
  }

  logger.info("Migrations complete");
  await db.destroy();
}

migrate().catch((err) => {
  logger.error(err, "Migration failed");
  process.exit(1);
});
