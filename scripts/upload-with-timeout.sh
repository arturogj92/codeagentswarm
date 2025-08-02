#!/bin/bash

# Upload file to Supabase with timeout and retry logic
# Usage: ./upload-with-timeout.sh <SUPABASE_URL> <SERVICE_KEY> <FILE_PATH> <UPLOAD_PATH>

SUPABASE_URL="$1"
SERVICE_KEY="$2"
FILE_PATH="$3"
UPLOAD_PATH="$4"

MAX_RETRIES=3
TIMEOUT_SECONDS=120  # 2 minutes timeout per attempt

upload_file() {
    local attempt=$1
    echo "📤 Upload attempt $attempt/$MAX_RETRIES..."
    
    # Use timeout command to limit execution time
    if command -v gtimeout >/dev/null 2>&1; then
        TIMEOUT_CMD="gtimeout"
    else
        TIMEOUT_CMD="timeout"
    fi
    
    # Try the upload with timeout
    $TIMEOUT_CMD $TIMEOUT_SECONDS node scripts/upload-large-file.js \
        "$SUPABASE_URL" \
        "$SERVICE_KEY" \
        "$FILE_PATH" \
        "releases/$UPLOAD_PATH"
    
    return $?
}

# Main retry loop
for attempt in $(seq 1 $MAX_RETRIES); do
    if upload_file $attempt; then
        echo "✅ Upload successful on attempt $attempt"
        exit 0
    else
        exit_code=$?
        if [ $exit_code -eq 124 ]; then
            echo "⏱️  Upload timed out after $TIMEOUT_SECONDS seconds"
        else
            echo "❌ Upload failed with exit code $exit_code"
        fi
        
        if [ $attempt -lt $MAX_RETRIES ]; then
            wait_time=$((5 * attempt))  # 5s, 10s, 15s
            echo "⏳ Waiting $wait_time seconds before retry..."
            sleep $wait_time
        fi
    fi
done

echo "❌ Upload failed after $MAX_RETRIES attempts"
exit 1