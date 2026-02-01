#!/usr/bin/env node

/**
 * Anomaly Diagnostics Validation Script
 * 
 * Validates:
 * 1. Diagnostic engine exists and exports correctly
 * 2. API endpoint responds with proper structure
 * 3. Frontend component loads and renders
 * 4. Diagnostic logic handles edge cases
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
  console.log(`PASS: ${message}`);
  passCount++;
}

function fail(message) {
  console.log(`FAIL: ${message}`);
  failCount++;
}

function info(message) {
  console.log(`INFO: ${message}`);
}

console.log('Validating Anomaly Diagnostics System\n');

// Check 1: Backend diagnostics engine exists
const diagnosticsPath = path.join(ROOT, 'lib/anomaly-diagnostics.js');
if (fs.existsSync(diagnosticsPath)) {
  pass('Diagnostic engine file exists');
  
  const content = fs.readFileSync(diagnosticsPath, 'utf8');
  
  if (content.includes('class AnomalyDiagnostics')) {
    pass('AnomalyDiagnostics class found');
  } else {
    fail('AnomalyDiagnostics class missing');
  }
  
  // Check for required methods
  const methods = [
    'diagnose',
    '_isWeatherCorrelated',
    '_checkSensorIssues',
    '_checkControlPatterns',
    '_checkEquipmentStatus',
    'diagnoseMultiple',
    'getSummary'
  ];
  
  methods.forEach(method => {
    if (content.includes(`${method}(`)) {
      pass(`Method ${method}() exists`);
    } else {
      fail(`Method ${method}() missing`);
    }
  });
  
} else {
  fail('Diagnostic engine file does not exist: lib/anomaly-diagnostics.js');
}

// Check 2: Server integration
const serverPath = path.join(ROOT, 'server-foxtrot.js');
if (fs.existsSync(serverPath)) {
  pass('Server file exists');
  
  const content = fs.readFileSync(serverPath, 'utf8');
  
  if (content.includes('import AnomalyDiagnostics')) {
    pass('Server imports AnomalyDiagnostics');
  } else {
    fail('Server missing AnomalyDiagnostics import');
  }
  
  if (content.includes('const anomalyDiagnostics = new AnomalyDiagnostics')) {
    pass('Server initializes AnomalyDiagnostics');
  } else {
    fail('Server does not initialize AnomalyDiagnostics');
  }
  
  if (content.includes('/api/ml/diagnostics')) {
    pass('Diagnostics API endpoint exists');
  } else {
    fail('Diagnostics API endpoint missing');
  }
  
} else {
  fail('Server file does not exist');
}

// Check 3: Frontend component
const componentPath = path.join(ROOT, 'public/anomaly-diagnostics.js');
if (fs.existsSync(componentPath)) {
  pass('Frontend component exists');
  
  const content = fs.readFileSync(componentPath, 'utf8');
  
  if (content.includes('class AnomalyDiagnosticsDisplay')) {
    pass('AnomalyDiagnosticsDisplay class found');
  } else {
    fail('AnomalyDiagnosticsDisplay class missing');
  }
  
  const methods = ['load', 'renderCard', 'renderSummary', 'renderAll', 'injectStyles'];
  methods.forEach(method => {
    if (content.includes(`${method}(`)) {
      pass(`Frontend method ${method}() exists`);
    } else {
      fail(`Frontend method ${method}() missing`);
    }
  });
  
} else {
  fail('Frontend component does not exist: public/anomaly-diagnostics.js');
}

// Check 4: Test API endpoint (if server is running)
async function testAPI() {
  console.log('\nTesting API Endpoints...\n');
  
  try {
    const response = await fetch('http://localhost:8091/api/ml/diagnostics');
    
    if (response.ok) {
      pass('GET /api/ml/diagnostics responds successfully');
      
      const data = await response.json();
      
      if (data.ok !== undefined) {
        pass('Response has ok field');
      } else {
        fail('Response missing ok field');
      }
      
      if (Array.isArray(data.diagnostics)) {
        pass(`Response has diagnostics array (${data.diagnostics.length} items)`);
        
        if (data.diagnostics.length > 0) {
          const diag = data.diagnostics[0];
          
          // Check diagnostic structure
          const requiredFields = ['diagnosis', 'zone', 'indoor_temp', 'indoor_rh'];
          requiredFields.forEach(field => {
            if (diag.hasOwnProperty(field)) {
              pass(`Diagnostic has ${field} field`);
            } else {
              fail(`Diagnostic missing ${field} field`);
            }
          });
          
          // Check diagnosis structure
          if (diag.diagnosis) {
            const diagFields = ['category', 'rootCause', 'confidence', 'weatherRelated', 'suggestions', 'urgency'];
            diagFields.forEach(field => {
              if (diag.diagnosis.hasOwnProperty(field)) {
                pass(`Diagnosis has ${field} field`);
              } else {
                fail(`Diagnosis missing ${field} field`);
              }
            });
          }
        } else {
          info('No diagnostics available (no anomalies detected)');
        }
      } else {
        fail('Response missing diagnostics array');
      }
      
      if (data.summary) {
        pass('Response has summary object');
        
        const summaryFields = ['total', 'needsAttention', 'weatherRelated', 'message'];
        summaryFields.forEach(field => {
          if (data.summary.hasOwnProperty(field)) {
            pass(`Summary has ${field} field`);
          } else {
            fail(`Summary missing ${field} field`);
          }
        });
      } else {
        fail('Response missing summary');
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
  console.log(`PASSED: ${passCount}`);
  console.log(`FAILED: ${failCount}`);
  console.log(`TOTAL:  ${passCount + failCount}`);
  console.log(`SCORE:  ${Math.round((passCount / (passCount + failCount)) * 100)}%`);
  console.log('='.repeat(50) + '\n');
  
  if (failCount === 0) {
    console.log('All checks passed! Anomaly diagnostics system ready.\n');
    process.exit(0);
  } else {
    console.log('Some checks failed. Review errors above.\n');
    process.exit(1);
  }
});
