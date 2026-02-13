import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const FORMATS_FILE = path.join(DATA_DIR, 'tray-formats.json');
const TRAYS_FILE = path.join(DATA_DIR, 'trays.json');

const DEFAULT_FORMATS = [
  {
    trayFormatId: 'fmt-72-cell',
    name: '72 Cell Standard',
    plantSiteCount: 72,
    systemType: 'NFT',
    trayMaterial: 'plastic',
    description: 'Standard 72-site nursery tray',
    isWeightBased: false,
    targetWeightPerSite: null,
    weightUnit: 'heads',
    isCustom: false
  },
  {
    trayFormatId: 'fmt-48-cell',
    name: '48 Cell Heavy Greens',
    plantSiteCount: 48,
    systemType: 'DWC',
    trayMaterial: 'plastic',
    description: '48-site tray for larger crops',
    isWeightBased: true,
    targetWeightPerSite: 0.25,
    weightUnit: 'lb',
    isCustom: false
  }
];

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function getFormats() {
  const raw = await readJson(FORMATS_FILE, { formats: DEFAULT_FORMATS });
  const formats = Array.isArray(raw) ? raw : (raw?.formats || []);
  if (!Array.isArray(formats) || formats.length === 0) {
    await writeJson(FORMATS_FILE, { formats: DEFAULT_FORMATS });
    return [...DEFAULT_FORMATS];
  }
  return formats;
}

async function saveFormats(formats) {
  await writeJson(FORMATS_FILE, { formats });
}

async function getTrays() {
  const raw = await readJson(TRAYS_FILE, { trays: [] });
  return Array.isArray(raw) ? raw : (raw?.trays || []);
}

async function saveTrays(trays) {
  await writeJson(TRAYS_FILE, { trays });
}

router.get('/tray-formats', async (_req, res) => {
  const formats = await getFormats();
  res.json(formats);
});

router.post('/tray-formats', async (req, res) => {
  const payload = req.body || {};
  const name = String(payload.name || '').trim();
  const plantSiteCount = Number(payload.plantSiteCount || 0);

  if (!name || !Number.isFinite(plantSiteCount) || plantSiteCount <= 0) {
    return res.status(400).json({ error: 'Invalid tray format payload' });
  }

  const formats = await getFormats();
  const format = {
    trayFormatId: `fmt-${Date.now()}`,
    name,
    plantSiteCount,
    systemType: payload.systemType || null,
    trayMaterial: payload.trayMaterial || null,
    description: payload.description || null,
    isWeightBased: Boolean(payload.isWeightBased),
    targetWeightPerSite: payload.targetWeightPerSite ?? null,
    weightUnit: payload.weightUnit || 'heads',
    isCustom: true
  };

  formats.push(format);
  await saveFormats(formats);
  res.status(201).json(format);
});

router.put('/tray-formats/:formatId', async (req, res) => {
  const { formatId } = req.params;
  const payload = req.body || {};
  const formats = await getFormats();
  const index = formats.findIndex((f) => f.trayFormatId === formatId);

  if (index === -1) {
    return res.status(404).json({ error: 'Tray format not found' });
  }

  formats[index] = {
    ...formats[index],
    name: payload.name ?? formats[index].name,
    plantSiteCount: Number(payload.plantSiteCount ?? formats[index].plantSiteCount),
    systemType: payload.systemType ?? formats[index].systemType,
    description: payload.description ?? formats[index].description,
    isWeightBased: Boolean(payload.isWeightBased ?? formats[index].isWeightBased),
    targetWeightPerSite: payload.targetWeightPerSite ?? formats[index].targetWeightPerSite,
    weightUnit: payload.weightUnit ?? formats[index].weightUnit
  };

  await saveFormats(formats);
  res.json(formats[index]);
});

router.delete('/tray-formats/:formatId', async (req, res) => {
  const { formatId } = req.params;
  const formats = await getFormats();
  const format = formats.find((f) => f.trayFormatId === formatId);

  if (!format) {
    return res.status(404).json({ error: 'Tray format not found' });
  }

  if (!format.isCustom) {
    return res.status(400).json({ error: 'Default tray formats cannot be deleted' });
  }

  const filtered = formats.filter((f) => f.trayFormatId !== formatId);
  await saveFormats(filtered);
  res.json({ success: true });
});

router.get('/trays', async (_req, res) => {
  const trays = await getTrays();
  res.json(trays);
});

router.post('/trays/register', async (req, res) => {
  const payload = req.body || {};
  const qrCodeValue = String(payload.qrCodeValue || '').trim();
  const trayFormatId = String(payload.trayFormatId || '').trim();

  if (!qrCodeValue || !trayFormatId) {
    return res.status(400).json({ error: 'qrCodeValue and trayFormatId are required' });
  }

  const trays = await getTrays();
  if (trays.some((t) => t.qrCode === qrCodeValue)) {
    return res.status(409).json({ error: 'Tray already registered' });
  }

  const formats = await getFormats();
  const format = formats.find((f) => f.trayFormatId === trayFormatId);

  if (!format) {
    return res.status(404).json({ error: 'Tray format not found' });
  }

  const tray = {
    trayId: `tray-${Date.now()}`,
    qrCode: qrCodeValue,
    trayFormatId,
    formatName: format.name,
    plantSiteCount: Number(format.plantSiteCount || 0),
    forecastedYield: format.isWeightBased && format.targetWeightPerSite
      ? `${(Number(format.targetWeightPerSite) * Number(format.plantSiteCount || 0)).toFixed(1)} ${format.weightUnit || 'oz'}`
      : `${format.plantSiteCount} plants`,
    status: 'available',
    daysSinceSeeding: null,
    currentLocation: null,
    createdAt: new Date().toISOString()
  };

  trays.push(tray);
  await saveTrays(trays);
  res.status(201).json(tray);
});

export default router;
