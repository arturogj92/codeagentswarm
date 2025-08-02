#!/bin/bash

# Create DMG background and icon
echo "Creating DMG assets..."

# Create DMG background using ImageMagick (if available)
if command -v convert &> /dev/null; then
    # Create a 660x400 background with instructions
    convert -size 660x400 xc:'#0d0d0d' \
        -fill white -font Arial -pointsize 24 \
        -annotate +330+320 "Drag to Applications →" \
        -fill '#00d4ff' -font Arial-Bold -pointsize 32 \
        -annotate +330+80 "Install CodeAgentSwarm" \
        dmg-background.png
    
    echo "✅ Created dmg-background.png"
else
    echo "⚠️  ImageMagick not found. Install with: brew install imagemagick"
fi

# Convert PNG icon to ICNS (if png2icns is available)
if command -v png2icns &> /dev/null; then
    png2icns dmg-icon.icns logo_prod_512.png
    echo "✅ Created dmg-icon.icns"
else
    echo "⚠️  png2icns not found. Install with: brew install libicns"
    echo "   Using iconutil as fallback..."
    
    # Create iconset directory
    mkdir -p dmg-icon.iconset
    
    # Generate different sizes from the 512px icon
    sips -z 16 16     logo_prod_512.png --out dmg-icon.iconset/icon_16x16.png
    sips -z 32 32     logo_prod_512.png --out dmg-icon.iconset/icon_16x16@2x.png
    sips -z 32 32     logo_prod_512.png --out dmg-icon.iconset/icon_32x32.png
    sips -z 64 64     logo_prod_512.png --out dmg-icon.iconset/icon_32x32@2x.png
    sips -z 128 128   logo_prod_512.png --out dmg-icon.iconset/icon_128x128.png
    sips -z 256 256   logo_prod_512.png --out dmg-icon.iconset/icon_128x128@2x.png
    sips -z 256 256   logo_prod_512.png --out dmg-icon.iconset/icon_256x256.png
    sips -z 512 512   logo_prod_512.png --out dmg-icon.iconset/icon_256x256@2x.png
    sips -z 512 512   logo_prod_512.png --out dmg-icon.iconset/icon_512x512.png
    cp logo_prod_512.png dmg-icon.iconset/icon_512x512@2x.png
    
    # Convert to icns
    iconutil -c icns dmg-icon.iconset
    rm -rf dmg-icon.iconset
    
    echo "✅ Created dmg-icon.icns using iconutil"
fi

echo ""
echo "📦 DMG customization ready!"
echo "Run 'npm run build' to create the customized DMG installer"