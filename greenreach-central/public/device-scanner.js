/**
 * Device Scanner — Light Controller Auto-Discovery
 *
 * Cloud mode:  Returns empty results; renders informational panel.
 * Edge mode:   Calls /api/devices/scan on the local edge server for
 *              mDNS/network discovery of GROW3 and DMX controllers.
 *
 * Usage (from setup-wizard.html):
 *   const scanner = new DeviceScanner({ baseUrl, onDevicesFound, onError, onProgress });
 *   scanner.injectStyles();
 *   container.innerHTML = scanner.renderScanButton();
 *   await scanner.scanLightControllers();
 */

class DeviceScanner {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || '';
    this.onDevicesFound = options.onDevicesFound || (() => {});
    this.onError = options.onError || ((err) => console.error('[DeviceScanner]', err));
    this.onProgress = options.onProgress || (() => {});
    this.devices = [];
    this.isScanning = false;
    this.planType = localStorage.getItem('plan_type') || 'cloud';
  }

  /**
   * Is this a cloud deployment? If so, scanning is a no-op.
   */
  get isCloud() {
    return this.planType !== 'edge';
  }

  /**
   * Inject CSS styles for the scanner UI
   */
  injectStyles() {
    if (document.getElementById('device-scanner-styles')) return;
    const style = document.createElement('style');
    style.id = 'device-scanner-styles';
    style.textContent = `
      .scan-button {
        display: flex; align-items: center; gap: 8px;
        padding: 10px 20px; border-radius: 6px;
        font-weight: 500; cursor: pointer;
        border: 1px solid rgba(16,185,129,0.3);
        background: rgba(16,185,129,0.1);
        color: #10b981;
        transition: all 0.2s ease;
        width: 100%;
        justify-content: center;
      }
      .scan-button:hover:not(:disabled) {
        background: rgba(16,185,129,0.2);
        border-color: rgba(16,185,129,0.5);
      }
      .scan-button:disabled {
        opacity: 0.6; cursor: not-allowed;
      }
      .scan-button.scanning .scan-icon {
        animation: spin 1s linear infinite;
      }
      @keyframes spin { 100% { transform: rotate(360deg); } }

      .device-list { margin-top: 12px; }
      .device-item {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 14px; margin-bottom: 6px;
        border-radius: 6px;
        background: rgba(16,185,129,0.06);
        border: 1px solid rgba(16,185,129,0.15);
      }
      .device-item .device-icon { font-size: 18px; }
      .device-item .device-info { flex: 1; }
      .device-item .device-name { font-weight: 500; font-size: 13px; }
      .device-item .device-meta { font-size: 11px; color: var(--text-muted, #94a3b8); }

      .cloud-scanner-notice {
        text-align: center; padding: 20px;
        color: var(--text-muted, #94a3b8);
      }
      .cloud-scanner-notice .notice-icon { font-size: 32px; margin-bottom: 8px; }
    `;
    document.head.appendChild(style);
  }

  /**
   * Render the scan button HTML.
   * For cloud users returns an informational notice instead.
   */
  renderScanButton(showScanUI = true) {
    if (this.isCloud) {
      return `
        <div class="cloud-scanner-notice">
          <div class="notice-icon">☁️</div>
          <p style="margin: 0; font-size: 13px;">
            Auto-discovery is available with Light Engine Edge.
          </p>
        </div>`;
    }
    return `
      <button type="button" class="scan-button" id="device-scan-btn">
        <span class="scan-icon">🔍</span>
        <span class="scan-text">Scan for Light Controllers</span>
      </button>`;
  }

  /**
   * Scan for light controllers on the local network.
   * Cloud: immediately returns empty.
   * Edge: calls GET /api/devices/scan.
   */
  async scanLightControllers() {
    if (this.isCloud) {
      console.log('[DeviceScanner] Cloud mode — scan skipped');
      this.onDevicesFound([], { devicesFound: 0, lightControllers: 0, duration: '0s' });
      return [];
    }

    if (this.isScanning) return this.devices;
    this.isScanning = true;
    this.onProgress({ status: 'scanning', percent: 0 });

    const startTime = Date.now();

    try {
      const response = await fetch(`${this.baseUrl}/api/devices/scan`, {
        headers: {
          'Authorization': `Bearer ${sessionStorage.getItem('token') || localStorage.getItem('token') || ''}`
        }
      });

      if (!response.ok) {
        throw new Error(`Scan failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      this.devices = data.devices || [];
      const duration = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
      const lightControllers = this.devices.filter(d =>
        d.type === 'grow3' || d.type === 'dmx' || d.protocol === 'artnet'
      ).length;

      this.onProgress({ status: 'complete', percent: 100 });
      this.onDevicesFound(this.devices, {
        devicesFound: this.devices.length,
        lightControllers,
        duration
      });

      return this.devices;

    } catch (error) {
      this.onError(error);
      return [];
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Render a device list for discovered devices
   */
  renderDeviceList(devices) {
    if (!devices || devices.length === 0) {
      return '<p style="color: var(--text-muted); font-size: 12px;">No devices discovered.</p>';
    }

    return `<div class="device-list">${devices.map(d => `
      <div class="device-item">
        <span class="device-icon">${d.type === 'grow3' ? '[INFO]' : d.type === 'dmx' ? '🎛️' : '📡'}</span>
        <div class="device-info">
          <div class="device-name">${d.name || d.type || 'Unknown Device'}</div>
          <div class="device-meta">${d.ip || d.address || '—'} · ${d.protocol || d.type || '—'}${d.manufacturer ? ` · ${d.manufacturer}` : ''}</div>
        </div>
      </div>`).join('')}</div>`;
  }
}

// Make globally available
window.DeviceScanner = DeviceScanner;
