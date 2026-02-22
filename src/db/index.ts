import { db } from "../config/database.js";

export { db };

/**
 * Thin query-builder helpers wrapping Knex.
 * Each module can import `db` and use `db("table_name")` directly.
 */
