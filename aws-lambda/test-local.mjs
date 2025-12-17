/**
 * Local test script for Lambda function
 * Run: node test-local.mjs
 */

import { handler } from './index.mjs';

// Mock event
const event = {
  queryStringParameters: {
    // zone: 'zone-1',  // Optional filter
    // deviceId: 'ABC123'  // Optional filter
  },
  headers: {}
};

console.log('Testing Lambda function locally...\n');
console.log('Event:', JSON.stringify(event, null, 2));
console.log('\n---\n');

try {
  const response = await handler(event);
  console.log('Status Code:', response.statusCode);
  console.log('\nHeaders:', JSON.stringify(response.headers, null, 2));
  console.log('\nBody:');
  
  const body = JSON.parse(response.body);
  console.log(JSON.stringify(body, null, 2));
  
  if (Array.isArray(body) && body.length > 0) {
    console.log(`\n✅ Success! Found ${body.length} sensor reading(s)`);
  } else if (body.error) {
    console.log('\n❌ Error:', body.error);
  } else {
    console.log('\n⚠️  No sensors found');
  }
} catch (error) {
  console.error('❌ Test failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
