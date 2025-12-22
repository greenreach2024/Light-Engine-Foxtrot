/**
 * Farm Selection Optimizer
 * 
 * Intelligently selects supplier farms for wholesale orders based on:
 * - Product availability and certifications (filters)
 * - Geographic proximity and radius restrictions
 * - Route clustering (multiple farms in same direction)
 * - Logistics efficiency (minimize courier driving)
 * 
 * Algorithm prioritizes:
 * 1. Farms that meet ALL filter criteria
 * 2. Farms within radius restriction
 * 3. Farms that cluster well with others (same pickup route)
 * 4. Overall logistics cost and efficiency
 */

import db from '../lib/db.js';

class FarmSelectionOptimizer {
  constructor() {
    // Configuration for logistics optimization
    this.config = {
      // Radius restrictions (km)
      maxRadius: 150,           // Absolute maximum distance
      preferredRadius: 75,      // Preferred distance (bonus for being within)
      clusterRadius: 25,        // Consider farms within this distance as "clustered"
      
      // Scoring weights (must sum to 100)
      weights: {
        productMatch: 30,       // Has the products buyer needs
        certifications: 20,     // Meets filter requirements
        distance: 20,           // Proximity to buyer
        clustering: 15,         // Groups well with other farms
        quality: 10,            // Farm quality score
        price: 5                // Price competitiveness
      },
      
      // Clustering bonuses
      clusterBonus: 25,         // Bonus points for being in same cluster
      directionBonus: 15,       // Bonus for being in same direction
      
      // Efficiency thresholds
      minClusterSize: 2,        // Minimum farms to consider a "cluster"
      maxDetourPercent: 20,     // Max % extra distance for clustering
      
      // Penalties
      oppositeDirectionPenalty: 30,  // Penalty for being opposite direction
      isolatedFarmPenalty: 20        // Penalty for requiring separate trip
    };
  }

  /**
   * Select optimal farms for a wholesale order
   * 
   * @param {Object} order - Order details with items and buyer location
   * @param {Array} order.items - Products needed
   * @param {Object} order.buyer - Buyer location {lat, lng, address}
   * @param {Object} order.filters - Required certifications/attributes
   * @returns {Array} Ranked list of farm selections with logistics scores
   */
  async selectFarms(order) {
    console.log('[FarmOptimizer] Selecting farms for order:', {
      items: order.items.length,
      buyerLocation: order.buyer.city,
      filters: order.filters
    });

    // Step 1: Get all potential farms with required products
    const candidateFarms = await this.findCandidateFarms(order.items, order.filters);
    console.log(`[FarmOptimizer] Found ${candidateFarms.length} candidate farms`);

    if (candidateFarms.length === 0) {
      return [];
    }

    // Step 2: Filter by radius restriction
    const nearbyFarms = this.filterByRadius(candidateFarms, order.buyer);
    console.log(`[FarmOptimizer] ${nearbyFarms.length} farms within radius`);

    if (nearbyFarms.length === 0) {
      console.warn('[FarmOptimizer] No farms within radius, relaxing restriction...');
      // Return closest farms even if outside preferred radius
      return this.rankFarmsByDistance(candidateFarms, order.buyer).slice(0, 5);
    }

    // Step 3: Identify geographic clusters
    const clusters = this.identifyClusters(nearbyFarms, order.buyer);
    console.log(`[FarmOptimizer] Identified ${clusters.length} geographic clusters`);

    // Step 4: Score each farm considering logistics efficiency
    const rankedFarms = this.scoreAndRankFarms(nearbyFarms, clusters, order);
    
    // Step 5: Generate optimal farm combinations
    const optimalCombinations = this.generateOptimalCombinations(rankedFarms, order, clusters);
    
    console.log('[FarmOptimizer] Top 5 farm selections:', 
      optimalCombinations.slice(0, 5).map(f => ({
        farm: f.farm_name,
        score: f.totalScore,
        distance: `${f.distance.toFixed(1)}km`,
        cluster: f.clusterInfo?.clusterId
      }))
    );

    return optimalCombinations;
  }

