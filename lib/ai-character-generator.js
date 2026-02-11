/**
 * AI-Powered Character SVG Generator
 * Generates unique animated characters based on farm vitality component data
 * Uses procedural generation with AI-inspired variation algorithms
 */

class AICharacterGenerator {
  constructor() {
    this.characterCache = new Map();
  }

  /**
   * Generate a unique character for a component
   * @param {string} componentType - environment, crops, nutrients, systems
   * @param {number} score - 0-100 health score
   * @param {string} emotion - happy, neutral, worried, critical
   * @returns {Object} Character definition with SVG paths and animation data
   */
  generateCharacter(componentType, score, emotion) {
    const cacheKey = `${componentType}_${Math.floor(score / 10)}_${emotion}`;
    
    if (this.characterCache.has(cacheKey)) {
      return this.characterCache.get(cacheKey);
    }

    let character;
    switch (componentType) {
      case 'environment':
        character = this.generateCloudSpirit(score, emotion);
        break;
      case 'crops':
      case 'crop_readiness':
        character = this.generatePlantCreature(score, emotion);
        break;
      case 'nutrients':
      case 'nutrient_health':
        character = this.generateDropletBeing(score, emotion);
        break;
      case 'operations':
      case 'systems':
        character = this.generateGearBot(score, emotion);
        break;
      default:
        character = this.generateBlobCreature(score, emotion);
    }

    this.characterCache.set(cacheKey, character);
    return character;
  }

  /**
   * Cloud Spirit - Fluid, airy character for Environment
   */
  generateCloudSpirit(score, emotion) {
    const healthFactor = score / 100;
    const puffiness = 0.6 + healthFactor * 0.4; // More puffy when healthy
    
    return {
      type: 'cloud_spirit',
      paths: {
        // Main cloud body (morphing organic shape)
        body: this.generateCloudPath(1.0, puffiness),
        leftWing: this.generateCloudPath(0.4, puffiness * 0.8),
        rightWing: this.generateCloudPath(0.4, puffiness * 0.8),
      },
      eyes: {
        count: 2,
        size: 0.12,
        spacing: 0.3,
        yOffset: -0.15,
        sparkle: true
      },
      mouth: this.getMouthShape(emotion, 'round'),
      particles: {
        type: 'wind_swirls',
        count: 8,
        speed: 0.5 + healthFactor * 0.5
      },
      animation: {
        float: { amplitude: 0.03, frequency: 0.02 },
        breathe: { amplitude: 0.05, frequency: 0.03 },
        wingFlap: { amplitude: 0.1, frequency: 0.04 }
      },
      colors: {
        primary: score > 80 ? '#a5d8ff' : score > 50 ? '#74c0fc' : '#4dabf7',
        secondary: '#e7f5ff',
        accent: '#3b9edb'
      }
    };
  }

  /**
   * Plant Creature - Growing, leafy character for Crops
   */
  generatePlantCreature(score, emotion) {
    const healthFactor = score / 100;
    const leafCount = Math.floor(3 + healthFactor * 3); // More leaves when healthy
    
    return {
      type: 'plant_creature',
      paths: {
        stem: this.generateStemPath(healthFactor),
        head: this.generateLeafHeadPath(healthFactor),
        leaves: this.generateMultipleLeaves(leafCount, healthFactor)
      },
      eyes: {
        count: 2,
        size: 0.14,
        spacing: 0.25,
        yOffset: -0.1,
        sparkle: true
      },
      mouth: this.getMouthShape(emotion, 'wide'),
      particles: {
        type: 'sparkles',
        count: score > 80 ? 6 : 3,
        speed: 0.3
      },
      animation: {
        sway: { amplitude: 0.08, frequency: 0.025 },
        grow: { amplitude: 0.03, frequency: 0.02 },
        leafRustle: { amplitude: 0.15, frequency: 0.05 }
      },
      colors: {
        primary: score > 80 ? '#51cf66' : score > 50 ? '#37b24d' : '#2f9e44',
        secondary: '#d3f9d8',
        accent: '#087f5b'
      }
    };
  }

