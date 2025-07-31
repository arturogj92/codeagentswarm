#!/bin/bash

# Direct storage test
SUPABASE_URL="https://fqamfucosytcyueqadog.supabase.co"
SERVICE_KEY="${1:-}"

if [ -z "$SERVICE_KEY" ]; then
  echo "❌ ERROR: Necesitas proporcionar el SERVICE KEY como argumento"
  echo "Uso: ./test-storage-direct.sh <SERVICE_KEY>"
  echo ""
  echo "Puedes encontrar el SERVICE KEY en:"
  echo "1. Ve a https://supabase.com/dashboard"
  echo "2. Selecciona tu proyecto"
  echo "3. Settings → API"
  echo "4. Copia el 'service_role' key (NO el anon key)"
  exit 1
fi

echo "🧪 Testing direct storage upload..."

# Create a small test zip file
echo "Test content for release" > test-content.txt
zip test-release.zip test-content.txt

echo ""
echo "1️⃣ Uploading test zip file to storage..."
UPLOAD_RESPONSE=$(curl -X POST \
  "$SUPABASE_URL/storage/v1/object/releases/test/manual-test.zip" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "apikey: $SERVICE_KEY" \
  -H "Content-Type: application/zip" \
  --data-binary "@test-release.zip" \
  -w "\n%{http_code}")

HTTP_STATUS=$(echo "$UPLOAD_RESPONSE" | tail -n 1)
RESPONSE_BODY=$(echo "$UPLOAD_RESPONSE" | sed '$d')

echo "Status: $HTTP_STATUS"
echo "Response: $RESPONSE_BODY"

if [ "$HTTP_STATUS" = "200" ]; then
  echo "✅ Upload successful!"
  
  echo ""
  echo "2️⃣ Now testing database insert..."
  
  DB_RESPONSE=$(curl -X POST \
    "$SUPABASE_URL/rest/v1/releases" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "apikey: $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    -d '{
      "version": "0.0.1-manual-test",
      "platform": "darwin",
      "arch": "x64",
      "file_name": "manual-test.zip",
      "file_url": "'$SUPABASE_URL'/storage/v1/object/public/releases/test/manual-test.zip",
      "file_size": 123,
      "sha512": "test-sha512",
      "release_notes": "Manual test",
      "is_prerelease": false,
      "is_active": true
    }' \
    -w "\n%{http_code}")
  
  DB_HTTP_STATUS=$(echo "$DB_RESPONSE" | tail -n 1)
  DB_RESPONSE_BODY=$(echo "$DB_RESPONSE" | sed '$d')
  
  echo "Database Status: $DB_HTTP_STATUS"
  echo "Database Response: $DB_RESPONSE_BODY"
  
  if [ "$DB_HTTP_STATUS" = "200" ] || [ "$DB_HTTP_STATUS" = "201" ]; then
    echo "✅ Database insert successful!"
    
    echo ""
    echo "3️⃣ Cleaning up test data..."
    curl -X DELETE \
      "$SUPABASE_URL/rest/v1/releases?version=eq.0.0.1-manual-test" \
      -H "Authorization: Bearer $SERVICE_KEY" \
      -H "apikey: $SERVICE_KEY"
    
    curl -X DELETE \
      "$SUPABASE_URL/storage/v1/object/releases/test/manual-test.zip" \
      -H "Authorization: Bearer $SERVICE_KEY" \
      -H "apikey: $SERVICE_KEY"
  fi
fi

# Clean up local files
rm -f test-content.txt test-release.zip

echo ""
echo "✅ Test completed!"