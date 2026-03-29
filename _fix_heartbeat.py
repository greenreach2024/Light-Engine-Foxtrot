#!/usr/bin/env python3
"""Fix heartbeat pipeline: query + sync write + alert text."""
import re, sys

# ── Fix 1: faye-intelligence.js ──
path1 = 'greenreach-central/services/faye-intelligence.js'
with open(path1, 'r') as f:
    lines = f.readlines()

# Find the checkFarmHeartbeats function and replace the query + alert text
content = ''.join(lines)

# Use a regex to replace the query inside checkFarmHeartbeats
old_query = re.escape("""    const stale = await query(`
      SELECT farm_id, farm_name,
             EXTRACT(EPOCH FROM (NOW() - COALESCE(last_seen_at, "timestamp"))) / 60 AS minutes_stale
      FROM farm_heartbeats
      WHERE COALESCE(last_seen_at, "timestamp") < NOW() - INTERVAL '30 minutes'
    `);""")

new_query = """    // Check both data sources: farms.last_heartbeat (updated by sync-service)
    // and farm_heartbeats.last_seen_at (updated by farms.js registration).
    const stale = await query(`
      SELECT f.farm_id, COALESCE(f.name, f.farm_id) AS farm_name,
             EXTRACT(EPOCH FROM (NOW() - GREATEST(
               f.last_heartbeat,
               (SELECT MAX(COALESCE(h.last_seen_at, h.timestamp)) FROM farm_heartbeats h WHERE h.farm_id = f.farm_id)
             ))) / 60 AS minutes_stale
      FROM farms f
      WHERE f.status != 'inactive'
        AND GREATEST(
              f.last_heartbeat,
              (SELECT MAX(COALESCE(h.last_seen_at, h.timestamp)) FROM farm_heartbeats h WHERE h.farm_id = f.farm_id)
            ) < NOW() - INTERVAL '30 minutes'
    `);"""

if re.search(old_query, content):
    content = re.sub(old_query, new_query, content, count=1)
    print("[OK] Fix 1a: Heartbeat query now checks farms.last_heartbeat + farm_heartbeats")
else:
    print("ERROR: Could not find heartbeat query in faye-intelligence.js")
    sys.exit(1)

# Fix alert text: remove "hardware" reference
old_alert_text = 'No heartbeat for ${mins} minutes. Farm may be experiencing connectivity or hardware issues.'
new_alert_text = 'No heartbeat for ${mins} minutes. Farm may be experiencing connectivity issues.'
if old_alert_text in content:
    content = content.replace(old_alert_text, new_alert_text, 1)
    print("[OK] Fix 1b: Removed 'hardware' from alert text (cloud-only architecture)")
else:
    print("WARN: Alert text already updated or not found")

with open(path1, 'w') as f:
    f.write(content)

# ── Fix 2: sync.js ──
path2 = 'greenreach-central/routes/sync.js'
with open(path2, 'r') as f:
    content = f.read()

old_sync = """      logger.info(`[Sync] Farm ${farmId} upserted successfully with status ${dbStatus}`);
    }
    
    res.json({ 
      success: true,
      message: 'Heartbeat received',
      farmId,
      timestamp: new Date().toISOString()
    });"""

new_sync = """      logger.info(`[Sync] Farm ${farmId} upserted successfully with status ${dbStatus}`);

      // Also update farm_heartbeats so F.A.Y.E. intelligence monitoring stays current
      try {
        await query(
          `INSERT INTO farm_heartbeats (farm_id, farm_name, cpu_percent, memory_percent, disk_percent, metadata, last_seen_at, timestamp)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
          [
            farmId,
            farmName,
            stats?.cpu || null,
            stats?.memory || null,
            stats?.disk || null,
            JSON.stringify(metadata || {})
          ]
        );
      } catch (hbErr) {
        logger.warn(`[Sync] farm_heartbeats insert failed (non-fatal): ${hbErr.message}`);
      }
    }
    
    res.json({ 
      success: true,
      message: 'Heartbeat received',
      farmId,
      timestamp: new Date().toISOString()
    });"""

if old_sync in content:
    content = content.replace(old_sync, new_sync, 1)
    print("[OK] Fix 2: sync.js heartbeat now also writes to farm_heartbeats")
else:
    print("ERROR: Could not find sync.js anchor")
    sys.exit(1)

with open(path2, 'w') as f:
    f.write(content)

print("\n=== All heartbeat fixes applied ===")
