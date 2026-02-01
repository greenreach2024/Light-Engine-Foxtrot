#!/usr/bin/env node

/**
 * Device Discovery System - Validation & Cleanup Script
 * 
 * Purpose:
 * 1. Validate device discovery system functionality
 * 2. Clean up demo/test data after validation
 * 3. Ensure production readiness
 * 
 * Usage:
 *   node scripts/validate-and-cleanup-device-discovery.js [--cleanup]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function section(title) {
    log(`\n${'='.repeat(60)}`, 'cyan');
    log(title, 'cyan');
    log('='.repeat(60), 'cyan');
}

// Validation checks
const validations = {
    files: [
        {
            path: 'lib/device-discovery.js',
            required: true,
            checkContent: ['class DeviceDiscovery', 'scanNetwork', 'identifyDevice', 'tryGrow3', 'tryDMX']
        },
        {
            path: 'public/device-scanner.js',
            required: true,
            checkContent: ['class DeviceScanner', 'scanNetwork', 'renderDeviceList', 'renderScanButton']
        },
        {
            path: 'public/device-discovery-demo.html',
            required: false, // Demo file, will be removed
            checkContent: ['Device Auto-Discovery', 'device-scanner.js']
        },
        {
            path: 'public/setup-wizard.html',
            required: true,
            checkContent: ['device-scanner.js', 'Auto-Discover Light Controllers', 'initDeviceScanner']
        },
        {
            path: 'server-foxtrot.js',
            required: true,
            checkContent: [
                'import DeviceDiscovery',
                '/api/devices/scan',
                '/api/devices/scan/lights'
            ]
        }
    ],
    
    endpoints: [
        {
            path: '/api/devices/scan',
            method: 'POST',
            description: 'Full network device scan'
        },
        {
            path: '/api/devices/scan/lights',
            method: 'POST',
            description: 'Quick light controller scan'
        }
    ],
    
    demoFiles: [
        'public/device-discovery-demo.html'
    ]
};

// Check if file exists and validate content
function validateFile(fileCheck) {
    const filePath = path.join(projectRoot, fileCheck.path);
    
    if (!fs.existsSync(filePath)) {
        if (fileCheck.required) {
            log(`  ❌ Missing required file: ${fileCheck.path}`, 'red');
            return false;
        } else {
            log(`  ⚠️  Optional file not found: ${fileCheck.path}`, 'yellow');
            return true;
        }
    }

    log(`  ✅ File exists: ${fileCheck.path}`, 'green');

    // Check content if specified
    if (fileCheck.checkContent) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const missing = fileCheck.checkContent.filter(text => !content.includes(text));
        
        if (missing.length > 0) {
            log(`    ⚠️  Missing expected content: ${missing.join(', ')}`, 'yellow');
            return false;
        } else {
            log(`    ✅ All expected content present`, 'green');
        }
    }

    return true;
}

// Validate server endpoints exist
function validateEndpoints() {
    const serverPath = path.join(projectRoot, 'server-foxtrot.js');
    if (!fs.existsSync(serverPath)) {
        log('  ❌ server-foxtrot.js not found', 'red');
        return false;
    }

    const content = fs.readFileSync(serverPath, 'utf-8');
    let allValid = true;

    validations.endpoints.forEach(endpoint => {
        const pattern = new RegExp(`app\\.${endpoint.method.toLowerCase()}\\(['"\`]${endpoint.path.replace(/\//g, '\\/')}['"\`]`);
        if (pattern.test(content)) {
            log(`  ✅ ${endpoint.method} ${endpoint.path} - ${endpoint.description}`, 'green');
        } else {
            log(`  ❌ ${endpoint.method} ${endpoint.path} - NOT FOUND`, 'red');
            allValid = false;
        }
    });

    return allValid;
}

// Clean up demo files
function cleanupDemoFiles(dryRun = true) {
    section('🧹 Demo File Cleanup');

    if (dryRun) {
        log('\nDRY RUN - No files will be deleted\n', 'yellow');
    }

    let filesRemoved = 0;

    validations.demoFiles.forEach(demoPath => {
        const filePath = path.join(projectRoot, demoPath);
        
        if (fs.existsSync(filePath)) {
            if (dryRun) {
                log(`  🗑️  Would remove: ${demoPath}`, 'yellow');
            } else {
                try {
                    fs.unlinkSync(filePath);
                    log(`  ✅ Removed: ${demoPath}`, 'green');
                    filesRemoved++;
                } catch (error) {
                    log(`  ❌ Failed to remove ${demoPath}: ${error.message}`, 'red');
                }
            }
        } else {
            log(`  ℹ️  Already removed: ${demoPath}`, 'blue');
        }
    });

    if (dryRun) {
        log(`\n${validations.demoFiles.length} file(s) would be removed`, 'yellow');
        log('Run with --cleanup flag to actually remove files', 'yellow');
    } else {
        log(`\n${filesRemoved} file(s) removed`, 'green');
    }
}

// Generate validation report
function generateReport(results) {
    section('📊 Validation Report');

    const totalChecks = results.files.length + results.endpoints.length;
    const passedChecks = results.files.filter(r => r.valid).length + 
                         (results.endpointsValid ? results.endpoints.length : 0);
    const passRate = Math.round((passedChecks / totalChecks) * 100);

    log(`\nTotal Checks: ${totalChecks}`, 'blue');
    log(`Passed: ${passedChecks}`, passedChecks === totalChecks ? 'green' : 'yellow');
    log(`Pass Rate: ${passRate}%`, passRate === 100 ? 'green' : 'yellow');

    if (passRate === 100) {
        log('\n✅ Device Discovery System - VALIDATED', 'green');
        log('All components present and properly integrated', 'green');
    } else {
        log('\n⚠️  Device Discovery System - ISSUES FOUND', 'yellow');
        log('Some components are missing or incomplete', 'yellow');
    }

    // Production readiness checklist
    section('🚀 Production Readiness Checklist');
    
    const readiness = [
        { check: 'Backend scanning service (lib/device-discovery.js)', status: results.files.find(f => f.path === 'lib/device-discovery.js')?.valid },
        { check: 'Frontend UI component (public/device-scanner.js)', status: results.files.find(f => f.path === 'public/device-scanner.js')?.valid },
        { check: 'API endpoints (/api/devices/scan)', status: results.endpointsValid },
        { check: 'Setup wizard integration', status: results.files.find(f => f.path === 'public/setup-wizard.html')?.valid },
        { check: 'Server import statement', status: results.files.find(f => f.path === 'server-foxtrot.js')?.valid }
    ];

    readiness.forEach(item => {
        const icon = item.status ? '✅' : '❌';
        const color = item.status ? 'green' : 'red';
        log(`  ${icon} ${item.check}`, color);
    });

    const isReady = readiness.every(item => item.status);
    
    if (isReady) {
        log('\n🎉 System is PRODUCTION READY', 'green');
    } else {
        log('\n⚠️  System NOT READY for production', 'red');
        log('Fix issues above before deploying', 'red');
    }

    return isReady;
}

// Main validation function
async function validate() {
    section('🔍 Device Discovery System Validation');

    const results = {
        files: [],
        endpoints: [],
        endpointsValid: false
    };

    // Validate files
    log('\nChecking Files:', 'blue');
    validations.files.forEach(fileCheck => {
        const valid = validateFile(fileCheck);
        results.files.push({ path: fileCheck.path, valid });
    });

    // Validate endpoints
    log('\nChecking API Endpoints:', 'blue');
    results.endpointsValid = validateEndpoints();
    results.endpoints = validations.endpoints;

    return results;
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    const shouldCleanup = args.includes('--cleanup');
    const helpRequested = args.includes('--help') || args.includes('-h');

    if (helpRequested) {
        log('\nDevice Discovery Validation & Cleanup', 'cyan');
        log('\nUsage:', 'blue');
        log('  node scripts/validate-and-cleanup-device-discovery.js [options]');
        log('\nOptions:', 'blue');
        log('  --cleanup    Remove demo files after validation');
        log('  --help, -h   Show this help message');
        log('\nExamples:', 'blue');
        log('  node scripts/validate-and-cleanup-device-discovery.js');
        log('  node scripts/validate-and-cleanup-device-discovery.js --cleanup\n');
        return;
    }

    log('Device Discovery System - Validation & Cleanup', 'cyan');
    log(`Date: ${new Date().toISOString()}`, 'blue');
    log(`Project: ${projectRoot}`, 'blue');

    // Run validation
    const results = await validate();
    const isReady = generateReport(results);

    // Cleanup if requested and validation passed
    if (isReady) {
        cleanupDemoFiles(!shouldCleanup);

        if (shouldCleanup) {
            section('✅ Validation & Cleanup Complete');
            log('Device discovery system validated and demo files removed', 'green');
            log('System is ready for production use', 'green');
        } else {
            section('✅ Validation Complete');
            log('Run with --cleanup to remove demo files', 'yellow');
        }
    } else {
        section('❌ Validation Failed');
        log('Fix issues before cleanup', 'red');
        process.exit(1);
    }
}

// Run
main().catch(error => {
    log(`\n❌ Error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
});
