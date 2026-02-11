#!/usr/bin/env node
// One-time script to fix Central data files with real farm data
const fs = require('fs');
const path = require('path');

const centralDataDir = path.join(__dirname, '..', 'greenreach-central', 'public', 'data');

// Fix groups.json
const groups = {
  schemaVersion: "1.0.0",
  groups: [
    {
      id: "Your Grow Room:1:Your First Group",
      name: "Your First Group",
      zone: "1",
      zoneId: "room-3xxjln-z1",
      roomId: "room-3xxjln",
      crop: "Bibb Butterhead",
      plan: "crop-bibb-butterhead",
      planId: "crop-bibb-butterhead",
      recipe: "Bibb Butterhead",
      trays: 4,
      plants: 48,
      health: "healthy",
      devices: ["F00001"],
      deviceCount: 1,
      intensity: 25,
      spectrum: "CW/WW + BL + RD",
      planConfig: {
        anchor: { mode: "seedDate", seedDate: "2026-02-04T00:00:00.000Z" },
        schedule: { photoperiodHours: 12, totalOnHours: 12 }
      },
      status: "deployed",
      active: true
    },
    {
      id: "Your Grow Room:1:Your 2nd Group",
      name: "Your 2nd Group",
      zone: "1",
      zoneId: "room-3xxjln-z1",
      roomId: "room-3xxjln",
      crop: "Buttercrunch Lettuce",
      plan: "crop-buttercrunch-lettuce",
      planId: "crop-buttercrunch-lettuce",
      recipe: "Buttercrunch Lettuce",
      trays: 4,
      plants: 48,
      health: "healthy",
      devices: ["F00002"],
      deviceCount: 1,
      intensity: 25,
      spectrum: "CW/WW + BL + RD",
      planConfig: {
        anchor: { mode: "seedDate", seedDate: "2026-02-04T00:00:00.000Z" },
        schedule: { photoperiodHours: 12, totalOnHours: 12 }
      },
      status: "deployed",
      active: true
    },
    {
      id: "Your Grow Room:1:Your 3nd Group",
      name: "Your 3nd Group",
      zone: "1",
      zoneId: "room-3xxjln-z1",
      roomId: "room-3xxjln",
      crop: "Salad Bowl Oakleaf",
      plan: "crop-salad-bowl-oakleaf",
      planId: "crop-salad-bowl-oakleaf",
      recipe: "Salad Bowl Oakleaf",
      trays: 4,
      plants: 48,
      health: "healthy",
      devices: ["F00003"],
      deviceCount: 1,
      intensity: 25,
      spectrum: "CW/WW + BL + RD",
      planConfig: {
        anchor: { mode: "seedDate", seedDate: "2026-02-04T00:00:00.000Z" },
        schedule: { photoperiodHours: 12, totalOnHours: 12 }
      },
      status: "deployed",
      active: true
    },
    {
      id: "Your Grow Room:1:Your 4th Room",
      name: "Your 4th Room",
      zone: "1",
      zoneId: "room-3xxjln-z1",
      roomId: "room-3xxjln",
      crop: "Astro Arugula",
      plan: "crop-astro-arugula",
      planId: "crop-astro-arugula",
      recipe: "Astro Arugula",
      trays: 4,
      plants: 48,
      health: "healthy",
      devices: ["F00004"],
      deviceCount: 1,
      intensity: 25,
      spectrum: "CW/WW + BL + RD",
      planConfig: {
        anchor: { mode: "seedDate", seedDate: "2026-02-04T00:00:00.000Z" },
        schedule: { photoperiodHours: 12, totalOnHours: 12 }
      },
      status: "deployed",
      active: true
    }
  ]
};

fs.writeFileSync(path.join(centralDataDir, 'groups.json'), JSON.stringify(groups, null, 2));
console.log('Central groups.json: ' + groups.groups.length + ' groups written');

// Verify rooms.json
const rooms = JSON.parse(fs.readFileSync(path.join(centralDataDir, 'rooms.json'), 'utf8'));
console.log('Central rooms.json: ' + rooms.rooms[0].name);

// Verify farm.json
const farm = JSON.parse(fs.readFileSync(path.join(centralDataDir, 'farm.json'), 'utf8'));
console.log('Central farm.json: ' + farm.name + ' (' + farm.farmId + ')');

console.log('Done!');
