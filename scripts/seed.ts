/**
 * Seed the database with dev sample data.
 * Usage: npx tsx scripts/seed.ts
 */
import fs from "fs";
import path from "path";
import { db } from "../src/config/database.js";
import { logger } from "../src/shared/utils/logger.js";

async function seed() {
  const seedFile = path.resolve(import.meta.dirname, "../src/db/seeds/dev-seed.sql");
  const sql = fs.readFileSync(seedFile, "utf-8");

  logger.info("Seeding database...");
  await db.raw(sql);
  logger.info("✅ Seed data loaded");

  await db.destroy();
}

seed().catch((err) => {
  logger.error(err, "Seeding failed");
  process.exit(1);
});
