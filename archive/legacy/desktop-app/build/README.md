# Light Engine Desktop - Build Assets

This directory contains assets for building desktop installers:

## Windows
- `icon.ico` - Application icon (256x256)
- `installerHeader.bmp` - NSIS installer header (150x57)
- `installerSidebar.bmp` - NSIS installer sidebar (164x314)

## macOS  
- `icon.icns` - Application icon (multiple sizes)
- `dmgBackground.png` - DMG background image (540x380)
- `entitlements.mac.plist` - macOS entitlements for hardened runtime

## Linux
- `icons/` - Icon set for Linux (16x16 to 512x512)

## Creating Icons

### From SVG or PNG source:

**Windows .ico:**
```bash
# Using ImageMagick
convert icon.png -define icon:auto-resize=256,128,96,64,48,32,16 icon.ico
```

**macOS .icns:**
```bash
# Create iconset
mkdir icon.iconset
sips -z 16 16 icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32 icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32 icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64 icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128 icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256 icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256 icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512 icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512 icon.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png

# Convert to .icns
iconutil -c icns icon.iconset
```

**Linux icons:**
```bash
mkdir -p icons
for size in 16 32 48 64 128 256 512; do
  convert icon.png -resize ${size}x${size} icons/${size}x${size}.png
done
```

## Installer Images

**NSIS Header** (150x57):
- Top banner of Windows installer
- Should include logo and product name
- BMP format

**NSIS Sidebar** (164x314):
- Left side of Windows installer pages
- Vertical banner with branding
- BMP format

**DMG Background** (540x380):
- Background image for macOS DMG
- Shows app icon and Applications folder
- PNG format with transparency

## Icon Guidelines

- Use high-resolution source (1024x1024 minimum)
- Simple, recognizable design
- Works at small sizes (16x16)
- Consistent branding
- Avoid text (may not be readable at small sizes)

## Current Status

⚠️ Placeholder images needed. To build installers, add:
- `build/icon.ico` (Windows)
- `build/icon.icns` (macOS)
- `build/icon.png` (Linux + fallback)
- `build/installerHeader.bmp` (Windows NSIS)
- `build/installerSidebar.bmp` (Windows NSIS)
- `build/dmgBackground.png` (macOS DMG)

For now, electron-builder will use default Electron icons.
