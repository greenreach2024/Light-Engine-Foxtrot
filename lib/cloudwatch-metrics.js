/**
 * AWS CloudWatch Metrics Integration
 * Publishes custom metrics for monitoring and alerting
 * 
 * Environment Variables:
 * - CLOUDWATCH_ENABLED: Enable CloudWatch metrics (default: false)
 * - CLOUDWATCH_NAMESPACE: Metrics namespace (default: LightEngine/Foxtrot)
 * - CLOUDWATCH_REGION: AWS region (default: us-east-1)
 * - AWS_ACCESS_KEY_ID: AWS credentials (from environment)
 * - AWS_SECRET_ACCESS_KEY: AWS credentials (from environment)
 */

import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

const CLOUDWATCH_ENABLED = String(process.env.CLOUDWATCH_ENABLED || 'false').toLowerCase() === 'true';
const CLOUDWATCH_NAMESPACE = process.env.CLOUDWATCH_NAMESPACE || 'LightEngine/Foxtrot';
const CLOUDWATCH_REGION = process.env.CLOUDWATCH_REGION || 'us-east-1';

let cloudWatchClient = null;

if (CLOUDWATCH_ENABLED) {
  try {
    cloudWatchClient = new CloudWatchClient({ region: CLOUDWATCH_REGION });
    console.log(`[CloudWatch] Metrics enabled - namespace: ${CLOUDWATCH_NAMESPACE}, region: ${CLOUDWATCH_REGION}`);
  } catch (error) {
    console.error('[CloudWatch] Failed to initialize client:', error.message);
  }
}

/**
 * Publish a metric to CloudWatch
 * @param {string} metricName - Name of the metric
 * @param {number} value - Metric value
 * @param {string} unit - Metric unit (Count, Milliseconds, Percent, Bytes, etc.)
 * @param {Array} dimensions - Array of {Name, Value} dimension objects
 * @returns {Promise<boolean>} Success status
 */
export async function publishMetric(metricName, value, unit = 'Count', dimensions = []) {
  if (!CLOUDWATCH_ENABLED || !cloudWatchClient) {
    return false;
  }

  try {
    const params = {
      Namespace: CLOUDWATCH_NAMESPACE,
      MetricData: [
        {
          MetricName: metricName,
          Value: value,
          Unit: unit,
          Timestamp: new Date(),
          Dimensions: dimensions
        }
      ]
    };

    const command = new PutMetricDataCommand(params);
    await cloudWatchClient.send(command);
    
    return true;
  } catch (error) {
    console.error(`[CloudWatch] Failed to publish metric ${metricName}:`, error.message);
    return false;
  }
}

/**
 * Publish multiple metrics in a single call
 * @param {Array} metrics - Array of {metricName, value, unit, dimensions} objects
 * @returns {Promise<boolean>} Success status
 */
export async function publishMetrics(metrics) {
  if (!CLOUDWATCH_ENABLED || !cloudWatchClient || !metrics || metrics.length === 0) {
    return false;
  }

  try {
    const metricData = metrics.map(metric => ({
      MetricName: metric.metricName,
      Value: metric.value,
      Unit: metric.unit || 'Count',
      Timestamp: new Date(),
      Dimensions: metric.dimensions || []
    }));

    const params = {
      Namespace: CLOUDWATCH_NAMESPACE,
      MetricData: metricData
    };

    const command = new PutMetricDataCommand(params);
    await cloudWatchClient.send(command);
    
    return true;
  } catch (error) {
    console.error('[CloudWatch] Failed to publish metrics:', error.message);
    return false;
  }
}

/**
 * Publish API request metrics
 * @param {string} endpoint - API endpoint path
 * @param {string} method - HTTP method
 * @param {number} statusCode - Response status code
 * @param {number} responseTimeMs - Response time in milliseconds
 * @returns {Promise<boolean>} Success status
 */
