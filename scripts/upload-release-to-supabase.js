#!/usr/bin/env node

// Alternative approach using Node.js instead of curl
const https = require('https');
const { URL } = require('url');

// Get arguments
const args = process.argv.slice(2);
if (args.length < 10) {
  console.error('Usage: node upload-release-to-supabase.js <SUPABASE_URL> <SERVICE_KEY> <VERSION> <PLATFORM> <ARCH> <FILENAME> <FILE_URL> <FILE_SIZE> <SHA512> <RELEASE_NOTES>');
  process.exit(1);
}

const [SUPABASE_URL, SERVICE_KEY, VERSION, PLATFORM, ARCH, FILENAME, FILE_URL, FILE_SIZE, SHA512, RELEASE_NOTES] = args;

const releaseData = {
  version: VERSION,
  platform: PLATFORM,
  arch: ARCH,
  file_name: FILENAME,
  file_url: FILE_URL,
  file_size: parseInt(FILE_SIZE),
  sha512: SHA512,
  release_notes: RELEASE_NOTES || `Release ${VERSION}`,
  is_prerelease: false,
  is_active: true
};

async function insertRelease() {
  const url = new URL(`${SUPABASE_URL}/rest/v1/releases`);
  const data = JSON.stringify(releaseData);

  const options = {
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
      'Content-Length': Buffer.byteLength(data)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          console.log('✅ Release registered successfully');
          resolve({ success: true, status: res.statusCode, data: responseData });
        } else {
          console.error(`❌ Failed with status ${res.statusCode}`);
          console.error('Response:', responseData);
          reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
        }
      });
    });

    req.on('error', (err) => {
      console.error('❌ Request failed:', err.message);
      reject(err);
    });

    req.write(data);
    req.end();
  });
}

// Run the insertion
insertRelease()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });