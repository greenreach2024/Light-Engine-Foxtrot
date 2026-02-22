import knex, { Knex } from "knex";
import { env } from "./env.js";

const config: Knex.Config = {
  client: "pg",
  connection: env.DATABASE_URL,
  pool: {
    min: env.DB_POOL_MIN,
    max: env.DB_POOL_MAX,
  },
  migrations: {
    directory: "../db/migrations",
    extension: "sql",
  },
};

export const db = knex(config);

export async function checkDbConnection(): Promise<void> {
  try {
    await db.raw("SELECT 1");
  } catch (err) {
    throw new Error(`Database connection failed: ${(err as Error).message}`);
  }
}
