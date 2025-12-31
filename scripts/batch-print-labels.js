#!/usr/bin/env node
/**
 * Batch Print Tray Labels Script
 * 
 * Prints multiple tray labels in sequence for initial farm setup.
 * 
 * Usage:
 *   node scripts/batch-print-labels.js --start 1000 --count 500
 *   node scripts/batch-print-labels.js --start 1000 --count 500 --host 192.168.1.100
 *   node scripts/batch-print-labels.js --help
 */

import fetch from 'node-fetch';

// Parse command line arguments
const args = process.argv.slice(2);
const config = {
  start: 1000,
  count: 100,
  farmName: 'GreenReach Farms',
  connection: 'network',
  host: '192.168.1.100',
  port: 9100,
  format: 'zpl',
  delay: 500,
  apiUrl: 'http://localhost:8091'
};

// Parse arguments
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--help':
    case '-h':
      console.log(`
Batch Print Tray Labels

Usage:
  node scripts/batch-print-labels.js [options]

Options:
  --start NUM        Starting tray number (default: 1000)
  --count NUM        Number of labels to print (default: 100)
  --farm NAME        Farm name (default: "GreenReach Farms")
  --connection TYPE  Printer connection: usb or network (default: network)
  --host IP          Printer IP address (network only, default: 192.168.1.100)
  --port NUM         Printer port (default: 9100)
  --format TYPE      Label format: zpl or epl (default: zpl)
  --delay MS         Delay between prints in ms (default: 500)
  --api URL          API base URL (default: http://localhost:8091)
  --dry-run          Show what would be printed without actually printing
  --help, -h         Show this help message

Examples:
  # Print 100 labels starting from 1000
  node scripts/batch-print-labels.js --start 1000 --count 100

  # Print 500 labels to USB printer
  node scripts/batch-print-labels.js --start 1000 --count 500 --connection usb

  # Dry run to see what would be printed
  node scripts/batch-print-labels.js --start 1000 --count 10 --dry-run

  # Custom farm name and network printer
  node scripts/batch-print-labels.js \\
    --start 2000 \\
    --count 250 \\
    --farm "Sunset Farms" \\
    --host 192.168.1.105
      `);
      process.exit(0);
    case '--start':
      config.start = parseInt(args[++i]);
      break;
    case '--count':
      config.count = parseInt(args[++i]);
      break;
    case '--farm':
      config.farmName = args[++i];
      break;
    case '--connection':
      config.connection = args[++i];
      break;
    case '--host':
      config.host = args[++i];
      break;
    case '--port':
      config.port = parseInt(args[++i]);
      break;
    case '--format':
      config.format = args[++i];
      break;
    case '--delay':
      config.delay = parseInt(args[++i]);
      break;
    case '--api':
      config.apiUrl = args[++i];
      break;
    case '--dry-run':
      config.dryRun = true;
      break;
  }
}

// Validate configuration
if (config.start < 1) {
  console.error('Error: --start must be >= 1');
  process.exit(1);
}

if (config.count < 1 || config.count > 10000) {
  console.error('Error: --count must be between 1 and 10000');
  process.exit(1);
}

if (!['usb', 'network'].includes(config.connection)) {
  console.error('Error: --connection must be "usb" or "network"');
  process.exit(1);
}

if (!['zpl', 'epl'].includes(config.format)) {
  console.error('Error: --format must be "zpl" or "epl"');
  process.exit(1);
}

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  bold: '\x1b[1m'
};

/**
 * Print a single label
 */
async function printLabel(code) {
  const body = {
    code,
    farmName: config.farmName,
    connection: config.connection,
    format: config.format
  };

  if (config.connection === 'network') {
    body.host = config.host;
    body.port = config.port;
  }

  if (config.dryRun) {
    console.log(`${COLORS.blue}[DRY RUN]${COLORS.reset} Would print: ${code}`);
    return { success: true, jobId: 'dry-run' };
  }

  const response = await fetch(`${config.apiUrl}/api/printer/print-tray`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HTTP ${response.status}: ${error}`);
  }

  return await response.json();
}

/**
 * Test printer connection
 */
async function testPrinter() {
  const body = {
    connection: config.connection
  };

  if (config.connection === 'network') {
    body.host = config.host;
    body.port = config.port;
  }

  try {
    const response = await fetch(`${config.apiUrl}/api/printer/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const result = await response.json();
    return result.success;
  } catch (error) {
    return false;
  }
}

