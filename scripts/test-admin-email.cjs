#!/usr/bin/env node
/**
 * Test Script: Admin Welcome Email
 * Tests the complete workflow of creating an admin user and sending welcome email
 */

const http = require('http');

const BASE_URL = 'http://127.0.0.1:8091';

function makeRequest(path, method, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (data && data.token) {
      options.headers['Authorization'] = `Bearer ${data.token}`;
      delete data.token;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

async function testAdminWelcomeEmail() {
  console.log('=== TESTING ADMIN WELCOME EMAIL ===\n');

  // Step 1: Admin login
  console.log('1. Admin Login...');
  const login = await makeRequest('/api/admin/auth/login', 'POST', {
    email: 'info@greenreachfarms.com',
    password: 'Admin2025!'
  });

  if (!login.data.success) {
    console.error('❌ Login failed:', login.data);
    process.exit(1);
  }

  console.log('✅ Login successful');
  console.log('   Admin:', login.data.admin.name);
  const token = login.data.token;

  // Step 2: Create user
  console.log('\n2. Creating new user...');
  const timestamp = Date.now();
  const create = await makeRequest('/api/admin/users', 'POST', {
    token: token,
    first_name: 'Test',
    last_name: 'Employee',
    email: `test.employee.${timestamp}@local.test`,
    role: 'staff'
  });

  console.log('\n=== USER CREATION RESPONSE ===');
  console.log(JSON.stringify(create.data, null, 2));

  if (create.data.success) {
    console.log('\n✅ User created successfully!');
    console.log('   Email sent:', create.data.email_sent);
    console.log('   Temp password:', create.data.temp_password);
    if (create.data.email_error) {
      console.log('   Email error:', create.data.email_error);
    }
  } else {
    console.log('\n❌ User creation failed');
    console.log('   Error:', create.data.error);
  }

  console.log('\n=== TEST COMPLETE ===');
}

testAdminWelcomeEmail().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
