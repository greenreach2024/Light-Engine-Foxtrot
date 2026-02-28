import fs from 'fs';
import express from '../greenreach-central/node_modules/express/index.js';
import accountingRoutes from '../greenreach-central/routes/accounting.js';
import { authMiddleware } from '../greenreach-central/middleware/auth.js';
import { initDatabase } from '../greenreach-central/config/database.js';

const keyMap = JSON.parse(fs.readFileSync('../public/data/farm-api-keys.json', 'utf8'));
const entry = Object.entries(keyMap).find(([, value]) => value && value.status === 'active' && value.api_key);

if (!entry) {
  console.log('ERROR:no_active_farm_api_key');
  process.exit(2);
}

const [farmId, row] = entry;

await initDatabase();

const app = express();
app.use(express.json());
app.use('/api/accounting', authMiddleware, accountingRoutes);

const server = app.listen(3199, async () => {
  try {
    const resp = await fetch('http://127.0.0.1:3199/api/accounting/connectors/aws-cost-explorer/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Farm-ID': farmId,
        'X-API-Key': row.api_key
      },
      body: JSON.stringify({ dry_run: true, granularity: 'DAILY' })
    });

    const text = await resp.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      console.log('HTTP_STATUS:' + resp.status);
      console.log('FARM_ID:' + farmId);
      console.log('ERROR:invalid_json_response');
      console.log('RAW:' + text.slice(0, 500));
      return;
    }

    console.log('HTTP_STATUS:' + resp.status);
    console.log('FARM_ID:' + farmId);
    console.log('OK:' + Boolean(json.ok));
    console.log('BY_ACCOUNT:' + JSON.stringify((json.summary || {}).by_account || null));
    console.log('FETCHED_ROWS:' + ((json.summary || {}).fetched_rows ?? 'n/a'));
    console.log('TOTAL_USD:' + ((json.summary || {}).total_amount_usd ?? 'n/a'));
    if (!json.ok) {
      console.log('ERROR:' + (json.error || 'unknown'));
      console.log('MESSAGE:' + (json.message || ''));
    }
  } catch (err) {
    console.log('ERROR:request_failed');
    console.log('MESSAGE:' + err.message);
  } finally {
    server.close(() => process.exit(0));
  }
});