  /**
   * Find farms that have required products and meet filter criteria
   */
  async findCandidateFarms(items, filters = {}) {
    // TODO: Replace with actual database query
    // For now, mock data structure
    const query = `
      SELECT DISTINCT f.*,
        f.latitude, f.longitude,
        f.certifications,
        f.quality_score,
        fi.product_id, fi.product_name, fi.available_quantity, fi.price_per_unit
      FROM farms f
      JOIN farm_inventory fi ON f.farm_id = fi.farm_id
      WHERE fi.available_quantity > 0
        AND f.is_active = true
        AND f.wholesale_enabled = true
    `;

    // Apply certification filters
    const certFilters = [];
    if (filters.organic) certFilters.push("'organic'");
    if (filters.locallyGrown) certFilters.push("'locally_grown'");
    if (filters.pesticide_free) certFilters.push("'pesticide_free'");
    
    let farms = await db.query(query); // Placeholder
    
    // Filter by certifications
    if (certFilters.length > 0) {
      farms = farms.filter(farm => {
        const farmCerts = farm.certifications || [];
        return certFilters.every(cert => farmCerts.includes(cert));
      });
    }

    // Group by farm and check if they have all required products
    const farmMap = new Map();
    for (const row of farms) {
      if (!farmMap.has(row.farm_id)) {
        farmMap.set(row.farm_id, {
          ...row,
          availableProducts: []
        });
      }
      farmMap.get(row.farm_id).availableProducts.push({
        product_id: row.product_id,
        product_name: row.product_name,
        available_quantity: row.available_quantity,
        price_per_unit: row.price_per_unit
      });
    }

    // Filter farms that can fulfill at least one product
    const candidateFarms = Array.from(farmMap.values()).filter(farm => {
      return items.some(item => 
        farm.availableProducts.some(p => 
          p.product_id === item.product_id && 
          p.available_quantity >= item.quantity
        )
      );
    });

    return candidateFarms;
  }

  /**
   * Filter farms by maximum radius from buyer
   */
  filterByRadius(farms, buyer) {
    return farms.map(farm => {
      const distance = this.calculateDistance(
        buyer.latitude, buyer.longitude,
        farm.latitude, farm.longitude
      );
      
      return {
        ...farm,
        distance,
        withinPreferredRadius: distance <= this.config.preferredRadius
      };
    }).filter(farm => farm.distance <= this.config.maxRadius);
  }

  /**
   * Identify geographic clusters of farms
   * Farms within clusterRadius of each other are grouped
   */
  identifyClusters(farms, buyer) {
    const clusters = [];
    const assigned = new Set();

    // Calculate direction (bearing) from buyer to each farm
    farms.forEach(farm => {
      farm.bearing = this.calculateBearing(
        buyer.latitude, buyer.longitude,
        farm.latitude, farm.longitude
      );
    });

    // Sort by distance to process closest farms first
    const sortedFarms = [...farms].sort((a, b) => a.distance - b.distance);

    for (const farm of sortedFarms) {
      if (assigned.has(farm.farm_id)) continue;

      // Start new cluster
      const cluster = {
        clusterId: clusters.length + 1,
        centerLat: farm.latitude,
        centerLng: farm.longitude,
        avgDistance: farm.distance,
        avgBearing: farm.bearing,
        farms: [farm],
        bearingRange: [farm.bearing, farm.bearing]
      };

      assigned.add(farm.farm_id);

      // Find nearby farms in similar direction
      for (const otherFarm of sortedFarms) {
        if (assigned.has(otherFarm.farm_id)) continue;

        const distanceToCluster = this.calculateDistance(
          cluster.centerLat, cluster.centerLng,
          otherFarm.latitude, otherFarm.longitude
        );

        const bearingDiff = Math.abs(cluster.avgBearing - otherFarm.bearing);
        const normalizedBearingDiff = Math.min(bearingDiff, 360 - bearingDiff);

        // Add to cluster if close and similar direction (within 45 degrees)
        if (distanceToCluster <= this.config.clusterRadius && 
            normalizedBearingDiff <= 45) {
          cluster.farms.push(otherFarm);
          assigned.add(otherFarm.farm_id);
          
          // Update cluster center (weighted average)
          const weight = cluster.farms.length;
          cluster.centerLat = (cluster.centerLat * (weight - 1) + otherFarm.latitude) / weight;
          cluster.centerLng = (cluster.centerLng * (weight - 1) + otherFarm.longitude) / weight;
          cluster.avgDistance = (cluster.avgDistance * (weight - 1) + otherFarm.distance) / weight;
          cluster.avgBearing = (cluster.avgBearing * (weight - 1) + otherFarm.bearing) / weight;
          
          cluster.bearingRange[0] = Math.min(cluster.bearingRange[0], otherFarm.bearing);
          cluster.bearingRange[1] = Math.max(cluster.bearingRange[1], otherFarm.bearing);
        }
      }

      // Only keep clusters with multiple farms or very close single farms
      if (cluster.farms.length >= this.config.minClusterSize || 
          cluster.avgDistance <= this.config.preferredRadius * 0.5) {
        clusters.push(cluster);
      }
    }

    console.log('[FarmOptimizer] Cluster details:', clusters.map(c => ({
      id: c.clusterId,
      farms: c.farms.length,
      avgDistance: `${c.avgDistance.toFixed(1)}km`,
      direction: `${c.avgBearing.toFixed(0)}°`
    })));

    return clusters;
  }

