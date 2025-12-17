import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tariffs = require('../data/tariffs.json');

const MINUTES_PER_DAY = 1440;

function toMinutes(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return (hours * 60 + minutes) % MINUTES_PER_DAY;
}

function clampRateName(name) {
  return typeof name === 'string' ? name : 'offPeak';
}

export class UtilityRateAdapter {
  constructor(options = {}) {
    const key = options.tariffKey || 'default';
    this.tariff = tariffs.tariffs[key] || tariffs.tariffs.default;
    this.blocks = tariffs.timeBlocks;
    this.currency = this.tariff?.currency || 'CAD';
  }

  rateForLabel(label) {
    const rates = this.tariff?.rates || {};
    const name = clampRateName(label);
    return Number.isFinite(rates[name]) ? rates[name] : rates.offPeak;
  }

  /**
   * Resolve the energy rate for the provided Date instance.
   * Supports weekday/weekend switching with simple time blocks.
   * @param {Date} date
   * @returns {{ rate: number, label: string, currency: string }}
   */
  getRateForDate(date = new Date()) {
    const day = date.getDay(); // 0 = Sunday
    const isWeekend = day === 0 || day === 6;
    const blocks = isWeekend ? this.blocks.weekend : this.blocks.weekday;
    const minutes = date.getHours() * 60 + date.getMinutes();

    for (const block of blocks) {
      const start = toMinutes(block.start);
      const end = toMinutes(block.end);
      if (start == null || end == null) continue;
      if (end < start) {
        if (minutes >= start || minutes <= end) {
          const label = clampRateName(block.rate);
          return { rate: this.rateForLabel(label), label, currency: this.currency };
        }
      } else if (minutes >= start && minutes <= end) {
        const label = clampRateName(block.rate);
        return { rate: this.rateForLabel(label), label, currency: this.currency };
      }
    }

    const fallbackLabel = clampRateName(blocks?.[0]?.rate || 'offPeak');
    return { rate: this.rateForLabel(fallbackLabel), label: fallbackLabel, currency: this.currency };
  }

  getRateByLabel(label) {
    const normalized = clampRateName(label);
    return { rate: this.rateForLabel(normalized), label: normalized, currency: this.currency };
  }
}

export default UtilityRateAdapter;
