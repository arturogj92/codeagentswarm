#!/bin/bash

# Test local para Supabase
SUPABASE_URL="https://fqamfucosytcyueqadog.supabase.co"
SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZxYW1mdWNvc3l0Y3l1ZXFhZG9nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4MTgwNzgsImV4cCI6MjA2OTM5NDA3OH0.xt7-hlYgNT0vYOcz96HhV278Pmoc5LNmoga7a65AraY"

echo "🧪 Testing Supabase connection..."
echo ""

# Test 1: Check if we can read the releases table
echo "1️⃣ Testing READ access to releases table with anon key..."
curl -s "$SUPABASE_URL/rest/v1/releases?limit=1" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" | jq '.'

echo ""
echo "2️⃣ Checking bucket info..."
curl -s "$SUPABASE_URL/storage/v1/bucket" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" | jq '.'

echo ""
echo "3️⃣ Testing storage upload with anon key (this will likely fail)..."
echo "Test content" > test-file.txt
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  "$SUPABASE_URL/storage/v1/object/releases/test/test-file.txt" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: text/plain" \
  --data-binary "@test-file.txt")

HTTP_STATUS=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "Status: $HTTP_STATUS"
echo "Response: $BODY"

rm -f test-file.txt

echo ""
echo "❗ IMPORTANTE: El anon key NO tiene permisos para subir archivos a storage."
echo "❗ Necesitas el SERVICE KEY de tu dashboard de Supabase (Settings → API → service_role)"