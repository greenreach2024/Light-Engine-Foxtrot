# Light Engine File Consolidation Analysis

**Generated**: $(date)

## Strategy
- **Edge (public/)** = Source of truth (more complete, tested in production)
- **Cloud (greenreach-central/public/)** = Check for unique improvements before archiving

---

## 1. Schema Validation (Pre-Analysis)

Running schema validation...
```

> light-engine-foxtrot@1.0.0 validate-schemas
> node scripts/validate-all-schemas.js

[34m
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[0m
[1m  Data Format Schema Validation[0m
[34m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[0m

[34m●[0m Validating [1m/Users/petergilbert/Light-Engine-Foxtrot/public/data/groups.json[0m...
  [31m✗[0m Validation failed:
    [31m→[0m /groups/0/id: must match pattern "^[^:]+:[^:]+:.+$"
    [31m→[0m /groups/1/id: must match pattern "^[^:]+:[^:]+:.+$"
    [31m→[0m /groups/2/id: must match pattern "^[^:]+:[^:]+:.+$"
    [31m→[0m /groups/3/id: must match pattern "^[^:]+:[^:]+:.+$"
    [31m→[0m /groups/4/id: must match pattern "^[^:]+:[^:]+:.+$"
    [31m→[0m /groups/5/id: must match pattern "^[^:]+:[^:]+:.+$"
    [31m→[0m /groups/6/id: must match pattern "^[^:]+:[^:]+:.+$"
    [31m→[0m /groups/7/id: must match pattern "^[^:]+:[^:]+:.+$"

[34m●[0m Validating [1m/Users/petergilbert/Light-Engine-Foxtrot/public/data/farm.json[0m...
  [32m✓[0m Valid farm format

[34m●[0m Validating [1m/Users/petergilbert/Light-Engine-Foxtrot/public/data/rooms.json[0m...
  [32m✓[0m Valid rooms format
  [33m⚠[0m Warning: No schemaVersion field
[34m
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[0m
[1m  Validation Summary[0m
[34m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[0m
  [32m✓[0m Valid:   2
  [31m✗[0m Invalid: 1
  [31m✗[0m Errors:  0
  [33m⚠[0m Skipped: 0
[31m
✗ Schema validation failed
[0m
See DATA_FORMAT_STANDARDS.md for canonical formats
Schema validation not configured
```

---

## 2. Identical Files (Safe to Use Edge Version)

✓ `LE-admin-legacy.html` - identical
✓ `LE-ai-agent-test.html` - identical
✓ `LE-billing.html` - identical
✓ `LE-create-test-farm.html` - identical
✓ `LE-downloads.html` - identical
✓ `LE-migration-wizard.html` - identical
✓ `LE-notification-settings.html` - identical
✓ `LE-notifications.html` - identical
✓ `LE-offline.html` - identical
✓ `LE-qr-generator.html` - identical
✓ `LE-switchbot.html` - identical
✓ `LE-vpd.html` - identical
✓ `LE-wholesale-orders.html` - identical
✓ `LE-wholesale-review.html` - identical
✓ `fan-rotation-monitor.html` - identical
✓ `farm-summary.html` - identical
✓ `field-mapping.html` - identical
✓ `iot-manager.html` - identical
✓ `tray-inventory-old-backup.html` - identical

**Total identical files**: 19

## 3. Files That Differ (⚠️ NEED MANUAL REVIEW)

### 📝 `LE-dashboard.html`

**Edge size**:     3009 lines
**Cloud size**:     2949 lines

