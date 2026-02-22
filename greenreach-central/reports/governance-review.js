/**
 * AI Governance Review Report Generator — Phase 4, Ticket 4.8
 *
 * Monthly auto-generated governance report covering:
 *  - Model accuracy trends
 *  - Agent action audit summary
 *  - Safety incidents
 *  - Data quality scores
 *  - Recommendation acceptance rates
 *
 * Data sources:
 *  - experiment_records (model accuracy)
 *  - agent audit log (agent actions, accept/dismiss)
 *  - crop benchmarks (data quality)
 *  - AI push logs (recommendation delivery)
 */

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

/**
 * Generate a monthly governance review report.
 *
 * @param {object} [options]
 * @param {number} [options.months=1] — how many months back to cover
 * @returns {object} governance report
 */
export async function generateGovernanceReport(options = {}) {
  const months = options.months || 1;
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const sinceISO = since.toISOString();

  const report = {
    title: 'AI Governance Monthly Review',
    period: {
      from: sinceISO,
      to: new Date().toISOString(),
      months
    },
    generated_at: new Date().toISOString(),
    sections: {}
  };

  // Section 1: Model Accuracy Trends
  try {
    const experimentResult = await pool.query(`
      SELECT
        crop,
        COUNT(*) AS record_count,
        AVG((outcomes->>'weight_per_plant_oz')::float) AS avg_weight,
        STDDEV((outcomes->>'weight_per_plant_oz')::float) AS weight_stddev,
        AVG((outcomes->>'quality_score')::float) AS avg_quality,
        AVG((outcomes->>'loss_rate')::float) AS avg_loss_rate,
        MIN(recorded_at) AS first_record,
        MAX(recorded_at) AS last_record
      FROM experiment_records
      WHERE recorded_at > $1
      GROUP BY crop
      ORDER BY record_count DESC
    `, [sinceISO]);

    report.sections.model_accuracy = {
      status: experimentResult.rows.length > 0 ? 'data_available' : 'insufficient_data',
      crops: experimentResult.rows.map(r => ({
        crop: r.crop,
        records: parseInt(r.record_count),
        avg_weight_oz: r.avg_weight ? parseFloat(r.avg_weight).toFixed(2) : null,
        weight_consistency: r.weight_stddev ? 
          (parseFloat(r.weight_stddev) / (parseFloat(r.avg_weight) || 1) * 100).toFixed(1) + '% CV' : 'N/A',
        avg_quality: r.avg_quality ? parseFloat(r.avg_quality).toFixed(2) : null,
        avg_loss_rate: r.avg_loss_rate ? (parseFloat(r.avg_loss_rate) * 100).toFixed(1) + '%' : null
      })),
      total_records: experimentResult.rows.reduce((s, r) => s + parseInt(r.record_count), 0),
      note: 'CV < 15% indicates consistent model predictions. Loss rate < 10% is target.'
    };
  } catch (error) {
    report.sections.model_accuracy = { status: 'error', error: error.message };
  }

  // Section 2: Agent Action Audit
  try {
    // Query the farms table and check if any have audit data pushed
    const farmCount = await pool.query('SELECT COUNT(*) AS cnt FROM farms');
    report.sections.agent_actions = {
      status: 'summary',
      note: 'Detailed agent audit data resides on edge servers (agentAuditDB). Central receives push summaries.',
      network_farms: parseInt(farmCount.rows[0]?.cnt || 0),
      review_items: [
        'Review per-farm agent audit logs for action breakdown',
        'Check permission denials across all agent classes',
        'Verify require-approval actions have human sign-off records',
        'Sample 10% of auto-approved actions for quality assurance'
      ]
    };
  } catch (error) {
    report.sections.agent_actions = { status: 'error', error: error.message };
  }

  // Section 3: Safety Incidents
  report.sections.safety_incidents = {
    status: 'review_required',
    checklist: [
      { item: 'Equipment damage from AI-directed actions', result: 'pending_review' },
      { item: 'Crop loss attributed to recipe modifier errors', result: 'pending_review' },
      { item: 'Incorrect wholesale pricing from dynamic pricing', result: 'pending_review' },
      { item: 'Autonomous action executed without proper authorization', result: 'pending_review' },
      { item: 'Data integrity issues in experiment records', result: 'pending_review' }
    ],
    note: 'Each item requires manual review against farm incident logs. Mark pass/fail/na.'
  };

  // Section 4: Data Quality Scores
  try {
    const benchmarks = await pool.query('SELECT * FROM crop_benchmarks ORDER BY crop');
    const staleThreshold = new Date();
    staleThreshold.setDate(staleThreshold.getDate() - 7);

    const qualityChecks = benchmarks.rows.map(b => ({
      crop: b.crop,
      record_count: parseInt(b.record_count || 0),
      has_sufficient_data: parseInt(b.record_count || 0) >= 10,
      last_updated: b.updated_at || b.computed_at,
      is_stale: b.updated_at ? new Date(b.updated_at) < staleThreshold : true
    }));

    report.sections.data_quality = {
      status: 'assessed',
      crops_with_sufficient_data: qualityChecks.filter(c => c.has_sufficient_data).length,
      crops_with_stale_data: qualityChecks.filter(c => c.is_stale).length,
      total_crops: qualityChecks.length,
      details: qualityChecks,
      score: qualityChecks.length > 0
        ? Math.round(qualityChecks.filter(c => c.has_sufficient_data && !c.is_stale).length / qualityChecks.length * 100)
        : 0
    };
  } catch (error) {
    // Tables may not exist yet
    report.sections.data_quality = {
      status: 'no_data',
      note: 'Crop benchmarks table not yet populated. Run nightly benchmark computation first.',
      score: 0
    };
  }

  // Section 5: Recommendation Acceptance Rates
  try {
    // Check network recipe modifier adoption
    const modifierResult = await pool.query(`
      SELECT crop, COUNT(*) AS modifier_count
      FROM network_recipe_modifiers
      GROUP BY crop
    `);

    report.sections.acceptance_rates = {
      status: 'summary',
      network_modifiers_published: modifierResult.rows.length,
      crops_with_modifiers: modifierResult.rows.map(r => r.crop),
      note: 'Per-farm acceptance rates tracked in edge alert-history.json and agentAuditDB.',
      review_items: [
        'Pull alert dismiss rates from each farm (/api/alerts/stats)',
        'Pull recipe modifier acceptance from each farm (/api/recipe-modifiers)',
        'Target: > 90% acceptance rate before enabling autonomous mode',
        'Review any crops with < 70% acceptance — may need parameter tuning'
      ]
    };
  } catch (error) {
    report.sections.acceptance_rates = {
      status: 'no_data',
      note: 'Network modifier table not yet populated.'
    };
  }

  // Section 6: Autonomy Gate Assessment
  report.sections.autonomy_gates = {
    gates: [
      {
        name: 'Model Accuracy > 85%',
        status: 'pending',
        note: 'Requires holdout test evaluation per crop. Check /api/ml/metrics on each farm.'
      },
      {
        name: 'Grower Acceptance Rate > 90%',
        status: 'pending',
        note: 'Measured from agent audit DB accept/dismiss ratio across all farms.'
      },
      {
        name: 'Zero Safety Incidents (last 100 cycles)',
        status: 'pending',
        note: 'Requires manual safety incident review above.'
      },
      {
        name: 'Minimum Data Volume Met',
        status: report.sections.model_accuracy?.total_records > 50 ? 'met' : 'not_met',
        current: report.sections.model_accuracy?.total_records || 0,
        threshold: 50
      },
      {
        name: 'Monthly Governance Review Completed',
        status: 'in_progress',
        note: 'This report constitutes the review. Requires sign-off.'
      }
    ],
    overall: 'not_ready',
    note: 'All gates must be "met" before Phase 5 autonomous operations can activate.'
  };

  return report;
}

