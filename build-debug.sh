#!/bin/bash

echo "🔧 Building CodeAgentSwarm in DEBUG mode..."

# Create debug config file
echo '{"debugMode":true}' > debug-config.json
echo "✅ Created debug-config.json"

# Set Python path for macOS
export PYTHON=/opt/homebrew/bin/python3.11

# Enable debug logs
export ENABLE_DEBUG_LOGS=true

# Run the build
echo "🏗️ Starting build process..."
electron-builder

# Check if build was successful
if [ $? -eq 0 ]; then
    echo "✅ Build completed successfully!"
    echo "📍 Debug mode is enabled in the built app"
    echo "📋 The debug-config.json file is included in the bundle"
    
    # Keep debug-config.json for reference
    echo ""
    echo "⚠️  Note: debug-config.json is still in the project directory."
    echo "   Run 'npm run build:debug:clean' to remove it if needed."
else
    echo "❌ Build failed!"
    # Clean up on failure
    rm -f debug-config.json
    exit 1
fi