**Key differences**:
```diff
--- greenreach-central/public/LE-dashboard.html	2026-01-22 16:12:09
+++ public/LE-dashboard.html	2026-01-24 18:43:18
@@ -109,6 +109,65 @@
 .wizard-test-area {background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:1.5rem;margin:1.5rem 0;}
 .wizard-test-area h4 {margin:0 0 1rem 0;}
   </style>
+  
+  <!-- Inline Diagnostic Script - runs immediately to show what's happening -->
+  <script>
+    (function() {
+      const log = [];
+      const updateDiagnostic = (msg) => {
+        log.push(msg);
+        const el = document.getElementById('diagnosticStatus');
+        if (el) el.innerHTML = log.join('<br>');
+      };
+      
+      log.push('[' + new Date().toLocaleTimeString() + '] Page loaded');
+      
+      document.addEventListener('DOMContentLoaded', async () => {
+        updateDiagnostic('[' + new Date().toLocaleTimeString() + '] DOMContentLoaded fired');
+        
+        const iotList = document.getElementById('iotDevicesList');
+        updateDiagnostic('iotDevicesList element: ' + (iotList ? 'FOUND' : 'NOT FOUND'));
+        
+        try {
+          updateDiagnostic('Fetching /data/iot-devices.json...');
+          const resp = await fetch('/data/iot-devices.json');
+          updateDiagnostic('Response status: ' + resp.status);
+          
+          if (resp.ok) {
+            const devices = await resp.json();
+            const deviceArray = Array.isArray(devices) ? devices : (devices.devices || []);
+            updateDiagnostic('✓ Loaded ' + deviceArray.length + ' devices');
+            updateDiagnostic('Device IDs: ' + deviceArray.map(d => d.id || d.deviceId).join(', '));
+            
+            // Set STATE and LAST_IOT_SCAN, then call render
+            window.LAST_IOT_SCAN = deviceArray;
+            if (!window.STATE) window.STATE = {};
+            window.STATE.iotDevices = deviceArray;
+            
+            setTimeout(() => {
+              updateDiagnostic('renderIoTDeviceCards: ' + (typeof window.renderIoTDeviceCards));
+              updateDiagnostic('STATE.iotDevices length: ' + (window.STATE?.iotDevices?.length || 'STATE not set'));
+              updateDiagnostic('LAST_IOT_SCAN length: ' + (window.LAST_IOT_SCAN?.length || 'not set'));
+              
+              // Actually call the render function
+              if (typeof window.renderIoTDeviceCards === 'function') {
+                updateDiagnostic('Calling renderIoTDeviceCards with ' + deviceArray.length + ' devices...');
+                window.renderIoTDeviceCards(deviceArray);
+                updateDiagnostic('Render complete');
+              } else {
+                updateDiagnostic('ERROR: renderIoTDeviceCards not found!');
+              }
+            }, 2000);
+          } else {
+            updateDiagnostic('✗ Fetch failed: ' + resp.status);
+          }
+        } catch (e) {
+          updateDiagnostic('✗ Error: ' + e.message);
+        }
+      });
+    })();
+  </script>
+  
   <script src="/app.foxtrot.js?v={{BUILD_TIME}}" defer></script>
   <!-- Groups V2 module: handles plan dropdown, anchor toggle, and schedule UI -->
   <script src="/groups-v2.js?v={{BUILD_TIME}}" defer></script>
@@ -163,7 +222,7 @@
           Equipment Overview
         </button>
 
-        <a class="sidebar-link" href="./views/room-mapper.html" target="_blank" rel="noopener" role="menuitem" data-room-mapper-link>
+        <a class="sidebar-link" href="./views/room-mapper.html" role="menuitem" data-room-mapper-link>
           Room Mapper
         </a>
       </div>
@@ -190,7 +249,7 @@
         <span class="sidebar-group__icon" aria-hidden="true"></span>
       </button>
       <div class="sidebar-group__items" role="menu" hidden>
-        <a class="sidebar-link" href="/downloads.html" target="_blank" rel="noopener" role="menuitem">
+        <a class="sidebar-link" href="/downloads.html" role="menuitem">
           Desktop App Downloads
         </a>
       </div>
@@ -240,7 +299,6 @@
                     <!-- Farm Summary Button -->
                     <a 
                       href="/views/farm-summary.html" 
-                      target="_blank" 
                       rel="noopener"
                       class="btn btn--primary" 
                       style="margin-top: 0.75rem; margin-right: 0.5rem; font-size: 0.875rem; padding: 0.5rem 1rem; text-decoration: none; display: inline-block;"
@@ -251,7 +309,6 @@
                     <!-- Farm Admin Button -->
                     <a 
                       href="/login.html" 
-                      target="_blank" 
                       rel="noopener"
```

---

### 📝 `LE-farm-admin.html`

**Edge size**:     4701 lines
**Cloud size**:     4675 lines

