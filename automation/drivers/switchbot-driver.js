// SwitchBot Driver for PlugManager
// Loads real SwitchBot devices via API

import crypto from 'crypto';

class SwitchBotDriver {
  constructor(config) {
    this.token = config?.token || '';
    this.secret = config?.secret || '';
    this.apiBase = (config && config.apiBase) || 'https://api.switch-bot.com/v1.1';
    
    // Cache to prevent excessive API calls (SwitchBot has rate limits)
    this.deviceCache = null;
    this.cacheTimestamp = 0;
    this.cacheTTL = 60000; // 60 seconds cache
  }

  async getDevices(refresh = false) {
    if (!this.hasCredentials()) {
      throw new Error('SwitchBot credentials are not configured');
    }
    
    // Return cached data if still fresh (unless forced refresh)
    const now = Date.now();
    if (!refresh && this.deviceCache && (now - this.cacheTimestamp) < this.cacheTTL) {
      return this.deviceCache;
    }
    
    const url = `${this.apiBase}/devices${refresh ? '?refresh=1' : ''}`;
    const headers = this._getAuthHeaders();
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`SwitchBot API error: ${response.status}`);
    const data = await response.json();
    if (data.statusCode === 100 && data.body && data.body.deviceList) {
      // Cache the result
      this.deviceCache = data.body.deviceList;
      this.cacheTimestamp = now;
      return data.body.deviceList;
    }
    throw new Error('No deviceList in SwitchBot response');
  }

  _getAuthHeaders() {
    if (!this.hasCredentials()) {
      throw new Error('SwitchBot credentials are not configured');
    }
    const t = Date.now().toString();
    const nonce = crypto.randomUUID().replace(/-/g, '');
    const strToSign = this.token + t + nonce;
    const sign = crypto.createHmac('sha256', this.secret)
      .update(strToSign, 'utf8')
      .digest('base64');

    return {
      'Authorization': this.token,
      't': t,
      'sign': sign,
      'nonce': nonce,
      'Content-Type': 'application/json',
      'charset': 'utf8'
    };
  }

  vendor() {
    return 'switchbot';
  }

  hasCredentials() {
    return Boolean(this.token && this.secret);
  }

  updateCredentials({ token, secret, apiBase } = {}) {
    this.token = token || '';
    this.secret = secret || '';
    if (apiBase) {
      this.apiBase = apiBase;
    }
  }

  async discover() {
    try {
      const devices = await this.getDevices(false); // Use cached data (60s TTL)
      return devices.map(device => ({
        id: device.deviceId,
        name: device.deviceName || 'SwitchBot Device',
        model: device.deviceType,
        vendor: this.vendor(),
        hubId: device.hubDeviceId,
        online: true, // SwitchBot API only returns online devices
        data: device
      }));
    } catch (error) {
      // Silently skip discovery if API is unavailable (404/auth errors)
      // Manual device control via /api/switchbot endpoints still works
      if (error.message?.includes('404') || error.message?.includes('401')) {
        return []; // Return empty array silently
      }
      // Log other errors
      console.error('[switchbot] Discovery failed:', error);
      return []; // Return empty array on error to match driver interface
    }
  }

  /**
   * Extract device ID from plugId (handles both bare IDs and normalized format)
   */
  _extractDeviceId(plugId) {
    // If format is plug:vendor:id, extract the id part
    if (plugId.includes(':')) {
      const parts = plugId.split(':');
      return parts[2] || parts[parts.length - 1];
    }
    // Otherwise assume it's already a bare device ID
    return plugId;
  }

  /**
   * Get device state from SwitchBot API
   * @param {string} plugId - Device ID (bare or normalized format)
   * @returns {Promise<{on: boolean, online: boolean}>}
   */
  async getState(plugId) {
    if (!this.hasCredentials()) {
      throw new Error('SwitchBot credentials are not configured');
    }

    const deviceId = this._extractDeviceId(plugId);
    const url = `${this.apiBase}/devices/${deviceId}/status`;
    const headers = this._getAuthHeaders();
    
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[switchbot] API returned ${response.status} for ${deviceId}:`, errorBody);
        throw new Error(`SwitchBot API error: ${response.status} - ${errorBody}`);
      }
      
      const data = await response.json();
      if (data.statusCode === 100 && data.body) {
        // SwitchBot Plug Mini returns power state in body.power
        // Can be "on" or "off" as string
        const power = data.body.power;
        return {
          on: power === 'on',
          online: true,
          power: power
        };
      }
      
      throw new Error(`Invalid SwitchBot status response for ${deviceId}`);
    } catch (error) {
      console.error(`[switchbot] Failed to get state for ${deviceId}:`, error.message);
      throw error;
    }
  }

  /**
   * Set device power state via SwitchBot API
   * @param {string} plugId - Device ID (bare or normalized format)
   * @param {boolean} on - Desired power state (true=on, false=off)
   * @returns {Promise<{on: boolean, online: boolean}>}
   */
  async setOn(plugId, on) {
    if (!this.hasCredentials()) {
      throw new Error('SwitchBot credentials are not configured');
    }

    const deviceId = this._extractDeviceId(plugId);
    const command = on ? 'turnOn' : 'turnOff';
    const url = `${this.apiBase}/devices/${deviceId}/commands`;
    const headers = this._getAuthHeaders();
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          command: command,
          parameter: 'default',
          commandType: 'command'
        })
      });
      
      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[switchbot] API returned ${response.status} for ${deviceId}:`, errorBody);
        throw new Error(`SwitchBot API error: ${response.status} - ${errorBody}`);
      }
      
      const data = await response.json();
      if (data.statusCode === 100) {
        // Command successful - return expected state
        return {
          on: on,
          online: true,
          command: command
        };
      }
      
      throw new Error(`SwitchBot command failed for ${deviceId}: ${data.message || 'Unknown error'}`);
    } catch (error) {
      console.error(`[switchbot] Failed to set ${deviceId} to ${on ? 'on' : 'off'}:`, error.message);
      throw error;
    }
  }
}

export default SwitchBotDriver;

