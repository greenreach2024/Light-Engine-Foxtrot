/**
 * Admin AI Monitoring API
 * GreenReach Central admin endpoints for monitoring AI agent activity and usage
 * 
 * Endpoints:
 *   GET /api/admin/ai/monitoring - Get AI monitoring dashboard data
 *   GET /api/admin/ai/activity   - Get recent AI activity log
 */

import express from 'express';
import { getAIPusherRuntimeStatus } from '../services/ai-recommendations-pusher.js';
import { isGeminiConfigured } from '../lib/gemini-client.js';

const router = express.Router();

// In-memory activity log
const aiActivityLog = [];
const MAX_ACTIVITY_LOG = 500;

/**
 * Log an AI activity event (called internally by other services)
 */
export function logAiActivity(event) {
  aiActivityLog.unshift({
    timestamp: new Date().toISOString(),
    ...event
  });
  if (aiActivityLog.length > MAX_ACTIVITY_LOG) {
    aiActivityLog.length = MAX_ACTIVITY_LOG;
  }
}

/**
 * GET /monitoring - AI monitoring dashboard data
 */
router.get('/monitoring', async (req, res) => {
  try {
    const hasGemini = isGeminiConfigured();
    const pusher = getAIPusherRuntimeStatus();
    
    // Count farms with URLs (those that receive recommendations)
    let farmsCovered = 0;
    try {
      const { listNetworkFarms } = await import('../services/networkFarmsStore.js');
      const allFarms = await listNetworkFarms();
      farmsCovered = allFarms.filter(f => f.status === 'active' && f.api_url).length;
    } catch {
      farmsCovered = 0;
    }
    
    // Count AI rules
    let rulesCount = 0;
    try {
      const { query: dbQuery } = await import('../config/database.js');
      const result = await dbQuery('SELECT COUNT(*) as count FROM ai_rules WHERE active = true');
      rulesCount = parseInt(result.rows[0]?.count || 0);
    } catch {
      rulesCount = 0;
    }
    
    // Calculate stats from activity log
    const now = new Date();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    
    const recent24h = aiActivityLog.filter(a => new Date(a.timestamp) >= oneDayAgo);
    const recent30d = aiActivityLog.filter(a => new Date(a.timestamp) >= thirtyDaysAgo);
    
    const recs24h = recent24h.filter(a => a.type === 'recommendation').length;
    const chatSessions = aiActivityLog.filter(a => a.type === 'chat').length;
    const totalPushes = aiActivityLog.filter(a => a.type === 'recommendation').length;
    const successPushes = aiActivityLog.filter(a => a.type === 'recommendation' && a.status === 'success').length;
    const failedPushes = aiActivityLog.filter(a => a.type === 'recommendation' && a.status === 'error').length;
    
    // Estimate API cost (rough: ~$0.03 per GPT-4 call with typical input)
    const apiCalls30d = recent30d.filter(a => a.type === 'recommendation' || a.type === 'chat').length;
    const estimatedCost = apiCalls30d * 0.03;
    
    const pusherStatus = pusher?.last_run_status || 'idle';
    const pusherEnabled = Boolean(pusher?.enabled && hasGemini);
    const disabledReason = hasGemini
      ? (pusher?.last_error || null)
      : 'Gemini credentials missing';

    res.json({
      success: true,
      pusher_status: pusherEnabled ? 'active' : (hasGemini ? pusherStatus : 'disabled'),
      gemini_configured: hasGemini,
      model: pusher?.model || 'google/gemini-2.5-flash',
      push_interval: `${pusher?.push_interval_minutes || 30} minutes`,
      disabled_reason: disabledReason,
      runtime_status: pusherStatus,
      recommendations_24h: recs24h,
      chat_sessions_total: chatSessions,
      api_cost_30d: estimatedCost,
      farms_covered: farmsCovered,
      rules_count: rulesCount,
      total_pushes: Math.max(totalPushes, Number(pusher?.totals?.runs || 0)),
      success_pushes: Math.max(successPushes, Number(pusher?.totals?.pushed_farms || 0)),
      failed_pushes: Math.max(failedPushes, Number(pusher?.totals?.failed_runs || 0)),
      avg_recs_per_farm: farmsCovered > 0 ? totalPushes / farmsCovered : 0,
      last_run: pusher?.last_run_completed_at || aiActivityLog.find(a => a.type === 'recommendation')?.timestamp || null,
      next_run: pusher?.next_run_at || null,
      activity: aiActivityLog.slice(0, 50), // Last 50 events
      message: hasGemini
        ? null
        : 'AI recommendations are disabled -- Gemini not configured. Core dashboard and manual workflows remain available.'
    });
  } catch (error) {
    console.error('[Admin AI Monitoring] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load AI monitoring data',
      message: error.message
    });
  }
});

/**
 * GET /activity - Full AI activity log
 */
router.get('/activity', (req, res) => {
  const { type, limit = 100, offset = 0 } = req.query;
  
  let filtered = aiActivityLog;
  if (type && type !== 'all') {
    filtered = filtered.filter(a => a.type === type);
  }
  
  const page = filtered.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
  
  res.json({
    success: true,
    total: filtered.length,
    activity: page
  });
});

export default router;