/**
 * Main execution
 */
async function main() {
  console.log(`\n${COLORS.bold}Batch Print Tray Labels${COLORS.reset}\n`);
  
  // Show configuration
  console.log('Configuration:');
  console.log(`  Start number: ${COLORS.green}${config.start}${COLORS.reset}`);
  console.log(`  Count: ${COLORS.green}${config.count}${COLORS.reset}`);
  console.log(`  End number: ${COLORS.green}${config.start + config.count - 1}${COLORS.reset}`);
  console.log(`  Farm name: ${COLORS.green}${config.farmName}${COLORS.reset}`);
  console.log(`  Connection: ${COLORS.green}${config.connection}${COLORS.reset}`);
  
  if (config.connection === 'network') {
    console.log(`  Printer: ${COLORS.green}${config.host}:${config.port}${COLORS.reset}`);
  }
  
  console.log(`  Format: ${COLORS.green}${config.format.toUpperCase()}${COLORS.reset}`);
  console.log(`  Delay: ${COLORS.green}${config.delay}ms${COLORS.reset}`);
  
  if (config.dryRun) {
    console.log(`\n${COLORS.yellow}DRY RUN MODE - No actual printing${COLORS.reset}\n`);
  } else {
    console.log('');
  }

  // Test printer connection (skip in dry-run mode)
  if (!config.dryRun) {
    process.stdout.write('Testing printer connection... ');
    const connected = await testPrinter();
    
    if (connected) {
      console.log(`${COLORS.green}✓ Connected${COLORS.reset}`);
    } else {
      console.log(`${COLORS.red}✗ Failed${COLORS.reset}`);
      console.error('\nCannot connect to printer. Check:');
      console.error('  1. Printer is powered on');
      console.error('  2. Network/USB connection is working');
      console.error(`  3. Server is running (${config.apiUrl})`);
      console.error('  4. Printer IP/name is correct\n');
      process.exit(1);
    }
  }

  // Confirm before printing
  if (!config.dryRun) {
    console.log(`\n${COLORS.yellow}About to print ${config.count} labels.${COLORS.reset}`);
    console.log(`${COLORS.yellow}Press Ctrl+C to cancel, or wait 5 seconds to continue...${COLORS.reset}\n`);
    
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  // Print labels
  console.log(`${COLORS.bold}Printing labels...${COLORS.reset}\n`);
  
  const startTime = Date.now();
  let successful = 0;
  let failed = 0;

  for (let i = 0; i < config.count; i++) {
    const number = config.start + i;
    const code = `FARM-TRAY-${String(number).padStart(4, '0')}`;
    
    try {
      const result = await printLabel(code);
      successful++;
      
      const progress = ((i + 1) / config.count * 100).toFixed(1);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const remaining = (config.count - i - 1) * config.delay / 1000;
      
      console.log(
        `${COLORS.green}✓${COLORS.reset} ${code.padEnd(20)} ` +
        `Job: ${result.jobId.slice(0, 12)}... ` +
        `Progress: ${progress}% ` +
        `Elapsed: ${elapsed}s ` +
        `Remaining: ~${remaining.toFixed(0)}s`
      );
      
      // Delay between prints
      if (i < config.count - 1) {
        await new Promise(resolve => setTimeout(resolve, config.delay));
      }
      
    } catch (error) {
      failed++;
      console.error(`${COLORS.red}✗${COLORS.reset} ${code.padEnd(20)} Error: ${error.message}`);
    }
  }

  // Summary
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log(`\n${COLORS.bold}Summary:${COLORS.reset}`);
  console.log(`  ${COLORS.green}✓ Successful: ${successful}${COLORS.reset}`);
  
  if (failed > 0) {
    console.log(`  ${COLORS.red}✗ Failed: ${failed}${COLORS.reset}`);
  }
  
  console.log(`  Total time: ${totalTime}s`);
  console.log(`  Average: ${(totalTime / config.count).toFixed(2)}s per label\n`);

  if (failed > 0) {
    console.log(`${COLORS.yellow}Some labels failed to print. Check server logs for details.${COLORS.reset}\n`);
    process.exit(1);
  } else if (!config.dryRun) {
    console.log(`${COLORS.green}${COLORS.bold}✅ All labels printed successfully!${COLORS.reset}\n`);
  }
}

// Run
main().catch(error => {
  console.error(`\n${COLORS.red}Fatal error:${COLORS.reset}`, error.message);
  process.exit(1);
});
