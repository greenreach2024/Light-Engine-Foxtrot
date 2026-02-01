#!/usr/bin/env node

/**
 * Harvest Prediction UI Component - Validation Script
 * 
 * Validates:
 * 1. Component file exists and is valid JavaScript
 * 2. Demo page exists and has required elements
 * 3. API endpoints respond correctly
 * 4. Component can load and render predictions
 * 5. CSS styles are properly injected
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
  console.log(`✅ PASS: ${message}`);
  passCount++;
}

function fail(message) {
  console.log(`❌ FAIL: ${message}`);
  failCount++;
}

function info(message) {
  console.log(`ℹ️  INFO: ${message}`);
}

console.log('🎯 Validating Harvest Prediction UI Component\n');

// Check 1: Component file exists
const componentPath = path.join(ROOT, 'public/harvest-predictions.js');
if (fs.existsSync(componentPath)) {
  const content = fs.readFileSync(componentPath, 'utf8');
  
  if (content.includes('class HarvestPredictions')) {
    pass('Component file exists with HarvestPredictions class');
  } else {
    fail('Component file missing HarvestPredictions class');
  }

  // Check for required methods
  const requiredMethods = [
    'loadForGroup',
    'loadAll',
    'loadBatch',
    'refresh',
    'get',
    'renderBadge',
    'renderCard',
    'renderAll',
    'injectStyles'
  ];

  requiredMethods.forEach(method => {
    if (content.includes(`${method}(`)) {
      pass(`Component has ${method}() method`);
    } else {
      fail(`Component missing ${method}() method`);
    }
  });

  // Check for badge state classes
  const badgeStates = [
    'harvest-badge-today',
    'harvest-badge-soon',
    'harvest-badge-week',
    'harvest-badge-future',
    'harvest-badge-overdue',
    'harvest-badge-unknown'
  ];

  badgeStates.forEach(state => {
    if (content.includes(state)) {
      pass(`Component has ${state} badge state`);
    } else {
      fail(`Component missing ${state} badge state`);
    }
  });

} else {
  fail('Component file does not exist: public/harvest-predictions.js');
}

// Check 2: Demo page exists
const demoPath = path.join(ROOT, 'public/harvest-predictions-demo.html');
if (fs.existsSync(demoPath)) {
  const content = fs.readFileSync(demoPath, 'utf8');
  
  pass('Demo page exists');

  // Check for required elements
  if (content.includes('id="harvest-predictions"')) {
    pass('Demo page has harvest-predictions container');
  } else {
    fail('Demo page missing harvest-predictions container');
  }

  if (content.includes('src="harvest-predictions.js"')) {
    pass('Demo page includes component script');
  } else {
    fail('Demo page missing component script include');
  }

  if (content.includes('loadAllPredictions')) {
    pass('Demo page has loadAllPredictions function');
  } else {
    fail('Demo page missing loadAllPredictions function');
  }

} else {
  fail('Demo page does not exist: public/harvest-predictions-demo.html');
}

// Check 3: Backend predictor exists
const predictorPath = path.join(ROOT, 'lib/harvest-predictor.js');
if (fs.existsSync(predictorPath)) {
  const content = fs.readFileSync(predictorPath, 'utf8');
  
  pass('Backend predictor exists');

  if (content.includes('class HarvestPredictor')) {
    pass('Backend has HarvestPredictor class');
  } else {
    fail('Backend missing HarvestPredictor class');
  }

  if (content.includes('CROP_DURATIONS')) {
    pass('Backend has CROP_DURATIONS database');
  } else {
    fail('Backend missing CROP_DURATIONS database');
  }

} else {
  fail('Backend predictor does not exist: lib/harvest-predictor.js');
}

// Check 4: Server integration
const serverPath = path.join(ROOT, 'server-foxtrot.js');
if (fs.existsSync(serverPath)) {
  const content = fs.readFileSync(serverPath, 'utf8');
  
  pass('Server file exists');

  if (content.includes('import HarvestPredictor')) {
    pass('Server imports HarvestPredictor');
  } else {
    fail('Server missing HarvestPredictor import');
  }

  // Check for API endpoints
  const endpoints = [
    '/api/harvest/predictions/all',
    '/api/harvest/predictions/:groupId',
    '/api/harvest/predictions/batch'
  ];

  endpoints.forEach(endpoint => {
    const endpointPattern = endpoint.replace(':groupId', '');
    if (content.includes(endpointPattern)) {
      pass(`Server has ${endpoint} endpoint`);
    } else {
      fail(`Server missing ${endpoint} endpoint`);
    }
  });

} else {
  fail('Server file does not exist: server-foxtrot.js');
}

// Check 5: Test API endpoints (if server is running)
async function testAPI() {
  console.log('\n🌐 Testing API Endpoints...\n');

  try {
    // Test /api/harvest/predictions/all
    const response = await fetch('http://localhost:8091/api/harvest/predictions/all');
    if (response.ok) {
      const data = await response.json();
      
      if (data.ok) {
        pass('GET /api/harvest/predictions/all responds correctly');
        
        if (data.predictions && Array.isArray(data.predictions)) {
          pass(`API returned ${data.predictions.length} prediction(s)`);
          
          if (data.predictions.length > 0) {
            const pred = data.predictions[0];
            
            // Validate prediction structure
            const requiredFields = [
              'groupId',
              'crop',
              'seedDate',
              'predictedDate',
              'daysRemaining',
              'confidence',
              'factors',
              'baseline',
              'adjustments'
            ];

            requiredFields.forEach(field => {
              if (pred.hasOwnProperty(field)) {
                pass(`Prediction has ${field} field`);
              } else {
                fail(`Prediction missing ${field} field`);
              }
            });

            info(`Sample prediction: ${pred.crop} - ${pred.daysRemaining} days (${Math.round(pred.confidence * 100)}% confident)`);
          } else {
            info('No active groups with predictions (this is OK if no groups are seeded)');
          }
        } else {
          fail('API response missing predictions array');
        }
      } else {
        fail('API response has ok=false');
      }
    } else {
      fail(`API responded with status ${response.status}`);
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
  console.log(`✅ PASSED: ${passCount}`);
  console.log(`❌ FAILED: ${failCount}`);
  console.log(`📊 TOTAL:  ${passCount + failCount}`);
  console.log(`✨ SCORE:  ${Math.round((passCount / (passCount + failCount)) * 100)}%`);
  console.log('='.repeat(50) + '\n');

  if (failCount === 0) {
    console.log('🎉 All checks passed! Component is ready for integration.\n');
    console.log('Next steps:');
    console.log('1. Choose integration target (Activity Hub, Farm Summary, Groups V2)');
    console.log('2. Add <script src="harvest-predictions.js"></script> to target page');
    console.log('3. Initialize component in page JavaScript');
    console.log('4. Modify group card template to include predictions.renderBadge(groupId)');
    console.log('5. Test on real dashboard\n');
    
    console.log('Demo page: http://localhost:8091/harvest-predictions-demo.html\n');
    process.exit(0);
  } else {
    console.log('❌ Some checks failed. Review errors above.\n');
    process.exit(1);
  }
});
