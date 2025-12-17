#!/bin/bash
# Quick Fix Script for Mobile App Critical Issues

echo "=========================================="
echo "Light Engine Mobile App - Quick Fix"
echo "=========================================="
echo ""

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Fix 1: Update forecast metric name in API service
echo "Fix 1: Updating forecast metric parameter..."
sed -i.bak "s/metric = 'temperature'/metric = 'indoor_temp'/g" /Users/petergilbert/Light-Engine-Delta/mobile-app/src/services/api.js
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} Updated getForecast() default metric to 'indoor_temp'"
else
    echo -e "${RED}✗${NC} Failed to update api.js"
fi

# Fix 2: Add error handling to EnvironmentScreen
echo ""
echo "Fix 2: Improving error handling in EnvironmentScreen..."
cat > /tmp/environment-fix.js << 'EOF'
  const loadEnvironmentData = async () => {
    try {
      setError('');
      const [envResponse, anomalyResponse] = await Promise.all([
        api.getEnvironmentData(selectedRoom, timeRange),
        api.getAnomalies().catch(err => {
          console.warn('Anomaly detection unavailable:', err.message);
          return { anomalies: [], error: err.message };
        }),
      ]);
      setEnvData(envResponse);
      setAnomalies(anomalyResponse.anomalies || []);
    } catch (err) {
      console.error('Environment load error:', err);
      setError('Failed to load environmental data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };
EOF

echo -e "${YELLOW}ℹ${NC} Error handling pattern prepared (manual merge required)"
echo "   File: /tmp/environment-fix.js"

# Fix 3: Create placeholder FastAPI routes
echo ""
echo "Fix 3: Creating FastAPI route placeholders..."
cat > /tmp/fastapi-routes-fix.py << 'EOF'
# Add these routes to main.py

@app.get("/api/inventory/summary")
async def get_inventory_summary(db: Session = Depends(get_db)):
    """Get inventory summary statistics."""
    # Count active trays
    active_trays = db.query(Tray).filter(Tray.status == 'active').count()
    
    # Count total plants (sum of plant_count from active tray_runs)
    total_plants = db.query(func.sum(TrayRun.plant_count)).filter(
        TrayRun.status.in_(['placed', 'growing'])
    ).scalar() or 0
    
    # Count farms
    farms = db.query(func.count(func.distinct(Tray.farm_id))).scalar() or 1
    
    return {
        "active_trays": active_trays,
        "total_plants": int(total_plants),
        "farms": farms,
    }


@app.get("/api/inventory/harvest-forecast")
async def get_harvest_forecast(db: Session = Depends(get_db)):
    """Get harvest forecast buckets."""
    today = date.today()
    
    # Query trays by expected harvest date
    today_count = db.query(TrayRun).filter(
        TrayRun.expected_harvest_date == today,
        TrayRun.status == 'placed'
    ).count()
    
    this_week_count = db.query(TrayRun).filter(
        TrayRun.expected_harvest_date.between(today, today + timedelta(days=7)),
        TrayRun.status == 'placed'
    ).count()
    
    next_week_count = db.query(TrayRun).filter(
        TrayRun.expected_harvest_date.between(today + timedelta(days=8), today + timedelta(days=14)),
        TrayRun.status == 'placed'
    ).count()
    
    later_count = db.query(TrayRun).filter(
        TrayRun.expected_harvest_date > today + timedelta(days=14),
        TrayRun.status == 'placed'
    ).count()
    
    return {
        "today": today_count,
        "this_week": this_week_count,
        "next_week": next_week_count,
        "later": later_count,
    }
EOF

echo -e "${YELLOW}ℹ${NC} FastAPI routes prepared (manual merge required)"
echo "   File: /tmp/fastapi-routes-fix.py"

# Fix 4: Add notification endpoint placeholders
echo ""
echo "Fix 4: Creating notification endpoint placeholders..."
cat > /tmp/notification-routes-fix.js << 'EOF'
// Add these routes to server-charlie.js

// Get notifications for authenticated user
app.get('/api/notifications', (req, res) => {
  // TODO: Implement with database
  res.status(501).json({
    ok: false,
    error: 'Not Implemented',
    message: 'Notification backend coming soon',
    notifications: [], // Mock empty array
  });
});

// Mark notification as read
app.post('/api/notifications/:id/read', (req, res) => {
  // TODO: Implement with database
  res.status(501).json({
    ok: false,
    error: 'Not Implemented',
    message: 'Notification backend coming soon',
  });
});

// Mark all notifications as read
app.post('/api/notifications/read-all', (req, res) => {
  // TODO: Implement with database
  res.status(501).json({
    ok: false,
    error: 'Not Implemented',
    message: 'Notification backend coming soon',
  });
});
EOF

echo -e "${YELLOW}ℹ${NC} Notification routes prepared (manual merge required)"
echo "   File: /tmp/notification-routes-fix.js"

echo ""
echo "=========================================="
echo "Summary"
echo "=========================================="
echo -e "${GREEN}✓${NC} Fix 1: Updated forecast metric name"
echo -e "${YELLOW}ℹ${NC} Fix 2-4: Code templates ready for manual merge"
echo ""
echo "Next steps:"
echo "1. Review and merge /tmp/environment-fix.js into EnvironmentScreen.js"
echo "2. Review and merge /tmp/fastapi-routes-fix.py into main.py"
echo "3. Review and merge /tmp/notification-routes-fix.js into server-charlie.js"
echo "4. Restart servers and re-run tests"
echo ""
echo "Or run: /Users/petergilbert/Light-Engine-Delta/mobile-app/test-endpoints.sh"
