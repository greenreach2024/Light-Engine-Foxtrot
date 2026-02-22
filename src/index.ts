import { createApp } from "./app.js";
import { env, checkDbConnection } from "./config/index.js";
import { logger } from "./shared/utils/logger.js";

async function main() {
  // Verify DB is reachable
  await checkDbConnection();
  logger.info("Database connected");

  const app = createApp();

  app.listen(env.PORT, () => {
    logger.info(`Light-Engine-Foxtrot listening on :${env.PORT} [${env.NODE_ENV}]`);
  });
}

main().catch((err) => {
  logger.fatal(err, "Failed to start server");
  process.exit(1);
});
