#!/usr/bin/env node

/**
 * Adaptive VPD Validation Script
 * 
 * Validates:
 * 1. Service exists and exports correctly
 * 2. API endpoints respond properly
 * 3. Adaptation logic handles edge cases
 * 4. Progressive enhancement works
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

let passCount = 0;
let failCount = 0;

function pass(message) {
  console.log(`✓ ${message}`);
  passCount++;
}

function fail(message) {
  console.log(`✗ ${message}`);
  failCount++;
}

function info(message) {
  console.log(`ℹ ${message}`);
}

console.log('Validating Adaptive VPD System\n');

// Check 1: Service file exists
const servicePath = path.join(ROOT, 'lib/adaptive-vpd.js');
if (fs.existsSync(servicePath)) {
  pass('Adaptive VPD service file exists');
  
  const content = fs.readFileSync(servicePath, 'utf8');
  
  if (content.includes('class AdaptiveVpd')) {
    pass('AdaptiveVpd class found');
  } else {
    fail('AdaptiveVpd class missing');
  }
  
  // Check for required methods
  const methods = [
    'adapt',
    '_adaptForWeather',
    '_adaptForEnergy',
    '_adaptForCapacity',
    '_getCacheKey',
    'clearCache'
  ];
  
  methods.forEach(method => {
    if (content.includes(`${method}(`)) {
      pass(`Method ${method}() exists`);
    } else {
      fail(`Method ${method}() missing`);
    }
  });
  
} else {
  fail('Adaptive VPD service file does not exist: lib/adaptive-vpd.js');
}

// Check 2: Server integration
const serverPath = path.join(ROOT, 'server-foxtrot.js');
if (fs.existsSync(serverPath)) {
  pass('Server file exists');
  
  const content = fs.readFileSync(serverPath, 'utf8');
  
  if (content.includes('import AdaptiveVpd')) {
    pass('Server imports AdaptiveVpd');
  } else {
    fail('Server missing AdaptiveVpd import');
  }
  
  if (content.includes('const adaptiveVpd = new AdaptiveVpd')) {
    pass('Server initializes AdaptiveVpd');
  } else {
    fail('Server does not initialize AdaptiveVpd');
  }
  
  if (content.includes('/api/vpd/adapt')) {
    pass('VPD adaptation API endpoint exists');
  } else {
    fail('VPD adaptation API endpoint missing');
  }
  
} else {
  fail('Server file does not exist');
}

// Check 3: Test API endpoint (if server is running)
async function testAPI() {
  console.log('\nTesting API Endpoints...\n');
  
  try {
    // Test example endpoint
    const exampleResponse = await fetch('http://localhost:8091/api/vpd/adapt/example');
    
    if (exampleResponse.ok) {
      pass('GET /api/vpd/adapt/example responds successfully');
      
      const examples = await exampleResponse.json();
      
      if (examples.ok && examples.examples) {
        pass('Examples endpoint returns valid data');
        
        // Test each scenario
        const scenarios = ['heat_wave', 'cold_snap', 'peak_demand', 'normal'];
        
        for (const scenario of scenarios) {
          const example = examples.examples[scenario];
          
          if (example) {
            info(`Testing scenario: ${scenario}`);
            
            // Test adaptation
            const adaptResponse = await fetch('http://localhost:8091/api/vpd/adapt', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(example)
            });
            
            if (adaptResponse.ok) {
              pass(`  Scenario ${scenario} adapts successfully`);
              
              const result = await adaptResponse.json();
              
              if (result.ok && result.decision) {
                pass(`  Response has decision object`);
                
                const decision = result.decision;
                
                // Check decision structure
                const requiredFields = ['min', 'max', 'target', 'adapted', 'reason', 'confidence'];
                let allFieldsPresent = true;
                
                requiredFields.forEach(field => {
                  if (decision.hasOwnProperty(field)) {
                    pass(`    Decision has ${field} field`);
                  } else {
                    fail(`    Decision missing ${field} field`);
                    allFieldsPresent = false;
                  }
                });
                
                if (allFieldsPresent) {
                  // Validate adaptation logic
                  if (scenario === 'heat_wave' && decision.adapted) {
                    if (decision.max > example.recipe.max) {
                      pass(`    Heat wave: Upper bound relaxed (${example.recipe.max} → ${decision.max})`);
                    } else {
                      fail(`    Heat wave: Upper bound not relaxed`);
                    }
                    
                    if (decision.energySavingsPct > 0) {
                      pass(`    Energy savings estimated: ${decision.energySavingsPct}%`);
                    } else {
                      fail(`    No energy savings calculated`);
                    }
                  }
                  
                  if (scenario === 'cold_snap' && decision.adapted) {
                    if (decision.min < example.recipe.min) {
                      pass(`    Cold snap: Lower bound relaxed (${example.recipe.min} → ${decision.min})`);
                    } else {
                      fail(`    Cold snap: Lower bound not relaxed`);
                    }
                  }
                  
                  if (scenario === 'normal') {
                    if (!decision.adapted || decision.factors.length === 0) {
                      pass(`    Normal conditions: No adaptation (correct)`);
                    } else {
                      info(`    Normal conditions adapted: ${decision.reason}`);
                    }
                  }
                }
              } else {
                fail(`  Response missing decision`);
              }
            } else {
              fail(`  Scenario ${scenario} failed: ${adaptResponse.status}`);
            }
          }
        }
      } else {
        fail('Examples endpoint missing data');
      }
    } else {
      fail(`Examples endpoint responded with status ${exampleResponse.status}`);
    }
    
    // Test with minimal data (progressive enhancement)
    info('\nTesting progressive enhancement (minimal data)...');
    
    const minimalResponse = await fetch('http://localhost:8091/api/vpd/adapt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipe: { min: 0.8, max: 1.2, target: 1.0 }
      })
    });
    
    if (minimalResponse.ok) {
      pass('Minimal data (recipe only) works');
      
      const result = await minimalResponse.json();
      if (result.ok && result.decision) {
        pass('Returns valid decision with minimal data');
        
        if (!result.decision.adapted) {
          pass('No adaptation without context (correct)');
        } else {
          info(`Adapted even with minimal data: ${result.decision.reason}`);
        }
      }
    } else {
      fail('Minimal data test failed');
    }
    
    // Test with weather only
    info('\nTesting with weather data only...');
    
    const weatherOnlyResponse = await fetch('http://localhost:8091/api/vpd/adapt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipe: { min: 0.8, max: 1.2, target: 1.0 },
        outdoor: { temp: 35, rh: 70 }
      })
    });
    
    if (weatherOnlyResponse.ok) {
      pass('Weather-only data works');
      
      const result = await weatherOnlyResponse.json();
      if (result.ok && result.decision && result.decision.adapted) {
        pass('Adapts based on weather (heat wave)');
        pass(`  Reason: ${result.decision.reason}`);
      }
    }
    
  } catch (error) {
    fail(`API test failed: ${error.message}`);
    info('Make sure server is running: PORT=8091 node server-foxtrot.js');
  }
}

// Run API tests
testAPI().then(() => {
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`PASSED: ${passCount}`);
  console.log(`FAILED: ${failCount}`);
  console.log(`TOTAL:  ${passCount + failCount}`);
  console.log(`SCORE:  ${Math.round((passCount / (passCount + failCount)) * 100)}%`);
  console.log('='.repeat(50) + '\n');
  
  if (failCount === 0) {
    console.log('✓ All checks passed! Adaptive VPD system ready.\n');
    process.exit(0);
  } else {
    console.log('✗ Some checks failed. Review errors above.\n');
    process.exit(1);
  }
});
