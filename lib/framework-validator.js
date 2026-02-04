import fs from 'fs';
import path from 'path';

/**
 * Framework Validator - Enforce AGENT_SKILLS_FRAMEWORK rules at runtime
 * This prevents demo data, malformed configurations, and other violations from being served
 * 
 * BLOCKING RULES (application won't start if violated):
 * 1. farm.json must contain production farm ID (not demo)
 * 2. groups.json must have valid status/active fields (not null)
 * 3. Only ONE farm should be initialized at startup (lazy initialization)
 * 4. No demo data constants or functions should execute at startup
 */

export class FrameworkValidator {
  constructor() {
    this.violations = [];
    this.warnings = [];
  }

  /**
   * RULE 1: Canonical Data Integrity Check
   * Ensure canonical data files match expected schemas and don't contain demo data
   */
  validateCanonicalDataFiles() {
    const requiredFiles = [
      'public/data/farm.json',
      'public/data/groups.json',
    ];

    for (const file of requiredFiles) {
      try {
        const content = JSON.parse(fs.readFileSync(file, 'utf8'));
        
        // farm.json must have valid production farmId
        if (file.includes('farm.json')) {
          const farmId = content.farmId;
          const DEMO_FARM_IDS = ['light-engine-demo', 'DEMO-FARM-001', 'GR-00001', 'LOCAL-FARM', 'FARM-001', 'FARM-002', 'FARM-003'];
          
          if (!farmId) {
            this.violations.push(
              `❌ CRITICAL: farm.json missing farmId field`
            );
          } else if (DEMO_FARM_IDS.includes(farmId)) {
            this.violations.push(
              `❌ CRITICAL: farm.json contains DEMO farm ID: "${farmId}"`
            );
          }
        }

        // groups.json must follow canonical wrapper format and have valid status/active fields (no nulls)
        if (file.includes('groups.json')) {
          let groups = null;

          if (Array.isArray(content)) {
            // Legacy format support (array at root)
            groups = content;
          } else if (content && typeof content === 'object' && Array.isArray(content.groups)) {
            // Canonical format (wrapper with groups array)
            groups = content.groups;
          }

          if (!groups) {
            this.violations.push(
              `❌ groups.json must be an object with groups[] (canonical) or a legacy array, got: ${typeof content}`
            );
          } else {
            groups.forEach((group, idx) => {
              if (group.status === null || group.status === undefined) {
                this.violations.push(
                  `❌ groups.json[${idx}] ID:"${group.id}" has null/undefined status - DATA INTEGRITY VIOLATION`
                );
              }
              if (group.active === null || group.active === undefined) {
                this.violations.push(
                  `❌ groups.json[${idx}] ID:"${group.id}" has null/undefined active - DATA INTEGRITY VIOLATION`
                );
              }
            });
          }
        }
      } catch (error) {
        this.violations.push(
          `❌ Failed to read/parse ${file}: ${error.message}`
        );
      }
    }
  }

  /**
   * RULE 3: Farm Store Should Not Initialize Multiple Farms at Startup
   * Only initialize the current farm (lazy initialization pattern)
   */
  validateFarmInitializationPattern() {
    const farmStoreFile = 'lib/farm-store.js';
    try {
      const content = fs.readFileSync(farmStoreFile, 'utf8');

      // MUST NOT have DEMO_FARMS array (auto-initialization)
      if (content.includes('const DEMO_FARMS') && !content.includes('// DEPRECATED')) {
        this.violations.push(
          `❌ lib/farm-store.js contains DEMO_FARMS array - this causes multiple farms to initialize at startup`
        );
      }

      // MUST have ensureFarmInitialized() for lazy loading
      if (!content.includes('export function ensureFarmInitialized')) {
        this.violations.push(
          `❌ lib/farm-store.js missing ensureFarmInitialized() - required for lazy loading pattern`
        );
      }

      // MUST have initializeCurrentFarm() called at module load
      if (!content.includes('initializeCurrentFarm()')) {
        this.warnings.push(
          `⚠️  lib/farm-store.js may not initialize current farm at startup`
        );
      }
    } catch (error) {
      this.violations.push(
        `❌ Failed to validate farm-store.js: ${error.message}`
      );
    }
  }

  /**
   * RULE 4: Check server-foxtrot.js for demo mode logic execution
   * Authentication must not serve demo tokens
   */
  validateAuthenticationLogic() {
    const serverFile = 'server-foxtrot.js';
    try {
      const content = fs.readFileSync(serverFile, 'utf8');

      // Check that server still logs demo mode (should not happen in production)
      const demoModeLogMatch = content.match(/console\.log.*DEMO_MODE/);
      if (demoModeLogMatch) {
        this.warnings.push(
          `⚠️  server-foxtrot.js logs DEMO_MODE at startup - ensure DEMO_MODE is not set to 'true' in production`
        );
      }

      // Verify isDemoMode() function is not used in critical paths
      const demoModeUsages = (content.match(/if\s*\(\s*isDemoMode\s*\(\s*\)/g) || []).length;
      if (demoModeUsages > 3) {
        this.warnings.push(
          `⚠️  isDemoMode() called ${demoModeUsages} times - verify it's only in development paths`
        );
      }
    } catch (error) {
      this.violations.push(
        `❌ Failed to validate server-foxtrot.js: ${error.message}`
      );
    }
  }

  /**
   * Run all validations and report violations
   * Blocks startup if any violations found
   */
  validate() {
    console.log('\n' + '='.repeat(70));
    console.log('🔍 FRAMEWORK VALIDATOR: Running framework compliance checks...');
    console.log('='.repeat(70) + '\n');

    this.validateCanonicalDataFiles();
    this.validateFarmInitializationPattern();
    this.validateAuthenticationLogic();

    // Report violations (BLOCKING - prevents startup)
    if (this.violations.length > 0) {
      console.error('\n' + '❌'.repeat(35));
      console.error('\n🚨 FRAMEWORK VIOLATIONS DETECTED - APPLICATION WILL NOT START\n');
      this.violations.forEach((v, idx) => {
        console.error(`${idx + 1}. ${v}`);
      });
      console.error('\n📖 Framework Documentation:');
      console.error('   - .github/AGENT_SKILLS_FRAMEWORK.md');
      console.error('   - .github/DATA_FORMAT_STANDARDS.md');
      console.error('   - .github/copilot-instructions-schema.md');
      console.error('\n' + '❌'.repeat(35) + '\n');
      
      return false;
    }

    // Report warnings (non-blocking, but important)
    if (this.warnings.length > 0) {
      console.warn('\n⚠️  FRAMEWORK WARNINGS:\n');
      this.warnings.forEach((w, idx) => {
        console.warn(`${idx + 1}. ${w}`);
      });
      console.warn('');
    }

    console.log('✅ Framework validation passed - all rules compliant\n');
    console.log('='.repeat(70) + '\n');
    return true;
  }
}

// Export singleton
export const validator = new FrameworkValidator();

export default validator;
