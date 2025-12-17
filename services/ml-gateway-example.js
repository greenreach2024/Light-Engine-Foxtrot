// Example usage of services/ml-gateway.js

import { getAnomalies, getEffects, getCacheStats, clearCache } from './services/ml-gateway.js';

// Example 1: Get anomalies (cached for 15 seconds)
async function checkForAnomalies() {
  try {
    const result = await getAnomalies();
    
    if (result.ok) {
      console.log(`Found ${result.count} anomalies`);
      
      if (result.anomalies?.length > 0) {
        result.anomalies.forEach(anomaly => {
          console.log(`  - ${anomaly.severity}: ${anomaly.message}`);
        });
      }
    } else {
      console.error('ML anomaly detection failed:', result.error);
    }
  } catch (error) {
    console.error('Failed to fetch anomalies:', error.message);
  }
}

// Example 2: Get effects (cached for 5 minutes)
async function getRecommendations() {
  try {
    const result = await getEffects();
    console.log('ML effects/recommendations:', result);
  } catch (error) {
    console.error('Failed to fetch effects:', error.message);
  }
}

// Example 3: Check cache statistics
function logCacheStatus() {
  const stats = getCacheStats();
  console.log('ML Gateway Cache Status:');
  console.log('  Anomalies:', stats.anomalies);
  console.log('  Effects:', stats.effects);
}

// Example 4: Force refresh by clearing cache
function forceRefresh() {
  clearCache();
  console.log('ML gateway cache cleared - next call will fetch fresh data');
}

// Run examples
(async () => {
  await checkForAnomalies();
  logCacheStatus();
  
  // Second call uses cache
  console.log('\nSecond call (should use cache):');
  await checkForAnomalies();
  
  // Force refresh
  console.log('\nForcing refresh:');
  forceRefresh();
  await checkForAnomalies();
})();
