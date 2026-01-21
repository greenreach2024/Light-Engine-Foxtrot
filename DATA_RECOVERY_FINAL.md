# Actual Data Recovery - January 20, 2026

## Real Farm Configuration

**Your actual setup:**
- 1 Room: "GreenReach"
- 1 Zone: "Zone 1"
- 1 Group: "Aeroponic Trays" (crop-astro-arugula)
- 1 Schedule: 12 hour photoperiod (20:00 on, 08:00 off)
- 1 Light: GROW3 Pro 640 - F00001 (192.168.2.80)

**What was wrong:**
I had restored demo data with 8 groups across Room A and Room B - completely fake production data that wasn't yours.

## Correctly Restored From Git Stash

### rooms.json
```json
{
  "rooms": [
    {
      "id": "GreenReach-room",
      "name": "GreenReach",
      "zones": [
        {
          "id": "1",
          "name": "Zone 1"
        }
      ]
    }
  ]
}
```

### groups.json
- **Group ID:** `GreenReach:1:Aeroponic Trays`
- **Crop Plan:** crop-astro-arugula
- **Schedule:** 20:00-08:00 (12 hour photoperiod)
- **Ramp:** 10 min up/down
- **Light Device:** GROW3 Pro 640 (F00001) at 192.168.2.80:3000
- **Status:** deployed
- **Last Modified:** 2026-01-20T23:04:23.128Z

### farm.json
- **Farm Name:** Big Green Farm
- **Farm ID:** FARM-MKLOMAT3-A9D8
- **Location:** Kingston, Ontario
- **Contact:** Peter Gilbert (shelbygilbert@rogers.com)

## Verification

✅ 1 room (GreenReach)
✅ 1 zone (Zone 1)  
✅ 1 group (Aeroponic Trays)
✅ 1 schedule (12h photoperiod, 20:00-08:00)
✅ 1 light controller (GROW3 Pro at 192.168.2.80)

This is now your ACTUAL configuration, not demo data.