  /**
   * Droplet Being - Liquid, flowing character for Nutrients
   */
  generateDropletBeing(score, emotion) {
    const healthFactor = score / 100;
    const viscosity = 0.5 + healthFactor * 0.5; // More fluid when healthy
    
    return {
      type: 'droplet_being',
      paths: {
        body: this.generateDropletPath(1.0, viscosity),
        leftArm: this.generateTentaclePath(0.6, viscosity),
        rightArm: this.generateTentaclePath(0.6, viscosity),
        tail: this.generateTentaclePath(0.8, viscosity)
      },
      eyes: {
        count: 2,
        size: 0.13,
        spacing: 0.28,
        yOffset: -0.2,
        sparkle: true,
        reflective: true
      },
      mouth: this.getMouthShape(emotion, 'small'),
      particles: {
        type: 'bubbles',
        count: 12,
        speed: 0.4 + healthFactor * 0.4
      },
      animation: {
        drip: { amplitude: 0.04, frequency: 0.03 },
        ripple: { amplitude: 0.06, frequency: 0.04 },
        tentacleWave: { amplitude: 0.2, frequency: 0.03 }
      },
      colors: {
        primary: score > 80 ? '#4dabf7' : score > 50 ? '#339af0' : '#1971c2',
        secondary: '#d0ebff',
        accent: '#1864ab',
        shimmer: 'rgba(255, 255, 255, 0.6)'
      }
    };
  }

  /**
   * Gear Bot - Mechanical, robotic character for Systems
   */
  generateGearBot(score, emotion) {
    const healthFactor = score / 100;
    const gearCount = Math.floor(2 + healthFactor * 2);
    
    return {
      type: 'gear_bot',
      paths: {
        chassis: this.generateChassis(healthFactor),
        head: this.generateBotHead(healthFactor),
        gears: this.generateMultipleGears(gearCount),
        antenna: this.generateAntennaPath(healthFactor)
      },
      eyes: {
        count: 2,
        size: 0.11,
        spacing: 0.32,
        yOffset: -0.05,
        style: 'digital',
        glow: true
      },
      mouth: this.getMouthShape(emotion, 'digital'),
      particles: {
        type: 'sparks',
        count: score > 80 ? 8 : 4,
        speed: 0.6
      },
      animation: {
        idle: { amplitude: 0.02, frequency: 0.04 },
        gearSpin: { speed: 0.1 + healthFactor * 0.1, direction: [1, -1, 1] },
        antennaBlink: { frequency: 0.5 }
      },
      colors: {
        primary: score > 80 ? '#748ffc' : score > 50 ? '#5c7cfa' : '#4c6ef5',
        secondary: '#e5dbff',
        accent: '#364fc7',
        metallic: '#adb5bd'
      }
    };
  }

  /**
   * Generic Blob Creature - Fallback character
   */
  generateBlobCreature(score, emotion) {
    const healthFactor = score / 100;
    
    return {
      type: 'blob_creature',
      paths: {
        body: this.generateBlobPath(1.0, healthFactor)
      },
      eyes: {
        count: 2,
        size: 0.15,
        spacing: 0.3,
        yOffset: -0.15,
        sparkle: true
      },
      mouth: this.getMouthShape(emotion, 'round'),
      particles: {
        type: 'sparkles',
        count: 5,
        speed: 0.4
      },
      animation: {
        bounce: { amplitude: 0.05, frequency: 0.03 },
        squish: { amplitude: 0.08, frequency: 0.025 }
      },
      colors: {
        primary: '#ff6b9d',
        secondary: '#ffe3e8',
        accent: '#e8366f'
      }
    };
  }

  // ============ PATH GENERATORS ============