export async function publishApiMetrics(endpoint, method, statusCode, responseTimeMs) {
  const dimensions = [
    { Name: 'Endpoint', Value: endpoint },
    { Name: 'Method', Value: method },
    { Name: 'StatusCode', Value: String(statusCode) }
  ];

  const metrics = [
    {
      metricName: 'APIResponseTime',
      value: responseTimeMs,
      unit: 'Milliseconds',
      dimensions
    },
    {
      metricName: 'APIRequests',
      value: 1,
      unit: 'Count',
      dimensions
    }
  ];

  // Add error metric if status code >= 400
  if (statusCode >= 400) {
    metrics.push({
      metricName: 'APIErrors',
      value: 1,
      unit: 'Count',
      dimensions
    });
  }

  return publishMetrics(metrics);
}

/**
 * Publish database health metrics
 * @param {string} mode - Database mode (postgresql or nedb)
 * @param {boolean} connected - Connection status
 * @param {number} latencyMs - Connection latency in milliseconds
 * @returns {Promise<boolean>} Success status
 */
export async function publishDatabaseMetrics(mode, connected, latencyMs) {
  const dimensions = [{ Name: 'DatabaseMode', Value: mode }];

  const metrics = [
    {
      metricName: 'DatabaseConnected',
      value: connected ? 1 : 0,
      unit: 'Count',
      dimensions
    },
    {
      metricName: 'DatabaseLatency',
      value: latencyMs || 0,
      unit: 'Milliseconds',
      dimensions
    }
  ];

  return publishMetrics(metrics);
}

/**
 * Publish memory usage metrics
 * @param {number} usedMB - Used memory in megabytes
 * @param {number} totalMB - Total memory in megabytes
 * @returns {Promise<boolean>} Success status
 */
export async function publishMemoryMetrics(usedMB, totalMB) {
  const percentUsed = (usedMB / totalMB) * 100;

  const metrics = [
    {
      metricName: 'MemoryUsed',
      value: usedMB,
      unit: 'Megabytes',
      dimensions: []
    },
    {
      metricName: 'MemoryPercent',
      value: percentUsed,
      unit: 'Percent',
      dimensions: []
    }
  ];

  return publishMetrics(metrics);
}

/**
 * Publish wholesale order metrics
 * @param {string} farmId - Farm identifier
 * @param {string} status - Order status (reserved, confirmed, released)
 * @param {number} count - Number of orders
 * @returns {Promise<boolean>} Success status
 */
export async function publishOrderMetrics(farmId, status, count = 1) {
  const dimensions = [
    { Name: 'FarmId', Value: farmId },
    { Name: 'OrderStatus', Value: status }
  ];

  return publishMetric('WholesaleOrders', count, 'Count', dimensions);
}

/**
 * Publish inventory metrics
 * @param {string} farmId - Farm identifier
 * @param {number} availableQuantity - Available inventory
 * @param {number} reservedQuantity - Reserved inventory
 * @returns {Promise<boolean>} Success status
 */
export async function publishInventoryMetrics(farmId, availableQuantity, reservedQuantity) {
  const dimensions = [{ Name: 'FarmId', Value: farmId }];

  const metrics = [
    {
      metricName: 'InventoryAvailable',
      value: availableQuantity,
      unit: 'Count',
      dimensions
    },
    {
      metricName: 'InventoryReserved',
      value: reservedQuantity,
      unit: 'Count',
      dimensions
    }
  ];

  return publishMetrics(metrics);
}

/**
 * Check if CloudWatch is enabled
 * @returns {boolean} CloudWatch enabled status
 */
export function isCloudWatchEnabled() {
  return CLOUDWATCH_ENABLED && cloudWatchClient !== null;
}

/**
 * Get CloudWatch configuration
 * @returns {Object} CloudWatch configuration
 */
export function getCloudWatchConfig() {
  return {
    enabled: CLOUDWATCH_ENABLED,
    namespace: CLOUDWATCH_NAMESPACE,
    region: CLOUDWATCH_REGION
  };
}

export default {
  publishMetric,
  publishMetrics,
  publishApiMetrics,
  publishDatabaseMetrics,
  publishMemoryMetrics,
  publishOrderMetrics,
  publishInventoryMetrics,
  isCloudWatchEnabled,
  getCloudWatchConfig
};
