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
    
    # On macOS, we need to install coreutils for gtimeout
    # For GitHub Actions, we'll handle this differently
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # Use a background job with a timer for macOS
        (
            node scripts/upload-large-file.js \
                "$SUPABASE_URL" \
                "$SERVICE_KEY" \
                "$FILE_PATH" \
                "releases/$UPLOAD_PATH"
        ) &
        
        local upload_pid=$!
        local elapsed=0
        
        # Wait for the process or timeout
        while kill -0 $upload_pid 2>/dev/null; do
            if [ $elapsed -ge $TIMEOUT_SECONDS ]; then
                echo "⏱️  Upload timed out after $TIMEOUT_SECONDS seconds"
                kill -9 $upload_pid 2>/dev/null
                wait $upload_pid 2>/dev/null
                return 124  # Same exit code as timeout command
            fi
            sleep 1
            ((elapsed++))
        done
        
        # Get the exit status
        wait $upload_pid
        return $?
    else
        # On Linux, use timeout command
        timeout $TIMEOUT_SECONDS node scripts/upload-large-file.js \
            "$SUPABASE_URL" \
            "$SERVICE_KEY" \
            "$FILE_PATH" \
            "releases/$UPLOAD_PATH"
        
        return $?
    fi
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