  generateCloudPath(scale, puffiness) {
    // Bezier curve points for organic cloud shape
    const points = [];
    const segments = 8;
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const radius = scale * (0.8 + Math.sin(i * 1.7) * 0.2 * puffiness);
      points.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius
      });
    }
    return this.pointsToBezierPath(points, true);
  }

  generateStemPath(health) {
    return {
      type: 'quadratic',
      points: [
        { x: 0, y: 0.3 },
        { x: 0.05 * health, y: 0 },
        { x: 0, y: -0.3 }
      ]
    };
  }

  generateLeafHeadPath(health) {
    const width = 0.6 + health * 0.2;
    return {
      type: 'bezier',
      points: [
        { x: -width/2, y: 0 },
        { x: -width/2, y: -0.4 },
        { x: 0, y: -0.6 },
        { x: width/2, y: -0.4 },
        { x: width/2, y: 0 }
      ]
    };
  }

  generateMultipleLeaves(count, health) {
    const leaves = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const size = 0.2 + Math.random() * 0.15 * health;
      leaves.push({
        angle,
        size,
        path: this.generateLeafPath(size)
      });
    }
    return leaves;
  }

  generateLeafPath(size) {
    return {
      type: 'bezier',
      points: [
        { x: 0, y: 0 },
        { x: size * 0.3, y: -size * 0.5 },
        { x: 0, y: -size },
        { x: -size * 0.3, y: -size * 0.5 },
        { x: 0, y: 0 }
      ]
    };
  }

  generateDropletPath(scale, viscosity) {
    const top = -0.5 * scale;
    const bottom = 0.5 * scale;
    const width = 0.4 * scale * viscosity;
    
    return {
      type: 'bezier',
      points: [
        { x: 0, y: top },
        { x: width, y: top * 0.3 },
        { x: width, y: bottom * 0.3 },
        { x: 0, y: bottom },
        { x: -width, y: bottom * 0.3 },
        { x: -width, y: top * 0.3 },
        { x: 0, y: top }
      ]
    };
  }

  generateTentaclePath(length, viscosity) {
    const segments = 4;
    const points = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const wave = Math.sin(t * Math.PI * 2) * 0.1 * viscosity;
      points.push({
        x: wave,
        y: t * length
      });
    }
    return { type: 'smooth', points };
  }

  generateChassis(health) {
    const width = 0.4;
    const height = 0.3;
    return {
      type: 'rect',
      x: -width / 2,
      y: -0.1,
      width,
      height,
      rounded: 0.05
    };
  }

  generateBotHead(health) {
    const size = 0.35;
    return {
      type: 'rect',
      x: -size / 2,
      y: -0.45,
      width: size,
      height: size * 0.8,
      rounded: 0.08
    };
  }

  generateMultipleGears(count) {
    const gears = [];
    for (let i = 0; i < count; i++) {
      gears.push({
        x: (i - count / 2) * 0.15,
        y: 0,
        radius: 0.08 + Math.random() * 0.04,
        teeth: 8 + Math.floor(Math.random() * 4)
      });
    }
    return gears;
  }

  generateAntennaPath(health) {
    return {
      type: 'line',
      points: [
        { x: 0, y: -0.45 },
        { x: 0, y: -0.65 }
      ]
    };
  }

  generateBlobPath(scale, health) {
    // Simple organic blob
    const complexity = 6;
    const points = [];
    for (let i = 0; i < complexity; i++) {
      const angle = (i / complexity) * Math.PI * 2;
      const variance = 0.8 + Math.random() * 0.2 * health;
      const radius = scale * variance;
      points.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius
      });
    }
    return this.pointsToBezierPath(points, true);
  }

  // ============ HELPER FUNCTIONS ============

  pointsToBezierPath(points, closed = false) {
    return { type: 'bezier_smooth', points, closed };
  }

  getMouthShape(emotion, style) {
    const shapes = {
      happy: {
        round: { type: 'arc', start: 0.2, end: 0.8, direction: 'down', size: 0.25 },
        wide: { type: 'arc', start: 0.1, end: 0.9, direction: 'down', size: 0.3 },
        small: { type: 'arc', start: 0.3, end: 0.7, direction: 'down', size: 0.2 },
        digital: { type: 'segments', pattern: [1, 0, 1], size: 0.15 }
      },
      neutral: {
        round: { type: 'line', width: 0.15 },
        wide: { type: 'line', width: 0.2 },
        small: { type: 'oval', width: 0.08, height: 0.04 },
        digital: { type: 'line', width: 0.12 }
      },
      worried: {
        round: { type: 'arc', start: 0.2, end: 0.8, direction: 'up', size: 0.2 },
        wide: { type: 'arc', start: 0.15, end: 0.85, direction: 'up', size: 0.25 },
        small: { type: 'arc', start: 0.35, end: 0.65, direction: 'up', size: 0.15 },
        digital: { type: 'segments', pattern: [0, 1, 0], size: 0.12 }
      },
      critical: {
        round: { type: 'zigzag', width: 0.2, amplitude: 0.05 },
        wide: { type: 'zigzag', width: 0.25, amplitude: 0.06 },
        small: { type: 'dot', size: 0.05 },
        digital: { type: 'x', size: 0.1 }
      }
    };

    return shapes[emotion]?.[style] || shapes.neutral[style];
  }
}

export default new AICharacterGenerator();