  /**
   * Score each farm considering all factors
   */
  scoreAndRankFarms(farms, clusters, order) {
    const scored = farms.map(farm => {
      const scores = {
        productMatch: this.scoreProductMatch(farm, order.items),
        certifications: this.scoreCertifications(farm, order.filters),
        distance: this.scoreDistance(farm.distance),
        clustering: this.scoreClustering(farm, clusters),
        quality: farm.quality_score || 50,
        price: this.scorePricing(farm, order.items)
      };

      // Calculate weighted total score
      const totalScore = Object.entries(scores).reduce((total, [key, score]) => {
        return total + (score * this.config.weights[key] / 100);
      }, 0);

      // Find cluster info
      const cluster = clusters.find(c => 
        c.farms.some(f => f.farm_id === farm.farm_id)
      );

      return {
        ...farm,
        scores,
        totalScore,
        clusterInfo: cluster ? {
          clusterId: cluster.clusterId,
          clusterSize: cluster.farms.length,
          clusterAvgDistance: cluster.avgDistance
        } : null
      };
    });

    return scored.sort((a, b) => b.totalScore - a.totalScore);
  }

  /**
   * Generate optimal farm combinations considering route efficiency
   */
  generateOptimalCombinations(rankedFarms, order, clusters) {
    const combinations = [];

    // Strategy 1: Prefer largest clusters first (most efficient routes)
    const clusterFarms = rankedFarms.filter(f => f.clusterInfo !== null);
    const isolatedFarms = rankedFarms.filter(f => f.clusterInfo === null);

    // Sort clusters by efficiency (size and distance)
    const sortedClusters = clusters
      .sort((a, b) => {
        const scoreA = (a.farms.length * 2) - (a.avgDistance / 10);
        const scoreB = (b.farms.length * 2) - (b.avgDistance / 10);
        return scoreB - scoreA;
      });

    // Add farms from best clusters first
    for (const cluster of sortedClusters) {
      const clusterFarmList = clusterFarms.filter(f => 
        f.clusterInfo.clusterId === cluster.clusterId
      );
      
      for (const farm of clusterFarmList) {
        combinations.push({
          ...farm,
          selectionReason: `Cluster ${cluster.clusterId} (${cluster.farms.length} farms, ${cluster.avgDistance.toFixed(1)}km avg)`,
          routeEfficiency: 'high',
          estimatedDeliveryTime: this.estimateDeliveryTime(cluster.avgDistance, cluster.farms.length)
        });
      }
    }

    // Add isolated farms (lower priority)
    for (const farm of isolatedFarms) {
      combinations.push({
        ...farm,
        selectionReason: 'Isolated farm (requires separate pickup)',
        routeEfficiency: 'low',
        estimatedDeliveryTime: this.estimateDeliveryTime(farm.distance, 1)
      });
    }

    return combinations;
  }

