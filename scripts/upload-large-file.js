#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const { URL } = require('url');

// Parse arguments
const args = process.argv.slice(2);
if (args.length < 4) {
  console.error('Usage: node upload-large-file.js <SUPABASE_URL> <SERVICE_KEY> <FILE_PATH> <UPLOAD_PATH>');
  process.exit(1);
}

const [SUPABASE_URL, SERVICE_KEY, FILE_PATH, UPLOAD_PATH] = args;

async function uploadLargeFile() {
  const fileSize = fs.statSync(FILE_PATH).size;
  console.log(`📦 File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
  
  console.log('📤 Uploading file to Supabase Storage...');
  
  // Use direct upload for all files
  // Supabase storage accepts files up to 5GB with proper configuration
  const uploadUrl = new URL(`${SUPABASE_URL}/storage/v1/object/${UPLOAD_PATH}`);
  
  const options = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Content-Type': 'application/octet-stream',
      'Content-Length': fileSize.toString(),
      'Cache-Control': 'public, max-age=31536000'
    }
  };
  
  return new Promise((resolve, reject) => {
    const req = https.request(uploadUrl, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log('✅ File uploaded successfully!');
          resolve({ success: true, data });
        } else {
          console.error(`❌ Upload failed with status ${res.statusCode}`);
          console.error(`Response: ${data}`);
          reject(new Error(`Upload failed: ${res.statusCode} - ${data}`));
        }
      });
    });
    
    req.on('error', (err) => {
      console.error('❌ Request error:', err);
      reject(err);
    });
    
    // For large files, stream the data instead of loading all in memory
    if (fileSize > 50 * 1024 * 1024) { // 50MB
      console.log('📊 Streaming large file...');
      const fileStream = fs.createReadStream(FILE_PATH);
      let uploaded = 0;
      
      fileStream.on('data', (chunk) => {
        uploaded += chunk.length;
        const percent = ((uploaded / fileSize) * 100).toFixed(1);
        process.stdout.write(`\r📤 Upload progress: ${percent}%`);
      });
      
      fileStream.on('end', () => {
        console.log('\n✅ Stream complete');
      });
      
      fileStream.on('error', (err) => {
        console.error('\n❌ Stream error:', err);
        req.destroy();
        reject(err);
      });
      
      fileStream.pipe(req);
    } else {
      // For smaller files, read all at once
      const fileData = fs.readFileSync(FILE_PATH);
      req.write(fileData);
      req.end();
    }
  });
}

// Run the upload
uploadLargeFile()
  .then(() => {
    console.log('✅ Upload completed successfully!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Upload failed:', err.message);
    process.exit(1);
  });