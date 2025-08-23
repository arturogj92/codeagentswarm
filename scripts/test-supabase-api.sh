#!/bin/bash

# Test script for Supabase API
# Usage: ./test-supabase-api.sh <SUPABASE_URL> <SUPABASE_SERVICE_KEY>

SUPABASE_URL=$1
SUPABASE_SERVICE_KEY=$2

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_KEY" ]; then
  echo "Usage: $0 <SUPABASE_URL> <SUPABASE_SERVICE_KEY>"
  exit 1
fi

echo "Testing Supabase API..."
echo "URL: $SUPABASE_URL"

# Test 1: Check if releases table exists
echo -e "\n1. Checking releases table..."
TABLE_CHECK=$(curl -s -X GET \
  "$SUPABASE_URL/rest/v1/releases?limit=1" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json")
echo "Response: $TABLE_CHECK"

# Test 2: Test INSERT with minimal return
echo -e "\n2. Testing INSERT with return=minimal..."
TEST_DATA='{
  "version": "0.0.1-test",
  "platform": "darwin",
  "arch": "x64",
  "file_name": "test.dmg",
  "file_url": "https://example.com/test.dmg",
  "file_size": 12345,
  "sha512": "abc123",
  "release_notes": "Test release",
  "is_prerelease": false,
  "is_active": true
}'

INSERT_RESPONSE=$(curl -s -X POST \
  "$SUPABASE_URL/rest/v1/releases" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d "$TEST_DATA" \
  -w "\n%{http_code}")

HTTP_STATUS=$(echo "$INSERT_RESPONSE" | tail -n 1)
RESPONSE_BODY=$(echo "$INSERT_RESPONSE" | sed '$d')

echo "HTTP Status: $HTTP_STATUS"
echo "Response Body: $RESPONSE_BODY"

# Test 3: Clean up test data
echo -e "\n3. Cleaning up test data..."
DELETE_RESPONSE=$(curl -s -X DELETE \
  "$SUPABASE_URL/rest/v1/releases?version=eq.0.0.1-test" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_KEY" \
  -w "\n%{http_code}")

DELETE_STATUS=$(echo "$DELETE_RESPONSE" | tail -n 1)
echo "Delete status: $DELETE_STATUS"