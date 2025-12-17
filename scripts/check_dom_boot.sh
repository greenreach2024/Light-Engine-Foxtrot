#!/usr/bin/env bash
# Check DOM boot shape and basic CORS hints
set -euo pipefail

FILE="public/app.charlie.js"
SERVER="server-charlie.js"

if ! grep -q "document.addEventListener('DOMContentLoaded', async () =>" "$FILE"; then
  echo "ERROR: DOMContentLoaded async boot listener not found in $FILE"
  exit 2
fi

echo "DOM boot listener shape OK in $FILE"

if ! grep -q "Access-Control-Allow-Origin" "$SERVER"; then
  echo "WARNING: server may not explicitly set Access-Control-Allow-Origin (check server-charlie.js)"
else
  echo "CORS header hint found in $SERVER"
fi

exit 0
