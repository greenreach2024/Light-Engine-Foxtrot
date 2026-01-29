// IoT Devices Manager
class IoTDevicesManager {
  constructor() {
    this.devices = [];
    this.scanning = false;
    this.deviceGroups = Array.from(document.querySelectorAll('.iot-device-group'));
    this.scanButton = document.getElementById('scanDevicesBtn') || document.getElementById('btnScanIoTDevices');
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
    
    // Load initial device list
    await this.loadDevices();
    
    // Setup room/zone data from farm registration
    await this.setupAssignmentData();
  }

  async loadDevices() {
    try {
      const response = await fetch('/iot/devices');
      const data = await response.json();
      this.devices = data.devices;
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
      const response = await fetch('/iot/devices/scan', { method: 'POST' });
      const data = await response.json();
      this.devices = data.devices;
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
      const response = await fetch(`/iot/devices/${deviceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      
      if (!response.ok) throw new Error('Failed to update device');
      
      // Update local device data
      const updatedDevice = await response.json();
      this.devices = this.devices.map(d => 
        d.id === deviceId ? updatedDevice : d
      );
      
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
      const response = await fetch(`/iot/devices/${deviceId}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) throw new Error('Failed to remove device');
      
      // Update local device data
      this.devices = this.devices.filter(d => d.id !== deviceId);
      
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