**Key differences**:
```diff
--- greenreach-central/public/LE-farm-admin.html	2026-02-03 20:21:23
+++ public/LE-farm-admin.html	2026-01-24 11:37:31
@@ -946,11 +946,15 @@
                         <span class="nav-item-icon">⚙</span>
                         Dashboard Setup
                     </a>
-                    <a href="/views/farm-summary.html" class="nav-item" target="_blank">
+                    <a href="/views/tray-inventory.html" class="nav-item" target="_blank">
+                        <span class="nav-item-icon">📱</span>
+                        Activity Hub
+                    </a>
+                    <a href="/views/farm-summary.html" class="nav-item">
                         <span class="nav-item-icon">■</span>
                         Farm Summary
                     </a>
-                    <a href="/views/farm-inventory.html" class="nav-item" target="_blank">
+                    <a href="/views/farm-inventory.html" class="nav-item">
                         <span class="nav-item-icon">■</span>
                         Inventory
                     </a>
@@ -1093,7 +1097,7 @@
                 <div class="card">
                     <h2>Quick Actions</h2>
                     <div class="quick-actions">
-                        <a href="/views/farm-summary.html" class="action-card" target="_blank">
+                        <a href="/views/farm-summary.html" class="action-card">
                             <div class="action-icon">FS</div>
                             <div class="action-title">View Farm</div>
                             <div class="action-desc">Monitor zones, groups & growth</div>
@@ -2907,6 +2911,28 @@
                                     <span>Enable wholesale orders</span>
                                 </label>
                                 <p style="color: var(--text-muted); font-size: 11px; margin: 0;">Opt-out to disable wholesale orders from GreenReach Central. All other services (monitoring, updates, support) remain active.</p>
+                            </div>
+                            
+                            <!-- Device Pairing for Activity Hub Tablets -->
+                            <div>
+                                <h3 style="font-size: 14px; font-weight: 600; margin-bottom: 10px;">Tablet Device Pairing</h3>
+                                <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 15px;">
+                                    Generate a QR code to pair tablets with this farm's Activity Hub. Each tablet must scan this code for secure access.
+                                </p>
+                                <button class="btn-primary" onclick="generatePairingQR()" style="width: 100%; margin-bottom: 15px;">
+                                    Generate Pairing QR Code
+                                </button>
+                                <div id="pairingQRContainer" style="display: none; background: white; padding: 20px; border-radius: 8px; text-align: center;">
+                                    <h4 style="color: #1a2332; margin-bottom: 10px;">Scan with Tablet</h4>
+                                    <div id="pairingQRCode" style="display: inline-block;"></div>
+                                    <p style="color: #6b7280; font-size: 0.85rem; margin-top: 10px;">
+                                        Farm: <strong id="pairingFarmName" style="color: #1a2332;"></strong><br>
+                                        Token expires in 24 hours
+                                    </p>
+                                    <button class="btn-secondary" onclick="closePairingQR()" style="margin-top: 15px; background: #e5e7eb; color: #1a2332;">
+                                        Close
+                                    </button>
+                                </div>
                             </div>
                         </div>
                     </div>
```

---

### 📝 `LE-setup-wizard-legacy.html`

**Edge size**:     1092 lines
**Cloud size**:     1066 lines

**Key differences**:
```diff
--- greenreach-central/public/LE-setup-wizard-legacy.html	2026-02-03 20:21:56
+++ public/LE-setup-wizard-legacy.html	2026-01-04 15:00:17
@@ -602,7 +602,33 @@
                                     <p style="font-size: 1.2rem; color: var(--text-secondary); line-height: 1.5;">
                                         Track market prices, set your own pricing, and analyze profitability. 
                                         Compare your prices with regional averages to stay competitive.
+                                    </p>
+                                </div>
+                            </div>
+                        </div>
+
+                        <!-- Activity Hub -->
+                        <div class="status-card">
+                            <div style="display: flex; align-items: start; gap: 1.5rem;">
+                                <div style="font-size: 2.5rem; font-weight: bold; color: var(--accent-yellow);">APP</div>
+                                <div>
+                                    <h3 style="color: var(--accent-yellow); font-size: 1.8rem; margin-bottom: 0.5rem;">Activity Hub - Mobile App</h3>
+                                    <p style="font-size: 1.2rem; color: var(--text-secondary); line-height: 1.5;">
+                                        Download the Activity Hub mobile app to manage your farm on the go. 
+                                        Track tasks, log activities, monitor conditions, and receive alerts anywhere.
                                     </p>
+                                    <div style="display: flex; gap: 1rem; margin-top: 1rem;">
+                                        <a href="https://apps.apple.com/ca/app/greenreach-farms/id6738987013" target="_blank" style="text-decoration: none;">
+                                            <div class="touch-button" style="padding: 1rem 2rem; font-size: 1rem; min-height: auto;">
+                                                <span>iOS App Store</span>
+                                            </div>
+                                        </a>
+                                        <a href="https://play.google.com/store/apps" target="_blank" style="text-decoration: none;">
+                                            <div class="touch-button" style="padding: 1rem 2rem; font-size: 1rem; min-height: auto;">
+                                                <span>Google Play</span>
+                                            </div>
+                                        </a>
+                                    </div>
                                 </div>
                             </div>
                         </div>
```

