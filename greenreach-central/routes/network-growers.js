/**
 * Network & Grower Management Routes
 * Backend for GR-central-admin.html network management sections
 *
 * Endpoints:
 *   GET /api/network/dashboard            - Network overview dashboard
 *   GET /api/network/farms/list           - List network farms
 *   GET /api/network/farms/:farmId        - Single farm detail
 *   GET /api/network/comparative-analytics - Cross-farm analytics
 *   GET /api/network/trends               - Network trend data
 *   GET /api/network/buyer-behavior       - Buyer behavior and churn analytics
 *   GET /api/network/alerts               - Network alerts
 *   GET /api/growers/dashboard            - Grower management dashboard
 *   GET /api/growers/list                 - List all growers
 *   GET /api/farms/list                   - Alias for farm listing
 *   GET /api/contracts/list               - Contract listing
 *   GET /api/leaderboard                  - Farm leaderboard
 *   GET /api/performance/:growerId        - Grower performance
 *   GET /api/invitations/list             - Pending invitations
 */
import { Router } from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = Router();

// ─── Network Dashboard ────────────────────────────────────
router.get('/network/dashboard', async (req, res) => {
  try {
    let farmCount = 0, activeFarms = 0;
    if (await isDatabaseAvailable()) {
      const result = await query('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = \'active\') as active FROM farms');
      farmCount = parseInt(result.rows[0].total);
      activeFarms = parseInt(result.rows[0].active);
    }
    res.json({
      success: true,
      dashboard: {
        totalFarms: farmCount,
        activeFarms,
        offlineFarms: farmCount - activeFarms,
        networkHealth: activeFarms > 0 ? 'healthy' : 'no_farms',
        totalProductionCapacity: 0,
        alerts: [],
        recentActivity: [],
      }
    });
  } catch (error) {
    console.error('[Network] Dashboard error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Network Farms List ────────────────────────────────────
router.get('/network/farms/list', async (req, res) => {
  try {
    let farms = [];
    if (await isDatabaseAvailable()) {
      const result = await query(
        `SELECT farm_id, name, status, email, api_url, last_heartbeat, metadata, created_at
         FROM farms ORDER BY name`
      );
      farms = result.rows.map(f => ({
        farmId: f.farm_id,
        name: f.name,
        status: f.status,
        email: f.email,
        apiUrl: f.api_url,
        lastHeartbeat: f.last_heartbeat,
        metadata: f.metadata || {},
        createdAt: f.created_at,
      }));
    }
    res.json({ success: true, farms, total: farms.length });
  } catch (error) {
    console.error('[Network] Farm list error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Network Farm Detail ───────────────────────────────────
router.get('/network/farms/:farmId', async (req, res) => {
  try {
    const { farmId } = req.params;
    if (await isDatabaseAvailable()) {
      const result = await query(
        'SELECT farm_id, name, status, email, api_url, last_heartbeat, metadata, settings, created_at FROM farms WHERE farm_id = $1',
        [farmId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Farm not found' });
      }
      const f = result.rows[0];
      // Also fetch farm_data summary
      const dataResult = await query(
        "SELECT data_type, octet_length(data::text) as size_bytes FROM farm_data WHERE farm_id = $1",
        [farmId]
      );
      return res.json({
        success: true,
        farm: {
          farmId: f.farm_id, name: f.name, status: f.status, email: f.email,
          apiUrl: f.api_url, lastHeartbeat: f.last_heartbeat,
          metadata: f.metadata, settings: f.settings, createdAt: f.created_at,
          dataSets: dataResult.rows.map(d => ({ type: d.data_type, sizeBytes: parseInt(d.size_bytes) })),
        }
      });
    }
    res.status(404).json({ success: false, error: 'Database not available' });
  } catch (error) {
    console.error('[Network] Farm detail error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Comparative Analytics (Phase 1 Task 1.11) ───────────────────
router.get('/network/comparative-analytics', async (req, res) => {
  try {
    const period = req.query.period || '30d';
    if (!(await isDatabaseAvailable())) {
      return res.json({ success: true, analytics: { farms: [], metrics: ['yield', 'loss_rate', 'grow_days'], period, data: [] } });
    }

    // Aggregate per-farm yield performance from experiment_records
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - parseInt(period));

    const result = await query(`
      SELECT
        er.farm_id,
        f.name AS farm_name,
        COUNT(*) AS harvest_count,
        AVG((er.outcomes->>'weight_per_plant_oz')::DECIMAL) AS avg_yield,
        AVG((er.outcomes->>'loss_rate')::DECIMAL) AS avg_loss_rate,
        AVG(er.grow_days) AS avg_grow_days
      FROM experiment_records er
      LEFT JOIN farms f ON f.farm_id = er.farm_id
      WHERE er.recorded_at >= $1
      GROUP BY er.farm_id, f.name
      ORDER BY avg_yield DESC NULLS LAST
    `, [sinceDate.toISOString()]);

    // Crop benchmarks for comparison baseline
    const benchResult = await query('SELECT * FROM crop_benchmarks ORDER BY harvest_count DESC');

    res.json({
      success: true,
      analytics: {
        farms: result.rows.map(r => r.farm_id),
        metrics: ['yield', 'loss_rate', 'grow_days'],
        period,
        data: result.rows.map(r => ({
          farm_id: r.farm_id,
          farm_name: r.farm_name || r.farm_id,
          harvest_count: parseInt(r.harvest_count),
          avg_yield_oz: r.avg_yield ? parseFloat(r.avg_yield).toFixed(3) : null,
          avg_loss_rate: r.avg_loss_rate ? parseFloat(r.avg_loss_rate).toFixed(3) : null,
          avg_grow_days: r.avg_grow_days ? parseFloat(r.avg_grow_days).toFixed(1) : null,
        })),
        crop_benchmarks: benchResult.rows.map(b => ({
          crop: b.crop,
          network_avg_yield_oz: parseFloat(b.avg_weight_per_plant_oz) || 0,
          network_avg_loss_rate: parseFloat(b.avg_loss_rate) || 0,
          network_avg_grow_days: parseFloat(b.avg_grow_days) || 0,
          farm_count: parseInt(b.farm_count),
        })),
      }
    });
  } catch (error) {
    console.error('[Network] Comparative analytics error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Network Trends (Phase 1 Task 1.11) ──────────────────────
router.get('/network/trends', async (req, res) => {
  try {
    const period = req.query.period || '90d';
    if (!(await isDatabaseAvailable())) {
      return res.json({ success: true, trends: { period, networkGrowth: [], productionTrend: [], demandTrend: [], yieldTrend: [] } });
    }

    const sinceDays = parseInt(period);
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - sinceDays);

    // Network growth: new farms joining over time
    const growthResult = await query(`
      SELECT DATE_TRUNC('week', created_at) AS week, COUNT(*) AS new_farms
      FROM farms
      WHERE created_at >= $1
      GROUP BY week ORDER BY week
    `, [sinceDate.toISOString()]);

    // Production trend: harvest records per week
    const prodResult = await query(`
      SELECT DATE_TRUNC('week', recorded_at) AS week,
             COUNT(*) AS harvests,
             AVG((outcomes->>'weight_per_plant_oz')::DECIMAL) AS avg_yield
      FROM experiment_records
      WHERE recorded_at >= $1
      GROUP BY week ORDER BY week
    `, [sinceDate.toISOString()]);

    // Demand trend: wholesale order demand per week
    let demandResult = { rows: [] };
    try {
      demandResult = await query(`
        SELECT
          DATE_TRUNC('week', created_at) AS week,
          COUNT(*) AS orders,
          COALESCE(SUM(
            (
              SELECT SUM(
                CASE
                  WHEN (item->>'quantity') ~ '^[0-9]+(\\.[0-9]+)?$' THEN (item->>'quantity')::DECIMAL
                  WHEN (item->>'qty') ~ '^[0-9]+(\\.[0-9]+)?$' THEN (item->>'qty')::DECIMAL
                  ELSE 0
                END
              )
              FROM jsonb_array_elements(COALESCE(order_data->'cart', '[]'::jsonb)) item
            )
          ), 0) AS total_units
        FROM wholesale_orders
        WHERE created_at >= $1
        GROUP BY week
        ORDER BY week
      `, [sinceDate.toISOString()]);
    } catch (demandError) {
      console.warn('[Network] Demand trend unavailable:', demandError.message);
    }

    const productionTrend = prodResult.rows.map(r => ({
      week: r.week,
      harvests: parseInt(r.harvests),
      avg_yield_oz: r.avg_yield ? parseFloat(r.avg_yield).toFixed(3) : null
    }));

    res.json({
      success: true,
      trends: {
        period,
        networkGrowth: growthResult.rows.map(r => ({
          week: r.week, new_farms: parseInt(r.new_farms)
        })),
        productionTrend,
        demandTrend: demandResult.rows.map(r => ({
          week: r.week,
          orders: parseInt(r.orders),
          total_units: parseFloat(r.total_units || 0)
        })),
        yieldTrend: productionTrend.map(r => ({
          week: r.week,
          avg_yield_oz: r.avg_yield_oz
        })),
      }
    });
  } catch (error) {
    console.error('[Network] Trends error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Buyer Behavior & Churn (Phase 2 Task 2.12) ───────────
router.get('/network/buyer-behavior', async (req, res) => {
  try {
    const period = req.query.period || '90d';
    if (!(await isDatabaseAvailable())) {
      return res.json({
        success: true,
        behavior: {
          period,
          summary: { active_buyers: 0, at_risk_buyers: 0, churned_buyers: 0, repeat_rate: 0 },
          buyers: []
        }
      });
    }

    const sinceDays = parseInt(period);
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - sinceDays);

    const buyerStats = await query(`
      WITH buyer_orders AS (
        SELECT
          COALESCE(NULLIF(buyer_email, ''), NULLIF(order_data->'buyer_account'->>'email', ''), buyer_id) AS buyer_key,
          MAX(created_at) AS last_order_at,
          MIN(created_at) AS first_order_at,
          COUNT(*) AS total_orders,
          COUNT(*) FILTER (WHERE created_at >= $1) AS period_orders,
          COALESCE(SUM(
            (
              SELECT SUM(
                CASE
                  WHEN (item->>'quantity') ~ '^[0-9]+(\\.[0-9]+)?$' THEN (item->>'quantity')::DECIMAL
                  WHEN (item->>'qty') ~ '^[0-9]+(\\.[0-9]+)?$' THEN (item->>'qty')::DECIMAL
                  ELSE 0
                END
              )
              FROM jsonb_array_elements(COALESCE(order_data->'cart', '[]'::jsonb)) item
            )
          ), 0) AS lifetime_units
        FROM wholesale_orders
        GROUP BY buyer_key
      )
      SELECT
        buyer_key,
        first_order_at,
        last_order_at,
        total_orders,
        period_orders,
        lifetime_units,
        CASE
          WHEN last_order_at < NOW() - INTERVAL '60 days' THEN 'churned'
          WHEN last_order_at < NOW() - INTERVAL '30 days' THEN 'at_risk'
          ELSE 'active'
        END AS churn_status
      FROM buyer_orders
      WHERE buyer_key IS NOT NULL
      ORDER BY last_order_at DESC
      LIMIT 500
    `, [sinceDate.toISOString()]);

    const buyers = buyerStats.rows.map(row => ({
      buyer: row.buyer_key,
      first_order_at: row.first_order_at,
      last_order_at: row.last_order_at,
      total_orders: parseInt(row.total_orders),
      period_orders: parseInt(row.period_orders),
      lifetime_units: parseFloat(row.lifetime_units || 0),
      churn_status: row.churn_status
    }));

    const total = buyers.length || 1;
    const active = buyers.filter(b => b.churn_status === 'active').length;
    const atRisk = buyers.filter(b => b.churn_status === 'at_risk').length;
    const churned = buyers.filter(b => b.churn_status === 'churned').length;
    const repeat = buyers.filter(b => b.total_orders > 1).length;

    res.json({
      success: true,
      behavior: {
        period,
        summary: {
          active_buyers: active,
          at_risk_buyers: atRisk,
          churned_buyers: churned,
          repeat_rate: parseFloat(((repeat / total) * 100).toFixed(1))
        },
        buyers
      }
    });
  } catch (error) {
    console.error('[Network] Buyer behavior error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Network Alerts (Phase 1 Task 1.11) ──────────────────────
router.get('/network/alerts', async (req, res) => {
  try {
    if (!(await isDatabaseAvailable())) {
      return res.json({ success: true, alerts: [], total: 0 });
    }

    const alerts = [];

    // Alert: farms with high loss rates (>15%) in recent harvests
    const lossResult = await query(`
      SELECT er.farm_id, f.name AS farm_name, er.crop,
             (er.outcomes->>'loss_rate')::DECIMAL AS loss_rate,
             er.recorded_at
      FROM experiment_records er
      LEFT JOIN farms f ON f.farm_id = er.farm_id
      WHERE er.recorded_at >= NOW() - INTERVAL '30 days'
        AND (er.outcomes->>'loss_rate')::DECIMAL > 0.15
      ORDER BY loss_rate DESC
      LIMIT 10
    `);

    for (const row of lossResult.rows) {
      alerts.push({
        type: 'high_loss_rate',
        severity: parseFloat(row.loss_rate) > 0.25 ? 'critical' : 'warning',
        farm_id: row.farm_id,
        farm_name: row.farm_name || row.farm_id,
        crop: row.crop,
        value: parseFloat(row.loss_rate).toFixed(3),
        message: `${row.farm_name || row.farm_id}: ${row.crop} loss rate ${(parseFloat(row.loss_rate) * 100).toFixed(1)}%`,
        recorded_at: row.recorded_at
      });
    }

    // Alert: farms with below-benchmark yields
    const benchmarks = await query('SELECT crop, avg_weight_per_plant_oz FROM crop_benchmarks');
    const benchMap = {};
    for (const b of benchmarks.rows) benchMap[b.crop] = parseFloat(b.avg_weight_per_plant_oz);

    if (Object.keys(benchMap).length > 0) {
      const yieldResult = await query(`
        SELECT er.farm_id, f.name AS farm_name, er.crop,
               (er.outcomes->>'weight_per_plant_oz')::DECIMAL AS yield_oz,
               er.recorded_at
        FROM experiment_records er
        LEFT JOIN farms f ON f.farm_id = er.farm_id
        WHERE er.recorded_at >= NOW() - INTERVAL '30 days'
          AND er.outcomes->>'weight_per_plant_oz' IS NOT NULL
        ORDER BY er.recorded_at DESC
        LIMIT 50
      `);

      for (const row of yieldResult.rows) {
        const benchmark = benchMap[row.crop];
        if (benchmark && parseFloat(row.yield_oz) < benchmark * 0.7) {
          alerts.push({
            type: 'below_benchmark',
            severity: 'info',
            farm_id: row.farm_id,
            farm_name: row.farm_name || row.farm_id,
            crop: row.crop,
            value: parseFloat(row.yield_oz).toFixed(3),
            benchmark: benchmark.toFixed(3),
            message: `${row.farm_name || row.farm_id}: ${row.crop} yield ${parseFloat(row.yield_oz).toFixed(2)} oz vs network avg ${benchmark.toFixed(2)} oz`,
            recorded_at: row.recorded_at
          });
        }
      }
    }

    res.json({ success: true, alerts, total: alerts.length });
  } catch (error) {
    console.error('[Network] Alerts error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Grower Dashboard ──────────────────────────────────────
router.get('/growers/dashboard', async (req, res) => {
  try {
    let growerCount = 0;
    if (await isDatabaseAvailable()) {
      const result = await query("SELECT COUNT(*) as cnt FROM farms WHERE status = 'active'");
      growerCount = parseInt(result.rows[0].cnt);
    }
    res.json({
      success: true,
      dashboard: {
        totalGrowers: growerCount,
        activeGrowers: growerCount,
        pendingApplications: 0,
        averageRating: 0,
        topPerformers: [],
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Grower List ───────────────────────────────────────────
router.get('/growers/list', async (req, res) => {
  try {
    let growers = [];
    if (await isDatabaseAvailable()) {
      const result = await query(
        "SELECT farm_id, name, status, email, created_at FROM farms WHERE status = 'active' ORDER BY name"
      );
      growers = result.rows.map(f => ({
        id: f.farm_id, name: f.name, status: f.status,
        email: f.email, joinedAt: f.created_at, rating: 0, totalOrders: 0,
      }));
    }
    res.json({ success: true, growers, total: growers.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Farms List (alias) ───────────────────────────────────
router.get('/farms/list', async (req, res) => {
  // Redirect to network farms list handler
  try {
    let farms = [];
    if (await isDatabaseAvailable()) {
      const result = await query('SELECT farm_id, name, status, email, api_url, created_at FROM farms ORDER BY name');
      farms = result.rows.map(f => ({
        farmId: f.farm_id, name: f.name, status: f.status,
        email: f.email, apiUrl: f.api_url, createdAt: f.created_at,
      }));
    }
    res.json({ success: true, farms, total: farms.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Contracts ─────────────────────────────────────────────
router.get('/contracts/list', (req, res) => {
  res.json({ success: true, contracts: [], total: 0, message: 'Contract management not yet enabled' });
});

// ─── Leaderboard (Phase 1 Task 1.12) ─────────────────────────
router.get('/leaderboard', async (req, res) => {
  try {
    let entries = [];
    if (await isDatabaseAvailable()) {
      // Score = weighted composite: yield efficiency (40%), low loss rate (30%), consistency (30%)
      const result = await query(`
        WITH farm_stats AS (
          SELECT
            er.farm_id,
            f.name,
            COUNT(*) AS harvest_count,
            AVG((er.outcomes->>'weight_per_plant_oz')::DECIMAL) AS avg_yield,
            AVG((er.outcomes->>'loss_rate')::DECIMAL) AS avg_loss_rate,
            STDDEV((er.outcomes->>'weight_per_plant_oz')::DECIMAL) AS yield_stddev
          FROM experiment_records er
          LEFT JOIN farms f ON f.farm_id = er.farm_id
          WHERE f.status = 'active'
          GROUP BY er.farm_id, f.name
          HAVING COUNT(*) >= 1
        )
        SELECT
          farm_id, name, harvest_count,
          COALESCE(avg_yield, 0) AS avg_yield,
          COALESCE(avg_loss_rate, 0) AS avg_loss_rate,
          COALESCE(yield_stddev, 0) AS yield_stddev,
          -- Composite score (0-100)
          LEAST(100, GREATEST(0,
            COALESCE(avg_yield * 10, 0) * 0.4 +                          -- yield component
            (1.0 - LEAST(1.0, COALESCE(avg_loss_rate, 0.5))) * 100 * 0.3 + -- loss component (lower = better)
            (1.0 - LEAST(1.0, COALESCE(yield_stddev, 1.0))) * 100 * 0.3    -- consistency component
          )) AS score
        FROM farm_stats
        ORDER BY score DESC
        LIMIT 20
      `);

      entries = result.rows.map((f, i) => ({
        rank: i + 1,
        farmId: f.farm_id,
        name: f.name || f.farm_id,
        score: Math.round(parseFloat(f.score)),
        harvest_count: parseInt(f.harvest_count),
        avg_yield_oz: f.avg_yield ? parseFloat(f.avg_yield).toFixed(3) : null,
        avg_loss_rate: f.avg_loss_rate ? parseFloat(f.avg_loss_rate).toFixed(3) : null,
      }));

      // If no experiment records yet, fall back to basic farm listing
      if (entries.length === 0) {
        const fallback = await query(
          "SELECT farm_id, name FROM farms WHERE status = 'active' ORDER BY name LIMIT 20"
        );
        entries = fallback.rows.map((f, i) => ({
          rank: i + 1, farmId: f.farm_id, name: f.name, score: 0,
        }));
      }
    }
    res.json({ success: true, leaderboard: entries });
  } catch (error) {
    console.error('[Network] Leaderboard error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Performance (Phase 1 Task 1.12) ───────────────────────
router.get('/performance/:growerId', async (req, res) => {
  try {
    const { growerId } = req.params;

    if (!(await isDatabaseAvailable())) {
      return res.json({
        success: true, growerId,
        performance: { overallRating: 0, metrics: { yield: 0, quality: 0, reliability: 0, sustainability: 0 }, recentHarvests: [], trends: [] }
      });
    }

    // Per-grower aggregate metrics
    const statsResult = await query(`
      SELECT
        COUNT(*) AS harvest_count,
        AVG((outcomes->>'weight_per_plant_oz')::DECIMAL) AS avg_yield,
        AVG((outcomes->>'loss_rate')::DECIMAL) AS avg_loss_rate,
        AVG(grow_days) AS avg_grow_days,
        STDDEV((outcomes->>'weight_per_plant_oz')::DECIMAL) AS yield_stddev,
        MIN(recorded_at) AS first_harvest,
        MAX(recorded_at) AS last_harvest
      FROM experiment_records
      WHERE farm_id = $1
    `, [growerId]);

    const stats = statsResult.rows[0] || {};
    const avgYield = stats.avg_yield ? parseFloat(stats.avg_yield) : 0;
    const avgLoss = stats.avg_loss_rate ? parseFloat(stats.avg_loss_rate) : 0;
    const stddev = stats.yield_stddev ? parseFloat(stats.yield_stddev) : 0;

    // Compute sub-scores (0-100)
    const yieldScore = Math.min(100, avgYield * 10);
    const qualityScore = Math.min(100, (1 - Math.min(1, avgLoss)) * 100);
    const reliabilityScore = Math.min(100, (1 - Math.min(1, stddev)) * 100);
    const sustainabilityScore = Math.min(100, (stats.harvest_count > 0 ? 50 : 0) + (avgLoss < 0.1 ? 50 : avgLoss < 0.2 ? 25 : 0));
    const overallRating = Math.round((yieldScore * 0.3 + qualityScore * 0.3 + reliabilityScore * 0.2 + sustainabilityScore * 0.2));

    // Recent harvests
    const recentResult = await query(`
      SELECT crop, recipe_id, grow_days, outcomes, recorded_at
      FROM experiment_records
      WHERE farm_id = $1
      ORDER BY recorded_at DESC LIMIT 10
    `, [growerId]);

    // Yield trend (weekly)
    const trendResult = await query(`
      SELECT DATE_TRUNC('week', recorded_at) AS week,
             AVG((outcomes->>'weight_per_plant_oz')::DECIMAL) AS avg_yield,
             COUNT(*) AS count
      FROM experiment_records
      WHERE farm_id = $1 AND recorded_at >= NOW() - INTERVAL '90 days'
      GROUP BY week ORDER BY week
    `, [growerId]);

    res.json({
      success: true,
      growerId,
      performance: {
        overallRating,
        harvest_count: parseInt(stats.harvest_count) || 0,
        avg_yield_oz: avgYield.toFixed(3),
        avg_loss_rate: avgLoss.toFixed(3),
        avg_grow_days: stats.avg_grow_days ? parseFloat(stats.avg_grow_days).toFixed(1) : null,
        first_harvest: stats.first_harvest,
        last_harvest: stats.last_harvest,
        metrics: {
          yield: Math.round(yieldScore),
          quality: Math.round(qualityScore),
          reliability: Math.round(reliabilityScore),
          sustainability: Math.round(sustainabilityScore)
        },
        recentHarvests: recentResult.rows.map(r => ({
          crop: r.crop,
          recipe_id: r.recipe_id,
          grow_days: r.grow_days,
          yield_oz: r.outcomes?.weight_per_plant_oz || null,
          loss_rate: r.outcomes?.loss_rate || null,
          recorded_at: r.recorded_at
        })),
        trends: trendResult.rows.map(r => ({
          week: r.week,
          avg_yield_oz: r.avg_yield ? parseFloat(r.avg_yield).toFixed(3) : null,
          count: parseInt(r.count)
        }))
      }
    });
  } catch (error) {
    console.error('[Network] Performance error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Invitations ───────────────────────────────────────────
router.get('/invitations/list', (req, res) => {
  res.json({ success: true, invitations: [], total: 0 });
});

export default router;
