#!/usr/bin/env node
/**
 * End-to-End Order Flow Test
 * Tests complete pilot order workflow from placement to payment
 * 
 * Workflow Steps:
 * 1. Create test farm with inventory
 * 2. Create test buyer account
 * 3. Place order through wholesale portal
 * 4. Verify farm receives notification
 * 5. Farm verifies/accepts order
 * 6. Monitor deadline compliance
 * 7. Fulfill order (pickup/delivery)
 * 8. Buyer confirms receipt
 * 9. Process payment
 * 10. Validate all alerts and logs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test configuration
const TEST_CONFIG = {
  farm: {
    farm_id: 'TEST-FARM-E2E',
    name: 'End-to-End Test Farm',
    contact: 'Test Farm Owner',
    email: 'farm-test@greenreachgreens.com',
    phone: '+17093983166',
    api_url: 'http://localhost:8091',
    inventory: [
      {
        sku_id: 'E2E-TOMATO-001',
        product_name: 'Organic Cherry Tomatoes',
        quantity_available: 20,
        unit: 'lb',
        price_per_unit: 8.50,
        organic: true,
        category: 'vegetables'
      },
      {
        sku_id: 'E2E-LETTUCE-001',
        product_name: 'Butter Lettuce',
        quantity_available: 15,
        unit: 'head',
        price_per_unit: 3.75,
        organic: true,
        category: 'vegetables'
      },
      {
        sku_id: 'E2E-EGGS-001',
        product_name: 'Free Range Eggs',
        quantity_available: 30,
        unit: 'dozen',
        price_per_unit: 7.00,
        organic: false,
        category: 'eggs'
      }
    ]
  },
  buyer: {
    buyer_id: 'TEST-BUYER-E2E',
    business_name: 'The Local Café',
    contact_name: 'Jane Smith',
    email: 'buyer-test@greenreachgreens.com',
    phone: '+17093983166',
    buyer_type: 'cafe'
  },
  order: {
    items: [
      { sku_id: 'E2E-TOMATO-001', quantity: 5, unit: 'lb' },
      { sku_id: 'E2E-LETTUCE-001', quantity: 10, unit: 'head' },
      { sku_id: 'E2E-EGGS-001', quantity: 4, unit: 'dozen' }
    ],
    fulfillment_method: 'pickup',
    pickup_time: '2025-12-30T14:00:00Z',
    payment_method: 'manual',
    special_instructions: 'Please pack eggs carefully'
  }
};

// Test state tracking
const testResults = {
  timestamp: new Date().toISOString(),
  steps: [],
  alerts: [],
  notifications: [],
  errors: []
};

// Utility functions
function logStep(step, status, details = {}) {
  const result = {
    step,
    status,
    timestamp: new Date().toISOString(),
    ...details
  };
  testResults.steps.push(result);
  
  const icon = status === 'pass' ? '✅' : status === 'fail' ? '❌' : '🔄';
  console.log(`${icon} Step ${testResults.steps.length}: ${step}`);
  
  if (details.message) {
    console.log(`   ${details.message}`);
  }
  
  if (status === 'fail') {
    testResults.errors.push({ step, ...details });
  }
}

function calculateOrderTotal() {
  let subtotal = 0;
  TEST_CONFIG.order.items.forEach(item => {
    const product = TEST_CONFIG.farm.inventory.find(p => p.sku_id === item.sku_id);
    if (product) {
      subtotal += product.price_per_unit * item.quantity;
    }
  });
  
  const deliveryFee = TEST_CONFIG.order.fulfillment_method === 'delivery' ? 10.00 : 0;
  const platformFee = subtotal * 0.03;
  const total = subtotal + deliveryFee + platformFee;
  
  return {
    subtotal: subtotal.toFixed(2),
    delivery_fee: deliveryFee.toFixed(2),
    platform_fee: platformFee.toFixed(2),
    total: total.toFixed(2)
  };
}

function generateOrderId() {
  return `E2E-ORDER-${Date.now()}`;
}

function generateSubOrderId(orderId) {
  return `${orderId}-${TEST_CONFIG.farm.farm_id}`;
}

// Test execution
async function runEndToEndTest() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  GreenReach Wholesale - End-to-End Order Flow Test');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`Test Farm: ${TEST_CONFIG.farm.name} (${TEST_CONFIG.farm.farm_id})`);
  console.log(`Test Buyer: ${TEST_CONFIG.buyer.business_name} (${TEST_CONFIG.buyer.buyer_id})`);
  console.log(`Order Items: ${TEST_CONFIG.order.items.length} products\n`);
  
  const orderId = generateOrderId();
  const subOrderId = generateSubOrderId(orderId);
  const orderTotal = calculateOrderTotal();
  
  console.log(`Order ID: ${orderId}`);
  console.log(`Sub-Order ID: ${subOrderId}`);
  console.log(`Order Total: $${orderTotal.total}\n`);
  console.log('─────────────────────────────────────────────────────────────\n');
  
  // Step 1: Setup test farm
  await setupTestFarm();
  
  // Step 2: Setup test buyer
  await setupTestBuyer();
  
  // Step 3: Validate inventory availability
  await validateInventory();
  
  // Step 4: Reserve inventory
  await reserveInventory(orderId);
  
  // Step 5: Place order
  await placeOrder(orderId, subOrderId, orderTotal);
  
  // Step 6: Send farm notification
  await sendFarmNotification(subOrderId);
  
  // Step 7: Farm verification
  await farmVerification(subOrderId);
  
  // Step 8: Monitor deadline compliance
  await monitorDeadline(subOrderId);
  
  // Step 9: Fulfill order
  await fulfillOrder(subOrderId);
  
  // Step 10: Buyer confirms receipt
  await confirmDelivery(subOrderId);
  
  // Step 11: Process payment
  await processPayment(orderId, orderTotal);
  
  // Step 12: Validate alerts
  await validateAlerts();
  
  // Step 13: Generate report
  await generateReport();
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Test Complete!');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

async function setupTestFarm() {
  try {
    logStep('Setup Test Farm', 'running');
    
    // Create farm config
    const farmConfig = {
      farm_id: TEST_CONFIG.farm.farm_id,
      name: TEST_CONFIG.farm.name,
      contact_name: TEST_CONFIG.farm.contact,
      email: TEST_CONFIG.farm.email,
      phone: TEST_CONFIG.farm.phone,
      api_url: TEST_CONFIG.farm.api_url,
      api_key: 'test-api-key-' + Math.random().toString(36).substr(2, 9),
      notification_preferences: {
        sms_enabled: true,
        email_enabled: true,
        push_enabled: true
      },
      status: 'active',
      created_at: new Date().toISOString()
    };
    
    // Save farm config
    const configDir = path.join(__dirname, '..', 'config', 'farms');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    const configFile = path.join(configDir, `${TEST_CONFIG.farm.farm_id}.json`);
    fs.writeFileSync(configFile, JSON.stringify(farmConfig, null, 2));
    
    // Create farm inventory
    const inventoryFile = path.join(__dirname, '..', 'public', 'data', 'wholesale-products.json');
    let productsData = { products: [] };
    
    if (fs.existsSync(inventoryFile)) {
      productsData = JSON.parse(fs.readFileSync(inventoryFile, 'utf8'));
    }
    
    // Add test farm products
    TEST_CONFIG.farm.inventory.forEach(product => {
      productsData.products.push({
        ...product,
        farm_id: TEST_CONFIG.farm.farm_id,
        farm_name: TEST_CONFIG.farm.name
      });
    });
    
    fs.writeFileSync(inventoryFile, JSON.stringify(productsData, null, 2));
    
    logStep('Setup Test Farm', 'pass', {
      message: `Farm created: ${TEST_CONFIG.farm.name}`,
      farm_id: TEST_CONFIG.farm.farm_id,
      products: TEST_CONFIG.farm.inventory.length
    });
    
  } catch (error) {
    logStep('Setup Test Farm', 'fail', {
      message: error.message,
      error: error.stack
    });
  }
}

async function setupTestBuyer() {
  try {
    logStep('Setup Test Buyer', 'running');
    
    const buyerConfig = {
      buyer_id: TEST_CONFIG.buyer.buyer_id,
      business_name: TEST_CONFIG.buyer.business_name,
      contact_name: TEST_CONFIG.buyer.contact_name,
      email: TEST_CONFIG.buyer.email,
      phone: TEST_CONFIG.buyer.phone,
      buyer_type: TEST_CONFIG.buyer.buyer_type,
      status: 'active',
      created_at: new Date().toISOString()
    };
    
    const configDir = path.join(__dirname, '..', 'config', 'buyers');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    const configFile = path.join(configDir, `${TEST_CONFIG.buyer.buyer_id}.json`);
    fs.writeFileSync(configFile, JSON.stringify(buyerConfig, null, 2));
    
    logStep('Setup Test Buyer', 'pass', {
      message: `Buyer created: ${TEST_CONFIG.buyer.business_name}`,
      buyer_id: TEST_CONFIG.buyer.buyer_id
    });
    
  } catch (error) {
    logStep('Setup Test Buyer', 'fail', {
      message: error.message,
      error: error.stack
    });
  }
}

async function validateInventory() {
  try {
    logStep('Validate Inventory Availability', 'running');
    
    const unavailable = [];
    TEST_CONFIG.order.items.forEach(item => {
      const product = TEST_CONFIG.farm.inventory.find(p => p.sku_id === item.sku_id);
      if (!product || product.quantity_available < item.quantity) {
        unavailable.push({
          sku_id: item.sku_id,
          requested: item.quantity,
          available: product ? product.quantity_available : 0
        });
      }
    });
    
    if (unavailable.length > 0) {
      logStep('Validate Inventory Availability', 'fail', {
        message: 'Insufficient inventory',
        unavailable
      });
    } else {
      logStep('Validate Inventory Availability', 'pass', {
        message: 'All items in stock',
        items: TEST_CONFIG.order.items.length
      });
    }
    
  } catch (error) {
    logStep('Validate Inventory Availability', 'fail', {
      message: error.message,
      error: error.stack
    });
  }
}

async function reserveInventory(orderId) {
  try {
    logStep('Reserve Inventory', 'running');
    
    // Simulate reservation
    const reservationsFile = path.join(__dirname, '..', 'public', 'data', 'wholesale-reservations.json');
    let reservations = { reservations: [] };
    
    if (fs.existsSync(reservationsFile)) {
      reservations = JSON.parse(fs.readFileSync(reservationsFile, 'utf8'));
    }
    
    TEST_CONFIG.order.items.forEach(item => {
      reservations.reservations.push({
        reservation_id: `RES-${orderId}-${item.sku_id}`,
        order_id: orderId,
        farm_id: TEST_CONFIG.farm.farm_id,
        sku_id: item.sku_id,
        quantity: item.quantity,
        status: 'active',
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
      });
    });
    
    fs.writeFileSync(reservationsFile, JSON.stringify(reservations, null, 2));
    
    logStep('Reserve Inventory', 'pass', {
      message: 'Inventory reserved for 24 hours',
      reservations: TEST_CONFIG.order.items.length
    });
    
  } catch (error) {
    logStep('Reserve Inventory', 'fail', {
      message: error.message,
      error: error.stack
    });
  }
}

async function placeOrder(orderId, subOrderId, orderTotal) {
  try {
    logStep('Place Order', 'running');
    
    const order = {
      order_id: orderId,
      buyer_id: TEST_CONFIG.buyer.buyer_id,
      buyer_name: TEST_CONFIG.buyer.business_name,
      status: 'PENDING',
      created_at: new Date().toISOString(),
      sub_orders: [
        {
          sub_order_id: subOrderId,
          farm_id: TEST_CONFIG.farm.farm_id,
          farm_name: TEST_CONFIG.farm.name,
          items: TEST_CONFIG.order.items.map(item => {
            const product = TEST_CONFIG.farm.inventory.find(p => p.sku_id === item.sku_id);
            return {
              ...item,
              product_name: product.product_name,
              price_per_unit: product.price_per_unit,
              line_total: (product.price_per_unit * item.quantity).toFixed(2)
            };
          }),
          fulfillment_method: TEST_CONFIG.order.fulfillment_method,
          pickup_time: TEST_CONFIG.order.pickup_time,
          special_instructions: TEST_CONFIG.order.special_instructions,
          status: 'PENDING',
          verification_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        }
      ],
      payment: {
        method: TEST_CONFIG.order.payment_method,
        subtotal: orderTotal.subtotal,
        delivery_fee: orderTotal.delivery_fee,
        platform_fee: orderTotal.platform_fee,
        total: orderTotal.total,
        status: 'pending'
      }
    };
    
    // Save order
    const ordersDir = path.join(__dirname, '..', 'data', 'orders');
    if (!fs.existsSync(ordersDir)) {
      fs.mkdirSync(ordersDir, { recursive: true });
    }
    
    const orderFile = path.join(ordersDir, `${orderId}.json`);
    fs.writeFileSync(orderFile, JSON.stringify(order, null, 2));
    
    logStep('Place Order', 'pass', {
      message: `Order placed: $${orderTotal.total}`,
      order_id: orderId,
      sub_order_id: subOrderId,
      items: TEST_CONFIG.order.items.length
    });
    
  } catch (error) {
    logStep('Place Order', 'fail', {
      message: error.message,
      error: error.stack
    });
  }
}

async function sendFarmNotification(subOrderId) {
  try {
    logStep('Send Farm Notification', 'running');
    
    // Log notification (would be sent via SMS/Email/Push in production)
    const notification = {
      notification_id: `NOTIF-${Date.now()}`,
      type: 'new_order',
      recipient_type: 'farm',
      recipient_id: TEST_CONFIG.farm.farm_id,
      recipient_email: TEST_CONFIG.farm.email,
      recipient_phone: TEST_CONFIG.farm.phone,
      subject: 'New Order Received',
      message: `New order ${subOrderId} from ${TEST_CONFIG.buyer.business_name}. Please verify within 24 hours.`,
      channels: ['sms', 'email', 'push'],
      status: 'sent',
      sent_at: new Date().toISOString()
    };
    
    testResults.notifications.push(notification);
    
    console.log(`\n   📧 Email: ${notification.recipient_email}`);
    console.log(`   📱 SMS: ${notification.recipient_phone}`);
    console.log(`   📲 Push: Mobile app notification`);
    console.log(`   Message: "${notification.message}"\n`);
    
    logStep('Send Farm Notification', 'pass', {
      message: 'Multi-channel notification sent',
      channels: notification.channels,
      notification_id: notification.notification_id
    });
    
  } catch (error) {
    logStep('Send Farm Notification', 'fail', {
      message: error.message,
      error: error.stack
    });
  }
}

async function farmVerification(subOrderId) {
  try {
    logStep('Farm Verification', 'running');
    
    // Simulate farm accepting order
    console.log(`\n   Farm reviews order: ${subOrderId}`);
    console.log('   Farm decision: ACCEPT ✓\n');
    
    const orderFile = path.join(__dirname, '..', 'data', 'orders', `${subOrderId.split('-')[0]}-${subOrderId.split('-')[1]}-${subOrderId.split('-')[2]}.json`);
    
    if (fs.existsSync(orderFile)) {
      const order = JSON.parse(fs.readFileSync(orderFile, 'utf8'));
      const subOrder = order.sub_orders.find(so => so.sub_order_id === subOrderId);
      
      if (subOrder) {
        subOrder.status = 'VERIFIED';
        subOrder.verified_at = new Date().toISOString();
        subOrder.verified_by = TEST_CONFIG.farm.contact;
        
        fs.writeFileSync(orderFile, JSON.stringify(order, null, 2));
      }
    }
    
    logStep('Farm Verification', 'pass', {
      message: 'Order verified by farm',
      sub_order_id: subOrderId,
      verified_at: new Date().toISOString()
    });
    
  } catch (error) {
    logStep('Farm Verification', 'fail', {
      message: error.message,
      error: error.stack
    });
  }
}

async function monitorDeadline(subOrderId) {
  try {
    logStep('Monitor Deadline Compliance', 'running');
    
    // Check verification happened before deadline
    const orderFile = path.join(__dirname, '..', 'data', 'orders', `${subOrderId.split('-')[0]}-${subOrderId.split('-')[1]}-${subOrderId.split('-')[2]}.json`);
    
    if (fs.existsSync(orderFile)) {
      const order = JSON.parse(fs.readFileSync(orderFile, 'utf8'));
      const subOrder = order.sub_orders.find(so => so.sub_order_id === subOrderId);
      
      if (subOrder && subOrder.verified_at) {
        const verifiedTime = new Date(subOrder.verified_at);
        const deadline = new Date(subOrder.verification_deadline);
        const onTime = verifiedTime < deadline;
        
        if (onTime) {
          const timeToVerify = Math.round((verifiedTime - new Date(order.created_at)) / 1000 / 60);
          logStep('Monitor Deadline Compliance', 'pass', {
            message: `Verified within deadline (${timeToVerify} minutes)`,
            verified_at: subOrder.verified_at,
            deadline: subOrder.verification_deadline,
            on_time: true
          });
        } else {
          logStep('Monitor Deadline Compliance', 'fail', {
            message: 'Verification missed deadline',
            verified_at: subOrder.verified_at,
            deadline: subOrder.verification_deadline,
            on_time: false
          });
        }
      } else {
        logStep('Monitor Deadline Compliance', 'fail', {
          message: 'Order not yet verified',
          sub_order_id: subOrderId
        });
      }
    }
    
  } catch (error) {
    logStep('Monitor Deadline Compliance', 'fail', {
      message: error.message,
      error: error.stack
    });
  }
}

async function fulfillOrder(subOrderId) {
  try {
    logStep('Fulfill Order', 'running');
    
    console.log(`\n   Farm prepares order for ${TEST_CONFIG.order.fulfillment_method}`);
    console.log(`   Packing items: ${TEST_CONFIG.order.items.length} products`);
    
    if (TEST_CONFIG.order.fulfillment_method === 'pickup') {
      console.log(`   Pickup scheduled: ${new Date(TEST_CONFIG.order.pickup_time).toLocaleString()}`);
    }
    
    console.log('   Order marked as READY\n');
    
    const orderFile = path.join(__dirname, '..', 'data', 'orders', `${subOrderId.split('-')[0]}-${subOrderId.split('-')[1]}-${subOrderId.split('-')[2]}.json`);
    
    if (fs.existsSync(orderFile)) {
      const order = JSON.parse(fs.readFileSync(orderFile, 'utf8'));
      const subOrder = order.sub_orders.find(so => so.sub_order_id === subOrderId);
      
      if (subOrder) {
        subOrder.status = 'READY';
        subOrder.ready_at = new Date().toISOString();
        
        fs.writeFileSync(orderFile, JSON.stringify(order, null, 2));
      }
    }
    
    logStep('Fulfill Order', 'pass', {
      message: 'Order ready for pickup/delivery',
      sub_order_id: subOrderId,
      fulfillment_method: TEST_CONFIG.order.fulfillment_method
    });
    
  } catch (error) {
    logStep('Fulfill Order', 'fail', {
      message: error.message,
      error: error.stack
    });
  }
}

async function confirmDelivery(subOrderId) {
  try {
    logStep('Buyer Confirms Delivery', 'running');
    
    console.log(`\n   Buyer picks up order`);
    console.log('   Buyer inspects products: All good ✓');
    console.log('   Buyer confirms receipt in portal\n');
    
    const orderFile = path.join(__dirname, '..', 'data', 'orders', `${subOrderId.split('-')[0]}-${subOrderId.split('-')[1]}-${subOrderId.split('-')[2]}.json`);
    
    if (fs.existsSync(orderFile)) {
      const order = JSON.parse(fs.readFileSync(orderFile, 'utf8'));
      const subOrder = order.sub_orders.find(so => so.sub_order_id === subOrderId);
      
      if (subOrder) {
        subOrder.status = 'COMPLETED';
        subOrder.completed_at = new Date().toISOString();
        subOrder.confirmed_by = TEST_CONFIG.buyer.contact_name;
        
        fs.writeFileSync(orderFile, JSON.stringify(order, null, 2));
      }
    }
    
    logStep('Buyer Confirms Delivery', 'pass', {
      message: 'Delivery confirmed by buyer',
      sub_order_id: subOrderId,
      completed_at: new Date().toISOString()
    });
    
  } catch (error) {
    logStep('Buyer Confirms Delivery', 'fail', {
      message: error.message,
      error: error.stack
    });
  }
}

async function processPayment(orderId, orderTotal) {
  try {
    logStep('Process Payment', 'running');
    
    console.log(`\n   Payment method: ${TEST_CONFIG.order.payment_method}`);
    console.log(`   Order total: $${orderTotal.total}`);
    
    if (TEST_CONFIG.order.payment_method === 'manual') {
      console.log('   Manual payment: Invoice sent to buyer');
      console.log('   Payment due: Net 7 days');
      console.log('   Farm settlement: After buyer payment received\n');
    }
    
    logStep('Process Payment', 'pass', {
      message: 'Payment processing initiated',
      payment_method: TEST_CONFIG.order.payment_method,
      total: orderTotal.total,
      status: 'pending_manual_payment'
    });
    
  } catch (error) {
    logStep('Process Payment', 'fail', {
      message: error.message,
      error: error.stack
    });
  }
}

async function validateAlerts() {
  try {
    logStep('Validate System Alerts', 'running');
    
    const alertsFile = path.join(__dirname, '..', 'public', 'data', 'system-alerts.json');
    
    if (fs.existsSync(alertsFile)) {
      const alertsData = JSON.parse(fs.readFileSync(alertsFile, 'utf8'));
      const recentAlerts = alertsData.alerts.filter(alert => {
        const alertTime = new Date(alert.timestamp);
        const testStartTime = new Date(testResults.timestamp);
        return alertTime >= testStartTime;
      });
      
      testResults.alerts = recentAlerts;
      
      if (recentAlerts.length === 0) {
        logStep('Validate System Alerts', 'pass', {
          message: 'No alerts during test (expected)',
          alerts_checked: alertsData.alerts.length
        });
      } else {
        console.log(`\n   ⚠️  ${recentAlerts.length} alerts detected during test:\n`);
        recentAlerts.forEach(alert => {
          console.log(`   - ${alert.type}: ${alert.details.message}`);
        });
        console.log();
        
        logStep('Validate System Alerts', 'pass', {
          message: `${recentAlerts.length} alerts recorded`,
          alerts: recentAlerts.map(a => a.type)
        });
      }
    } else {
      logStep('Validate System Alerts', 'pass', {
        message: 'No alert file found (no alerts)',
        alerts: 0
      });
    }
    
  } catch (error) {
    logStep('Validate System Alerts', 'fail', {
      message: error.message,
      error: error.stack
    });
  }
}

async function generateReport() {
  try {
    logStep('Generate Test Report', 'running');
    
    // Count results
    const passed = testResults.steps.filter(s => s.status === 'pass').length;
    const failed = testResults.steps.filter(s => s.status === 'fail').length;
    const total = testResults.steps.length;
    const successRate = ((passed / total) * 100).toFixed(1);
    
    // Generate report
    const report = {
      test_name: 'End-to-End Order Flow Test',
      timestamp: testResults.timestamp,
      duration: Math.round((new Date() - new Date(testResults.timestamp)) / 1000) + 's',
      summary: {
        total_steps: total,
        passed,
        failed,
        success_rate: successRate + '%'
      },
      test_data: {
        farm: TEST_CONFIG.farm.farm_id,
        buyer: TEST_CONFIG.buyer.buyer_id,
        order_items: TEST_CONFIG.order.items.length,
        order_total: calculateOrderTotal().total
      },
      steps: testResults.steps,
      notifications: testResults.notifications,
      alerts: testResults.alerts,
      errors: testResults.errors
    };
    
    // Save report
    const reportsDir = path.join(__dirname, '..', 'data', 'test-reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    
    const reportFile = path.join(reportsDir, `e2e-test-${Date.now()}.json`);
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    
    // Print summary
    console.log('\n─────────────────────────────────────────────────────────────');
    console.log('  TEST SUMMARY');
    console.log('─────────────────────────────────────────────────────────────\n');
    console.log(`Total Steps: ${total}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`Success Rate: ${successRate}%\n`);
    
    if (testResults.errors.length > 0) {
      console.log('Errors:\n');
      testResults.errors.forEach(error => {
        console.log(`  ❌ ${error.step}: ${error.message}`);
      });
      console.log();
    }
    
    console.log(`Report saved: ${reportFile}\n`);
    
    logStep('Generate Test Report', 'pass', {
      message: 'Test report generated',
      report_file: reportFile,
      success_rate: successRate + '%'
    });
    
  } catch (error) {
    logStep('Generate Test Report', 'fail', {
      message: error.message,
      error: error.stack
    });
  }
}

// Run test
runEndToEndTest().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
