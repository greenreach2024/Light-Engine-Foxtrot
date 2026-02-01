/**
 * Light Engine Edge Device - Health Check System
 * 
 * Validates connectivity and operational status of:
 * - Edge device server (local)
 * - GreenReach Central (cloud sync)
 * - Database connectivity
 * - Sensors (temperature, humidity, pressure, CO2, etc.)
 * - Light controllers (GROW3, DMX, etc.)
 * - Network connectivity
 * 
 * Usage:
 * - const healthChecker = new HealthCheck();
 * - const results = await healthChecker.runAll();
 * - healthChecker.displayResults(results);
 */

class HealthCheck {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || window.location.origin;
    this.centralUrl = options.centralUrl || null;
    this.timeout = options.timeout || 10000; // 10 seconds default
    this.results = {};
  }

  /**
   * Run all health checks
   * @returns {Promise<Object>} Health check results
   */
  async runAll() {
    console.log('[Health Check] Starting comprehensive system check...');
    
    const checks = [
      this.checkEdgeServer(),
      this.checkCentralSync(),
      this.checkDatabase(),
      this.checkSensors(),
      this.checkLightControllers(),
      this.checkNetwork(),
      this.checkDataIntegrity()
    ];

    const results = await Promise.allSettled(checks);
    
    this.results = {
      timestamp: new Date().toISOString(),
      overall: this.calculateOverallStatus(results),
      checks: {
        edgeServer: results[0].status === 'fulfilled' ? results[0].value : { status: 'error', error: results[0].reason },
        centralSync: results[1].status === 'fulfilled' ? results[1].value : { status: 'error', error: results[1].reason },
        database: results[2].status === 'fulfilled' ? results[2].value : { status: 'error', error: results[2].reason },
        sensors: results[3].status === 'fulfilled' ? results[3].value : { status: 'error', error: results[3].reason },
        lightControllers: results[4].status === 'fulfilled' ? results[4].value : { status: 'error', error: results[4].reason },
        network: results[5].status === 'fulfilled' ? results[5].value : { status: 'error', error: results[5].reason },
        dataIntegrity: results[6].status === 'fulfilled' ? results[6].value : { status: 'error', error: results[6].reason }
      }
    };

    console.log('[Health Check] Complete:', this.results);
    return this.results;
  }

  /**
   * Check edge device server health
   * @returns {Promise<Object>}
   */
  async checkEdgeServer() {
    const startTime = Date.now();
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/health`, {
        method: 'GET'
      });

      const data = await response.json();
      const responseTime = Date.now() - startTime;

      return {
        status: response.ok ? 'healthy' : 'degraded',
        responseTime,
        serverTime: data.timestamp || null,
        uptime: data.uptime || null,
        version: data.version || null,
        message: response.ok ? 'Edge server responding' : 'Edge server degraded'
      };
    } catch (error) {
      return {
        status: 'error',
        responseTime: Date.now() - startTime,
        error: error.message,
        message: 'Edge server unreachable'
      };
    }
  }

  /**
   * Check GreenReach Central connectivity and sync status
   * @returns {Promise<Object>}
   */
  async checkCentralSync() {
    const startTime = Date.now();
    
    // Get farm config to check if central sync is enabled
    try {
      const farmResponse = await this.fetchWithTimeout(`${this.baseUrl}/api/data/farm`);
      const farm = await farmResponse.json();
      
      if (!farm.central_linked && !farm.centralLinked) {
        return {
          status: 'disabled',
          message: 'Central sync not enabled',
          responseTime: Date.now() - startTime
        };
      }

      // Check central URL from farm config
      this.centralUrl = farm.central_url || farm.centralUrl || this.centralUrl;
      
      if (!this.centralUrl) {
        return {
          status: 'warning',
          message: 'Central URL not configured',
          responseTime: Date.now() - startTime
        };
      }

      // Test central connectivity
      const response = await this.fetchWithTimeout(`${this.centralUrl}/health`, {
        method: 'GET'
      });

      const data = await response.json();
      const responseTime = Date.now() - startTime;

      // Check last heartbeat
      const lastHeartbeat = farm.last_heartbeat || farm.lastHeartbeat;
      const heartbeatAge = lastHeartbeat ? Date.now() - new Date(lastHeartbeat).getTime() : null;
      const heartbeatHealthy = heartbeatAge ? heartbeatAge < 600000 : false; // 10 min threshold

      return {
        status: response.ok && heartbeatHealthy ? 'healthy' : 'degraded',
        responseTime,
        centralUrl: this.centralUrl,
        lastHeartbeat,
        heartbeatAge: heartbeatAge ? Math.round(heartbeatAge / 60000) : null,
        heartbeatHealthy,
        message: response.ok ? 
          (heartbeatHealthy ? 'Central sync operational' : 'Heartbeat delayed') : 
          'Central unreachable'
      };
    } catch (error) {
      return {
        status: 'error',
        responseTime: Date.now() - startTime,
        error: error.message,
        message: 'Central sync check failed'
      };
    }
  }

  /**
   * Check database connectivity
   * @returns {Promise<Object>}
   */
  async checkDatabase() {
    const startTime = Date.now();
    try {
      // Test database query
      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/health/database`, {
        method: 'GET'
      });

      const data = await response.json();
      const responseTime = Date.now() - startTime;

      return {
        status: data.available ? 'healthy' : 'error',
        responseTime,
        type: data.type || 'unknown',
        tablesCount: data.tables || 0,
        message: data.available ? 'Database operational' : 'Database unavailable'
      };
    } catch (error) {
      return {
        status: 'error',
        responseTime: Date.now() - startTime,
        error: error.message,
        message: 'Database check failed'
      };
    }
  }

  /**
   * Check sensor connectivity and data freshness
   * @returns {Promise<Object>}
   */
  async checkSensors() {
    const startTime = Date.now();
    try {
      // Get environment data
      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/data/env`);
      const env = await response.json();
      const responseTime = Date.now() - startTime;

      if (!env || !env.zones || env.zones.length === 0) {
        return {
          status: 'warning',
          responseTime,
          message: 'No zones configured yet',
          sensors: []
        };
      }

      // Check each zone's sensors
      const sensorChecks = env.zones.map(zone => {
        const sensors = zone.sensors || {};
        const sensorList = [];
        const issues = [];

        // Check temperature sensor
        if (sensors.tempC) {
          const temp = sensors.tempC;
          const age = temp.meta?.lastUpdated ? Date.now() - new Date(temp.meta.lastUpdated).getTime() : null;
          const fresh = age ? age < 300000 : false; // 5 min threshold
          
          sensorList.push({
            type: 'temperature',
            value: temp.current,
            unit: '°C',
            fresh,
            age: age ? Math.round(age / 60000) : null
          });

          if (!fresh) issues.push('Temperature data stale');
        } else {
          issues.push('Temperature sensor missing');
        }

        // Check humidity sensor
        if (sensors.rh) {
          const rh = sensors.rh;
          const age = rh.meta?.lastUpdated ? Date.now() - new Date(rh.meta.lastUpdated).getTime() : null;
          const fresh = age ? age < 300000 : false;
          
          sensorList.push({
            type: 'humidity',
            value: rh.current,
            unit: '%',
            fresh,
            age: age ? Math.round(age / 60000) : null
          });

          if (!fresh) issues.push('Humidity data stale');
        }

        // Check VPD
        if (sensors.vpd) {
          sensorList.push({
            type: 'vpd',
            value: sensors.vpd.current,
            unit: 'kPa',
            fresh: true
          });
        }

        // Check pressure
        if (sensors.pressureHpa) {
          sensorList.push({
            type: 'pressure',
            value: sensors.pressureHpa.current,
            unit: 'hPa',
            fresh: true
          });
        }

        // Check CO2
        if (sensors.co2) {
          sensorList.push({
            type: 'co2',
            value: sensors.co2.current,
            unit: 'ppm',
            fresh: true
          });
        }

        // Check air quality
        if (sensors.gasKohm) {
          sensorList.push({
            type: 'air_quality',
            value: sensors.gasKohm.current,
            unit: 'kΩ',
            fresh: true
          });
        }

        return {
          zone: zone.name || zone.id,
          sensorCount: sensorList.length,
          sensors: sensorList,
          issues,
          healthy: issues.length === 0
        };
      });

      const totalSensors = sensorChecks.reduce((sum, z) => sum + z.sensorCount, 0);
      const healthyZones = sensorChecks.filter(z => z.healthy).length;
      const allHealthy = healthyZones === sensorChecks.length && totalSensors > 0;

      return {
        status: allHealthy ? 'healthy' : (totalSensors > 0 ? 'warning' : 'error'),
        responseTime,
        zonesChecked: sensorChecks.length,
        healthyZones,
        totalSensors,
        zones: sensorChecks,
        message: allHealthy ? 
          `All ${totalSensors} sensors operational` : 
          `${healthyZones}/${sensorChecks.length} zones healthy`
      };
    } catch (error) {
      return {
        status: 'error',
        responseTime: Date.now() - startTime,
        error: error.message,
        message: 'Sensor check failed'
      };
    }
  }

  /**
   * Check light controller connectivity
   * @returns {Promise<Object>}
   */
  async checkLightControllers() {
    const startTime = Date.now();
    try {
      // Get groups to find light assignments
      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/data/groups`);
      const groupsData = await response.json();
      const responseTime = Date.now() - startTime;

      const groups = groupsData.groups || groupsData || [];
      
      if (groups.length === 0) {
        return {
          status: 'info',
          responseTime,
          message: 'No groups configured yet',
          controllers: []
        };
      }

      // Extract unique light controllers
      const controllers = new Map();
      groups.forEach(group => {
        if (group.lights && Array.isArray(group.lights)) {
          group.lights.forEach(light => {
            if (light.id && !controllers.has(light.id)) {
              controllers.set(light.id, {
                id: light.id,
                name: light.name || light.deviceName,
                protocol: light.protocol,
                ip: light.controllerIp,
                port: light.controllerPort,
                vendor: light.vendor,
                groups: [group.name]
              });
            } else if (light.id) {
              controllers.get(light.id).groups.push(group.name);
            }
          });
        }
      });

      if (controllers.size === 0) {
        return {
          status: 'warning',
          responseTime,
          message: 'No lights assigned to groups',
          controllers: []
        };
      }

      // Test connectivity to each controller
      const controllerArray = Array.from(controllers.values());
      const controllerChecks = await Promise.allSettled(
        controllerArray.map(async (controller) => {
          try {
            // Attempt ping to controller (if IP available)
            if (controller.ip && controller.port) {
              const pingResponse = await this.fetchWithTimeout(
                `${this.baseUrl}/api/lights/ping`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    ip: controller.ip,
                    port: controller.port,
                    protocol: controller.protocol
                  })
                }
              );
              const pingData = await pingResponse.json();
              
              return {
                ...controller,
                reachable: pingData.success || false,
                responseTime: pingData.responseTime || null
              };
            }
            
            return {
              ...controller,
              reachable: 'unknown',
              message: 'No IP configured'
            };
          } catch (error) {
            return {
              ...controller,
              reachable: false,
              error: error.message
            };
          }
        })
      );

      const results = controllerChecks.map(result => 
        result.status === 'fulfilled' ? result.value : { reachable: false, error: result.reason }
      );

      const reachableCount = results.filter(r => r.reachable === true).length;
      const allReachable = reachableCount === results.length && results.length > 0;

      return {
        status: allReachable ? 'healthy' : (reachableCount > 0 ? 'warning' : 'error'),
        responseTime,
        controllersFound: results.length,
        reachableCount,
        controllers: results,
        message: allReachable ? 
          `All ${results.length} controllers responsive` : 
          `${reachableCount}/${results.length} controllers reachable`
      };
    } catch (error) {
      return {
        status: 'error',
        responseTime: Date.now() - startTime,
        error: error.message,
        message: 'Light controller check failed'
      };
    }
  }

  /**
   * Check network connectivity and internet access
   * @returns {Promise<Object>}
   */
  async checkNetwork() {
    const startTime = Date.now();
    try {
      // Check if online
      const isOnline = navigator.onLine;
      
      if (!isOnline) {
        return {
          status: 'error',
          responseTime: Date.now() - startTime,
          online: false,
          message: 'Device offline'
        };
      }

      // Test internet connectivity (DNS resolution)
      const response = await this.fetchWithTimeout('https://www.google.com/generate_204', {
        method: 'HEAD',
        mode: 'no-cors'
      });

      const responseTime = Date.now() - startTime;

      return {
        status: 'healthy',
        responseTime,
        online: true,
        internetAccess: true,
        message: 'Network operational'
      };
    } catch (error) {
      return {
        status: 'warning',
        responseTime: Date.now() - startTime,
        online: navigator.onLine,
        internetAccess: false,
        error: error.message,
        message: 'Limited connectivity (local network only)'
      };
    }
  }

  /**
   * Check data file integrity
   * @returns {Promise<Object>}
   */
  async checkDataIntegrity() {
    const startTime = Date.now();
    try {
      const checks = await Promise.all([
        this.fetchWithTimeout(`${this.baseUrl}/api/data/farm`).then(r => r.json()),
        this.fetchWithTimeout(`${this.baseUrl}/api/data/rooms`).then(r => r.json()),
        this.fetchWithTimeout(`${this.baseUrl}/api/data/groups`).then(r => r.json())
      ]);

      const farm = checks[0];
      const rooms = checks[1];
      const groups = checks[2].groups || checks[2] || [];

      const issues = [];

      // Validate farm data
      if (!farm.farmId && !farm.id) issues.push('Farm ID missing');
      if (!farm.name) issues.push('Farm name missing');

      // Validate rooms
      if (!Array.isArray(rooms) || rooms.length === 0) {
        issues.push('No rooms configured');
      }

      // Validate groups
      if (groups.length > 0) {
        groups.forEach((group, idx) => {
          if (!group.id) issues.push(`Group ${idx + 1} missing ID`);
          if (!group.crop && !group.recipe) issues.push(`Group ${idx + 1} missing crop`);
          if (!group.zone && !group.zoneId) issues.push(`Group ${idx + 1} missing zone`);
        });
      }

      const responseTime = Date.now() - startTime;

      return {
        status: issues.length === 0 ? 'healthy' : 'warning',
        responseTime,
        issues,
        farm: {
          id: farm.farmId || farm.id,
          name: farm.name,
          valid: !!(farm.farmId || farm.id) && !!farm.name
        },
        rooms: {
          count: Array.isArray(rooms) ? rooms.length : 0,
          valid: Array.isArray(rooms) && rooms.length > 0
        },
        groups: {
          count: groups.length,
          valid: true
        },
        message: issues.length === 0 ? 'Data integrity verified' : `${issues.length} issue(s) found`
      };
    } catch (error) {
      return {
        status: 'error',
        responseTime: Date.now() - startTime,
        error: error.message,
        message: 'Data integrity check failed'
      };
    }
  }

  /**
   * Calculate overall system status
   * @param {Array} results - Array of check results
   * @returns {string} - 'healthy', 'degraded', or 'error'
   */
  calculateOverallStatus(results) {
    const statuses = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value.status);

    if (statuses.includes('error')) return 'error';
    if (statuses.includes('degraded') || statuses.includes('warning')) return 'degraded';
    return 'healthy';
  }

  /**
   * Fetch with timeout
   * @param {string} url
   * @param {Object} options
   * @returns {Promise<Response>}
   */
  async fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }
  }

  /**
   * Display results in UI
   * @param {Object} results - Health check results
   * @param {string} containerId - Container element ID
   */
  displayResults(results, containerId = 'health-check-results') {
    const container = document.getElementById(containerId);
    if (!container) {
      console.warn('[Health Check] Container not found:', containerId);
      return;
    }

    const statusColors = {
      healthy: '#10b981',
      degraded: '#f59e0b',
      warning: '#f59e0b',
      error: '#ef4444',
      disabled: '#6b7280',
      info: '#3b82f6'
    };

    const statusIcons = {
      healthy: '✓',
      degraded: '⚠',
      warning: '⚠',
      error: '✗',
      disabled: '○',
      info: 'ℹ'
    };

    let html = `
      <div style="padding: 1rem; background: var(--bg-card, #1a2332); border-radius: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
          <h3 style="margin: 0; color: ${statusColors[results.overall]};">
            ${statusIcons[results.overall]} System Health: ${results.overall.toUpperCase()}
          </h3>
          <small style="color: var(--text-secondary, #9ca3af);">
            ${new Date(results.timestamp).toLocaleTimeString()}
          </small>
        </div>
        <div style="display: grid; gap: 0.75rem;">
    `;

    Object.entries(results.checks).forEach(([name, check]) => {
      const displayName = name.replace(/([A-Z])/g, ' $1').trim();
      const color = statusColors[check.status] || '#6b7280';
      const icon = statusIcons[check.status] || '?';

      html += `
        <div style="padding: 0.75rem; background: var(--bg-secondary, #111827); border-left: 3px solid ${color}; border-radius: 4px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong style="color: ${color};">${icon} ${displayName}</strong>
              <div style="color: var(--text-secondary, #9ca3af); font-size: 0.875rem; margin-top: 0.25rem;">
                ${check.message}
              </div>
            </div>
            <div style="text-align: right; font-size: 0.75rem; color: var(--text-muted, #6b7280);">
              ${check.responseTime ? `${check.responseTime}ms` : ''}
            </div>
          </div>
      `;

      // Add details for specific checks
      if (name === 'sensors' && check.zones) {
        html += `<div style="margin-top: 0.5rem; font-size: 0.875rem;">`;
        check.zones.forEach(zone => {
          html += `<div style="margin-top: 0.25rem;">• ${zone.zone}: ${zone.sensorCount} sensors ${zone.healthy ? '✓' : '⚠'}</div>`;
        });
        html += `</div>`;
      }

      if (name === 'lightControllers' && check.controllers && check.controllers.length > 0) {
        html += `<div style="margin-top: 0.5rem; font-size: 0.875rem;">`;
        check.controllers.forEach(ctrl => {
          const status = ctrl.reachable === true ? '✓' : (ctrl.reachable === false ? '✗' : '?');
          html += `<div style="margin-top: 0.25rem;">• ${ctrl.name || ctrl.id}: ${status}</div>`;
        });
        html += `</div>`;
      }

      html += `</div>`;
    });

    html += `
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  /**
   * Generate text report
   * @param {Object} results - Health check results
   * @returns {string} - Text report
   */
  generateTextReport(results) {
    let report = `Light Engine Health Check Report\n`;
    report += `=================================\n\n`;
    report += `Timestamp: ${new Date(results.timestamp).toLocaleString()}\n`;
    report += `Overall Status: ${results.overall.toUpperCase()}\n\n`;

    Object.entries(results.checks).forEach(([name, check]) => {
      const displayName = name.replace(/([A-Z])/g, ' $1').trim();
      report += `${displayName}:\n`;
      report += `  Status: ${check.status}\n`;
      report += `  Message: ${check.message}\n`;
      if (check.responseTime) report += `  Response Time: ${check.responseTime}ms\n`;
      if (check.error) report += `  Error: ${check.error}\n`;
      report += `\n`;
    });

    return report;
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = HealthCheck;
}
