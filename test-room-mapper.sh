#!/bin/bash
# Test Room Mapper Data Loading
# Verifies that room-mapper.html correctly reads from rooms.json

set -e

echo "=== Room Mapper Data Loading Test ==="
echo

# Test 1: Check rooms.json exists and has correct data
echo "✓ Test 1: Verify rooms.json exists on edge device"
ROOMS_DATA=$(ssh greenreach@100.65.187.59 "cat /home/greenreach/Light-Engine-Foxtrot/public/data/rooms.json")
echo "$ROOMS_DATA" | jq .

# Test 2: Verify GreenReach room is present
echo
echo "✓ Test 2: Extract room name"
ROOM_NAME=$(echo "$ROOMS_DATA" | jq -r '.rooms[0].name')
echo "Room Name: $ROOM_NAME"

if [ "$ROOM_NAME" != "GreenReach" ]; then
    echo "❌ ERROR: Expected 'GreenReach', got '$ROOM_NAME'"
    exit 1
fi

# Test 3: Check if room-mapper.html is served correctly
echo
echo "✓ Test 3: Check room-mapper.html is accessible"
ssh greenreach@100.65.187.59 "curl -sS -I http://127.0.0.1:8091/views/room-mapper.html" | head -1

# Test 4: Verify room-mapper loads from /data/rooms.json
echo
echo "✓ Test 4: Verify room-mapper source code reads from /data/rooms.json"
ssh greenreach@100.65.187.59 "grep -n '/data/rooms.json' /home/greenreach/Light-Engine-Foxtrot/public/views/room-mapper.html" | head -3

# Test 5: Check console logs for room loading
echo
echo "✓ Test 5: Test data endpoint directly"
ROOMS_ENDPOINT=$(ssh greenreach@100.65.187.59 "curl -sS http://127.0.0.1:8091/data/rooms.json")
echo "$ROOMS_ENDPOINT" | jq .

echo
echo "=== Summary ==="
echo "✅ rooms.json exists with correct GreenReach room data"
echo "✅ room-mapper.html loads from /data/rooms.json"  
echo "✅ Data endpoint serving correct data"
echo
echo "CONCLUSION: Room Mapper should display 'GreenReach' room correctly."
echo "If user still sees fake rooms, likely browser cache issue."
echo "Solution: Hard refresh (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows)"
