/**
 * Tray Tracking Dashboard Enhancements
 * Add to public/views/tray-inventory.html to enable:
 * - Advanced filters (crop type, location, date range)
 * - Batch harvest recording
 * - Yield analytics per tray
 * - Photo history timeline
 */

// ===== ADVANCED FILTERS =====
const filters = {
  cropType: 'all',
  location: 'all',
  dateFrom: null,
  dateTo: null,
  status: 'all'
};

function applyFilters() {
  const filtered = allTrays.filter(tray => {
    // Crop type filter
    if (filters.cropType !== 'all' && tray.cropType !== filters.cropType) {
      return false;
    }

    // Location filter
    if (filters.location !== 'all' && tray.location !== filters.location) {
      return false;
    }

    // Date range filter
    if (filters.dateFrom && new Date(tray.plantDate) < new Date(filters.dateFrom)) {
      return false;
    }
    if (filters.dateTo && new Date(tray.plantDate) > new Date(filters.dateTo)) {
      return false;
    }

    // Status filter
    if (filters.status !== 'all' && tray.status !== filters.status) {
      return false;
    }

    return true;
  });

  renderTrays(filtered);
  updateFilterStats(filtered);
}

function updateFilterStats(trays) {
  document.getElementById('filteredCount').textContent = trays.length;
  document.getElementById('totalCount').textContent = allTrays.length;
}

// ===== BATCH HARVEST RECORDING =====
let batchHarvestMode = false;
let batchSelectedTrays = [];

function toggleBatchHarvestMode() {
  batchHarvestMode = !batchHarvestMode;
  batchSelectedTrays = [];
  
  const btn = document.getElementById('batchHarvestBtn');
  if (batchHarvestMode) {
    btn.classList.add('active');
    btn.textContent = '✓ Batch Mode Active (0)';
    showBatchControls();
  } else {
    btn.classList.remove('active');
    btn.textContent = '📦 Batch Harvest';
    hideBatchControls();
  }
  
  renderTrays(allTrays);
}

function toggleTraySelection(trayRunId) {
  if (!batchHarvestMode) return;
  
  const index = batchSelectedTrays.indexOf(trayRunId);
  if (index > -1) {
    batchSelectedTrays.splice(index, 1);
  } else {
    batchSelectedTrays.push(trayRunId);
  }
  
  document.getElementById('batchHarvestBtn').textContent = 
    `✓ Batch Mode Active (${batchSelectedTrays.length})`;
  
  updateBatchSelection();
}

function updateBatchSelection() {
  document.querySelectorAll('.tray-card').forEach(card => {
    const trayRunId = card.dataset.trayRunId;
    if (batchSelectedTrays.includes(trayRunId)) {
      card.classList.add('selected');
    } else {
      card.classList.remove('selected');
    }
  });
}