---

### 📝 `farm-inventory.html`

**Edge size**:     1382 lines
**Cloud size**:     1367 lines

**Key differences**:
```diff
--- greenreach-central/public/views/farm-inventory.html	2026-02-03 20:22:17
+++ public/views/farm-inventory.html	2026-02-02 19:06:53
@@ -488,6 +488,7 @@
             <a href="planting-scheduler.html" class="dropdown-item">Planting Scheduler</a>
             <a href="tray-setup.html" class="dropdown-item">Tray Setup</a>
             <a href="farm-inventory.html" class="dropdown-item active">Farm Inventory</a>
+            <a href="tray-inventory.html" class="dropdown-item">Activity Hub</a>
             <a href="/farm-sales-pos.html" class="dropdown-item">Lot Traceability</a>
           </div>
         </div>
@@ -542,9 +543,9 @@
     <div id="inventoryTree" class="inventory-tree">
       <h2>Inventory Views</h2>
       <div class="view-tabs">
-        <button class="view-tab active" onclick="switchView('location')">By Location</button>
-        <button class="view-tab" onclick="switchView('crop')">By Crop</button>
-        <button class="view-tab" onclick="switchView('harvest')">By Harvest Time</button>
+        <button class="view-tab active" onclick="switchView('location', event)">By Location</button>
+        <button class="view-tab" onclick="switchView('crop', event)">By Crop</button>
+        <button class="view-tab" onclick="switchView('harvest', event)">By Harvest Time</button>
       </div>
       <div id="locationView" class="inventory-view active">
         <!-- Dynamic location tree -->
@@ -617,7 +618,8 @@
         console.log('[loadInventory] Response status:', {
           current: currentResp.status,
           forecast: forecastResp.status,
-          groups: groupsResp.status
+          groups: groupsResp.status,
+          rooms: roomsResp.status
         });
 
         // If all requests failed, show helpful error
@@ -637,11 +639,14 @@
         const forecastData = forecastResp.ok ? await forecastResp.json() : { forecast: [] };
         const groupsResponse = groupsResp.ok ? await groupsResp.json() : { groups: [] };
         const groupsData = groupsResponse.groups || [];
+        const roomsResponse = roomsResp.ok ? await roomsResp.json() : { rooms: [] };
+        const roomsData = roomsResponse.rooms || [];
 
         console.log('[loadInventory] Data loaded:', {
           currentData: !!currentData,
           forecastData: !!forecastData,
-          groupsCount: groupsData.length
+          groupsCount: groupsData.length,
+          roomsCount: roomsData.length
         });
 
         // Calculate unique crops
@@ -650,9 +655,9 @@
         console.log('[loadInventory] Rendering...');
         renderSummaryCards(currentData, uniqueCrops.size);
         renderForecast(forecastData);
-        renderInventoryByLocation(currentData, groupsData, forecastData);
+        renderInventoryByLocation(currentData, groupsData, forecastData, roomsData);
         renderInventoryByCrop(currentData, groupsData, forecastData);
-        renderInventoryByHarvest(currentData, groupsData, forecastData);
+        renderInventoryByHarvest(currentData, groupsData, forecastData, roomsData);
         console.log('[loadInventory] Rendering complete!');
       } catch (error) {
         console.error('[loadInventory] Error:', error);
@@ -663,12 +668,14 @@
       }
     }
 
-    function switchView(viewName) {
+    function switchView(viewName, event) {
       // Update tabs
       document.querySelectorAll('.view-tab').forEach(tab => {
         tab.classList.remove('active');
       });
-      event.target.classList.add('active');
+      if (event && event.target) {
+        event.target.classList.add('active');
+      }
       
       // Update views
       document.querySelectorAll('.inventory-view').forEach(view => {
@@ -824,7 +831,7 @@
           <div class="location-section" style="background: rgba(30, 41, 59, 0.6); border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem;">
             <div class="location-header" style="cursor: pointer; margin-bottom: 1rem;" onclick="toggleLocation('${roomId}')">
               <h3 style="color: #60a5fa; font-size: 1.3rem; margin-bottom: 0.5rem;">
-                ${roomId}
+                ${roomIdToName[roomId] || roomId}
                 <span id="arrow-loc-${roomId}" style="font-size: 0.9rem; color: #94a3b8; margin-left: 0.5rem;">▼ Click to expand</span>
               </h3>
               <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; color: #94a3b8; font-size: 0.95rem;">
@@ -1117,8 +1124,16 @@
       `;
     }
 
