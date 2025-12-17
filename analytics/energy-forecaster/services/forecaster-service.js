import express from 'express';
import { buildFixtureIndex, forecastDailyEnergy, forecastGroupEnergy } from '../calculators/energy-calculator.js';
import { UtilityRateAdapter } from '../adapters/utility-rate-adapter.js';

/**
 * Lightweight Express router exposing REST endpoints for the energy forecaster.
 * Intended to be mounted under /api/energy on server-foxtrot.js.
 */
export class EnergyForecasterService {
  constructor(options = {}) {
    this.router = express.Router();
    this.fixtures = options.fixturesById || buildFixtureIndex();
    this.utilityAdapter = new UtilityRateAdapter(options.utility || {});
    this.bindRoutes();
  }

  bindRoutes() {
    this.router.get('/fixtures', (req, res) => {
      res.json({ fixtures: Object.values(this.fixtures) });
    });

    this.router.post('/forecast/fixture', express.json(), (req, res) => {
      try {
        const body = req.body || {};
        const fixture = this.resolveFixture(body.fixtureId || body.fixture);
        const result = forecastDailyEnergy({
          recipe: body.recipe || {},
          fixture,
          photoperiodHours: body.photoperiodHours,
          rateLabel: body.rateLabel,
          utilityOptions: { tariffKey: body.tariffKey, rateLabel: body.rateLabel }
        });
        res.json({ success: true, data: result });
      } catch (error) {
        res.status(400).json({ success: false, error: error.message });
      }
    });

    this.router.post('/forecast/group', express.json(), (req, res) => {
      try {
        const body = req.body || {};
        const group = body.group || {};
        const fixturesById = { ...this.fixtures, ...(body.fixturesById || {}) };
        const result = forecastGroupEnergy(group, { fixturesById, utilityOptions: { tariffKey: body.tariffKey, rateLabel: body.rateLabel } });
        res.json({ success: true, data: result });
      } catch (error) {
        res.status(400).json({ success: false, error: error.message });
      }
    });
  }

  resolveFixture(idOrFixture) {
    if (!idOrFixture) {
      throw new Error('fixture is required');
    }
    if (typeof idOrFixture === 'object') return idOrFixture;
    const fixture = this.fixtures[idOrFixture];
    if (!fixture) {
      throw new Error(`fixture ${idOrFixture} not found`);
    }
    return fixture;
  }

  mount(app, basePath = '/api/energy') {
    app.use(basePath, this.router);
  }
}

export default function createEnergyForecasterService(options) {
  return new EnergyForecasterService(options);
}
