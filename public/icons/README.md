# PWA App Icons

This directory contains app icons for the Progressive Web App.

## Required Sizes

- 72x72 - Android small
- 96x96 - Android medium
- 128x128 - Android large
- 144x144 - Android extra-large
- 152x152 - iOS
- 192x192 - Android standard
- 384x384 - Android double
- 512x512 - Android triple, splash screen

## Generating Icons

To generate all icon sizes from a source image:

```bash
# Using ImageMagick
convert source-icon.png -resize 72x72 icon-72x72.png
convert source-icon.png -resize 96x96 icon-96x96.png
convert source-icon.png -resize 128x128 icon-128x128.png
convert source-icon.png -resize 144x144 icon-144x144.png
convert source-icon.png -resize 152x152 icon-152x152.png
convert source-icon.png -resize 192x192 icon-192x192.png
convert source-icon.png -resize 384x384 icon-384x384.png
convert source-icon.png -resize 512x512 icon-512x512.png
```

## Design Guidelines

- Use a simple, recognizable design
- Ensure good contrast on all backgrounds
- Avoid text (will be too small on small icons)
- Use transparent or solid background
- Test on both light and dark themes