async function performBatchHarvest() {
  if (batchSelectedTrays.length === 0) {
    alert('No trays selected');
    return;
  }

  const weight = prompt(`Enter total weight for ${batchSelectedTrays.length} trays (kg):`);
  if (!weight) return;

  const weightPerTray = parseFloat(weight) / batchSelectedTrays.length;

  try {
    const results = [];
    for (const trayRunId of batchSelectedTrays) {
      const response = await fetch(`/api/tray-runs/${trayRunId}/harvest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actualWeight: weightPerTray,
          harvestedAt: new Date().toISOString(),
          note: `Batch harvest ${batchSelectedTrays.length} trays`
        })
      });

      if (response.ok) {
        const data = await response.json();
        results.push(data);
      } else {
        throw new Error(`Failed to harvest tray ${trayRunId}`);
      }
    }

    alert(`✅ Successfully harvested ${results.length} trays!`);
    toggleBatchHarvestMode();
    loadDashboardData();

  } catch (error) {
    alert(`❌ Error: ${error.message}`);
  }
}

// ===== YIELD ANALYTICS =====
async function loadYieldAnalytics() {
  try {
    const response = await fetch('/api/analytics/yield-by-tray');
    const data = await response.json();

    displayYieldChart(data);
    displayYieldTable(data);

  } catch (error) {
    console.error('Yield analytics error:', error);
  }
}

function displayYieldChart(data) {
  const chartContainer = document.getElementById('yieldChart');
  if (!chartContainer) return;

  // Simple bar chart with CSS
  const maxYield = Math.max(...data.map(d => d.avgYield));

  chartContainer.innerHTML = data.map(item => {
    const percentage = (item.avgYield / maxYield) * 100;
    return `
      <div class="chart-bar">
        <div class="chart-label">${item.cropName}</div>
        <div class="chart-bar-container">
          <div class="chart-bar-fill" style="width: ${percentage}%">
            ${item.avgYield.toFixed(2)} kg
          </div>
        </div>
        <div class="chart-count">${item.trayCount} trays</div>
      </div>
    `;
  }).join('');
}

function displayYieldTable(data) {
  const tableBody = document.getElementById('yieldTableBody');
  if (!tableBody) return;

  tableBody.innerHTML = data.map(item => `
    <tr>
      <td>${item.cropName}</td>
      <td>${item.trayCount}</td>
      <td>${item.totalYield.toFixed(2)} kg</td>
      <td>${item.avgYield.toFixed(2)} kg</td>
      <td>${item.minYield.toFixed(2)} kg</td>
      <td>${item.maxYield.toFixed(2)} kg</td>
      <td>${((item.avgYield / item.expectedYield) * 100).toFixed(1)}%</td>
    </tr>
  `).join('');
}

// ===== PHOTO HISTORY TIMELINE =====
async function loadPhotoTimeline(trayRunId) {
  try {
    const response = await fetch(`/api/tray-runs/${trayRunId}/photos`);
    const photos = await response.json();

    displayPhotoTimeline(photos);

  } catch (error) {
    console.error('Photo timeline error:', error);
  }
}

function displayPhotoTimeline(photos) {
  const timeline = document.getElementById('photoTimeline');
  if (!timeline) return;

  timeline.innerHTML = photos.map(photo => {
    const date = new Date(photo.createdAt);
    const daysAgo = Math.floor((new Date() - date) / (1000 * 60 * 60 * 24));

    return `
      <div class="timeline-item">
        <div class="timeline-marker"></div>
        <div class="timeline-content">
          <div class="timeline-date">
            ${date.toLocaleDateString()} (${daysAgo} days ago)
          </div>
          <img src="${photo.imageUrl}" alt="Tray photo" class="timeline-photo">
          ${photo.aiAnalysis ? `
            <div class="timeline-analysis">
              <strong>AI Analysis:</strong>
              <div>${photo.aiAnalysis.healthStatus}</div>
              ${photo.aiAnalysis.issues ? `<div class="analysis-issues">${photo.aiAnalysis.issues}</div>` : ''}
            </div>
          ` : ''}
          ${photo.note ? `<div class="timeline-note">${photo.note}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ===== EXPORT FUNCTIONS =====
function exportFilteredData() {
  const filtered = applyCurrentFilters();
  const csv = convertToCSV(filtered);
  downloadCSV(csv, `tray-inventory-${new Date().toISOString()}.csv`);
}

function convertToCSV(data) {
  const headers = ['Tray Code', 'Crop', 'Plant Date', 'Expected Harvest', 'Location', 'Status', 'Yield (kg)'];
  const rows = data.map(tray => [
    tray.code,
    tray.cropName,
    tray.plantDate,
    tray.expectedHarvestDate,
    tray.location,
    tray.status,
    tray.actualWeight || 'N/A'
  ]);

  return [headers, ...rows].map(row => row.join(',')).join('\n');
}

function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

// ===== ENHANCED API ENDPOINT =====
// Add this to backend/inventory_routes.py

/*
@router.get("/api/analytics/yield-by-tray")
def get_yield_analytics(db: Session = Depends(get_db)):
    """Get yield analytics aggregated by crop type"""
    
    results = db.query(
        TrayRun.recipe_id,
        func.count(TrayRun.tray_run_id).label('tray_count'),
        func.sum(TrayRun.actual_weight).label('total_yield'),
        func.avg(TrayRun.actual_weight).label('avg_yield'),
        func.min(TrayRun.actual_weight).label('min_yield'),
        func.max(TrayRun.actual_weight).label('max_yield')
    ).filter(
        TrayRun.status == 'HARVESTED',
        TrayRun.actual_weight.isnot(None)
    ).group_by(
        TrayRun.recipe_id
    ).all()
    
    analytics = []
    for result in results:
        # Get recipe name from plan store
        recipe = plan_store.get(result.recipe_id)
        crop_name = recipe.get('name', 'Unknown') if recipe else 'Unknown'
        
        analytics.append({
            'recipeId': result.recipe_id,
            'cropName': crop_name,
            'trayCount': result.tray_count,
            'totalYield': float(result.total_yield),
            'avgYield': float(result.avg_yield),
            'minYield': float(result.min_yield),
            'maxYield': float(result.max_yield),
            'expectedYield': 2.0  # TODO: Get from recipe
        })
    
    return analytics

@router.get("/api/tray-runs/{tray_run_id}/photos")
def get_tray_photos(tray_run_id: str, db: Session = Depends(get_db)):
    """Get photo history for a tray run"""
    
    # Query photos from quality_control_photos table
    photos = db.query(QualityControlPhoto).filter(
        QualityControlPhoto.tray_code == tray_run_id
    ).order_by(
        QualityControlPhoto.created_at.desc()
    ).all()
    
    return [{
        'id': str(photo.id),
        'imageUrl': photo.image_url,
        'createdAt': photo.created_at.isoformat(),
        'note': photo.note,
        'aiAnalysis': photo.ai_analysis
    } for photo in photos]
*/
