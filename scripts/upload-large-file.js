#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const { URL } = require('url');
const path = require('path');

// Parse arguments
const args = process.argv.slice(2);
if (args.length < 4) {
  console.error('Usage: node upload-large-file.js <SUPABASE_URL> <SERVICE_KEY> <FILE_PATH> <UPLOAD_PATH>');
  process.exit(1);
}

const [SUPABASE_URL, SERVICE_KEY, FILE_PATH, UPLOAD_PATH] = args;

// For large files, we'll use the resumable upload endpoint
async function uploadLargeFile() {
  const fileSize = fs.statSync(FILE_PATH).size;
  console.log(`📦 File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
  
  // For files over 6MB, use TUS resumable upload
  if (fileSize > 6 * 1024 * 1024) {
    console.log('📤 Using resumable upload for large file...');
    
    // Supabase uses TUS protocol for large files
    // First, create an upload session
    const createUrl = new URL(`${SUPABASE_URL}/storage/v1/upload/resumable`);
    
    const createOptions = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Upload-Length': fileSize.toString(),
        'Upload-Metadata': `bucketName YnVja2V0cw==,objectName ${Buffer.from(UPLOAD_PATH).toString('base64')}`, // base64 encoded
        'Tus-Resumable': '1.0.0'
      }
    };
    
    return new Promise((resolve, reject) => {
      const req = https.request(createUrl, createOptions, (res) => {
        if (res.statusCode === 201) {
          const uploadUrl = res.headers.location;
          console.log('✅ Upload session created');
          console.log(`📍 Upload URL: ${uploadUrl}`);
          
          // Now upload the file data
          const uploadOptions = {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${SERVICE_KEY}`,
              'apikey': SERVICE_KEY,
              'Content-Type': 'application/offset+octet-stream',
              'Upload-Offset': '0',
              'Tus-Resumable': '1.0.0'
            }
          };
          
          const uploadReq = https.request(uploadUrl, uploadOptions, (uploadRes) => {
            let data = '';
            uploadRes.on('data', chunk => data += chunk);
            uploadRes.on('end', () => {
              if (uploadRes.statusCode === 204) {
                console.log('✅ File uploaded successfully!');
                resolve({ success: true });
              } else {
                console.error(`❌ Upload failed with status ${uploadRes.statusCode}`);
                console.error(`Response: ${data}`);
                reject(new Error(`Upload failed: ${uploadRes.statusCode}`));
              }
            });
          });
          
          // Stream the file
          const fileStream = fs.createReadStream(FILE_PATH);
          fileStream.pipe(uploadReq);
          
          fileStream.on('error', (err) => {
            console.error('❌ File stream error:', err);
            uploadReq.destroy();
            reject(err);
          });
          
        } else {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            console.error(`❌ Failed to create upload session: ${res.statusCode}`);
            console.error(`Response: ${data}`);
            reject(new Error(`Failed to create session: ${res.statusCode}`));
          });
        }
      });
      
      req.on('error', reject);
      req.end();
    });
    
  } else {
    // For smaller files, use direct upload
    console.log('📤 Using direct upload...');
    
    const uploadUrl = new URL(`${SUPABASE_URL}/storage/v1/object/${UPLOAD_PATH}`);
    const fileData = fs.readFileSync(FILE_PATH);
    
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Content-Type': 'application/octet-stream',
        'Content-Length': fileSize
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
            reject(new Error(`Upload failed: ${res.statusCode}`));
          }
        });
      });
      
      req.on('error', reject);
      req.write(fileData);
      req.end();
    });
  }
}

// Run the upload
uploadLargeFile()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });