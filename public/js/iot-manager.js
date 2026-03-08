// IoT Devices Manager
class IoTDevicesManager {
  constructor() {
    this.devices = [];
    this.scanning = false;
    this.deviceGroups = Array.from(document.querySelectorAll('.iot-device-group'));
    this.scanButton = document.getElementById('scanDevicesBtn') || document.getElementById('btnScanIoTDevices');
    this.autoAssignButton = document.getElementById('autoAssignBtn');
    this.autoAssignResult = document.getElementById('autoAssignResult');
    this.loadingState = document.querySelector('.iot-loading-state');
    this.rootList = document.getElementById('iotDevicesList');

    const template = document.getElementById('iot-device-template');
    if (template && template.content) {
      this.templateContent = template.content;
    } else {
      const fallback = document.createElement('template');
      fallback.innerHTML = `
        <div class="iot-device-card">
          <div class="device-header">
            <h4 class="device-name"></h4>
            <span class="device-type"></span>
          </div>
          <div class="device-content">
            <div class="device-info">
              <p class="device-id"></p>
              <p class="device-last-seen"></p>
            </div>
            <div class="device-assignments">
              <select class="room-select"><option value="">Select Room</option></select>
              <select class="zone-select"><option value="">Select Zone</option></select>
              <select class="group-select"><option value="">Select Group</option></select>
              <select class="equipment-select"><option value="">Select Equipment</option></select>
            </div>
          </div>
          <div class="device-footer">
            <button type="button" class="button button--small button--secondary setup-device">Setup</button>
            <button type="button" class="button button--small button--danger remove-device">Remove</button>
          </div>
        </div>`;
      this.templateContent = fallback.content;
    }

    if (!this.rootList || !this.scanButton || this.deviceGroups.length === 0) {
      console.info('[IoTDevicesManager] Skipping initialization: required DOM nodes missing');
      this.disabled = true;
      return;
    }

    // Initialize
    this.init();
  }

  async init() {
    if (this.disabled) return;
    // Setup event listeners
    if (this.scanButton) {
      this.scanButton.addEventListener('click', () => this.scanDevices());
    }
    if (this.autoAssignButton) {
      this.autoAssignButton.addEventListener('click', () => this.autoAssignDevices());
    }
    
    // Load initial device list
    await this.loadDevices();
    
    // Setup room/zone data from farm registration
    await this.setupAssignmentData();
  }

  async loadDevices() {
    try {
      // Load from the canonical iot-devices.json (same source as app.foxtrot.js loadAllData)
      const response = await fetch('/data/iot-devices.json', { cache: 'no-store' });
      const data = await response.json();
      this.devices = Array.isArray(data) ? data : (data.devices || []);
      this.renderDevices();
    } catch (error) {
      console.error('Failed to load IoT devices:', error);
      // TODO: Show error state
    }
  }

  async scanDevices() {
    if (this.scanning) return;
    
    this.scanning = true;
    if (this.loadingState) this.loadingState.hidden = false;
    if (this.scanButton) this.scanButton.disabled = true;
    
    try {
      const response = await fetch('/discovery/devices');
      const data = await response.json();
      this.devices = Array.isArray(data) ? data : (data.devices || []);
      this.renderDevices();
    } catch (error) {
      console.error('Device scan failed:', error);
      // TODO: Show error state
    } finally {
      this.scanning = false;
      if (this.loadingState) this.loadingState.hidden = true;
      if (this.scanButton) this.scanButton.disabled = false;
    }
  }

  /**
   * Auto-assign unassigned devices to rooms/zones via POST /api/devices/auto-assign.
   * Uses the backend's protocol/type matching algorithm (max 4 of same type per room).
   */
  async autoAssignDevices() {
    if (this.autoAssignButton) this.autoAssignButton.disabled = true;

    // Collect current unassigned devices
    const unassigned = this.devices.filter(d => !d.room && !d.room_id);
    const payload = unassigned.length > 0 ? { devices: unassigned } : {};

    try {
      const response = await fetch('/api/devices/auto-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();

      // Show result banner
      if (this.autoAssignResult) {
        if (data.ok && data.assigned > 0) {
          this.autoAssignResult.style.display = 'block';
          this.autoAssignResult.style.background = 'rgba(16,185,129,0.1)';
          this.autoAssignResult.style.border = '1px solid rgba(16,185,129,0.3)';
          this.autoAssignResult.style.color = '#6ee7b7';
          const lines = data.assignments.map(a =>
            `${a.device_id} → ${a.room_id}${a.zone ? ' / ' + a.zone : ''} (${a.device_type})`
          );
          this.autoAssignResult.innerHTML =
            `<strong>Auto-assigned ${data.assigned} device${data.assigned > 1 ? 's' : ''}:</strong><br>` +
            lines.join('<br>');
        } else {
          this.autoAssignResult.style.display = 'block';
          this.autoAssignResult.style.background = 'rgba(96,165,250,0.1)';
          this.autoAssignResult.style.border = '1px solid rgba(96,165,250,0.3)';
          this.autoAssignResult.style.color = '#93c5fd';
          this.autoAssignResult.textContent = data.message || 'All devices are already assigned.';
        }

        // Auto-hide after 10 seconds
        setTimeout(() => { this.autoAssignResult.style.display = 'none'; }, 10000);
      }

      // Refresh device list to reflect new assignments
      if (data.assigned > 0) {
        await this.loadDevices();
        await this.setupAssignmentData();
      }

      if (typeof showToast === 'function') {
        showToast(data.assigned > 0
          ? `Auto-assigned ${data.assigned} device${data.assigned > 1 ? 's' : ''}`
          : (data.message || 'No unassigned devices'), data.assigned > 0 ? 'success' : 'info');
      }
    } catch (error) {
      console.error('[IoT Manager] Auto-assign failed:', error);
      if (typeof showToast === 'function') {
        showToast('Auto-assign failed: ' + error.message, 'error');
      }
    } finally {
      if (this.autoAssignButton) this.autoAssignButton.disabled = false;
    }
  }

  async setupAssignmentData() {
    // Load room/zone data from static files
    try {
      const roomsResponse = await fetch('/data/rooms.json');
      if (!roomsResponse.ok) throw new Error('Failed to load rooms.json');
      
      const roomsData = await roomsResponse.json();
      const rooms = roomsData.rooms || [];
      
      console.log('[IoT Manager] Loaded rooms:', rooms.length);
      
      this.roomOptions = rooms.map(room => ({
        value: room.id || room.name,
        label: room.name || room.location || room.id
      }));
      
      // Load zones from room-map.json files
      // For now, create zones from room data
      this.zoneOptions = [];
      for (const room of rooms) {
        try {
          const mapResponse = await fetch(`/data/room-map-${room.id}.json`);
          if (mapResponse.ok) {
            const mapData = await mapResponse.json();
            if (mapData.zones && Array.isArray(mapData.zones)) {
              mapData.zones.forEach(zone => {
                this.zoneOptions.push({
                  value: zone.zone,
                  label: `${room.name} - ${zone.name || 'Zone ' + zone.zone}`
                });
              });
            }
          }
        } catch (e) {
          console.warn(`[IoT Manager] Could not load map for room ${room.id}:`, e.message);
        }
      }
      
      console.log('[IoT Manager] Setup complete:', {
        rooms: this.roomOptions.length,
        zones: this.zoneOptions.length
      });
    } catch (error) {
      console.error('[IoT Manager] Failed to load assignment data:', error);
      this.roomOptions = [];
      this.zoneOptions = [];
    }
  }

  createDeviceElement(device) {
    const element = this.templateContent.cloneNode(true);
    const card = element.querySelector('.iot-device-card');
    
    // Add data attribute for device type styling
    card.setAttribute('data-device-type', device.type || 'unknown');
    
    // Set device info
    card.querySelector('.device-name').textContent = device.name;
    card.querySelector('.device-type').textContent = device.type;
    card.querySelector('.device-id').textContent = `ID: ${device.id}`;
    card.querySelector('.device-last-seen').textContent = 
      `Last seen: ${new Date(device.lastSeen).toLocaleString()}`;
    
    // Setup assignment dropdowns
    const roomSelect = card.querySelector('.room-select');
    const zoneSelect = card.querySelector('.zone-select');
    
    // Populate room options
    this.roomOptions.forEach(option => {
      const optionEl = document.createElement('option');
      optionEl.value = option.value;
      optionEl.textContent = option.label;
      if (device.room === option.value) optionEl.selected = true;
      roomSelect.appendChild(optionEl);
    });
    
    // Populate zone options
    this.zoneOptions.forEach(option => {
      const optionEl = document.createElement('option');
      optionEl.value = option.value;
      optionEl.textContent = option.label;
      if (device.zone === option.value) optionEl.selected = true;
      zoneSelect.appendChild(optionEl);
    });
    
    // Setup event listeners
    roomSelect.addEventListener('change', () => this.updateDevice(device.id, { room: roomSelect.value }));
    zoneSelect.addEventListener('change', () => this.updateDevice(device.id, { zone: zoneSelect.value }));
    
    card.querySelector('.setup-device').addEventListener('click', () => this.setupDevice(device));
    card.querySelector('.remove-device').addEventListener('click', () => this.removeDevice(device.id));
    
    return card;
  }

  renderDevices() {
    if (this.disabled) return;
    // Clear existing devices
    this.deviceGroups.forEach(group => {
      const listEl = group.querySelector('.device-list');
      const countEl = group.querySelector('.device-count');
      if (listEl) listEl.innerHTML = '';
      if (countEl) countEl.textContent = '(0)';
    });
    
    // Group devices by protocol
    const grouped = this.devices.reduce((acc, device) => {
      const protocol = device.protocol || 'unknown';
      if (!acc[protocol]) acc[protocol] = [];
      acc[protocol].push(device);
      return acc;
    }, {});
    
    // Render each group
    Object.entries(grouped).forEach(([protocol, devices]) => {
      const group = document.querySelector(`.iot-device-group[data-protocol="${protocol}"]`);
      if (!group) return;
      
      const list = group.querySelector('.device-list');
      if (!list) return;
      devices.forEach(device => {
        list.appendChild(this.createDeviceElement(device));
      });
      
      const countEl = group.querySelector('.device-count');
      if (countEl) countEl.textContent = `(${devices.length})`;
    });
  }

  async updateDevice(deviceId, updates) {
    try {
      // Update local device data
      this.devices = this.devices.map(d => 
        d.id === deviceId ? { ...d, ...updates } : d
      );
      
      // Persist to iot-devices.json
      const response = await fetch('/data/iot-devices.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.devices)
      });
      
      if (!response.ok) throw new Error('Failed to update device');
      
      // Re-render devices
      this.renderDevices();
    } catch (error) {
      console.error('Failed to update device:', error);
      // TODO: Show error state
    }
  }

  async removeDevice(deviceId) {
    if (!confirm('Are you sure you want to remove this device?')) return;
    
    try {
      // Remove from local list
      this.devices = this.devices.filter(d => d.id !== deviceId);
      
      // Persist to iot-devices.json
      const response = await fetch('/data/iot-devices.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.devices)
      });
      
      if (!response.ok) throw new Error('Failed to remove device');
      
      // Re-render devices
      this.renderDevices();
    } catch (error) {
      console.error('Failed to remove device:', error);
      // TODO: Show error state
    }
  }

  async setupDevice(device) {
    // Launch appropriate setup wizard based on protocol
    const wizardId = `${device.protocol}-setup`;
    if (window.SetupWizard && window.SetupWizard.launch) {
      window.SetupWizard.launch(wizardId, {
        deviceId: device.id,
        deviceMetadata: device.config
      });
    }
  }
}

// Initialize IoT Devices Manager when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  if (!document.querySelector('.iot-device-group')) {
    console.info('[IoTDevicesManager] Auto-init skipped: no .iot-device-group elements found');
    return;
  }
  window.iotManager = new IoTDevicesManager();
});