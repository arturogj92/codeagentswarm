#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const { URL } = require('url');

// Parse arguments
const args = process.argv.slice(2);
if (args.length < 4) {
  console.error('Usage: node upload-large-file-with-retry.js <SUPABASE_URL> <SERVICE_KEY> <FILE_PATH> <UPLOAD_PATH>');
  process.exit(1);
}

const [SUPABASE_URL, SERVICE_KEY, FILE_PATH, UPLOAD_PATH] = args;

// Configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 5000; // 5 seconds
const UPLOAD_TIMEOUT = 10 * 60 * 1000; // 10 minutes
const PROGRESS_INTERVAL = 2000; // Report progress every 2 seconds

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function uploadWithRetry(attempt = 1) {
  const fileSize = fs.statSync(FILE_PATH).size;
  
  if (attempt === 1) {
    console.log(`📦 File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
  }
  
  console.log(`📤 Upload attempt ${attempt}/${MAX_RETRIES}...`);
  
  const uploadUrl = new URL(`${SUPABASE_URL}/storage/v1/object/${UPLOAD_PATH}`);
  
  const options = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Content-Type': 'application/octet-stream',
      'Content-Length': fileSize.toString(),
      'Cache-Control': 'public, max-age=31536000'
    },
    timeout: UPLOAD_TIMEOUT
  };
  
  return new Promise((resolve, reject) => {
    let uploadStartTime = Date.now();
    let lastProgressTime = Date.now();
    let lastProgressBytes = 0;
    let uploaded = 0;
    let progressTimer;
    
    const req = https.request(uploadUrl, options, (res) => {
      clearInterval(progressTimer);
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log('\n✅ File uploaded successfully!');
          resolve({ success: true, data });
        } else {
          console.error(`\n❌ Upload failed with status ${res.statusCode}`);
          console.error(`Response: ${data}`);
          reject(new Error(`Upload failed: ${res.statusCode} - ${data}`));
        }
      });
    });
    
    // Set timeout for the request
    req.on('timeout', () => {
      clearInterval(progressTimer);
      console.error('\n❌ Upload timeout - connection seems stuck');
      req.destroy();
      reject(new Error('Upload timeout'));
    });
    
    req.on('error', (err) => {
      clearInterval(progressTimer);
      console.error('\n❌ Request error:', err.message);
      reject(err);
    });
    
    // Stream the file
    const fileStream = fs.createReadStream(FILE_PATH, { highWaterMark: 64 * 1024 }); // 64KB chunks
    
    // Track upload progress
    fileStream.on('data', (chunk) => {
      uploaded += chunk.length;
      lastProgressBytes = uploaded;
      lastProgressTime = Date.now();
    });
    
    // Progress monitoring
    progressTimer = setInterval(() => {
      const percent = ((uploaded / fileSize) * 100).toFixed(1);
      const elapsedSeconds = Math.floor((Date.now() - uploadStartTime) / 1000);
      const bytesPerSecond = uploaded / elapsedSeconds || 0;
      const remainingBytes = fileSize - uploaded;
      const remainingSeconds = Math.ceil(remainingBytes / bytesPerSecond);
      const speed = (bytesPerSecond / 1024 / 1024).toFixed(2);
      
      // Check if progress has stalled
      const timeSinceLastProgress = Date.now() - lastProgressTime;
      if (timeSinceLastProgress > 30000 && uploaded < fileSize) { // 30 seconds without progress
        console.error('\n⚠️  Upload appears to be stalled (no progress for 30s)');
        clearInterval(progressTimer);
        req.destroy();
        fileStream.destroy();
        reject(new Error('Upload stalled'));
        return;
      }
      
      process.stdout.write(`\r📤 Progress: ${percent}% | Speed: ${speed} MB/s | ETA: ${remainingSeconds}s`);
    }, PROGRESS_INTERVAL);
    
    fileStream.on('end', () => {
      console.log('\n📊 Stream complete, waiting for server response...');
    });
    
    fileStream.on('error', (err) => {
      clearInterval(progressTimer);
      console.error('\n❌ Stream error:', err);
      req.destroy();
      reject(err);
    });
    
    fileStream.pipe(req);
  });
}

async function uploadWithRetries() {
  let lastError;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await uploadWithRetry(attempt);
    } catch (error) {
      lastError = error;
      console.error(`\n⚠️  Attempt ${attempt} failed: ${error.message}`);
      
      if (attempt < MAX_RETRIES) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1); // Exponential backoff
        console.log(`⏳ Waiting ${delay / 1000} seconds before retry...`);
        await sleep(delay);
      }
    }
  }
  
  throw new Error(`Upload failed after ${MAX_RETRIES} attempts. Last error: ${lastError.message}`);
}

// Run the upload
uploadWithRetries()
  .then(() => {
    console.log('✅ Upload completed successfully!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Upload failed:', err.message);
    process.exit(1);
  });