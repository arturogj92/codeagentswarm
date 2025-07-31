#!/usr/bin/env node

// Manual test for Supabase upload
// Usage: node test-upload-manual.js

const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuration - REPLACE THESE VALUES
const SUPABASE_URL = 'https://fqamfucosytcyueqadog.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZxYW1mdWNvc3l0Y3l1ZXFhZG9nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4MTgwNzgsImV4cCI6MjA2OTM5NDA3OH0.xt7-hlYgNT0vYOcz96HhV278Pmoc5LNmoga7a65AraY';
// You need the SERVICE KEY (not anon key) for storage uploads
const SUPABASE_SERVICE_KEY = 'YOUR_SERVICE_KEY_HERE'; // <-- REPLACE THIS

// Test data
const testVersion = '0.0.1-test';
const testFileName = 'test-file.txt';
const testContent = 'This is a test file for Supabase storage upload';

async function makeRequest(url, options, data) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: responseData
        });
      });
    });
    
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function testStorageUpload() {
  console.log('🧪 Testing Supabase Storage Upload...\n');
  
  // Test 1: Check if bucket exists
  console.log('1️⃣ Checking if releases bucket exists...');
  const bucketsUrl = new URL(`${SUPABASE_URL}/storage/v1/bucket`);
  const bucketsResponse = await makeRequest(bucketsUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'apikey': SUPABASE_SERVICE_KEY
    }
  });
  
  console.log(`Status: ${bucketsResponse.status}`);
  console.log(`Buckets: ${bucketsResponse.data}\n`);
  
  // Test 2: Try uploading with service key
  console.log('2️⃣ Attempting file upload with service key...');
  const uploadPath = `releases/test/${testVersion}/${testFileName}`;
  const uploadUrl = new URL(`${SUPABASE_URL}/storage/v1/object/releases/${uploadPath}`);
  
  const uploadResponse = await makeRequest(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'apikey': SUPABASE_SERVICE_KEY,
      'Content-Type': 'text/plain',
      'Content-Length': Buffer.byteLength(testContent)
    }
  }, testContent);
  
  console.log(`Status: ${uploadResponse.status}`);
  console.log(`Response: ${uploadResponse.data}\n`);
  
  if (uploadResponse.status === 200) {
    console.log('✅ Upload successful! Now testing database insert...\n');
    
    // Test 3: Try inserting into releases table
    console.log('3️⃣ Testing database insert...');
    const releaseData = {
      version: testVersion,
      platform: 'darwin',
      arch: 'x64',
      file_name: testFileName,
      file_url: `${SUPABASE_URL}/storage/v1/object/public/releases/${uploadPath}`,
      file_size: Buffer.byteLength(testContent),
      sha512: 'test-sha512',
      release_notes: 'Test release',
      is_prerelease: false,
      is_active: true
    };
    
    const dbUrl = new URL(`${SUPABASE_URL}/rest/v1/releases`);
    const dbResponse = await makeRequest(dbUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'apikey': SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      }
    }, JSON.stringify(releaseData));
    
    console.log(`Status: ${dbResponse.status}`);
    console.log(`Response: ${dbResponse.data}\n`);
    
    // Clean up
    if (dbResponse.status === 200 || dbResponse.status === 201) {
      console.log('🧹 Cleaning up test data...');
      const deleteUrl = new URL(`${SUPABASE_URL}/rest/v1/releases?version=eq.${testVersion}`);
      await makeRequest(deleteUrl, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'apikey': SUPABASE_SERVICE_KEY
        }
      });
    }
  }
  
  // Test 4: Check storage bucket policies
  console.log('4️⃣ Checking storage bucket policies...');
  const policiesUrl = new URL(`${SUPABASE_URL}/storage/v1/bucket/releases`);
  const policiesResponse = await makeRequest(policiesUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'apikey': SUPABASE_SERVICE_KEY
    }
  });
  
  console.log(`Status: ${policiesResponse.status}`);
  console.log(`Bucket details: ${policiesResponse.data}\n`);
}

// Main
console.log('🚀 Supabase Manual Test Script');
console.log('================================\n');

if (SUPABASE_SERVICE_KEY === 'YOUR_SERVICE_KEY_HERE') {
  console.error('❌ ERROR: You need to replace SUPABASE_SERVICE_KEY with your actual service key!');
  console.error('You can find it in your Supabase dashboard under Settings > API\n');
  process.exit(1);
}

testStorageUpload()
  .then(() => console.log('✅ Tests completed!'))
  .catch(err => console.error('❌ Error:', err));