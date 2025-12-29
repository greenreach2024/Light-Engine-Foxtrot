#!/usr/bin/env node

/**
 * AI Agent Test Script
 * Tests the AI agent capabilities without requiring full server startup
 */

import 'dotenv/config';
import { parseCommand, executeAction } from './services/ai-agent.js';

// Mock farmStores for testing
const mockFarmStores = {
  zones: {
    getAllForFarm: (farmId) => [
      { zone_id: 'zone1', name: 'Grow Room 1', type: 'lighting', is_on: false, current_brightness: 0 },
      { zone_id: 'zone2', name: 'Grow Room 2', type: 'lighting', is_on: true, current_brightness: 75 },
      { zone_id: 'zone3', name: 'Nursery', type: 'environmental', is_on: true }
    ],
    updateForFarm: (farmId, zoneId, updates) => {
      console.log(`  [Mock] Updated zone ${zoneId}:`, updates);
    }
  },
  inventory: {
    getAllForFarm: (farmId) => [
      { sku_id: 'LET-001', product_name: 'Butterhead Lettuce', available: 45, quantity_total: 50, price_per_unit: 3.50 },
      { sku_id: 'BAS-001', product_name: 'Sweet Basil', available: 30, quantity_total: 35, price_per_unit: 4.00 },
      { sku_id: 'KAL-001', product_name: 'Curly Kale', available: 5, quantity_total: 20, price_per_unit: 3.75 }
    ],
    updateForFarm: (farmId, sku, updates) => {
      console.log(`  [Mock] Updated inventory ${sku}:`, updates);
    }
  },
  orders: {
    getAllForFarm: (farmId) => [
      { order_id: 'ORD-001', customer_name: 'John Doe', payment: { amount: 25.50 }, status: 'completed', timestamps: { created_at: new Date().toISOString() } },
      { order_id: 'ORD-002', customer_name: 'Jane Smith', payment: { amount: 42.00 }, status: 'pending', timestamps: { created_at: new Date(Date.now() - 86400000).toISOString() } }
    ]
  },
  sensorData: {
    getAllForFarm: (farmId) => [
      { sensor_id: 'temp1', type: 'temperature', value: 72.5, unit: '°F', timestamp: new Date().toISOString() },
      { sensor_id: 'hum1', type: 'humidity', value: 65, unit: '%', timestamp: new Date().toISOString() }
    ]
  },
  automationRules: {
    getAllForFarm: (farmId) => [
      { rule_id: 'rule1', name: 'Evening Lights Off', enabled: true, trigger_type: 'time' },
      { rule_id: 'rule2', name: 'High Temp Fan', enabled: false, trigger_type: 'sensor' }
    ],
    updateForFarm: (farmId, ruleId, updates) => {
      console.log(`  [Mock] Updated rule ${ruleId}:`, updates);
    }
  }
};

const testContext = {
  farmStores: mockFarmStores,
  farmId: 'test-farm-001',
  userId: 'test-user'
};

// Test commands
const testCommands = [
  "Turn on the lights",
  "What's the temperature?",
  "Show me my inventory",
  "List today's orders",
  "Check system health",
  "Generate sales report",
  "Low stock alert",
  "Set lights to 50%"
];

async function runTests() {
  console.log('🤖 AI Agent Test Script\n');
  console.log('Testing AI agent capabilities with mock data...\n');
  
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ Error: OPENAI_API_KEY not set');
    console.error('   Set your OpenAI API key: export OPENAI_API_KEY="sk-..."');
    process.exit(1);
  }
  
  console.log('✅ OpenAI API key configured\n');
  console.log('Running', testCommands.length, 'test commands...\n');
  console.log('─'.repeat(80));
  
  for (const command of testCommands) {
    console.log(`\n🗣️  User: "${command}"\n`);
    
    try {
      // Parse command
      console.log('   Parsing command...');
      const intent = await parseCommand(command);
      console.log('   Intent:', intent.intent);
      console.log('   Confidence:', intent.confidence);
      console.log('   Response:', intent.response);
      
      // Execute action
      console.log('\n   Executing action...');
      const result = await executeAction(intent, testContext);
      
      if (result.success) {
        console.log('   ✅', result.message);
        if (result.data) {
          console.log('   Data:', JSON.stringify(result.data, null, 2).split('\n').map(l => '      ' + l).join('\n'));
        }
      } else {
        console.log('   ❌ Error:', result.message);
      }
      
    } catch (error) {
      console.error('   ❌ Test failed:', error.message);
    }
    
    console.log('\n' + '─'.repeat(80));
    
    // Small delay between requests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n✅ All tests completed!\n');
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
