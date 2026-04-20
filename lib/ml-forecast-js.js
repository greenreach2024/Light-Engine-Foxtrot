/**
 * JavaScript-based environmental forecaster (SARIMAX alternative)
 * Phase 4 #25: ML pipeline reactivation
 *
 * Uses exponential smoothing with seasonal decomposition for
 * temperature/humidity forecasting without Python/statsmodels.
 *
 * Approach: Holt-Winters triple exponential smoothing with 24-point
 * seasonality (24 hours at 1-hour intervals).
 */

const SEASON_LENGTH = 24; // hourly seasonality
const DEFAULT_ALPHA = 0.3; // level smoothing
const DEFAULT_BETA = 0.1;  // trend smoothing
const DEFAULT_GAMMA = 0.2; // seasonal smoothing

/**
 * Holt-Winters triple exponential smoothing forecast.
 * @param {number[]} series - historical values (at least 2 * SEASON_LENGTH)
 * @param {number} horizon - number of steps to forecast
 * @param {object} params - { alpha, beta, gamma, seasonLength }
 * @returns {{ forecast: number[], confidence: {lower: number[], upper: number[]}, residualStd: number }}
 */
export function holtWintersForecast(series, horizon = 4, params = {}) {
  const alpha = params.alpha || DEFAULT_ALPHA;
  const beta = params.beta || DEFAULT_BETA;
  const gamma = params.gamma || DEFAULT_GAMMA;
  const m = params.seasonLength || SEASON_LENGTH;

  if (series.length < m * 2) {
    // Fallback to simple moving average
    return simpleMovingAverage(series, horizon);
  }

  // Initialize seasonal indices from first two seasons
  const seasonalInit = [];
  for (let i = 0; i < m; i++) {
    const s1 = series[i];
    const s2 = series[m + i];
    seasonalInit.push((s1 + s2) / 2);
  }
  const avgSeason = seasonalInit.reduce((a, b) => a + b, 0) / m;
  const seasonal = seasonalInit.map(s => s - avgSeason);

  // Initialize level and trend
  let level = series.slice(0, m).reduce((a, b) => a + b, 0) / m;
  let trend = 0;
  for (let i = 0; i < m; i++) {
    trend += (series[m + i] - series[i]);
  }
  trend /= (m * m);

  // Fit model and collect residuals
  const fitted = [];
  const residuals = [];
  for (let t = 0; t < series.length; t++) {
    const seasonIdx = t % m;
    const fittedVal = level + trend + seasonal[seasonIdx];
    fitted.push(fittedVal);
    residuals.push(series[t] - fittedVal);

    const prevLevel = level;
    level = alpha * (series[t] - seasonal[seasonIdx]) + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    seasonal[seasonIdx] = gamma * (series[t] - level) + (1 - gamma) * seasonal[seasonIdx];
  }

  // Forecast
  const forecast = [];
  for (let h = 1; h <= horizon; h++) {
    const seasonIdx = (series.length + h - 1) % m;
    forecast.push(Math.round((level + h * trend + seasonal[seasonIdx]) * 100) / 100);
  }

  // Confidence intervals from residual standard deviation
  const residualStd = stddev(residuals);
  const lower = forecast.map((f, i) => Math.round((f - 1.96 * residualStd * Math.sqrt(i + 1)) * 100) / 100);
  const upper = forecast.map((f, i) => Math.round((f + 1.96 * residualStd * Math.sqrt(i + 1)) * 100) / 100);

  return {
    forecast,
    confidence: { lower, upper, level: 0.95 },
    residualStd: Math.round(residualStd * 1000) / 1000,
    method: 'holt_winters',
    params: { alpha, beta, gamma, seasonLength: m }
  };
}

function simpleMovingAverage(series, horizon) {
  const windowSize = Math.min(series.length, 12);
  const recent = series.slice(-windowSize);
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const sd = stddev(recent);
  const forecast = Array(horizon).fill(Math.round(avg * 100) / 100);
  return {
    forecast,
    confidence: {
      lower: forecast.map((f, i) => Math.round((f - 1.96 * sd * Math.sqrt(i + 1)) * 100) / 100),
      upper: forecast.map((f, i) => Math.round((f + 1.96 * sd * Math.sqrt(i + 1)) * 100) / 100),
      level: 0.95
    },
    residualStd: Math.round(sd * 1000) / 1000,
    method: 'simple_moving_average',
    params: { windowSize }
  };
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = arr.reduce((s, v) => s + v, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

/**
 * Forecast environmental metrics for a zone.
 * @param {number[]} tempHistory - hourly temperature readings
 * @param {number[]} humHistory - hourly humidity readings
 * @param {number} horizon - hours to forecast (default 4)
 * @returns {{ temperature: object, humidity: object, generatedAt: string }}
 */
export function forecastZone(tempHistory, humHistory, horizon = 4) {
  return {
    temperature: holtWintersForecast(tempHistory, horizon),
    humidity: holtWintersForecast(humHistory, horizon),
    horizon,
    generatedAt: new Date().toISOString(),
    engine: 'js-holt-winters'
  };
}

export default { holtWintersForecast, forecastZone };