-    function renderInventoryByHarvest(currentData, groupsData, forecastData) {
+    function renderInventoryByHarvest(currentData, groupsData, forecastData, roomsData = []) {
       console.log('[renderInventoryByHarvest] Called');
+      
+      // Create room ID to name lookup
+      const roomIdToName = {};
+      roomsData.forEach(room => {
+        if (room.id && room.name) {
+          roomIdToName[room.id] = room.name;
```

---

### 📝 `nutrient-management.html`

**Edge size**:     3442 lines
**Cloud size**:     3441 lines

**Key differences**:
```diff
--- greenreach-central/public/views/nutrient-management.html	2026-02-03 20:22:39
+++ public/views/nutrient-management.html	2026-02-01 19:30:30
@@ -576,6 +576,7 @@
             <a href="planting-scheduler.html" class="dropdown-item">Planting Scheduler</a>
             <a href="tray-setup.html" class="dropdown-item">Tray Setup</a>
             <a href="farm-inventory.html" class="dropdown-item">Farm Inventory</a>
+            <a href="tray-inventory.html" class="dropdown-item">Activity Hub</a>
             <a href="/farm-sales-pos.html" class="dropdown-item">Lot Traceability</a>
           </div>
         </div>
```

---

### 📝 `planting-scheduler.html`

**Edge size**:     2452 lines
**Cloud size**:     2451 lines

**Key differences**:
```diff
--- greenreach-central/public/views/planting-scheduler.html	2026-02-03 20:22:35
+++ public/views/planting-scheduler.html	2026-01-24 11:37:31
@@ -1163,6 +1163,7 @@
             <a href="planting-scheduler.html" class="dropdown-item active">Planting Scheduler</a>
             <a href="tray-setup.html" class="dropdown-item">Tray Setup</a>
             <a href="farm-inventory.html" class="dropdown-item">Farm Inventory</a>
+            <a href="tray-inventory.html" class="dropdown-item">Activity Hub</a>
             <a href="/farm-sales-pos.html" class="dropdown-item">Lot Traceability</a>
           </div>
         </div>
```

---

### 📝 `room-heatmap.html`

**Edge size**:     2759 lines
**Cloud size**:     2758 lines

**Key differences**:
```diff
--- greenreach-central/public/views/room-heatmap.html	2026-02-03 20:22:30
+++ public/views/room-heatmap.html	2026-01-30 08:15:23
@@ -790,6 +790,7 @@
             <a href="planting-scheduler.html" class="dropdown-item">Planting Scheduler</a>
             <a href="tray-setup.html" class="dropdown-item">Tray Setup</a>
             <a href="farm-inventory.html" class="dropdown-item">Farm Inventory</a>
+            <a href="tray-inventory.html" class="dropdown-item">Activity Hub</a>
             <a href="/farm-sales-pos.html" class="dropdown-item">Lot Traceability</a>
           </div>
         </div>
```

---

### 📝 `room-mapper.html`

**Edge size**:     2206 lines
**Cloud size**:     2201 lines

**Key differences**:
```diff
--- greenreach-central/public/views/room-mapper.html	2026-02-02 08:58:11
+++ public/views/room-mapper.html	2026-02-02 19:06:53
@@ -128,6 +128,8 @@
       backdrop-filter: blur(10px);
       box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
       overflow-y: auto;
+      min-width: 0;
+      max-width: 100%;
     }
 
     .sidebar h2, .details-panel h2 {
@@ -206,8 +208,9 @@
       box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
       display: flex;
       flex-direction: column;
-      overflow: auto;
+      overflow: hidden;
       min-height: 800px;
+      max-width: 100%;
     }
 
     .canvas-header {
@@ -287,6 +290,8 @@
       border-radius: 8px;
       cursor: crosshair;
       display: block;
+      max-width: 100%;
+      height: auto;
       background: rgba(15, 23, 42, 0.6);
       background-image: 
         linear-gradient(rgba(59, 130, 246, 0.1) 1px, transparent 1px),
```

---

### 📝 `tray-inventory.html`

**Edge size**:     5344 lines
**Cloud size**:     5036 lines

**Key differences**:
```diff
--- greenreach-central/public/views/tray-inventory.html	2026-02-02 19:06:53
+++ public/views/tray-inventory.html	2026-02-02 19:06:53
@@ -1085,7 +1085,7 @@
           font-size: 0.9rem;
           font-weight: 600;
           cursor: pointer;
-        " title="Generate QR code to pair additional tablets">[Pair] Pair Device</button>
+        " title="Generate QR code to pair additional tablets">📱 Pair Device</button>
         <button id="logoutBtn" onclick="logoutDevice()" style="
           background: rgba(239, 68, 68, 0.2);
           border: 1px solid #ef4444;
@@ -1129,10 +1129,6 @@
           <div class="status-badge">
             <div class="status-dot" style="background: #34d399;"></div>
             <span id="currentTime">--:--</span>
-          </div>
-          <div class="status-badge">
-            <div class="status-dot" style="background: #f59e0b;"></div>
-            <span id="currentTemp">--°C</span>
           </div>
         </div>
       </div>
@@ -1144,10 +1140,6 @@
       <section class="priorities-section">
         <h2 class="section-title">Today's Priorities</h2>
         <div class="priority-items">
-          <div class="priority-card" onclick="scrollToHarvest()">
-            <div class="priority-number" id="harvestCount">0</div>
-            <div class="priority-label">Ready to Harvest</div>
-          </div>
           <div class="priority-card" id="orderPriorityCard" onclick="openOrderDashboard()">
             <div class="priority-number" id="orderCount">0</div>
             <div class="priority-label">Pending Orders</div>
@@ -1160,7 +1152,15 @@
           <div class="priority-card" onclick="openInventoryView()">
             <div class="priority-number" id="activeTrays">0</div>
             <div class="priority-label">Active Trays</div>
+          </div>
+          <div class="priority-card">
+            <div class="priority-number" id="seedlingCount">0</div>
+            <div class="priority-label">Seedlings</div>
           </div>
+          <div class="priority-card" onclick="scrollToHarvest()">
+            <div class="priority-number" id="harvestCount">0</div>
+            <div class="priority-label">Ready Soon</div>
+          </div>
         </div>
       </section>
 
@@ -1201,7 +1201,7 @@
           </button>
           
           <button class="action-btn orange" onclick="openOrderDashboard()">
-            <span class="action-icon">[Tasks]</span>
+            <span class="action-icon">📋</span>
             <div class="action-text">
               <div>View Orders</div>
               <div class="action-subtitle">Wholesale Order Dashboard</div>
@@ -1217,7 +1217,7 @@
           </button>
           
           <button class="action-btn cyan" onclick="startQuickMove()" id="quickMoveBtn">
-            <span class="action-icon">[Quick]</span>
+            <span class="action-icon">⚡</span>
             <div class="action-text">
               <div>Quick Move</div>
               <div class="action-subtitle">Fast 2-Scan Move</div>
@@ -1225,7 +1225,7 @@
           </button>
           
           <button class="action-btn" onclick="toggleVoiceMode()" id="voiceBtn" style="opacity: 0.5;">
-            <span class="action-icon">[Voice]</span>
+            <span class="action-icon">🔊</span>
             <div class="action-text">
               <div>Voice Mode</div>
               <div class="action-subtitle">Audio Feedback</div>
@@ -1275,7 +1275,7 @@
   <!-- Orientation Warning -->
   <div id="orientationWarning" class="orientation-warning">
     <div class="orientation-content">
-      <div style="font-size: 4rem; margin-bottom: 1rem;">[SYNC]</div>
+      <div style="font-size: 4rem; margin-bottom: 1rem;">🔄</div>
       <h2>Please Rotate Device</h2>
       <p>Activity Hub is optimized for landscape mode</p>
       <p style="font-size: 0.9rem; margin-top: 1rem; opacity: 0.8;">Rotate your tablet horizontally for the best experience</p>
@@ -1284,7 +1284,7 @@
 
   <!-- Voice Assistant Button -->
   <button class="voice-assistant-btn" onclick="toggleVoiceAssistant()" id="voiceBtn">
-    <span class="voice-icon">[MIC]</span>
+    <span class="voice-icon">🎤</span>
   </button>
 
   <!-- Voice Assistant Modal -->
@@ -1656,10 +1656,135 @@
     let currentQABatch = null;
     let currentQACheckpoint = null;
     let selectedQAResult = null;
+    
+    // === CAMERA PERMISSION FUNCTIONS ===
```

---

### 📝 `tray-setup.html`

**Edge size**:      982 lines
**Cloud size**:      981 lines

**Key differences**:
```diff
--- greenreach-central/public/views/tray-setup.html	2026-02-03 20:22:46
+++ public/views/tray-setup.html	2026-01-24 11:37:31
@@ -480,6 +480,7 @@
       <div class="header-nav">
         <a href="/LE-farm-admin.html" class="nav-link">Admin</a>
         <a href="/views/farm-summary.html" class="nav-link">Farm Summary</a>
+        <a href="/views/tray-inventory.html" class="nav-link">Activity Hub</a>
         <a href="/views/tray-setup.html" class="nav-link active">Tray Setup</a>
         <a href="/farm-sales-pos.html" class="nav-link">Lot Traceability</a>
       </div>
```

---

**Total differing files**: 10

## 4. Edge-Only Files (Will Be Copied)


**Total edge-only files**: 0

## 5. Cloud-Only Files (⚠️ CHECK: Unique Features?)


**Total cloud-only files**: 0

## 6. Path Reference Audit

Checking for hardcoded paths that might break after consolidation...

```
Binary file greenreach-central/.elasticbeanstalk/app_versions/app-260131_174811584712.zip matches
Binary file greenreach-central/.elasticbeanstalk/app_versions/app-260131_150404508217.zip matches
Binary file greenreach-central/.elasticbeanstalk/app_versions/app-260131_100409525198-stage-260131_100409525214.zip matches
Binary file greenreach-central/.elasticbeanstalk/app_versions/app-260130_162048593015.zip matches
Binary file greenreach-central/.elasticbeanstalk/app_versions/app-260201_151855108392.zip matches
Binary file greenreach-central/.elasticbeanstalk/app_versions/app-260201_140211779382-stage-260201_140211779416.zip matches
Binary file greenreach-central/.elasticbeanstalk/app_versions/app-260131_181635776809.zip matches
Binary file greenreach-central/.elasticbeanstalk/app_versions/fix-heartbeat-fields-260201-191839.zip matches
Binary file greenreach-central/.elasticbeanstalk/app_versions/app-260129_202416882253.zip matches
Binary file greenreach-central/.elasticbeanstalk/app_versions/app-260130_150645353549.zip matches
```

## 7. Summary & Recommendations

| Category | Count | Action |
|----------|-------|--------|
| Identical files | 19 | ✅ Use edge version |
| Differing files | 10 | ⚠️ **Manual review required** |
| Edge-only files | 0 | ✅ Copy to consolidated |
| Cloud-only files | 0 | ⚠️ Check for unique features |

### Next Steps

1. **⚠️ CRITICAL**: Review all 10 differing files above
2. Document any cloud improvements that should be preserved
3. Manually merge cloud improvements into edge files if needed
4. Review 0 cloud-only files for unique features
5. After review complete, run `./scripts/consolidate-light-engine.sh`

### Approval Checklist

- [ ] All 10 differing files reviewed
- [ ] Cloud improvements documented or merged
- [ ] Schema validation passed
- [ ] No critical features will be lost
- [ ] Ready to proceed with consolidation
