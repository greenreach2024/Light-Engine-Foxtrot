import axios from 'axios';

class ApiService {
  constructor() {
    this.client = axios.create({
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    this.baseURL = 'http://localhost:8000'; // Default for development
  }

  setBaseURL(url) {
    // Remove trailing slash and ensure proper format
    this.baseURL = url.replace(/\/$/, '');
    this.client.defaults.baseURL = this.baseURL;
  }

  setAuthToken(token) {
    if (token) {
      this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete this.client.defaults.headers.common['Authorization'];
    }
  }

  // Recipes
  async getRecipes() {
    const response = await this.client.get('/api/recipes');
    return response.data;
  }

  // Tray Formats
  async getTrayFormats() {
    const response = await this.client.get('/api/tray-formats');
    return response.data;
  }

  async createTrayFormat(data) {
    const response = await this.client.post('/api/tray-formats', data);
    return response.data;
  }

  // Trays
  async registerTray(qrCodeValue, trayFormatId) {
    const response = await this.client.post('/api/trays/register', {
      qrCodeValue,
      trayFormatId,
    });
    return response.data;
  }

  async seedTray(trayId, recipeId, seedDate, plantedSiteCount) {
    const response = await this.client.post(`/api/trays/${trayId}/seed`, {
      recipeId,
      seedDate,
      plantedSiteCount,
    });
    return response.data;
  }

  async getTrayInfo(qrCode) {
    const response = await this.client.get(`/api/trays/by-qr/${qrCode}`);
    return response.data;
  }

  // Tray Runs
  async placeTray(trayRunId, locationId, placedAt = null, note = null) {
    const response = await this.client.post(`/api/tray-runs/${trayRunId}/place`, {
      locationId,
      placedAt: placedAt || new Date().toISOString(),
      note,
    });
    return response.data;
  }

  async harvestTray(trayRunId, harvestedAt = null, actualHarvestCount = null, note = null) {
    const response = await this.client.post(`/api/tray-runs/${trayRunId}/harvest`, {
      harvestedAt: harvestedAt || new Date().toISOString(),
      actualHarvestCount,
      note,
    });
    return response.data;
  }

  // Locations
  async getLocations(groupId = null) {
    const params = groupId ? { group_id: groupId } : {};
    const response = await this.client.get('/api/locations', { params });
    return response.data;
  }

  async getLocationByQR(qrCode) {
    const response = await this.client.get(`/api/locations/by-qr/${qrCode}`);
    return response.data;
  }

  async registerLocation(qrCodeValue, groupId, name = null) {
    const response = await this.client.post('/api/locations', {
      qrCodeValue,
      groupId,
      name,
    });
    return response.data;
  }

  // Inventory
  async getCurrentInventory(tenantId) {
    const response = await this.client.get('/api/inventory/current', {
      params: { tenant_id: tenantId },
    });
    return response.data;
  }

  async getHarvestForecast(tenantId) {
    const response = await this.client.get('/api/inventory/forecast', {
      params: { tenant_id: tenantId },
    });
    return response.data;
  }

  // Farms
  async getFarms() {
    const response = await this.client.get('/api/farms');
    return response.data;
  }

  async createFarm(name) {
    const response = await this.client.post('/api/farms', { name });
    return response.data;
  }

  // Groups (for hierarchical organization)
  async getGroups(zoneId = null) {
    const params = zoneId ? { zone_id: zoneId } : {};
    const response = await this.client.get('/api/groups', { params });
    return response.data;
  }

  // Environment & Sensors
  async getEnvironmentData(roomId = 'all', timeRange = '1h') {
    try {
      const response = await this.client.get('/env', {
        params: { room: roomId, range: timeRange },
      });
      return response.data;
    } catch (error) {
      console.warn('Environment data endpoint unavailable, using mock data');
      throw error;
    }
  }

  async getAnomalies() {
    try {
      const response = await this.client.get('/api/ml/anomalies');
      return response.data;
    } catch (error) {
      console.warn('ML anomalies endpoint unavailable:', error.message);
      // Return empty anomalies list when endpoint unavailable
      return { anomalies: [], error: 'ML service unavailable' };
    }
  }

  async getForecast(zone, hours = 2, metric = 'indoor_temp') {
    const response = await this.client.get('/api/ml/forecast', {
      params: { zone, hours, metric },
    });
    return response.data;
  }

  // Notifications
  async getNotifications() {
    // Mock data for now - backend implementation needed
    return [
      {
        id: '1',
        type: 'harvest',
        severity: 'info',
        title: 'Harvest Ready',
        message: '5 trays of Buttercrunch Lettuce ready for harvest today',
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        read: false,
      },
      {
        id: '2',
        type: 'anomaly',
        severity: 'warning',
        title: 'Temperature Alert',
        message: 'Grow Room 1: Temperature 28°C (target: 24°C)',
        timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
        read: false,
      },
      {
        id: '3',
        type: 'device',
        severity: 'critical',
        title: 'Device Offline',
        message: 'Humidity sensor #3 not responding for 15 minutes',
        timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        read: true,
      },
    ];
  }

  async markNotificationRead(notificationId) {
    // TODO: Implement backend endpoint
    return { success: true };
  }

  async markAllNotificationsRead() {
    // TODO: Implement backend endpoint
    return { success: true };
  }

  async updateNotificationPreferences(preferences) {
    // TODO: Implement backend endpoint
    return { success: true };
  }

  // Crops
  async getCrops() {
    const response = await this.client.get('/api/crops');
    return response.data;
  }

  // Loss Tracking
  async reportTrayLoss(trayRunId, lossData) {
    const response = await this.client.post(`/api/tray-runs/${trayRunId}/loss`, lossData);
    return response.data;
  }

  async getTrayLossEvents(trayRunId) {
    const response = await this.client.get(`/api/tray-runs/${trayRunId}/loss-events`);
    return response.data;
  }

  async getCurrentLosses(farmId) {
    const params = farmId ? { farmId } : {};
    const response = await this.client.get('/api/losses/current', { params });
    return response.data;
  }
}

export default new ApiService();