  /**
   * Scoring functions
   */
  
  scoreProductMatch(farm, items) {
    const matchedItems = items.filter(item =>
      farm.availableProducts.some(p => 
        p.product_id === item.product_id && 
        p.available_quantity >= item.quantity
      )
    );
    return (matchedItems.length / items.length) * 100;
  }

  scoreCertifications(farm, filters) {
    if (!filters || Object.keys(filters).length === 0) return 100;
    
    const requiredCerts = Object.entries(filters)
      .filter(([key, value]) => value === true)
      .map(([key]) => key);
    
    if (requiredCerts.length === 0) return 100;
    
    const farmCerts = farm.certifications || [];
    const matchedCerts = requiredCerts.filter(cert => farmCerts.includes(cert));
    
    return (matchedCerts.length / requiredCerts.length) * 100;
  }

  scoreDistance(distance) {
    // Score decreases linearly with distance
    // 0km = 100 points, maxRadius = 0 points
    const score = Math.max(0, 100 * (1 - distance / this.config.maxRadius));
    
    // Bonus for being within preferred radius
    if (distance <= this.config.preferredRadius) {
      return Math.min(100, score * 1.2);
    }
    
    return score;
  }

  scoreClustering(farm, clusters) {
    const cluster = clusters.find(c => 
      c.farms.some(f => f.farm_id === farm.farm_id)
    );

    if (!cluster) {
      // Isolated farm - penalty
      return Math.max(0, 50 - this.config.isolatedFarmPenalty);
    }

    // Score based on cluster size and proximity
    const sizeScore = Math.min(50, cluster.farms.length * 10);
    const proximityScore = Math.max(0, 50 * (1 - cluster.avgDistance / this.config.maxRadius));
    
    return sizeScore + proximityScore;
  }

  scorePricing(farm, items) {
    // Calculate average price percentile
    // For now, assume 50 (would need market data)
    return 50;
  }

  /**
   * Distance calculation using Haversine formula
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Calculate bearing (direction) from point A to point B
   * Returns angle in degrees (0-360, where 0 is North)
   */
  calculateBearing(lat1, lon1, lat2, lon2) {
    const dLon = this.toRad(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(this.toRad(lat2));
    const x = Math.cos(this.toRad(lat1)) * Math.sin(this.toRad(lat2)) -
              Math.sin(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) * Math.cos(dLon);
    
    let bearing = Math.atan2(y, x);
    bearing = this.toDeg(bearing);
    return (bearing + 360) % 360;
  }

  toRad(degrees) {
    return degrees * Math.PI / 180;
  }

  toDeg(radians) {
    return radians * 180 / Math.PI;
  }

  /**
   * Rank farms by distance only (fallback when no farms in radius)
   */
  rankFarmsByDistance(farms, buyer) {
    return farms.map(farm => ({
      ...farm,
      distance: this.calculateDistance(
        buyer.latitude, buyer.longitude,
        farm.latitude, farm.longitude
      )
    }))
    .sort((a, b) => a.distance - b.distance);
  }

  /**
   * Estimate delivery time based on distance and number of stops
   */
  estimateDeliveryTime(avgDistance, numStops) {
    const drivingTimePerKm = 1.5; // minutes per km (40 km/h average in rural areas)
    const stopTime = 15; // minutes per farm stop
    
    const totalDrivingTime = avgDistance * drivingTimePerKm;
    const totalStopTime = numStops * stopTime;
    const bufferTime = 30; // general buffer
    
    return Math.ceil(totalDrivingTime + totalStopTime + bufferTime);
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = {
      ...this.config,
      ...newConfig
    };
    console.log('[FarmOptimizer] Configuration updated:', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig() {
    return { ...this.config };
  }
}

export default new FarmSelectionOptimizer();
