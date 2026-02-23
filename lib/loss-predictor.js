/**
 * Loss Prediction from Environment Trends — Phase 3, Task 29
 *
 * Analyzes environmental deviation patterns that precede loss events
 * and generates early warnings when similar patterns are detected.
 *
 * Feedback Loop: #2 (Environment → Loss)
 * Data Sources: trayLossEventsDB + env.json + preAutomationLogger
 *
 * Approach:
 * - Learns from historical loss events + environment snapshots
 * - Computes risk score based on current env deviation patterns
 * - Generates predictive alerts before losses materialize
 *
 * Safety: Advisory only — suggests investigation, does not act (Rule 8.1)
 */

/**
 * Analyze historical loss+environment correlation to build risk profiles.
 *
 * @param {Array} lossEvents - from trayLossEventsDB: [{ crop, reason, zone, timestamp, qty, envSnapshot }]
 * @param {Array} envReadings - recent environment readings: [{ timestamp, tempC, rh, vpd }]
 * @returns {{ risk_profiles: Record<string, RiskProfile>, total_events: number }}
 */
export function buildLossRiskProfiles(lossEvents, envReadings) {
  if (!Array.isArray(lossEvents) || lossEvents.length < 5) {
    return { risk_profiles: {}, total_events: 0, status: 'insufficient_data' };
  }

  // Group loss events by reason category
  const byReason = {};
  for (const evt of lossEvents) {
    const reason = normalizeReason(evt.reason || evt.loss_reason || 'unknown');
    if (!byReason[reason]) byReason[reason] = [];
    byReason[reason].push(evt);
  }

  const profiles = {};
  for (const [reason, events] of Object.entries(byReason)) {
    if (events.length < 3) continue;

    // Extract environment conditions from snapshots around loss events
    const envConditions = events
      .filter(e => e.envSnapshot || e.env_snapshot)
      .map(e => {
        const snap = e.envSnapshot || e.env_snapshot || {};
        return {
          tempC: parseFloat(snap.tempC ?? snap.temperature_c ?? snap.temp) || null,
          rh: parseFloat(snap.rh ?? snap.humidity ?? snap.humidity_pct) || null,
          vpd: parseFloat(snap.vpd ?? snap.vpd_kpa) || null
        };
      })
      .filter(c => c.tempC != null || c.rh != null);

    if (envConditions.length < 3) continue;

    // Compute mean + stddev of env conditions during losses
    const tempVals = envConditions.filter(c => c.tempC != null).map(c => c.tempC);
    const rhVals = envConditions.filter(c => c.rh != null).map(c => c.rh);

    profiles[reason] = {
      event_count: events.length,
      env_pattern: {
        temp_mean: mean(tempVals),
        temp_std: stddev(tempVals),
        rh_mean: mean(rhVals),
        rh_std: stddev(rhVals)
      },
      last_occurrence: events.reduce((max, e) => {
        const t = e.timestamp || e.recorded_at;
        return t > max ? t : max;
      }, ''),
      crops_affected: [...new Set(events.map(e => e.crop).filter(Boolean))]
    };
  }

  return {
    risk_profiles: profiles,
    total_events: lossEvents.length,
    reasons_profiled: Object.keys(profiles).length,
    status: 'ready'
  };
}

/**
 * Predict loss risk from current environmental conditions.
 *
 * @param {object} currentEnv - { tempC, rh, vpd }
 * @param {object} riskProfiles - from buildLossRiskProfiles()
 * @returns {Array<{ reason: string, risk_score: number, message: string, severity: string }>}
 */
export function predictLossRisk(currentEnv, riskProfiles) {
  const alerts = [];
  const profiles = riskProfiles?.risk_profiles;
  if (!profiles || !currentEnv) return alerts;

  const temp = parseFloat(currentEnv.tempC ?? currentEnv.temperature_c) || null;
  const rh = parseFloat(currentEnv.rh ?? currentEnv.humidity) || null;

  for (const [reason, profile] of Object.entries(profiles)) {
    const pattern = profile.env_pattern;
    if (!pattern) continue;

    let riskScore = 0;
    const factors = [];

    // Temperature risk: how many stddevs from the loss-event mean?
    if (temp != null && pattern.temp_mean != null && pattern.temp_std > 0) {
      const zTemp = Math.abs(temp - pattern.temp_mean) / pattern.temp_std;
      // If current temp is within 1 stddev of loss-event mean → high risk
      if (zTemp < 1.0) {
        riskScore += 0.5;
        factors.push(`temp ${temp.toFixed(1)}°C near loss zone ${pattern.temp_mean.toFixed(1)}±${pattern.temp_std.toFixed(1)}°C`);
      } else if (zTemp < 2.0) {
        riskScore += 0.2;
        factors.push(`temp approaching loss zone`);
      }
    }

    // Humidity risk
    if (rh != null && pattern.rh_mean != null && pattern.rh_std > 0) {
      const zRH = Math.abs(rh - pattern.rh_mean) / pattern.rh_std;
      if (zRH < 1.0) {
        riskScore += 0.5;
        factors.push(`humidity ${rh.toFixed(0)}% near loss zone ${pattern.rh_mean.toFixed(0)}±${pattern.rh_std.toFixed(0)}%`);
      } else if (zRH < 2.0) {
        riskScore += 0.2;
        factors.push(`humidity approaching loss zone`);
      }
    }

    if (riskScore >= 0.4) {
      const severity = riskScore >= 0.8 ? 'critical' : riskScore >= 0.5 ? 'warning' : 'info';
      alerts.push({
        reason,
        risk_score: +riskScore.toFixed(2),
        severity,
        event_count: profile.event_count,
        factors,
        crops_affected: profile.crops_affected,
        message: `Loss risk (${reason}): ${(riskScore * 100).toFixed(0)}% — ${factors.join('; ')}`
      });
    }
  }

  return alerts.sort((a, b) => b.risk_score - a.risk_score);
}

// ─── Helpers ────────────────────────────────────────────────

function normalizeReason(reason) {
  const r = (reason || '').toLowerCase().trim();
  if (r.includes('mold') || r.includes('fungus') || r.includes('botrytis')) return 'mold_fungal';
  if (r.includes('wilt') || r.includes('drought') || r.includes('dry')) return 'wilting';
  if (r.includes('pest') || r.includes('aphid') || r.includes('thrip') || r.includes('insect')) return 'pest';
  if (r.includes('rot') || r.includes('pythium') || r.includes('root')) return 'root_rot';
  if (r.includes('tip') || r.includes('burn') || r.includes('nutrient')) return 'nutrient_burn';
  if (r.includes('cold') || r.includes('frost') || r.includes('freeze')) return 'cold_damage';
  if (r.includes('heat') || r.includes('scorch')) return 'heat_damage';
  return r || 'unknown';
}

function mean(arr) {
  if (!arr || arr.length === 0) return null;
  return +(arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2);
}

function stddev(arr) {
  if (!arr || arr.length < 2) return 0;
  const m = arr.reduce((s, v) => s + v, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  return +Math.sqrt(variance).toFixed(2);
}

export default { buildLossRiskProfiles, predictLossRisk };
