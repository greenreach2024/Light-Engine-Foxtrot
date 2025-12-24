#!/bin/bash
# Generate PWA icons from SVG using rsvg-convert or ImageMagick

if command -v rsvg-convert &> /dev/null; then
    echo "Using rsvg-convert to generate icons..."
    rsvg-convert -w 72 -h 72 icon.svg > icon-72x72.png
    rsvg-convert -w 96 -h 96 icon.svg > icon-96x96.png
    rsvg-convert -w 128 -h 128 icon.svg > icon-128x128.png
    rsvg-convert -w 144 -h 144 icon.svg > icon-144x144.png
    rsvg-convert -w 152 -h 152 icon.svg > icon-152x152.png
    rsvg-convert -w 192 -h 192 icon.svg > icon-192x192.png
    rsvg-convert -w 384 -h 384 icon.svg > icon-384x384.png
    rsvg-convert -w 512 -h 512 icon.svg > icon-512x512.png
elif command -v convert &> /dev/null; then
    echo "Using ImageMagick to generate icons..."
    convert -background none icon.svg -resize 72x72 icon-72x72.png
    convert -background none icon.svg -resize 96x96 icon-96x96.png
    convert -background none icon.svg -resize 128x128 icon-128x128.png
    convert -background none icon.svg -resize 144x144 icon-144x144.png
    convert -background none icon.svg -resize 152x152 icon-152x152.png
    convert -background none icon.svg -resize 192x192 icon-192x192.png
    convert -background none icon.svg -resize 384x384 icon-384x384.png
    convert -background none icon.svg -resize 512x512 icon-512x512.png
else
    echo "Error: Neither rsvg-convert nor ImageMagick found."
    echo "Install one of these tools:"
    echo "  macOS: brew install librsvg  (or)  brew install imagemagick"
    echo "  Ubuntu: apt-get install librsvg2-bin  (or)  apt-get install imagemagick"
    exit 1
fi

echo "Icons generated successfully!"
ls -lh icon-*.png