/**
 * Format report as plain text (for email or log).
 */
export function formatReportText(report) {
  let text = `\n${'='.repeat(60)}\n`;
  text += `  ${report.title}\n`;
  text += `  Period: ${report.period.from.slice(0, 10)} — ${report.period.to.slice(0, 10)}\n`;
  text += `  Generated: ${report.generated_at}\n`;
  text += `${'='.repeat(60)}\n\n`;

  for (const [name, section] of Object.entries(report.sections)) {
    text += `── ${name.replace(/_/g, ' ').toUpperCase()} ──\n`;
    text += `Status: ${section.status || 'n/a'}\n`;

    if (section.note) text += `Note: ${section.note}\n`;
    if (section.score !== undefined) text += `Score: ${section.score}%\n`;
    if (section.total_records) text += `Total Records: ${section.total_records}\n`;

    if (section.review_items) {
      section.review_items.forEach((item, i) =>
        text += `  ${i + 1}. ${typeof item === 'string' ? item : item.item + ': ' + item.result}\n`
      );
    }
    if (section.checklist) {
      section.checklist.forEach((item, i) =>
        text += `  ${i + 1}. [${item.result}] ${item.item}\n`
      );
    }
    if (section.gates) {
      section.gates.forEach(g =>
        text += `  ${g.status === 'met' ? '✓' : '○'} ${g.name}: ${g.status}${g.current !== undefined ? ` (${g.current}/${g.threshold})` : ''}\n`
      );
    }

    text += '\n';
  }

  return text;
}

export default {
  generateGovernanceReport,
  formatReportText
};
