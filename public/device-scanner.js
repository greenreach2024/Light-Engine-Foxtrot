/**
 * Device Scanner UI Component
 * 
 * Frontend interface for automatic device discovery.
 * Integrates with /api/devices/scan endpoint.
 * 
 * Framework Compliance:
 * - Simplicity Over Features: One-click scanning, no configuration needed
 * - Workflow-Centric: Fits into setup wizard workflow naturally
 */

class DeviceScanner {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || '';
    this.onDevicesFound = options.onDevicesFound || (() => {});
    this.onError = options.onError || ((error) => console.error(error));
    this.onProgress = options.onProgress || (() => {});
  }

  /**
   * Scan network for all devices
   */
  async scanNetwork(subnet = null) {
    try {
      this.onProgress({ status: 'scanning', message: 'Scanning network...' });
      
      const response = await fetch(`${this.baseUrl}/api/devices/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subnet })
      });

      if (!response.ok) {
        throw new Error(`Scan failed: ${response.statusText}`);
      }

      const result = await response.json();
      
      this.onProgress({ 
        status: 'complete', 
        message: `Found ${result.devices.length} devices` 
      });
      
      this.onDevicesFound(result.devices, result.summary);
      
      return result;
    } catch (error) {
      this.onError(error);
      throw error;
    }
  }

  /**
   * Quick scan for light controllers only (faster)
   */
  async scanLightControllers() {
    try {
      this.onProgress({ status: 'scanning', message: 'Looking for light controllers...' });
      
      const response = await fetch(`${this.baseUrl}/api/devices/scan/lights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`Scan failed: ${response.statusText}`);
      }

      const result = await response.json();
      
      this.onProgress({ 
        status: 'complete', 
        message: `Found ${result.devices.length} light controllers` 
      });
      
      this.onDevicesFound(result.devices, result.summary);
      
      return result;
    } catch (error) {
      this.onError(error);
      throw error;
    }
  }

  /**
   * Render device list as HTML
   */
  renderDeviceList(devices) {
    if (devices.length === 0) {
      return `
        <div class="no-devices">
          <p>❌ No devices found</p>
          <p style="font-size: 0.9rem; color: #888; margin-top: 0.5rem;">
            Make sure devices are powered on and connected to the same network.
          </p>
        </div>
      `;
    }

    const deviceCards = devices.map(device => {
      const confidenceColor = device.confidence >= 0.9 ? '#10b981' : 
                               device.confidence >= 0.7 ? '#f59e0b' : '#ef4444';
      
      const protocolBadge = device.protocol === 'grow3' ? 
        '<span class="badge badge-grow3">GROW3</span>' :
        device.protocol === 'dmx' ?
        '<span class="badge badge-dmx">DMX512</span>' :
        '<span class="badge badge-http">HTTP</span>';

      return `
        <div class="device-card" data-ip="${device.ip}" data-port="${device.port}" data-protocol="${device.protocol}">
          <div class="device-header">
            <div class="device-icon">[INFO]</div>
            <div class="device-info">
              <div class="device-title">${device.manufacturer}</div>
              <div class="device-subtitle">${device.ip}:${device.port}</div>
            </div>
            ${protocolBadge}
          </div>
          <div class="device-details">
            <div class="detail-row">
              <span class="detail-label">Type:</span>
              <span class="detail-value">${device.type.replace('_', ' ')}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Confidence:</span>
              <span class="detail-value" style="color: ${confidenceColor}">
                ${(device.confidence * 100).toFixed(0)}%
              </span>
            </div>
            ${device.info ? `
              <div class="detail-row">
                <span class="detail-label">Model:</span>
                <span class="detail-value">${device.info.model || 'Unknown'}</span>
              </div>
            ` : ''}
          </div>
          <button class="device-select-btn" data-device='${JSON.stringify(device)}'>
            [OK] Use This Device
          </button>
        </div>
      `;
    }).join('');

    return `<div class="device-grid">${deviceCards}</div>`;
  }

  /**
   * Render scan button with loading state
   */
  renderScanButton(isScanning = false) {
    return `
      <button 
        class="scan-button ${isScanning ? 'scanning' : ''}" 
        ${isScanning ? 'disabled' : ''}
      >
        <span class="scan-icon">${isScanning ? '⟳' : '🔍'}</span>
        <span class="scan-text">${isScanning ? 'Scanning Network...' : 'Scan for Devices'}</span>
      </button>
    `;
  }

  /**
   * Inject default styles
   */
  injectStyles() {
    if (document.getElementById('device-scanner-styles')) return;

    const style = document.createElement('style');
    style.id = 'device-scanner-styles';
    style.textContent = `
      .device-scanner-container {
        padding: 1.5rem;
      }

      .scan-button {
        width: 100%;
        padding: 1rem 2rem;
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        color: white;
        border: none;
        border-radius: 12px;
        font-size: 1.1rem;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        transition: all 0.3s ease;
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
      }

      .scan-button:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(16, 185, 129, 0.4);
      }

      .scan-button:disabled {
        opacity: 0.7;
        cursor: not-allowed;
      }

      .scan-button.scanning .scan-icon {
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      .device-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 1.5rem;
        margin-top: 1.5rem;
      }

      .device-card {
        background: white;
        border: 2px solid #e5e7eb;
        border-radius: 12px;
        padding: 1.25rem;
        transition: all 0.3s ease;
      }

      .device-card:hover {
        border-color: #10b981;
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);
        transform: translateY(-2px);
      }

      .device-header {
        display: flex;
        align-items: center;
        gap: 1rem;
        margin-bottom: 1rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid #e5e7eb;
      }

      .device-icon {
        font-size: 2rem;
      }

      .device-info {
        flex: 1;
      }

      .device-title {
        font-size: 1.1rem;
        font-weight: 600;
        color: #1f2937;
      }

      .device-subtitle {
        font-size: 0.9rem;
        color: #6b7280;
        margin-top: 0.25rem;
      }

      .badge {
        padding: 0.25rem 0.75rem;
        border-radius: 6px;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
      }

      .badge-grow3 {
        background: #d1fae5;
        color: #065f46;
      }

      .badge-dmx {
        background: #dbeafe;
        color: #1e40af;
      }

      .badge-http {
        background: #fef3c7;
        color: #92400e;
      }

      .device-details {
        margin: 1rem 0;
      }

      .detail-row {
        display: flex;
        justify-content: space-between;
        padding: 0.5rem 0;
        font-size: 0.9rem;
      }

      .detail-label {
        color: #6b7280;
        font-weight: 500;
      }

      .detail-value {
        color: #1f2937;
        font-weight: 600;
      }

      .device-select-btn {
        width: 100%;
        padding: 0.75rem;
        background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
        color: white;
        border: none;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
      }

      .device-select-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 8px rgba(59, 130, 246, 0.3);
      }

      .no-devices {
        text-align: center;
        padding: 3rem 1rem;
        color: #6b7280;
      }

      .no-devices p:first-child {
        font-size: 1.25rem;
        font-weight: 600;
        margin-bottom: 0.5rem;
      }

      .scan-progress {
        margin-top: 1rem;
        padding: 1rem;
        background: #f3f4f6;
        border-radius: 8px;
        text-align: center;
        color: #4b5563;
      }
    `;
    document.head.appendChild(style);
  }
}

// Export for use in modules or make available globally
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DeviceScanner;
} else {
  window.DeviceScanner = DeviceScanner;
}
