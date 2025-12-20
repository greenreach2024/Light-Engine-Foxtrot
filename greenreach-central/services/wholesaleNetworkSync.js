import logger from '../utils/logger.js';
import { listNetworkFarms } from './networkFarmsStore.js';
import { setNetworkFarms, syncNetworkOnce } from './wholesaleNetworkAggregator.js';

export function startWholesaleNetworkSync(app) {
  const intervalMs = Number(process.env.WHOLESALE_NETWORK_SYNC_MS || 60_000);

  let timer = null;

  async function tick(reason = 'interval') {
    try {
      const farms = await listNetworkFarms();
      await setNetworkFarms(farms);
      const result = await syncNetworkOnce();
      app.locals.wholesaleNetworkLastSync = result.timestamp;
      logger.info('Wholesale network sync complete', {
        reason,
        farms: farms.length
      });
    } catch (error) {
      logger.warn('Wholesale network sync failed', { reason, error: error.message });
    }
  }

  tick('startup');
  timer = setInterval(() => tick('interval'), intervalMs);

  app.locals.stopWholesaleNetworkSync = () => {
    if (timer) clearInterval(timer);
  };
}
