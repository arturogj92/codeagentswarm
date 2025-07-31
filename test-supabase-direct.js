// Test Supabase API directly
// Usage: SUPABASE_URL=xxx SUPABASE_SERVICE_KEY=xxx node test-supabase-direct.js

const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables');
  process.exit(1);
}

const testData = {
  version: '0.0.1-test',
  platform: 'darwin',
  arch: 'x64',
  file_name: 'test.dmg',
  file_url: 'https://example.com/test.dmg',
  file_size: 12345,
  sha512: 'abc123',
  release_notes: 'Test release',
  is_prerelease: false,
  is_active: true
};

function makeRequest(path, method, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SUPABASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'apikey': SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, data, headers: res.headers });
      });
    });

    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function runTests() {
  console.log('Testing Supabase API...');
  console.log('URL:', SUPABASE_URL);

  try {
    // Test 1: Check table
    console.log('\n1. Checking releases table...');
    const tableCheck = await makeRequest('/rest/v1/releases?limit=1', 'GET');
    console.log('Status:', tableCheck.status);
    console.log('Data:', tableCheck.data);

    // Test 2: Insert with return=minimal
    console.log('\n2. Testing INSERT with return=minimal...');
    const insertMinimal = await makeRequest(
      '/rest/v1/releases',
      'POST',
      testData,
      { 'Prefer': 'return=minimal' }
    );
    console.log('Status:', insertMinimal.status);
    console.log('Data:', insertMinimal.data);

    // Test 3: Insert with return=representation
    console.log('\n3. Testing INSERT with return=representation...');
    const testData2 = { ...testData, version: '0.0.2-test' };
    const insertRep = await makeRequest(
      '/rest/v1/releases',
      'POST',
      testData2,
      { 'Prefer': 'return=representation' }
    );
    console.log('Status:', insertRep.status);
    console.log('Data:', insertRep.data);

    // Test 4: Clean up
    console.log('\n4. Cleaning up test data...');
    const cleanup1 = await makeRequest('/rest/v1/releases?version=eq.0.0.1-test', 'DELETE');
    const cleanup2 = await makeRequest('/rest/v1/releases?version=eq.0.0.2-test', 'DELETE');
    console.log('Cleanup status:', cleanup1.status, cleanup2.status);

  } catch (error) {
    console.error('Error:', error);
  }
}

runTests();