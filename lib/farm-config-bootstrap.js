import fs from 'fs';
import path from 'path';

export const LE_FARM_CONFIG_PATH = path.join(process.cwd(), 'public', 'data', 'farm.json');

const DEFAULT_FARM_ID = 'FARM-MLTP9LVH-B0B85039';
const DEFAULT_FARM_NAME = 'The Notable Sprout';
const DEFAULT_TIMEZONE = 'America/New_York';
const DEFAULT_CURRENCY = 'USD';
const DEFAULT_TAX_RATE = 0.08;

function buildBootstrapFarmConfig() {
  const now = new Date().toISOString();
  const farmId = process.env.FARM_ID || DEFAULT_FARM_ID;
  const farmName = process.env.FARM_NAME || process.env.GREENREACH_FARM_NAME || DEFAULT_FARM_NAME;
  const timezone = process.env.FARM_TIMEZONE || DEFAULT_TIMEZONE;
  const currency = process.env.FARM_CURRENCY || DEFAULT_CURRENCY;
  const parsedTaxRate = Number.parseFloat(process.env.FARM_TAX_RATE || '');
  const taxRate = Number.isFinite(parsedTaxRate) ? parsedTaxRate : DEFAULT_TAX_RATE;
  const token = process.env.SWITCHBOT_TOKEN || '';
  const secret = process.env.SWITCHBOT_SECRET || '';

  const farmConfig = {
    schemaVersion: '1.0.0',
    farmId,
    name: farmName,
    farmName,
    timezone,
    address: '',
    city: '',
    state: '',
    taxRate,
    currency,
    created_at: now,
    updated_at: now,
    integrations: {}
  };

  if (token || secret) {
    farmConfig.integrations.switchbot = {
      token,
      secret
    };
  }

  return farmConfig;
}

export function ensureFarmConfigFile(options = {}) {
  const filePath = options.filePath || LE_FARM_CONFIG_PATH;

  if (fs.existsSync(filePath)) {
    return { created: false, filePath };
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(buildBootstrapFarmConfig(), null, 2)}\n`, 'utf8');
  console.warn(`[farm-config-bootstrap] Created missing farm.json at ${filePath}`);
  return { created: true, filePath };
}
