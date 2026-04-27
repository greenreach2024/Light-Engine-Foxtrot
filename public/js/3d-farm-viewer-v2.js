// =====================================================================
// GreenReach 3D Farm Viewer v2 - cinematic HD rebuild + full feature set
// =====================================================================
// Self-contained Three.js viewer. Pulls /data/rooms.json, /data/groups.json,
// /data/grow-systems.json and /data/env.json from LE (via Central proxy).
//
// Features:
//   - Equipment-shaped meshes per category with real footprints
//   - Click + shift-click + marquee selection of groups
//   - Click empty floor / zone tile to inspect room or zone
//   - Edit mode: drag selected group(s) to reposition (persists)
//   - Heatmap overlay on zone floors driven by env sensor data
//   - Side panel: farm summary with room dimensions + per-zone env,
//     zone inspector, group inspector with environmental context
//   - Live SSE updates from /events
// =====================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

RectAreaLightUniformsLib.init();

const IN_TO_M = 0.0254;
const M_TO_FT = 3.28084;
const MAIN_WALKWAY_M = 1.8288; // 6 ft service aisle
const fmt = (v, d=1) => Number.isFinite(v) ? Number(v).toFixed(d) : '--';
const $ = (id) => document.getElementById(id);
const authFetch = (window.authFetch || fetch.bind(window));

const state = {
  rooms: [],
  groups: [],
  devices: [],
  templates: [],
  env: { zones: [], rooms: {} },
  envByZoneKey: new Map(),
  selection: new Set(),
  zoneSelection: null,
  roomSelection: null,
  meshIndex: new Map(),
  zoneFloorIndex: new Map(),
  roomFloorIndex: new Map(),
  roomMeshes: [],
  viewMode: 'iso',
  editMode: false,
  heatmapOn: false,
  heatMetric: 'tempC',
  heatAutoScale: false,
  showWalls: true,
  showCeiling: true,
  collapsedZoneSystems: new Set(),
  history: { snapshots: [], cursor: -1 },
  pendingPlacement: null,
  roomEquipment: [],
  equipmentKB: { equipment: [], categories: [] },
  equipDrawer: { open: false, level: 'cat', category: null, model: null, search: '', qty: 1, specs: {} },
};

let toastTimer = null;
function toast(msg, ms=2200) {
  const el = $('v3dToast'); if (!el) return;
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

const canvas = $('v3d-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05080d);
scene.fog = new THREE.Fog(0x05080d, 60, 240);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(28, 24, 32);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 2;
controls.maxDistance = 160;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.target.set(0, 1.5, 0);

scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x202830, 0.45));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(40, 60, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 200;
sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 4;
scene.add(sun);

const fill = new THREE.DirectionalLight(0x6ab1ff, 0.35);
fill.position.set(-30, 25, -20);
scene.add(fill);

const composer = new EffectComposer(renderer);
composer.setPixelRatio(renderer.getPixelRatio());
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.7, 0.85, 0.92
);
composer.addPass(bloomPass);

const outlinePass = new OutlinePass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  scene, camera
);
outlinePass.edgeStrength = 4.0;
outlinePass.edgeGlow = 0.6;
outlinePass.edgeThickness = 1.6;
outlinePass.pulsePeriod = 0;
outlinePass.visibleEdgeColor.set('#6ab1ff');
outlinePass.hiddenEdgeColor.set('#1a3a5a');
composer.addPass(outlinePass);

const smaaPass = new SMAAPass(
  window.innerWidth * renderer.getPixelRatio(),
  window.innerHeight * renderer.getPixelRatio()
);
composer.addPass(smaaPass);

composer.addPass(new OutputPass());

const MAX_RAL_PER_ZONE = 6;

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(160, 48),
  new THREE.MeshStandardMaterial({ color: 0x0a1018, roughness: 1, metalness: 0 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.position.y = -0.01;
scene.add(ground);

const grid = new THREE.GridHelper(120, 60, 0x16243a, 0x0c1626);
grid.position.y = 0;
grid.material.transparent = true;
grid.material.opacity = 0.35;
scene.add(grid);

const matFloor = new THREE.MeshStandardMaterial({ color: 0xc9d4dc, roughness: 0.35, metalness: 0.05 });
const matWall = new THREE.MeshStandardMaterial({ color: 0x1a2433, roughness: 0.85, metalness: 0.0, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
const matWallTrim = new THREE.MeshStandardMaterial({ color: 0x2a3a52, roughness: 0.6, metalness: 0.1 });
const matCeilingFrame = new THREE.MeshStandardMaterial({ color: 0x394758, roughness: 0.55, metalness: 0.4 });
const zoneBaseColors = [0x153e2e, 0x14334a, 0x3a2a16, 0x2e1a3a, 0x1a3a3a];
const matRackFrame = new THREE.MeshStandardMaterial({ color: 0x9aa6b2, roughness: 0.4, metalness: 0.85 });
const matChannel = new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.55, metalness: 0.25 });
const matCanopy = new THREE.MeshStandardMaterial({ color: 0x4dd0a3, roughness: 0.7, metalness: 0.0, emissive: 0x0a3a26, emissiveIntensity: 0.08 });
const matWater = new THREE.MeshPhysicalMaterial({ color: 0x1a4a6e, roughness: 0.15, metalness: 0.0, transmission: 0.4, thickness: 0.4, transparent: true, opacity: 0.85 });
const matTrayBox = new THREE.MeshStandardMaterial({ color: 0x202b3a, roughness: 0.6, metalness: 0.1 });
const matFixtureBody = new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.5, metalness: 0.6 });
const matFixtureLens = new THREE.MeshStandardMaterial({ color: 0xff66cc, emissive: 0xff3a99, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.0 });

const farmRoot = new THREE.Group();
scene.add(farmRoot);

function clearGroupChildren(g) {
  while (g.children.length) {
    const c = g.children.pop();
    c.traverse?.((n) => {
      if (n.geometry) n.geometry.dispose();
      if (n.material) {
        if (Array.isArray(n.material)) n.material.forEach((m) => m.dispose && m.dispose());
        else n.material.dispose && n.material.dispose();
      }
    });
  }
}

function readRoomDims(room) {
  if (!room) return null;
  const rawL = Number(room.length_m ?? room.lengthM ?? room.dimensions?.length_m ?? room.dimensions?.lengthM);
  const rawW = Number(room.width_m ?? room.widthM ?? room.dimensions?.width_m ?? room.dimensions?.widthM);
  const H = Number(room.ceiling_height_m ?? room.ceilingHeightM ?? room.height_m ?? room.heightM ?? room.dimensions?.ceiling_height_m ?? room.dimensions?.ceilingHeightM ?? room.dimensions?.height_m ?? room.dimensions?.heightM ?? 3.2);
  if (!Number.isFinite(rawL) || !Number.isFinite(rawW) || rawL <= 0 || rawW <= 0) return null;
  // Two views of the same dimensions:
  //   L / W  — the THREE.js axis mapping. L = X (side-to-side); W = Z (depth
  //            into scene). width_m maps to X, length_m maps to Z so the
  //            longer dimension runs into the screen.
  //   lengthM / widthM — the operator-facing labels (always = source data).
  //                       Use these in display strings so the UI keeps reading
  //                       "length × width × height" regardless of axis swap.
  return { L: rawW, W: rawL, H, lengthM: rawL, widthM: rawW };
}

function getZoneRects(room) {
  const dims = readRoomDims(room);
  if (!dims) return [];
  const rawZones = Array.isArray(room.zones) ? room.zones : [];
  // rooms.json stores `zones` as an array of strings ("Zone 1", "Zone 2").
  // Normalize each entry to an object so downstream code can read .name/.id
  // safely; otherwise z.name is undefined for strings, causing every zone
  // rect to register under the same `undefined` key in zoneFloors and all
  // groups to fall through to zoneRects[0] -- visually piling every group
  // into the first zone.
  const zones = rawZones.map((z, i) => {
    if (typeof z === 'string') return { id: z, name: z };
    if (z && typeof z === 'object') {
      const name = z.name || z.id || `Zone ${i + 1}`;
      return Object.assign({}, z, { id: z.id || name, name });
    }
    return { id: `Zone ${i + 1}`, name: `Zone ${i + 1}` };
  });
  if (!zones.length) return [{ id: 'default', name: 'Zone', x_m: 0, y_m: 0, length_m: dims.L, width_m: dims.W }];
  const haveGeom = zones.every(z => Number.isFinite(Number(z.x_m ?? z.x)) && Number.isFinite(Number(z.length_m ?? z.lengthM)));
  if (haveGeom) {
    return zones.map(z => ({
      id: z.id, name: z.name || z.id,
      x_m: Number(z.x_m ?? z.x ?? 0),
      y_m: Number(z.y_m ?? z.y ?? 0),
      length_m: Number(z.length_m ?? z.lengthM),
      width_m: Number(z.width_m ?? z.widthM ?? dims.W),
    }));
  }
  // Slice zones along the Z axis (depth = length_m direction) so zones appear
  // as front-to-back segments, matching the operator's mental model of the room.
  const sliceLen = dims.W / zones.length;
  return zones.map((z, i) => ({
    id: z.id, name: z.name || z.id,
    x_m: 0, y_m: i * sliceLen,
    length_m: dims.L, width_m: sliceLen,
  }));
}

function templateById(id) { return state.templates.find(t => t.id === id) || null; }

function groupInRoom(group, room) {
  if (!group || !room) return false;
  const roomId = String(room.id || '').trim();
  const roomName = String(room.name || '').trim();
  const gRoom = String(group.room || group.roomName || '').trim();
  const gRoomId = String(group.roomId || '').trim();
  if (roomId && (gRoomId === roomId || gRoom === roomId)) return true;
  if (roomName && gRoom === roomName) return true;
  return false;
}

function groupFootprintM(group) {
  const c = group.customization || {};
  const lenIn = Number(c.footprintLengthIn);
  const widIn = Number(c.footprintWidthIn);
  if (Number.isFinite(lenIn) && Number.isFinite(widIn) && lenIn > 0 && widIn > 0) {
    return { length_m: lenIn * IN_TO_M, width_m: widIn * IN_TO_M };
  }
  const tpl = templateById(group.templateId);
  const sc = tpl?.spatialContract;
  if (sc) {
    const L = Number(sc.footprint_m?.length || sc.lengthM || 1.5);
    const W = Number(sc.footprint_m?.width || sc.widthM || 0.6);
    return { length_m: L, width_m: W };
  }
  return { length_m: 1.5, width_m: 0.6 };
}

function makeNftRack(group) {
  const fp = groupFootprintM(group);
  const c = group.customization || {};
  const levels = Math.max(1, Math.min(8, Number(c.levels) || 3));
  const tierGap = 0.45;
  const baseHeight = 0.25;
  const channelsPerTier = Math.max(1, Math.min(12, Number(c.locationsY) || 3));
  const g = new THREE.Group();
  const upH = baseHeight + tierGap * (levels - 1) + 0.15;
  const upGeom = new THREE.BoxGeometry(0.06, upH, 0.06);
  [[0.06, 0.06], [fp.length_m-0.06, 0.06], [0.06, fp.width_m-0.06], [fp.length_m-0.06, fp.width_m-0.06]].forEach(([x,z]) => {
    const m = new THREE.Mesh(upGeom, matRackFrame);
    m.position.set(x - fp.length_m/2, upH/2, z - fp.width_m/2);
    m.castShadow = true; m.receiveShadow = true; g.add(m);
  });
  for (let i = 0; i < levels; i++) {
    const y = baseHeight + tierGap * i;
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(fp.length_m, 0.04, fp.width_m), matRackFrame);
    shelf.position.set(0, y - 0.02, 0); shelf.castShadow = true; shelf.receiveShadow = true; g.add(shelf);
    const chDepth = Math.min(0.10, fp.width_m / (channelsPerTier + 1));
    const chGeom = new THREE.BoxGeometry(fp.length_m * 0.94, 0.05, chDepth);
    const caGeom = new THREE.BoxGeometry(fp.length_m * 0.92, 0.06, chDepth * 0.85);
    for (let k = 0; k < channelsPerTier; k++) {
      const z = -fp.width_m/2 + (fp.width_m / (channelsPerTier + 1)) * (k + 1);
      const ch = new THREE.Mesh(chGeom, matChannel);
      ch.position.set(0, y + 0.04, z); ch.castShadow = true; ch.receiveShadow = true; g.add(ch);
      const cano = new THREE.Mesh(caGeom, matCanopy);
      cano.position.set(0, y + 0.10, z); g.add(cano);
    }
  }
  return { mesh: g, footprint: fp, height: upH };
}

function makeDwcPond(group) {
  const fp = groupFootprintM(group);
  const g = new THREE.Group();
  const wallH = 0.35;
  const outer = new THREE.Mesh(new THREE.BoxGeometry(fp.length_m, wallH, fp.width_m), matTrayBox);
  outer.position.set(0, wallH/2, 0); outer.castShadow = true; outer.receiveShadow = true; g.add(outer);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(fp.length_m * 0.96, fp.width_m * 0.96), matWater);
  water.rotation.x = -Math.PI/2; water.position.set(0, wallH - 0.02, 0); g.add(water);
  const holeGeom = new THREE.CircleGeometry(0.04, 12);
  const holeMat = new THREE.MeshStandardMaterial({ color: 0x0a1622, roughness: 1 });
  const cols = Math.max(2, Math.floor(fp.length_m / 0.20));
  const rows = Math.max(2, Math.floor(fp.width_m / 0.20));
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const h = new THREE.Mesh(holeGeom, holeMat);
    h.rotation.x = -Math.PI/2;
    h.position.set(-fp.length_m/2 + (i + 0.5) * (fp.length_m / cols), wallH - 0.005, -fp.width_m/2 + (j + 0.5) * (fp.width_m / rows));
    g.add(h);
  }
  return { mesh: g, footprint: fp, height: wallH };
}

function makeAeroponicTower(group) {
  const fp = groupFootprintM(group);
  const g = new THREE.Group();
  const towerH = 2.2;
  const r = Math.min(fp.width_m, fp.length_m) * 0.45;
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(r, r, towerH, 16), matChannel);
  tower.position.set(0, towerH/2, 0); tower.castShadow = true; tower.receiveShadow = true; g.add(tower);
  const ringGeom = new THREE.TorusGeometry(r * 1.1, 0.05, 8, 24);
  for (let i = 0; i < 5; i++) {
    const ring = new THREE.Mesh(ringGeom, matCanopy);
    ring.position.y = 0.4 + i * (towerH - 0.5) / 4;
    ring.rotation.x = Math.PI/2;
    g.add(ring);
  }
  return { mesh: g, footprint: fp, height: towerH };
}

function makeVerticalTier(group) {
  const fp = groupFootprintM(group);
  const c = group.customization || {};
  const levels = Math.max(2, Math.min(10, Number(c.levels) || 5));
  const tierGap = 0.32;
  const baseH = 0.18;
  const g = new THREE.Group();
  const upH = baseH + tierGap * (levels - 1) + 0.15;
  const upGeom = new THREE.BoxGeometry(0.05, upH, 0.05);
  [[0.05, 0.05], [fp.length_m-0.05, 0.05], [0.05, fp.width_m-0.05], [fp.length_m-0.05, fp.width_m-0.05]].forEach(([x,z]) => {
    const m = new THREE.Mesh(upGeom, matRackFrame);
    m.position.set(x-fp.length_m/2, upH/2, z-fp.width_m/2);
    m.castShadow = true; m.receiveShadow = true; g.add(m);
  });
  for (let i = 0; i < levels; i++) {
    const y = baseH + tierGap * i;
    const tray = new THREE.Mesh(new THREE.BoxGeometry(fp.length_m, 0.06, fp.width_m), matTrayBox);
    tray.position.set(0, y, 0); tray.castShadow = true; tray.receiveShadow = true; g.add(tray);
    const cano = new THREE.Mesh(new THREE.BoxGeometry(fp.length_m*0.96, 0.04, fp.width_m*0.92), matCanopy);
    cano.position.set(0, y + 0.06, 0); g.add(cano);
  }
  return { mesh: g, footprint: fp, height: upH };
}

function makeDripRail(group) {
  const fp = groupFootprintM(group);
  const g = new THREE.Group();
  const rail = new THREE.Mesh(new THREE.BoxGeometry(fp.length_m, 0.10, fp.width_m), matChannel);
  rail.position.set(0, 0.55, 0); rail.castShadow = true; rail.receiveShadow = true; g.add(rail);
  const legGeom = new THREE.BoxGeometry(0.05, 0.55, 0.05);
  [[-fp.length_m/2+0.1, -fp.width_m/2+0.1], [fp.length_m/2-0.1, -fp.width_m/2+0.1], [-fp.length_m/2+0.1, fp.width_m/2-0.1], [fp.length_m/2-0.1, fp.width_m/2-0.1]].forEach(([x,z]) => {
    const m = new THREE.Mesh(legGeom, matRackFrame);
    m.position.set(x, 0.275, z); m.castShadow = true; m.receiveShadow = true; g.add(m);
  });
  const cano = new THREE.Mesh(new THREE.BoxGeometry(fp.length_m*0.95, 0.08, fp.width_m*0.85), matCanopy);
  cano.position.set(0, 0.66, 0); g.add(cano);
  return { mesh: g, footprint: fp, height: 0.7 };
}

function makeTowerWall(group) {
  const fp = groupFootprintM(group);
  const g = new THREE.Group();
  const wallH = 2.4;
  const back = new THREE.Mesh(new THREE.BoxGeometry(fp.length_m, wallH, 0.08), matRackFrame);
  back.position.set(0, wallH/2, 0); back.castShadow = true; back.receiveShadow = true; g.add(back);
  const cols = Math.max(2, Math.floor(fp.length_m / 0.30));
  const colGeom = new THREE.BoxGeometry(0.18, wallH * 0.92, 0.18);
  for (let i = 0; i < cols; i++) {
    const cm = new THREE.Mesh(colGeom, matChannel);
    cm.position.set(-fp.length_m/2 + (i + 0.5) * (fp.length_m / cols), wallH/2, 0.13);
    cm.castShadow = true; cm.receiveShadow = true; g.add(cm);
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.20, wallH*0.85, 0.06), matCanopy);
    v.position.set(cm.position.x, wallH/2, 0.24); g.add(v);
  }
  return { mesh: g, footprint: fp, height: wallH };
}

function makeGenericRack(group) {
  const fp = groupFootprintM(group);
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(fp.length_m, 1.0, fp.width_m), matRackFrame);
  box.position.set(0, 0.5, 0); box.castShadow = true; box.receiveShadow = true; g.add(box);
  return { mesh: g, footprint: fp, height: 1.0 };
}

const equipmentFactories = {
  nft_rack: makeNftRack,
  dwc_pond: makeDwcPond,
  aeroponic_tower: makeAeroponicTower,
  vertical_tier: makeVerticalTier,
  drip_rail: makeDripRail,
  tower_wall: makeTowerWall,
};

function buildEquipmentForGroup(group) {
  const tpl = templateById(group.templateId);
  const cat = tpl?.category || 'nft_rack';
  const fac = equipmentFactories[cat] || makeGenericRack;
  return fac(group);
}

function makeFixtureAbove(footprint, mountHeight, count=1, opts={}) {
  const g = new THREE.Group();
  const cols = Math.max(1, Math.min(4, count));
  const span = footprint.length_m * 0.85;
  const lensW = span / cols * 0.86;
  const lensD = footprint.width_m * 0.66;
  const litRemaining = { n: opts.maxLights == null ? cols : Math.max(0, Math.min(cols, opts.maxLights)) };
  for (let i = 0; i < cols; i++) {
    const fixture = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(span / cols * 0.9, 0.08, footprint.width_m * 0.7), matFixtureBody);
    body.position.y = mountHeight + 0.45; body.castShadow = true; fixture.add(body);
    const lens = new THREE.Mesh(new THREE.BoxGeometry(lensW, 0.02, lensD), matFixtureLens);
    lens.position.y = mountHeight + 0.41; fixture.add(lens);
    if (litRemaining.n > 0) {
      // RectAreaLight only affects MeshStandard/Physical materials, which is
      // what every surface in this scene uses. Cap the count via opts.maxLights
      // so a 78-group farm doesn't try to evaluate hundreds of lights per pixel.
      const ral = new THREE.RectAreaLight(0xff66cc, 2.4, lensW, lensD);
      ral.position.y = mountHeight + 0.40;
      ral.lookAt(ral.position.x, 0, ral.position.z);
      ral.userData = { kind: 'growLight' };
      fixture.add(ral);
      litRemaining.n--;
    }
    fixture.position.x = -span/2 + (i + 0.5) * (span / cols);
    g.add(fixture);
  }
  return g;
}

function makeSelectionRing(footprint) {
  const r = Math.max(footprint.length_m, footprint.width_m) * 0.62;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(r * 0.95, r, 48),
    new THREE.MeshBasicMaterial({ color: 0x6ab1ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI/2;
  ring.position.y = 0.005;
  return ring;
}

function makeLabelSprite(text) {
  const padding = 16;
  const fontSize = 36;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  ctx.font = `600 ${fontSize}px Inter, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + padding * 2;
  const h = fontSize + padding;
  cv.width = w; cv.height = h;
  ctx.font = `600 ${fontSize}px Inter, sans-serif`;
  ctx.fillStyle = 'rgba(10,16,24,0.85)';
  const r = 12;
  ctx.beginPath();
  ctx.moveTo(r, 0); ctx.lineTo(w-r, 0); ctx.quadraticCurveTo(w, 0, w, r);
  ctx.lineTo(w, h-r); ctx.quadraticCurveTo(w, h, w-r, h);
  ctx.lineTo(r, h); ctx.quadraticCurveTo(0, h, 0, h-r);
  ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(106,177,255,0.45)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#e6edf6'; ctx.textBaseline = 'middle';
  ctx.fillText(text, padding, h/2 + 1);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(w / 100, h / 100, 1);
  sprite.renderOrder = 9999;
  return sprite;
}

// ---- env helpers ----
function buildEnvIndex() {
  state.envByZoneKey.clear();
  const zones = Array.isArray(state.env?.zones) ? state.env.zones : [];
  zones.forEach(z => {
    const keys = [z.id, z.name, z.location].filter(Boolean);
    keys.forEach(k => state.envByZoneKey.set(String(k).trim().toLowerCase(), z));
  });
}
function envForZone(roomId, zoneKey) {
  if (!zoneKey) return null;
  const k = String(zoneKey).trim().toLowerCase();
  return state.envByZoneKey.get(k) || null;
}
function envForRoom(room) {
  if (!room) return null;
  const zr = getZoneRects(room);
  const buckets = { tempC: [], rh: [], vpd: [] };
  zr.forEach(z => {
    const env = envForZone(room.id, z.name) || envForZone(room.id, z.id);
    if (!env) return;
    ['tempC','rh','vpd'].forEach(m => {
      const v = Number(env.sensors?.[m]?.current);
      if (Number.isFinite(v)) buckets[m].push(v);
    });
  });
  const avg = a => a.length ? a.reduce((s,n)=>s+n,0)/a.length : null;
  return { tempC: avg(buckets.tempC), rh: avg(buckets.rh), vpd: avg(buckets.vpd) };
}
function metricInfo(metric) {
  if (metric === 'tempC') return { label: 'Temp (C)', unit: 'C', lo: 16, hi: 28 };
  if (metric === 'rh') return { label: 'RH (%)', unit: '%', lo: 50, hi: 80 };
  if (metric === 'vpd') return { label: 'VPD (kPa)', unit: 'kPa', lo: 0.4, hi: 1.4 };
  if (metric === 'ppfd') return { label: 'PPFD (μmol/m²/s)', unit: 'μmol/m²/s', lo: 0, hi: 1000 };
  if (metric === 'dli') return { label: 'DLI (mol/m²/d)', unit: 'mol/m²/d', lo: 0, hi: 40 };
  return { label: metric, unit: '', lo: 0, hi: 1 };
}
function heatColor(v, lo, hi) {
  if (!Number.isFinite(v)) return new THREE.Color(0x223044);
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  const stops = [
    [0.00, [0x2c/255, 0x4d/255, 0xff/255]],
    [0.40, [0x4d/255, 0xd0/255, 0xa3/255]],
    [0.70, [0xf5/255, 0xb8/255, 0x6b/255]],
    [1.00, [0xff/255, 0x5a/255, 0x5a/255]],
  ];
  let a = stops[0], b = stops[stops.length-1];
  for (let i = 0; i < stops.length-1; i++) {
    if (t >= stops[i][0] && t <= stops[i+1][0]) { a = stops[i]; b = stops[i+1]; break; }
  }
  const span = b[0] - a[0] || 1;
  const lt = (t - a[0]) / span;
  const r = a[1][0] + (b[1][0]-a[1][0]) * lt;
  const g = a[1][1] + (b[1][1]-a[1][1]) * lt;
  const bl = a[1][2] + (b[1][2]-a[1][2]) * lt;
  return new THREE.Color(r, g, bl);
}
function inSetpoint(v, sp) {
  if (!Number.isFinite(v) || !sp) return null;
  const mn = Number(sp.min), mx = Number(sp.max);
  if (!Number.isFinite(mn) || !Number.isFinite(mx)) return null;
  if (v < mn || v > mx) return false;
  return true;
}

function buildScene() {
  clearGroupChildren(farmRoot);
  state.meshIndex.clear();
  state.zoneFloorIndex.clear();
  state.roomFloorIndex.clear();
  state.roomMeshes = [];

  let cursorX = 0;
  const gap = 2.0;
  state.rooms.forEach((room) => {
    const dims = readRoomDims(room);
    if (!dims) return;
    const roomGroup = new THREE.Group();
    roomGroup.name = `room:${room.id}`;
    roomGroup.userData = { kind: 'roomGroup', id: room.id, name: room.name, dims };

    const floor = new THREE.Mesh(new THREE.BoxGeometry(dims.L, 0.05, dims.W), matFloor);
    floor.position.set(dims.L/2, -0.025, dims.W/2); floor.receiveShadow = true;
    floor.userData = { kind: 'room', id: room.id, name: room.name };
    roomGroup.add(floor);
    state.roomFloorIndex.set(room.id, floor);

    const wallT = 0.06;
    if (state.showWalls) {
      [
        [dims.L/2, dims.H/2, 0, dims.L, dims.H, wallT],
        [dims.L/2, dims.H/2, dims.W, dims.L, dims.H, wallT],
        [dims.L, dims.H/2, dims.W/2, wallT, dims.H, dims.W],
        [0, dims.H/2, dims.W/2, wallT, dims.H, dims.W],
      ].forEach(([x,y,z,sx,sy,sz]) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), matWall);
        m.position.set(x, y, z); roomGroup.add(m);
      });
    }

    if (state.showCeiling) {
      [[dims.L/2, 0], [dims.L/2, dims.W]].forEach(([cx, cz]) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(dims.L, 0.10, wallT * 1.4), matWallTrim);
        m.position.set(cx, dims.H, cz); roomGroup.add(m);
      });

      const beamGeom = new THREE.BoxGeometry(dims.L, 0.10, 0.12);
      const beams = Math.max(2, Math.floor(dims.W / 2.5));
      for (let b = 0; b < beams; b++) {
        const beam = new THREE.Mesh(beamGeom, matCeilingFrame);
        beam.position.set(dims.L/2, dims.H - 0.05, (b + 0.5) * (dims.W / beams));
        roomGroup.add(beam);
      }
    }

    const label = makeLabelSprite(room.name || room.id);
    label.position.set(dims.L/2, dims.H + 0.6, dims.W/2);
    roomGroup.add(label);

    const zoneRects = getZoneRects(room);
    const zoneFloors = new Map();
    zoneRects.forEach((zr, idx) => {
      const baseColor = zoneBaseColors[idx % zoneBaseColors.length];
      zoneFloors.set(zr.name, zr); zoneFloors.set(zr.id, zr);

      // Split zone into per-sensor-source tiles for spatial heatmap resolution
      const envData = envForZone(room.id, zr.name) || envForZone(room.id, zr.id);
      const tempSources = envData?.sensors?.tempC?.sources;
      const srcIds = tempSources ? Object.keys(tempSources) : [];

      if (srcIds.length > 1) {
        const tileW = zr.width_m / srcIds.length;
        srcIds.forEach((srcId, si) => {
          const mat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.85, metalness: 0, transparent: true, opacity: 0.55 });
          const zf = new THREE.Mesh(new THREE.BoxGeometry(zr.length_m, 0.02, tileW), mat);
          zf.position.set(zr.x_m + zr.length_m/2, 0.01, zr.y_m + si * tileW + tileW/2);
          zf.receiveShadow = true;
          zf.userData = { kind: 'zone', roomId: room.id, zoneId: zr.id, zoneName: zr.name, rect: zr, baseColor, sourceId: srcId };
          roomGroup.add(zf);
          state.zoneFloorIndex.set(`${room.id}|${zr.name}|${srcId}`, zf);
          state.zoneFloorIndex.set(`${room.id}|${zr.id}|${srcId}`, zf);
        });
      } else {
        const mat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.85, metalness: 0, transparent: true, opacity: 0.55 });
        const zf = new THREE.Mesh(new THREE.BoxGeometry(zr.length_m, 0.02, zr.width_m), mat);
        zf.position.set(zr.x_m + zr.length_m/2, 0.01, zr.y_m + zr.width_m/2);
        zf.receiveShadow = true;
        zf.userData = { kind: 'zone', roomId: room.id, zoneId: zr.id, zoneName: zr.name, rect: zr, baseColor };
        roomGroup.add(zf);
        state.zoneFloorIndex.set(`${room.id}|${zr.name}`, zf);
        state.zoneFloorIndex.set(`${room.id}|${zr.id}`, zf);
      }

      const zl = makeLabelSprite(zr.name);
      zl.position.set(zr.x_m + zr.length_m/2, 0.6, zr.y_m + zr.width_m/2);
      zl.scale.multiplyScalar(0.6); roomGroup.add(zl);
    });

    // 6 ft central service aisle — amber overlay spanning the full room length
    if (dims.W > MAIN_WALKWAY_M * 2 + 0.3) {
      const walkMat = new THREE.MeshStandardMaterial({
        color: 0x4a3d10, roughness: 0.96, metalness: 0, transparent: true, opacity: 0.28,
      });
      const wm = new THREE.Mesh(new THREE.BoxGeometry(dims.L - 0.3, 0.028, MAIN_WALKWAY_M), walkMat);
      wm.position.set(dims.L / 2, 0.014, dims.W / 2);
      wm.receiveShadow = true;
      roomGroup.add(wm);
      const wl = makeLabelSprite('← Aisle (6 ft) →');
      wl.scale.multiplyScalar(0.42);
      wl.position.set(dims.L / 2, 0.55, dims.W / 2);
      roomGroup.add(wl);
    }

    const roomGroups = state.groups.filter(g => groupInRoom(g, room));
    const buckets = new Map();
    roomGroups.forEach(gr => {
      const key = gr.zone || (zoneRects[0]?.name || 'default');
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(gr);
    });
    buckets.forEach((groupsArr, zoneKey) => {
      const zr = zoneFloors.get(zoneKey) || zoneRects[0];
      if (!zr) return;
      placeGroupsInZone(roomGroup, zr, groupsArr, room);
    });

    buildDevicesInRoom(roomGroup, room);
    buildEquipmentInRoom(roomGroup, room);

    roomGroup.position.set(cursorX - dims.L/2, 0, -dims.W/2);
    farmRoot.add(roomGroup);
    state.roomMeshes.push(roomGroup);
    cursorX += dims.L + gap;
  });

  const box = new THREE.Box3().setFromObject(farmRoot);
  if (Number.isFinite(box.min.x) && Number.isFinite(box.max.x)) {
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    farmRoot.position.x -= cx;
    farmRoot.position.z -= cz;
  }

  applyHeatmap();
  applySelectionVisuals();
  updateStats();
}

function placeGroupsInZone(roomGroup, zr, groupsArr, room) {
  if (!groupsArr.length) return;
  const items = groupsArr.map(g => ({ group: g, fp: groupFootprintM(g) }));
  const padding = 0.25;
  let cursorX = zr.x_m + padding;
  let cursorY = zr.y_m + padding;
  let rowMaxW = 0;
  const maxX = zr.x_m + zr.length_m - padding;
  const maxY = zr.y_m + zr.width_m - padding;

  // Skip the central 6 ft walkway when packing rows
  const roomDims = readRoomDims(room);
  const walkwayCenterY = roomDims ? roomDims.W / 2 : null;
  const walkwayStartY = walkwayCenterY !== null ? walkwayCenterY - MAIN_WALKWAY_M / 2 : null;
  const walkwayEndY   = walkwayCenterY !== null ? walkwayCenterY + MAIN_WALKWAY_M / 2 : null;
  const zoneHasWalkway = walkwayStartY !== null &&
    zr.y_m < walkwayEndY && zr.y_m + zr.width_m > walkwayStartY;
  if (zoneHasWalkway && cursorY >= walkwayStartY && cursorY < walkwayEndY) {
    cursorY = walkwayEndY + padding;
  }
  // RectAreaLight budget per zone — top-down view drops fixture lighting
  // entirely (no benefit when looking straight down).
  let ralBudget = state.viewMode === 'top' ? 0 : MAX_RAL_PER_ZONE;

  items.forEach(({ group, fp }) => {
    let L = fp.length_m, W = fp.width_m, rotate = false;
    let posX, posY;
    const placement = group.customization?.placement;
    const hasPlacement = placement && Number.isFinite(Number(placement.x_m)) && Number.isFinite(Number(placement.z_m));
    if (hasPlacement) {
      rotate = !!placement.rotated;
      if (rotate) { L = fp.width_m; W = fp.length_m; }
      posX = Math.max(zr.x_m + L/2, Math.min(zr.x_m + zr.length_m - L/2, Number(placement.x_m)));
      posY = Math.max(zr.y_m + W/2, Math.min(zr.y_m + zr.width_m - W/2, Number(placement.z_m)));
    } else {
      if (cursorX + L > maxX && cursorX + W <= maxX && cursorY + L <= maxY) {
        L = fp.width_m; W = fp.length_m; rotate = true;
      }
      if (cursorX + L > maxX) {
        cursorX = zr.x_m + padding;
        cursorY += rowMaxW + padding;
        rowMaxW = 0;
        if (zoneHasWalkway && cursorY < walkwayEndY && cursorY + W > walkwayStartY) {
          cursorY = walkwayEndY + padding;
        }
      }
      posX = cursorX + L/2;
      posY = cursorY + W/2;
      cursorX += L + padding;
      rowMaxW = Math.max(rowMaxW, W);
    }
    const built = buildEquipmentForGroup(group);
    const mesh = built.mesh;
    mesh.position.set(posX, 0, posY);
    if (rotate) mesh.rotation.y = Math.PI / 2;
    mesh.userData = { kind: 'group', id: group.id, group, footprint: built.footprint, rotate, height: built.height || 1.5, roomId: room.id, zoneRect: zr };
    mesh.name = `group:${group.id}`;
    roomGroup.add(mesh);
    state.meshIndex.set(group.id, mesh);

    const lightsCount = Array.isArray(group.lights) ? group.lights.length : 0;
    if (lightsCount > 0) {
      const cols = Math.min(lightsCount, 4);
      const litCount = Math.min(cols, ralBudget);
      ralBudget -= litCount;
      const fix = makeFixtureAbove(built.footprint, built.height || 1.5, cols, { maxLights: litCount });
      fix.position.copy(mesh.position);
      fix.rotation.y = mesh.rotation.y;
      fix.userData = { kind: 'fixtureFor', groupId: group.id };
      roomGroup.add(fix);
    }
  });
}

function computeDataRange(metric) {
  const vals = [];
  state.envByZoneKey.forEach((envData) => {
    const s = envData?.sensors?.[metric];
    if (!s) return;
    const cv = Number(s.current);
    if (Number.isFinite(cv)) vals.push(cv);
    if (s.sources) Object.values(s.sources).forEach(src => {
      const sv = Number(src?.current);
      if (Number.isFinite(sv)) vals.push(sv);
    });
  });
  if (!vals.length) return null;
  const dlo = Math.min(...vals), dhi = Math.max(...vals);
  const spread = dhi - dlo || 0.5;
  return { lo: dlo - spread * 0.05, hi: dhi + spread * 0.05 };
}

// ── Device rendering ──────────────────────────────────────────────────────────

const matSensor  = new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x00e5ff, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.25, transparent: true, opacity: 0.88 });
const matFan     = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.6, metalness: 0.5 });
const matHub     = new THREE.MeshStandardMaterial({ color: 0x777788, roughness: 0.5, metalness: 0.35 });
const matEnvUnit = new THREE.MeshStandardMaterial({ color: 0x3377cc, roughness: 0.5, metalness: 0.2 });

function makeDeviceMesh(device) {
  const type = (device.type || '').toLowerCase();
  let geo, mat;
  if (type === 'woiosensor' || type.includes('sensor') || type.includes('thermo')) {
    geo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    mat = matSensor;
  } else if (type.includes('fan')) {
    geo = new THREE.CylinderGeometry(0.12, 0.12, 0.07, 16);
    mat = matFan;
  } else if (type.includes('hub')) {
    geo = new THREE.BoxGeometry(0.18, 0.05, 0.12);
    mat = matHub;
  } else {
    geo = new THREE.BoxGeometry(0.25, 0.35, 0.18);
    mat = matEnvUnit;
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

function buildDevicesInRoom(roomGroup, room) {
  state.devices.forEach(device => {
    if (!device || !device.id) return;
    if (device.roomId !== room.id) return;
    const x = Number(device.x_m), z = Number(device.z_m);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;

    const g = new THREE.Group();
    const body = makeDeviceMesh(device);
    g.add(body);

    const lbl = makeLabelSprite(device.name || device.id);
    lbl.scale.multiplyScalar(0.22);
    lbl.position.set(0, 0.28, 0);
    g.add(lbl);

    g.position.set(x, 0.07, z);
    g.userData = { kind: 'device', id: device.id, device, footprint: { length_m: 0.15, width_m: 0.15 }, roomId: room.id };
    g.name = `device:${device.id}`;
    roomGroup.add(g);
    state.meshIndex.set(device.id, g);
  });
}

async function saveDevices(opts = {}) {
  try {
    const r = await authFetch('/data/iot-devices.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.devices),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (!opts.silent) toast(opts.msg || 'Devices saved');
  } catch (err) {
    console.error('[v3d] device save failed', err);
    toast('Device save failed: ' + (err.message || 'unknown'));
  }
}

// ── Category colors / footprints ──────────────────────────────────────
const EQUIP_CAT_META = {
  fans:           { color: 0x4dd0a3, bg: '#1a6645', icon: 'FAN',  fp: { l: 0.45, w: 0.45, h: 0.18 } },
  dehumidifier:   { color: 0x6ab1ff, bg: '#1a3a6a', icon: 'DH',   fp: { l: 0.55, w: 0.45, h: 0.90 } },
  hvac:           { color: 0x9b8cff, bg: '#2d2160', icon: 'AC',   fp: { l: 0.90, w: 0.40, h: 0.35 } },
  humidifier:     { color: 0x63d3ff, bg: '#103a50', icon: 'HM',   fp: { l: 0.30, w: 0.30, h: 0.75 } },
  'co2-generator':{ color: 0xf5b86b, bg: '#5a3510', icon: 'CO2', fp: { l: 0.35, w: 0.35, h: 1.00 } },
};
function catMeta(cat) { return EQUIP_CAT_META[(cat||'').toLowerCase()] || { color: 0xaaaaaa, bg: '#333', icon: cat?.slice(0,3).toUpperCase()||'EQ', fp: { l: 0.5, w: 0.5, h: 0.5 } }; }

function makeEquipMesh(category) {
  const m = catMeta(category);
  const mat = new THREE.MeshStandardMaterial({ color: m.color, metalness: 0.25, roughness: 0.55, transparent: true, opacity: 0.9 });
  const { l, w, h } = m.fp;
  let geo;
  if (category === 'fans' || category === 'humidifier' || category === 'co2-generator') {
    geo = new THREE.CylinderGeometry(l / 2, l / 2, h, 16);
  } else {
    geo = new THREE.BoxGeometry(l, h, w);
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

function buildEquipmentInRoom(roomGroup, room) {
  state.roomEquipment.forEach(entry => {
    if (!entry || !entry.id) return;
    if (entry.roomId && entry.roomId !== room.id) return;
    const m = catMeta(entry.category);
    const h = m.fp.h;
    (entry.instances || []).forEach(inst => {
      if (inst.roomId && inst.roomId !== room.id) return;
      const x = Number(inst.x_m), z = Number(inst.z_m);
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      const g = new THREE.Group();
      const body = makeEquipMesh(entry.category);
      g.add(body);
      const lbl = makeLabelSprite(`${entry.vendor !== '_generic' ? entry.vendor + ' ' : ''}${entry.model}`);
      lbl.scale.multiplyScalar(0.22);
      lbl.position.set(0, h / 2 + 0.22, 0);
      g.add(lbl);
      g.position.set(x, h / 2, z);
      if (inst.rotation) g.rotation.y = inst.rotation;
      g.userData = { kind: 'room-equipment', id: inst.instanceId, equipId: entry.id, instanceId: inst.instanceId, footprint: { length_m: m.fp.l, width_m: m.fp.w }, roomId: room.id };
      g.name = `equip:${inst.instanceId}`;
      roomGroup.add(g);
      state.meshIndex.set(inst.instanceId, g);
    });
  });
}

async function saveRoomEquipment(opts = {}) {
  try {
    const r = await authFetch('/data/room-equipment.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.roomEquipment),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (!opts.silent) toast(opts.msg || 'Equipment saved');
  } catch (err) {
    console.error('[v3d] equipment save failed', err);
    toast('Equipment save failed: ' + (err.message || 'unknown'));
  }
}

// ── Equipment Drawer ──────────────────────────────────────────────────
const DRAWER_CATS = [
  { key: 'fans',            label: 'Fans' },
  { key: 'dehumidifier',    label: 'Dehumidifier' },
  { key: 'hvac',            label: 'HVAC' },
  { key: 'humidifier',      label: 'Humidifier' },
  { key: 'co2-generator',   label: 'CO2 Generator' },
];
const GENERIC_SPECS = {
  fans:           ['wattage', 'cfm'],
  dehumidifier:   ['wattage', 'ppd'],
  hvac:           ['btu', 'wattage'],
  humidifier:     ['outputGPH'],
  'co2-generator':['outputCuFtHr'],
};
const SPEC_LABELS = { wattage: 'Wattage (W)', cfm: 'CFM', ppd: 'PPD (pints/day)', btu: 'BTU', outputGPH: 'Output (GPH)', outputCuFtHr: 'Output (cu.ft/hr)' };

function openEquipDrawer() {
  state.equipDrawer.open = true;
  state.equipDrawer.level = 'cat';
  state.equipDrawer.category = null;
  state.equipDrawer.model = null;
  state.equipDrawer.search = '';
  state.equipDrawer.qty = 1;
  state.equipDrawer.specs = {};
  const el = $('v3dEquipDrawer');
  el.classList.add('open');
  renderEquipDrawer();
}

function closeEquipDrawer() {
  state.equipDrawer.open = false;
  $('v3dEquipDrawer').classList.remove('open');
}

function renderEquipDrawer() {
  const d = state.equipDrawer;
  const titleEl = $('v3dEquipDrawerTitle');
  const backBtn = $('v3dEquipDrawerBack');
  const catGrid = $('v3dEquipCatGrid');
  const modelPanel = $('v3dEquipModelPanel');
  const configPanel = $('v3dEquipConfigPanel');

  titleEl.textContent = d.level === 'config'
    ? `Configure: ${d.model?.model || ''}`
    : d.level === 'model'
      ? `Select ${d.category ? DRAWER_CATS.find(c => c.key === d.category)?.label || d.category : ''} Model`
      : 'Add Equipment';
  backBtn.hidden = d.level === 'cat';
  catGrid.hidden = d.level !== 'cat';
  modelPanel.hidden = d.level !== 'model';
  configPanel.hidden = d.level !== 'config';

  if (d.level === 'cat') renderEquipCatGrid();
  if (d.level === 'model') renderEquipModelPanel();
  if (d.level === 'config') renderEquipConfigPanel();
}

function renderEquipCatGrid() {
  const grid = $('v3dEquipCatGrid');
  grid.innerHTML = DRAWER_CATS.map(cat => {
    const m = catMeta(cat.key);
    return `<div class="v3d-equip-tile" data-cat="${escapeHtml(cat.key)}">
      <div class="v3d-equip-tile__icon" style="background:${m.bg};">${m.icon}</div>
      <div class="v3d-equip-tile__label">${escapeHtml(cat.label)}</div>
    </div>`;
  }).join('');
  grid.querySelectorAll('.v3d-equip-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      state.equipDrawer.category = tile.dataset.cat;
      state.equipDrawer.level = 'model';
      state.equipDrawer.search = '';
      renderEquipDrawer();
    });
  });
}

function renderEquipModelPanel() {
  const d = state.equipDrawer;
  const cat = d.category;
  const searchInput = $('v3dEquipModelSearch');
  if (searchInput) {
    searchInput.value = d.search || '';
    searchInput.oninput = () => { d.search = searchInput.value; renderEquipModelList(); };
  }
  renderEquipModelList();
}

function renderEquipModelList() {
  const d = state.equipDrawer;
  const q = (d.search || '').toLowerCase();
  const models = (state.equipmentKB.equipment || []).filter(e => {
    if ((e.category || '').toLowerCase() !== d.category) return false;
    if (!q) return true;
    return (e.vendor + ' ' + e.model).toLowerCase().includes(q);
  });
  const listEl = $('v3dEquipModelList');
  if (!listEl) return;
  if (!models.length) { listEl.innerHTML = '<div class="v3d-empty" style="padding:10px;">No models found</div>'; return; }
  listEl.innerHTML = models.map((m, i) => {
    const specHints = Object.entries(m.specs || {}).filter(([, v]) => v).slice(0, 2).map(([k,v]) => `${k}: ${v}`).join(' / ');
    return `<div class="v3d-equip-model-row" data-idx="${i}">
      <div>
        <div class="v3d-equip-model-row__name">${escapeHtml(m.vendor !== '_generic' ? m.vendor + ' ' : '')}${escapeHtml(m.model)}</div>
        ${specHints ? `<div class="v3d-equip-model-row__meta">${escapeHtml(specHints)}</div>` : ''}
      </div>
      ${m.isGeneric ? '<span class="v3d-equip-model-row__badge">Generic</span>' : ''}
    </div>`;
  }).join('');
  listEl.querySelectorAll('.v3d-equip-model-row').forEach((row, i) => {
    row.addEventListener('click', () => {
      d.model = models[i];
      d.specs = Object.assign({}, models[i].specs || {});
      d.level = 'config';
      renderEquipDrawer();
    });
  });
}

function renderEquipConfigPanel() {
  const d = state.equipDrawer;
  const cat = d.category;
  const model = d.model;
  const requiredSpecs = model?.requiredSpecs || GENERIC_SPECS[cat] || [];
  const specGrid = $('v3dEquipSpecGrid');
  if (specGrid) {
    specGrid.innerHTML = requiredSpecs.map(key => `
      <div>
        <div class="v3d-equip-spec-label">${escapeHtml(SPEC_LABELS[key] || key)}</div>
        <input class="v3d-equip-spec-input" data-spec="${escapeHtml(key)}" type="number" min="0"
          value="${escapeHtml(String(d.specs[key] ?? ''))}" placeholder="0" />
      </div>`).join('');
    specGrid.querySelectorAll('.v3d-equip-spec-input').forEach(inp => {
      inp.addEventListener('input', () => { d.specs[inp.dataset.spec] = Number(inp.value); });
    });
  }
  const qtyInput = $('v3dEquipQty');
  if (qtyInput) { qtyInput.value = d.qty; qtyInput.oninput = () => { d.qty = Math.max(1, parseInt(qtyInput.value) || 1); }; }
}

async function confirmEquipConfig() {
  const d = state.equipDrawer;
  if (!d.model || !d.category) return;
  const room = state.rooms[0]; // place in first room; assignment happens on drag
  const roomId = room?.id || null;
  const qty = Math.max(1, parseInt($('v3dEquipQty')?.value || '1'));
  const ts = Date.now();
  const entryId = `EQ-${ts}`;
  const instances = Array.from({ length: qty }, (_, i) => ({
    instanceId: `${entryId}-${i + 1}`,
    x_m: null, z_m: null, rotation: 0, roomId: null,
  }));
  const entry = {
    id: entryId,
    roomId,
    category: d.category,
    vendor: d.model.vendor,
    model: d.model.model,
    specs: { ...d.specs },
    quantity: qty,
    instances,
    createdAt: new Date().toISOString(),
  };
  state.roomEquipment.push(entry);
  await saveRoomEquipment({ msg: `Added ${qty}x ${entry.model}` });
  closeEquipDrawer();
  buildScene();
  renderSidePanel();
  if (instances.length === 1) {
    activateInstancePlacement(entryId, instances[0].instanceId);
  } else {
    toast(`${qty}x ${entry.model} added — place from side panel`);
    renderFarmSummary();
  }
}

function activateInstancePlacement(equipId, instanceId) {
  const entry = state.roomEquipment.find(e => e.id === equipId);
  const inst = entry?.instances?.find(i => i.instanceId === instanceId);
  if (!entry || !inst) return;
  state.pendingPlacement = { kind: 'room-equipment', equipId, instanceId };
  state.selection.clear();
  applySelectionVisuals();
  updatePlacementBanner();
}

function updatePlacementBanner() {
  const banner = $('v3dPlaceBanner');
  if (!banner) return;
  if (state.pendingPlacement) {
    const pp = state.pendingPlacement;
    let label;
    if (pp.kind === 'room-equipment') {
      const entry = state.roomEquipment.find(e => e.id === pp.equipId);
      label = entry ? `${entry.model} (${pp.instanceId})` : pp.instanceId;
    } else {
      const dev = state.devices.find(d => d.id === pp.deviceId);
      label = dev?.name || pp.deviceId;
    }
    $('v3dPlaceMsg').textContent = `Click room floor to place: ${label}`;
    banner.hidden = false;
    canvas.classList.add('placing');
  } else {
    banner.hidden = true;
    canvas.classList.remove('placing');
  }
}

function activatePlacement(deviceId) {
  state.pendingPlacement = { deviceId };
  state.selection.clear();
  applySelectionVisuals();
  updatePlacementBanner();
}

function cancelPlacement() {
  state.pendingPlacement = null;
  updatePlacementBanner();
  renderSidePanel();
}

async function completePlacement(worldPos) {
  const pp = state.pendingPlacement;
  state.pendingPlacement = null;
  updatePlacementBanner();

  if (pp.kind === 'room-equipment') {
    const entry = state.roomEquipment.find(e => e.id === pp.equipId);
    const inst = entry?.instances?.find(i => i.instanceId === pp.instanceId);
    if (!entry || !inst) return;
    let placed = false;
    for (const rg of state.roomMeshes) {
      const dims = rg.userData.dims;
      if (!dims) continue;
      const lp = rg.worldToLocal(worldPos.clone());
      if (lp.x >= 0 && lp.x <= dims.L && lp.z >= 0 && lp.z <= dims.W) {
        const roomId = rg.userData.id;
        const room = state.rooms.find(r => r.id === roomId);
        const zr = room ? (getZoneRects(room).find(z =>
          lp.x >= z.x_m && lp.x <= z.x_m + z.length_m &&
          lp.z >= z.y_m && lp.z <= z.y_m + z.width_m
        ) || null) : null;
        inst.x_m = Math.round(lp.x * 1000) / 1000;
        inst.z_m = Math.round(lp.z * 1000) / 1000;
        inst.roomId = roomId;
        if (zr) inst.zone = zr.name || zr.id;
        placed = true;
        break;
      }
    }
    if (!placed) {
      toast('Click within the room boundaries to place');
      state.pendingPlacement = pp;
      updatePlacementBanner();
      return;
    }
    buildScene();
    renderSidePanel();
    await saveRoomEquipment({ msg: `Placed ${entry.model}` });
    return;
  }

  // Device placement (original logic)
  const { deviceId } = pp;
  const device = state.devices.find(d => d.id === deviceId);
  if (!device) return;

  let placed = false;
  for (const rg of state.roomMeshes) {
    const dims = rg.userData.dims;
    if (!dims) continue;
    const lp = rg.worldToLocal(worldPos.clone());
    if (lp.x >= 0 && lp.x <= dims.L && lp.z >= 0 && lp.z <= dims.W) {
      const roomId = rg.userData.id;
      const room = state.rooms.find(r => r.id === roomId);
      const zoneRects = room ? getZoneRects(room) : [];
      const zr = zoneRects.find(z =>
        lp.x >= z.x_m && lp.x <= z.x_m + z.length_m &&
        lp.z >= z.y_m && lp.z <= z.y_m + z.width_m
      );
      device.roomId = roomId;
      device.x_m = Math.round(lp.x * 1000) / 1000;
      device.z_m = Math.round(lp.z * 1000) / 1000;
      if (zr) device.zone = zr.name || zr.id;
      placed = true;
      break;
    }
  }

  if (!placed) {
    toast('Click within the room boundaries to place');
    state.pendingPlacement = pp;
    updatePlacementBanner();
    return;
  }

  buildScene();
  renderSidePanel();
  await saveDevices({ msg: `Placed ${device.name || device.id}` });
}

function renderDevicePanel(devices) {
  const titleEl = $('v3dSideTitle'), countEl = $('v3dSideCount');
  const bodyEl = $('v3dSideBody'), actsEl = $('v3dSideActions');
  actsEl.hidden = true;
  if (devices.length === 1) {
    const dev = devices[0];
    const room = state.rooms.find(r => r.id === dev.roomId);
    const zr = dev.zone ? (room ? getZoneRects(room).find(z => z.name === dev.zone || z.id === dev.zone || String(z.id) === String(dev.zone)) : null) : null;
    const envZ = envForZone(dev.roomId, dev.zone) || envForZone(dev.roomId, zr?.name);
    const src = envZ?.sensors?.tempC?.sources?.[dev.id];
    const rhSrc = envZ?.sensors?.rh?.sources?.[dev.id];
    titleEl.textContent = dev.name || dev.id;
    countEl.textContent = dev.type || 'Device';
    bodyEl.innerHTML = `
      <div class="v3d-side__row">
        <div class="v3d-kv"><span>Type</span><span>${escapeHtml(dev.type || '-')}</span></div>
        <div class="v3d-kv"><span>Room</span><span>${escapeHtml(room?.name || dev.roomId || 'unplaced')}</span></div>
        <div class="v3d-kv"><span>Zone</span><span>${escapeHtml(String(dev.zone ?? 'unassigned'))}</span></div>
        <div class="v3d-kv"><span>Position</span><span>${dev.x_m != null ? `${dev.x_m}, ${dev.z_m} m` : 'not placed'}</span></div>
      </div>
      ${src ? `<div class="v3d-side__row">
        <div class="v3d-side__section-title">Live Readings</div>
        ${envKvRow('Temperature', Number(src.current), 'C')}
        ${rhSrc ? envKvRow('Humidity', Number(rhSrc.current), '%') : ''}
        ${src.battery != null ? `<div class="v3d-kv"><span>Battery</span><span>${src.battery}%</span></div>` : ''}
        ${src.updatedAt ? `<div class="v3d-kv"><span>Updated</span><span style="font-size:11px;">${new Date(src.updatedAt).toLocaleTimeString()}</span></div>` : ''}
      </div>` : '<div class="v3d-empty" style="padding:8px;">No live data — assign to a zone to see readings.</div>'}
      <div class="v3d-empty" style="padding:8px;font-size:12px;">${state.editMode ? 'Drag to reposition.' : 'Toggle Edit to drag and reposition.'}</div>
    `;
  } else {
    titleEl.textContent = `${devices.length} devices selected`;
    countEl.textContent = '';
    bodyEl.innerHTML = devices.map(d => `<div class="v3d-kv"><span>${escapeHtml(d.name || d.id)}</span><span>${escapeHtml(String(d.zone ?? 'unassigned'))}</span></div>`).join('');
  }
}

function applyHeatmap() {
  const on = state.heatmapOn;
  const metric = state.heatMetric;
  const mi = metricInfo(metric);

  let lo = mi.lo, hi = mi.hi;
  if (on && state.heatAutoScale) {
    const r = computeDataRange(metric);
    if (r) { lo = r.lo; hi = r.hi; }
  }

  const seen = new Set();
  state.zoneFloorIndex.forEach((mesh) => {
    if (seen.has(mesh.uuid)) return;
    seen.add(mesh.uuid);
    const ud = mesh.userData;
    if (!ud) return;
    if (!on) {
      mesh.material.color.setHex(ud.baseColor || 0x153e2e);
      mesh.material.opacity = 0.55;
      if (mesh.material.emissive) mesh.material.emissive.setHex(0x000000);
      return;
    }
    const env = envForZone(ud.roomId, ud.zoneName) || envForZone(ud.roomId, ud.zoneId);
    let v;
    if (ud.sourceId && env?.sensors?.[metric]?.sources?.[ud.sourceId]) {
      v = Number(env.sensors[metric].sources[ud.sourceId].current);
    } else {
      v = Number(env?.sensors?.[metric]?.current);
    }
    const c = heatColor(v, lo, hi);
    mesh.material.color.copy(c);
    mesh.material.opacity = Number.isFinite(v) ? 0.78 : 0.35;
    if (mesh.material.emissive) mesh.material.emissive.copy(c).multiplyScalar(0.18);
  });

  const loLabel = state.heatAutoScale ? lo.toFixed(1) : String(mi.lo);
  const hiLabel = state.heatAutoScale ? hi.toFixed(1) : String(mi.hi);
  $('v3dHeatLo').textContent = `${loLabel} ${mi.unit}`;
  $('v3dHeatHi').textContent = `${hiLabel} ${mi.unit}`;
  $('v3dHeatKey').classList.toggle('show', on);
  $('v3dHeatMode').classList.toggle('show', on);
  $('v3dHeatBtn').classList.toggle('active', on);
  const autoBtn = $('v3dHeatAutoBtn');
  if (autoBtn) autoBtn.classList.toggle('active', state.heatAutoScale);
}

function applySelectionVisuals() {
  state.meshIndex.forEach((mesh, id) => {
    const prev = mesh.getObjectByName('_v3dRing');
    if (prev) {
      mesh.remove(prev);
      prev.geometry?.dispose(); prev.material?.dispose();
    }
    if (state.selection.has(id)) {
      const ring = makeSelectionRing(mesh.userData.footprint || { length_m: 1, width_m: 1 });
      ring.name = '_v3dRing';
      mesh.add(ring);
    }
  });
  const selected = Array.from(state.selection)
    .map(id => state.meshIndex.get(id)).filter(Boolean);
  outlinePass.selectedObjects = selected;
}

let camAnim = null;
function animateCamera(toPos, toTarget, dur=750) {
  const fromPos = camera.position.clone();
  const fromTarget = controls.target.clone();
  const start = performance.now();
  camAnim = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const e = t < 0.5 ? 2*t*t : -1 + (4 - 2*t)*t;
    camera.position.lerpVectors(fromPos, toPos, e);
    controls.target.lerpVectors(fromTarget, toTarget, e);
    controls.update();
    if (t < 1) return true;
    camAnim = null; return false;
  };
}

function fitView() {
  const box = new THREE.Box3().setFromObject(farmRoot);
  if (!Number.isFinite(box.min.x)) return;
  const size = new THREE.Vector3(); box.getSize(size);
  const centre = new THREE.Vector3(); box.getCenter(centre);
  const radius = Math.max(size.x, size.z) * 0.6 + size.y * 0.3 + 4;
  const dir = new THREE.Vector3(0.6, 0.6, 0.8).normalize();
  const target = new THREE.Vector3(centre.x, size.y * 0.4, centre.z);
  animateCamera(target.clone().add(dir.multiplyScalar(radius)), target);
}

function setViewMode(mode) {
  state.viewMode = mode;
  document.querySelectorAll('.v3d-viewmode button').forEach(b => b.classList.toggle('active', b.dataset.view === mode));
  const box = new THREE.Box3().setFromObject(farmRoot);
  if (!Number.isFinite(box.min.x)) return;
  const size = new THREE.Vector3(); box.getSize(size);
  const centre = new THREE.Vector3(); box.getCenter(centre);
  if (mode === 'top') {
    animateCamera(new THREE.Vector3(centre.x, Math.max(size.x, size.z) * 1.3, centre.z + 0.001), centre);
  } else if (mode === 'walk') {
    animateCamera(new THREE.Vector3(centre.x - size.x * 0.3, 1.65, centre.z), new THREE.Vector3(centre.x, 1.65, centre.z));
  } else {
    fitView();
  }
}

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function setNdcFrom(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
}
function pickFirstByKind(clientX, clientY, kinds) {
  setNdcFrom(clientX, clientY);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(farmRoot, true);
  for (const h of hits) {
    let n = h.object;
    while (n) {
      if (n.userData && kinds.includes(n.userData.kind)) return { node: n, point: h.point };
      n = n.parent;
    }
  }
  return null;
}

const drag = {
  active: false, pointerId: null, startMeshes: [],
  plane: new THREE.Plane(new THREE.Vector3(0,1,0), 0),
  initialHit: new THREE.Vector3(),
  movedAtLeastOnce: false,
};
// Clamp to room bounds — equipment can move freely anywhere in the room.
// Zone assignment is auto-updated on drop (endDrag → findZoneForPosition).
function clampPosToRoom(mesh, x, z) {
  const ud = mesh.userData;
  const fp = ud.footprint;
  if (!fp) return { x, z };
  const L = ud.rotate ? fp.width_m : fp.length_m;
  const W = ud.rotate ? fp.length_m : fp.width_m;
  const pad = 0.15;
  const dims = mesh.parent?.userData?.dims;
  if (dims) {
    return {
      x: Math.max(L / 2 + pad, Math.min(dims.L - L / 2 - pad, x)),
      z: Math.max(W / 2 + pad, Math.min(dims.W - W / 2 - pad, z)),
    };
  }
  // Fallback: clamp to zone if room dims unavailable
  const zr = ud.zoneRect;
  if (!zr) return { x, z };
  return {
    x: Math.max(zr.x_m + L/2, Math.min(zr.x_m + zr.length_m - L/2, x)),
    z: Math.max(zr.y_m + W/2, Math.min(zr.y_m + zr.width_m - W/2, z)),
  };
}

function findZoneForPosition(mesh) {
  const x = mesh.position.x, z = mesh.position.z;
  const roomGroupId = mesh.parent?.userData?.id;
  if (!roomGroupId) return null;
  const room = state.rooms.find(r => r.id === roomGroupId);
  if (!room) return null;
  const zoneRects = getZoneRects(room);
  return zoneRects.find(zr =>
    x >= zr.x_m && x <= zr.x_m + zr.length_m &&
    z >= zr.y_m && z <= zr.y_m + zr.width_m
  ) || null;
}
function startDrag(targetMesh, startPoint) {
  let ids = state.selection.has(targetMesh.userData.id) ? Array.from(state.selection) : [targetMesh.userData.id];
  drag.startMeshes = ids.map(id => state.meshIndex.get(id)).filter(Boolean).map(m => ({ mesh: m, startLocal: m.position.clone() }));
  drag.initialHit.copy(startPoint);
  drag.active = true; drag.movedAtLeastOnce = false;
  controls.enabled = false; canvas.classList.add('dragging');
}
function updateDrag(clientX, clientY) {
  setNdcFrom(clientX, clientY);
  raycaster.setFromCamera(ndc, camera);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(drag.plane, hit)) return;
  const dx = hit.x - drag.initialHit.x;
  const dz = hit.z - drag.initialHit.z;
  if (Math.abs(dx) + Math.abs(dz) > 0.01) drag.movedAtLeastOnce = true;
  drag.startMeshes.forEach(({ mesh, startLocal }) => {
    const tx = startLocal.x + dx;
    const tz = startLocal.z + dz;
    const c = clampPosToRoom(mesh, tx, tz);
    mesh.position.set(c.x, startLocal.y, c.z);
    const room = mesh.parent;
    if (room) room.children.forEach(ch => {
      if (ch.userData?.kind === 'fixtureFor' && ch.userData.groupId === mesh.userData.id) {
        ch.position.set(c.x, 0, c.z);
      }
    });
  });
}
async function saveGroups(opts = {}) {
  try {
    const r = await authFetch('/data/groups.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.groups),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (!opts.silent) toast(opts.msg || 'Saved');
  } catch (err) {
    console.error('[v3d] save failed', err);
    toast('Save failed: ' + (err.message || 'unknown'));
  }
}

function pushHistory() {
  const h = state.history;
  h.snapshots = h.snapshots.slice(0, h.cursor + 1);
  h.snapshots.push(JSON.parse(JSON.stringify(state.groups)));
  if (h.snapshots.length > 20) h.snapshots.shift();
  h.cursor = h.snapshots.length - 1;
  updateHistoryButtons();
}

function updateHistoryButtons() {
  const h = state.history;
  const undoBtn = $('v3dUndoBtn'), redoBtn = $('v3dRedoBtn');
  if (undoBtn) undoBtn.disabled = h.cursor < 1;
  if (redoBtn) redoBtn.disabled = h.cursor >= h.snapshots.length - 1;
}

async function applyHistorySnapshot(snap) {
  state.groups = JSON.parse(JSON.stringify(snap));
  state.selection.clear();
  buildScene();
  renderSidePanel();
  await saveGroups({ silent: true });
  updateHistoryButtons();
}

async function undo() {
  const h = state.history;
  if (h.cursor < 1) { toast('Nothing to undo'); return; }
  h.cursor--;
  toast('Undo');
  await applyHistorySnapshot(h.snapshots[h.cursor]);
}

async function redo() {
  const h = state.history;
  if (h.cursor >= h.snapshots.length - 1) { toast('Nothing to redo'); return; }
  h.cursor++;
  toast('Redo');
  await applyHistorySnapshot(h.snapshots[h.cursor]);
}

function rotateSelected() {
  const ids = Array.from(state.selection);
  if (!ids.length) { toast('Select a system to rotate'); return; }
  pushHistory();
  ids.forEach(id => {
    const g = state.groups.find(gg => gg.id === id);
    const mesh = state.meshIndex.get(id);
    if (!g) return;
    g.customization = g.customization || {};
    const cur = g.customization.placement || {};
    const x = cur.x_m ?? mesh?.position.x ?? 0;
    const z = cur.z_m ?? mesh?.position.z ?? 0;
    g.customization.placement = { x_m: x, z_m: z, rotated: !cur.rotated };
  });
  buildScene();
  renderSidePanel();
  saveGroups({ msg: `Rotated ${ids.length} system(s)` });
}

async function deleteSelected() {
  const ids = Array.from(state.selection);
  if (!ids.length) { toast('Select a system to delete'); return; }
  const names = ids.map(id => {
    const g = state.groups.find(gg => gg.id === id);
    return g?.name || g?.id || id;
  }).join(', ');
  if (!confirm(`Delete ${ids.length} system(s)?\n\n${names}\n\nThis can be undone with Undo.`)) return;
  pushHistory();
  state.groups = state.groups.filter(g => !ids.includes(g.id));
  state.selection.clear();
  buildScene();
  renderSidePanel();
  await saveGroups({ msg: `Deleted ${ids.length} system(s)` });
}

async function endDrag() {
  if (!drag.active) return;
  drag.active = false;
  controls.enabled = true; canvas.classList.remove('dragging');
  if (!drag.movedAtLeastOnce) { drag.startMeshes = []; return; }

  const groupMeshes  = drag.startMeshes.filter(({ mesh }) => mesh.userData.kind === 'group');
  const deviceMeshes = drag.startMeshes.filter(({ mesh }) => mesh.userData.kind === 'device');
  const equipMeshes  = drag.startMeshes.filter(({ mesh }) => mesh.userData.kind === 'room-equipment');

  if (groupMeshes.length) pushHistory();

  groupMeshes.forEach(({ mesh }) => {
    const id = mesh.userData.id;
    const g = state.groups.find(gg => gg.id === id);
    if (!g) return;
    g.customization = g.customization || {};
    g.customization.placement = { x_m: mesh.position.x, z_m: mesh.position.z, rotated: !!mesh.userData.rotate };
    const zr = findZoneForPosition(mesh);
    if (zr) g.zone = zr.name;
  });

  deviceMeshes.forEach(({ mesh }) => {
    const id = mesh.userData.id;
    const dev = state.devices.find(d => d.id === id);
    if (!dev) return;
    dev.x_m = Math.round(mesh.position.x * 1000) / 1000;
    dev.z_m = Math.round(mesh.position.z * 1000) / 1000;
    dev.roomId = mesh.parent?.userData?.id || dev.roomId;
    const zr = findZoneForPosition(mesh);
    if (zr) dev.zone = zr.name || zr.id;
  });

  equipMeshes.forEach(({ mesh }) => {
    const { equipId, instanceId } = mesh.userData;
    const entry = state.roomEquipment.find(e => e.id === equipId);
    const inst = entry?.instances?.find(i => i.instanceId === instanceId);
    if (!inst) return;
    inst.x_m = Math.round(mesh.position.x * 1000) / 1000;
    inst.z_m = Math.round(mesh.position.z * 1000) / 1000;
    inst.roomId = mesh.parent?.userData?.id || inst.roomId;
    const zr = findZoneForPosition(mesh);
    if (zr) inst.zone = zr.name || zr.id;
  });

  drag.startMeshes = [];

  const saves = [];
  if (groupMeshes.length) saves.push(saveGroups({ msg: (deviceMeshes.length || equipMeshes.length) ? null : `Saved layout for ${groupMeshes.length} system(s)`, silent: !!(deviceMeshes.length || equipMeshes.length) }));
  if (deviceMeshes.length) saves.push(saveDevices({ silent: !!equipMeshes.length, msg: `Saved ${deviceMeshes.length} device position(s)` }));
  if (equipMeshes.length) saves.push(saveRoomEquipment({ msg: `Saved ${equipMeshes.length} equipment position(s)` }));
  await Promise.all(saves);
}

const marquee = { active: false, startX: 0, startY: 0, curX: 0, curY: 0, el: null };
function marqueeBegin(x, y) {
  marquee.active = true; marquee.startX = x; marquee.startY = y; marquee.curX = x; marquee.curY = y;
  marquee.el = $('v3dMarquee'); marquee.el.style.display = 'block'; marqueeUpdateBox();
  controls.enabled = false;
}
function marqueeUpdateBox() {
  if (!marquee.el) return;
  const x1 = Math.min(marquee.startX, marquee.curX);
  const y1 = Math.min(marquee.startY, marquee.curY);
  const w = Math.abs(marquee.curX - marquee.startX);
  const h = Math.abs(marquee.curY - marquee.startY);
  marquee.el.style.left = x1 + 'px'; marquee.el.style.top = y1 + 'px';
  marquee.el.style.width = w + 'px'; marquee.el.style.height = h + 'px';
}
function marqueeEnd(additive) {
  if (!marquee.active) return;
  marquee.active = false; marquee.el.style.display = 'none';
  controls.enabled = true;
  const rect = canvas.getBoundingClientRect();
  const x1 = Math.min(marquee.startX, marquee.curX) - rect.left;
  const y1 = Math.min(marquee.startY, marquee.curY) - rect.top;
  const x2 = Math.max(marquee.startX, marquee.curX) - rect.left;
  const y2 = Math.max(marquee.startY, marquee.curY) - rect.top;
  if (Math.abs(x2-x1) < 5 && Math.abs(y2-y1) < 5) return;
  if (!additive) state.selection.clear();
  const v = new THREE.Vector3();
  state.meshIndex.forEach((mesh, id) => {
    mesh.getWorldPosition(v);
    v.project(camera);
    const sx = (v.x * 0.5 + 0.5) * rect.width;
    const sy = (-v.y * 0.5 + 0.5) * rect.height;
    if (sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2) state.selection.add(id);
  });
  state.zoneSelection = null; state.roomSelection = null;
  applySelectionVisuals(); renderSidePanel();
}

let pointerDownAt = { x: 0, y: 0, t: 0 };
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  pointerDownAt = { x: e.clientX, y: e.clientY, t: performance.now() };

  // Placement mode: next click places the pending device
  if (state.pendingPlacement) {
    setNdcFrom(e.clientX, e.clientY);
    raycaster.setFromCamera(ndc, camera);
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hitPt = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(floorPlane, hitPt)) completePlacement(hitPt);
    return;
  }

  const hit = pickFirstByKind(e.clientX, e.clientY, ['group', 'device', 'room-equipment']);
  if (state.editMode && hit) {
    canvas.setPointerCapture(e.pointerId); drag.pointerId = e.pointerId;
    startDrag(hit.node, hit.point); return;
  }
  // Marquee selection only on shift+click (empty space)
  if (!hit && e.shiftKey) {
    canvas.setPointerCapture(e.pointerId); drag.pointerId = e.pointerId;
    marqueeBegin(e.clientX, e.clientY);
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (drag.active) { updateDrag(e.clientX, e.clientY); return; }
  if (marquee.active) { marquee.curX = e.clientX; marquee.curY = e.clientY; marqueeUpdateBox(); }
});
canvas.addEventListener('pointerup', (e) => {
  if (drag.pointerId === e.pointerId) {
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    drag.pointerId = null;
  }
  if (drag.active) { endDrag(); return; }
  if (marquee.active) {
    const ml = Math.abs(e.clientX - pointerDownAt.x);
    const mt = Math.abs(e.clientY - pointerDownAt.y);
    if (ml < 5 && mt < 5) { marquee.active = false; marquee.el.style.display='none'; controls.enabled = true; }
    else { marqueeEnd(e.shiftKey); return; }
  }
  handleClick(e);
});
canvas.addEventListener('pointercancel', () => {
  if (drag.active) { drag.active = false; controls.enabled = true; canvas.classList.remove('dragging'); }
  if (marquee.active) { marquee.active = false; if (marquee.el) marquee.el.style.display='none'; controls.enabled = true; }
});

let _hoverMesh = null;
canvas.addEventListener('pointermove', (e) => {
  if (drag.active || marquee.active) return;
  const hit = pickFirstByKind(e.clientX, e.clientY, ['group', 'device', 'room-equipment']);
  const next = hit ? hit.node : null;
  if (next === _hoverMesh) return;
  _hoverMesh = next;
  const selected = Array.from(state.selection)
    .map(id => state.meshIndex.get(id)).filter(Boolean);
  outlinePass.selectedObjects = next && !state.selection.has(next.userData.id)
    ? [...selected, next]
    : selected;
}, { passive: true });

function handleClick(e) {
  const equipHit = pickFirstByKind(e.clientX, e.clientY, ['group', 'device', 'room-equipment']);
  if (equipHit) {
    const id = equipHit.node.userData.id;
    if (e.shiftKey) {
      if (state.selection.has(id)) state.selection.delete(id); else state.selection.add(id);
    } else { state.selection.clear(); state.selection.add(id); }
    state.zoneSelection = null; state.roomSelection = null;
    applySelectionVisuals(); renderSidePanel(); return;
  }
  const zoneHit = pickFirstByKind(e.clientX, e.clientY, ['zone']);
  if (zoneHit) {
    const ud = zoneHit.node.userData;
    state.selection.clear();
    state.zoneSelection = { roomId: ud.roomId, zoneId: ud.zoneId, zoneName: ud.zoneName };
    state.roomSelection = null;
    applySelectionVisuals(); renderSidePanel(); return;
  }
  const roomHit = pickFirstByKind(e.clientX, e.clientY, ['room']);
  if (roomHit) {
    const ud = roomHit.node.userData;
    state.selection.clear(); state.zoneSelection = null; state.roomSelection = ud.id;
    applySelectionVisuals(); renderSidePanel(); return;
  }
  if (!e.shiftKey) {
    state.selection.clear(); state.zoneSelection = null; state.roomSelection = null;
    applySelectionVisuals(); renderSidePanel();
  }
}

canvas.addEventListener('dblclick', (e) => {
  const groupHit = pickFirstByKind(e.clientX, e.clientY, ['group', 'device']);
  if (!groupHit) return;
  const target = groupHit.node;
  const fp = target.userData.footprint || { length_m: 1, width_m: 1 };
  const wp = new THREE.Vector3(); target.getWorldPosition(wp);
  const dist = Math.max(fp.length_m, fp.width_m) * 2.6 + 1.2;
  animateCamera(new THREE.Vector3(wp.x + dist * 0.6, dist * 0.7, wp.z + dist * 0.8), wp.clone());
});

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}
function envKvRow(label, val, unit, sp) {
  if (!Number.isFinite(val)) return `<div class="v3d-kv"><span>${escapeHtml(label)}</span><span>--</span></div>`;
  const ok = sp ? inSetpoint(val, sp) : null;
  const cls = ok === false ? 'v3d-bad' : ok === true ? 'v3d-ok' : '';
  const spStr = sp && Number.isFinite(Number(sp.min)) ? ` <span style="color:var(--v3d-muted);font-size:10px;">(${sp.min}-${sp.max})</span>` : '';
  return `<div class="v3d-kv"><span>${escapeHtml(label)}</span><span class="${cls}">${fmt(val, unit==='%' ? 0 : 2)} ${escapeHtml(unit)}${spStr}</span></div>`;
}
function envBlockHtml(env) {
  if (!env || !env.sensors) return '';
  const t = env.sensors.tempC || {}; const h = env.sensors.rh || {}; const v = env.sensors.vpd || {};
  return `
    <div class="v3d-side__section-title">Environment</div>
    ${envKvRow('Temperature', Number(t.current), 'C', t.setpoint)}
    ${envKvRow('Humidity', Number(h.current), '%', h.setpoint)}
    ${envKvRow('VPD', Number(v.current), 'kPa', v.setpoint)}
    ${env.updatedAt ? `<div class="v3d-kv"><span>Updated</span><span style="font-size:11px;">${escapeHtml(new Date(env.updatedAt).toLocaleString())}</span></div>` : ''}
  `;
}

function renderFarmSummary() {
  $('v3dSideTitle').textContent = 'Farm summary';
  $('v3dSideCount').textContent = `${state.rooms.length} room(s)`;
  $('v3dSideActions').hidden = true;
  const bodyEl = $('v3dSideBody');
  if (!state.rooms.length) {
    bodyEl.innerHTML = '<div class="v3d-empty">No rooms configured yet. Open Grow Management to set up rooms.</div>';
    return;
  }
  const totalGroups = state.groups.length;
  const totalZones = state.rooms.reduce((s, r) => s + (r.zones?.length || 0), 0);
  const totalLocations = state.groups.reduce((s, g) => s + (Number(g.customization?.totalLocations) || 0), 0);
  const cards = state.rooms.map(room => {
    const dims = readRoomDims(room);
    const zoneRects = getZoneRects(room);
    const groupsInRoom = state.groups.filter(g => groupInRoom(g, room));
    const env = envForRoom(room);
    const dimStr = dims ? `${fmt(dims.lengthM,1)} x ${fmt(dims.widthM,1)} x ${fmt(dims.H,1)} m  (${fmt(dims.lengthM*M_TO_FT,0)} x ${fmt(dims.widthM*M_TO_FT,0)} ft)` : 'no dims';
    const area = dims ? `${fmt(dims.lengthM * dims.widthM, 1)} m^2` : '--';
    return `
      <div class="v3d-room-card">
        <h4>${escapeHtml(room.name || room.id)}</h4>
        <div class="v3d-kv"><span>Dimensions</span><span>${dimStr}</span></div>
        <div class="v3d-kv"><span>Floor area</span><span>${area}</span></div>
        <div class="v3d-kv"><span>Zones</span><span>${zoneRects.length}</span></div>
        <div class="v3d-kv"><span>Systems</span><span>${groupsInRoom.length}</span></div>
        ${env && Number.isFinite(env.tempC) ? `<div class="v3d-kv"><span>Temp / RH</span><span>${fmt(env.tempC,1)} C / ${fmt(env.rh,0)} %</span></div>` : ''}
      </div>`;
  }).join('');
  const unplaced = state.devices.filter(d => !d.roomId || d.x_m == null);
  const unplacedEquip = [];
  state.roomEquipment.forEach(entry => {
    (entry.instances || []).forEach(inst => {
      if (inst.x_m == null) unplacedEquip.push({ entry, inst });
    });
  });
  const unplacedHtml = (unplaced.length || unplacedEquip.length) ? `
    ${unplaced.length ? `
    <div class="v3d-side__section-title">Unplaced Devices (${unplaced.length})</div>
    <div class="v3d-room-list">
      ${unplaced.map(d => `
        <div class="v3d-room-card" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;">
          <div>
            <div style="font-weight:600;font-size:13px;">${escapeHtml(d.name || d.id)}</div>
            <div style="font-size:11px;color:var(--v3d-muted);">${escapeHtml(d.type || 'device')}</div>
          </div>
          <button class="v3d-btn v3d-place-btn" data-device-id="${escapeHtml(d.id)}" style="font-size:11px;padding:4px 10px;">Place</button>
        </div>`).join('')}
    </div>` : ''}
    ${unplacedEquip.length ? `
    <div class="v3d-side__section-title">Unplaced Equipment (${unplacedEquip.length})</div>
    <div class="v3d-room-list">
      ${unplacedEquip.map(({ entry, inst }) => `
        <div class="v3d-room-card" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;">
          <div>
            <div style="font-weight:600;font-size:13px;">${escapeHtml(entry.model)}</div>
            <div style="font-size:11px;color:var(--v3d-muted);">${escapeHtml(inst.instanceId)}</div>
          </div>
          <button class="v3d-btn v3d-equip-place-btn" data-equip-id="${escapeHtml(entry.id)}" data-inst-id="${escapeHtml(inst.instanceId)}" style="font-size:11px;padding:4px 10px;">Place</button>
        </div>`).join('')}
    </div>` : ''}` : '';

  bodyEl.innerHTML = `
    <div class="v3d-side__row">
      <div class="v3d-kv"><span>Total rooms</span><span>${state.rooms.length}</span></div>
      <div class="v3d-kv"><span>Total zones</span><span>${totalZones}</span></div>
      <div class="v3d-kv"><span>Total systems</span><span>${totalGroups}</span></div>
      <div class="v3d-kv"><span>Total locations</span><span>${totalLocations}</span></div>
    </div>
    <div class="v3d-side__section-title">Rooms</div>
    <div class="v3d-room-list">${cards}</div>
    ${unplacedHtml}
    <div class="v3d-empty" style="padding:12px 4px;">Click a room floor, zone, or system to inspect. Toggle Edit to drag. Click Place to position a device.</div>
  `;

  bodyEl.querySelectorAll('.v3d-place-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      activatePlacement(btn.dataset.deviceId);
    });
  });
  bodyEl.querySelectorAll('.v3d-equip-place-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      activateInstancePlacement(btn.dataset.equipId, btn.dataset.instId);
    });
  });
}

function renderRoomPanel(roomId) {
  const room = state.rooms.find(r => r.id === roomId);
  if (!room) { renderFarmSummary(); return; }
  const dims = readRoomDims(room);
  const zoneRects = getZoneRects(room);
  const groupsInRoom = state.groups.filter(g => groupInRoom(g, room));
  const totalLocs = groupsInRoom.reduce((s,g)=>s + (Number(g.customization?.totalLocations)||0), 0);
  const env = envForRoom(room);
  $('v3dSideTitle').textContent = room.name || room.id;
  $('v3dSideCount').textContent = 'Room';
  $('v3dSideActions').hidden = true;
  const dimStr = dims ? `${fmt(dims.lengthM,2)} x ${fmt(dims.widthM,2)} x ${fmt(dims.H,2)} m` : '--';
  const ftStr = dims ? `${fmt(dims.lengthM*M_TO_FT,1)} x ${fmt(dims.widthM*M_TO_FT,1)} x ${fmt(dims.H*M_TO_FT,1)} ft` : '--';
  const zoneList = zoneRects.map(zr => {
    const ze = envForZone(room.id, zr.name) || envForZone(room.id, zr.id);
    const t = ze?.sensors?.tempC?.current; const h = ze?.sensors?.rh?.current;
    return `<div class="v3d-kv"><span>${escapeHtml(zr.name)}</span><span>${fmt(zr.length_m,1)}x${fmt(zr.width_m,1)} m${Number.isFinite(t)?` / ${fmt(t,1)}C`:''}${Number.isFinite(h)?` / ${fmt(h,0)}%`:''}</span></div>`;
  }).join('');
  $('v3dSideBody').innerHTML = `
    <div class="v3d-side__row">
      <div class="v3d-side__section-title">Dimensions</div>
      <div class="v3d-kv"><span>L x W x H</span><span>${dimStr}</span></div>
      <div class="v3d-kv"><span>Imperial</span><span>${ftStr}</span></div>
      <div class="v3d-kv"><span>Floor area</span><span>${dims ? fmt(dims.lengthM*dims.widthM,1) + ' m^2' : '--'}</span></div>
      <div class="v3d-kv"><span>Volume</span><span>${dims ? fmt(dims.lengthM*dims.widthM*dims.H,1) + ' m^3' : '--'}</span></div>
    </div>
    <div class="v3d-side__row">
      <div class="v3d-side__section-title">Inventory</div>
      <div class="v3d-kv"><span>Zones</span><span>${zoneRects.length}</span></div>
      <div class="v3d-kv"><span>Systems</span><span>${groupsInRoom.length}</span></div>
      <div class="v3d-kv"><span>Total locations</span><span>${totalLocs}</span></div>
    </div>
    ${env && Number.isFinite(env.tempC) ? `<div class="v3d-side__row">
      <div class="v3d-side__section-title">Average environment</div>
      <div class="v3d-kv"><span>Temperature</span><span>${fmt(env.tempC,1)} C</span></div>
      <div class="v3d-kv"><span>Humidity</span><span>${fmt(env.rh,0)} %</span></div>
      <div class="v3d-kv"><span>VPD</span><span>${fmt(env.vpd,2)} kPa</span></div>
    </div>` : ''}
    <div class="v3d-side__row">
      <div class="v3d-side__section-title">Zones</div>
      ${zoneList || '<div class="v3d-empty" style="padding:6px;">No zones</div>'}
    </div>
  `;
}

function renderZonePanel(sel) {
  const room = state.rooms.find(r => r.id === sel.roomId);
  const zoneRects = room ? getZoneRects(room) : [];
  const zr = zoneRects.find(z => z.id === sel.zoneId || z.name === sel.zoneName);
  const env = envForZone(sel.roomId, sel.zoneName) || envForZone(sel.roomId, sel.zoneId);
  const groupsHere = state.groups.filter(g => groupInRoom(g, room) && (g.zone === sel.zoneName || g.zone === sel.zoneId));
  $('v3dSideTitle').textContent = sel.zoneName || sel.zoneId;
  $('v3dSideCount').textContent = `Zone in ${room?.name || sel.roomId}`;
  $('v3dSideActions').hidden = true;
  const zoneKey = `${sel.roomId}|${sel.zoneId}|${sel.zoneName}`;
  const isCollapsed = state.collapsedZoneSystems.has(zoneKey);
  const dimRow = zr ? `<div class="v3d-kv"><span>Footprint</span><span>${fmt(zr.length_m,2)} x ${fmt(zr.width_m,2)} m  (${fmt(zr.length_m*M_TO_FT,1)} x ${fmt(zr.width_m*M_TO_FT,1)} ft)</span></div>
       <div class="v3d-kv"><span>Area</span><span>${fmt(zr.length_m*zr.width_m,1)} m^2</span></div>` : '';
  const groupsRow = groupsHere.map(g => `<div class="v3d-kv"><span>${escapeHtml(g.name||g.id)}</span><span>${escapeHtml(templateById(g.templateId)?.category || g.templateId || '-')}</span></div>`).join('');
  const sources = env?.sensors?.tempC?.sources || env?.sensorDevices || {};
  const srcList = Object.values(sources).map(s => `<div class="v3d-kv"><span>${escapeHtml(s.name||s.deviceId)}</span><span>${Number.isFinite(s.current)?fmt(s.current,1)+' C':'--'}${Number.isFinite(s.battery)?` / bat ${s.battery}%`:''}</span></div>`).join('');
  $('v3dSideBody').innerHTML = `
    <div class="v3d-side__row">${dimRow}</div>
    ${env ? `<div class="v3d-side__row">${envBlockHtml(env)}</div>` : `<div class="v3d-empty" style="padding:8px;">No environmental data for this zone yet.</div>`}
    ${srcList ? `<div class="v3d-side__row"><div class="v3d-side__section-title">Sensors</div>${srcList}</div>` : ''}
    <div class="v3d-side__row">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <div class="v3d-side__section-title">Systems in this zone (${groupsHere.length})</div>
        <button class="v3d-collapse-btn" data-zone-key="${escapeHtml(zoneKey)}" style="background:none;border:none;color:var(--v3d-accent-2);cursor:pointer;font-size:14px;padding:0 4px;">${isCollapsed ? '▶' : '▼'}</button>
      </div>
      ${isCollapsed ? `<div class="v3d-empty" style="padding:6px;">Collapsed (${groupsHere.length} system${groupsHere.length!==1?'s':''})</div>` : (groupsRow || '<div class="v3d-empty" style="padding:6px;">None</div>')}
    </div>
  `;
  $('v3dSideBody').querySelectorAll('.v3d-collapse-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const zk = btn.dataset.zoneKey;
      if (state.collapsedZoneSystems.has(zk)) state.collapsedZoneSystems.delete(zk);
      else state.collapsedZoneSystems.add(zk);
      renderZonePanel(sel);
    });
  });
}

function renderGroupPanel(ids) {
  const groups = ids.map(id => state.groups.find(g => g.id === id)).filter(Boolean);
  const titleEl = $('v3dSideTitle'); const countEl = $('v3dSideCount');
  const bodyEl = $('v3dSideBody'); const actsEl = $('v3dSideActions');
  if (groups.length === 1) {
    const g = groups[0];
    const c = g.customization || {};
    const tpl = templateById(g.templateId);
    const room = state.rooms.find(r => r.name === g.room || r.id === g.room);
    const dims = room ? readRoomDims(room) : null;
    const env = envForZone(room?.id, g.zone);
    titleEl.textContent = g.name || g.id;
    countEl.textContent = tpl?.category || '';
    const fp = groupFootprintM(g);
    bodyEl.innerHTML = `
      <div class="v3d-side__row">
        <div class="v3d-kv"><span>Room</span><span>${escapeHtml(g.room || '-')}${dims?` (${fmt(dims.lengthM,1)}x${fmt(dims.widthM,1)}m)`:''}</span></div>
        <div class="v3d-kv"><span>Zone</span><span>${escapeHtml(g.zone || '-')}</span></div>
        <div class="v3d-kv"><span>Template</span><span>${escapeHtml(g.templateId || '-')}</span></div>
        <div class="v3d-kv"><span>Status</span><span><span class="v3d-tag ${g.status === 'active' ? 'v3d-tag--ok' : ''}">${escapeHtml(g.status || 'pending')}</span></span></div>
      </div>
      <div class="v3d-side__row">
        <div class="v3d-side__section-title">Geometry</div>
        <div class="v3d-kv"><span>Levels</span><span>${fmt(c.levels, 0)}</span></div>
        <div class="v3d-kv"><span>Locations / level</span><span>${fmt(c.locationsPerLevel, 0)}</span></div>
        <div class="v3d-kv"><span>Total locations</span><span>${fmt(c.totalLocations, 0)}</span></div>
        <div class="v3d-kv"><span>Footprint</span><span>${fmt(fp.length_m, 2)} x ${fmt(fp.width_m, 2)} m</span></div>
        ${c.placement ? `<div class="v3d-kv"><span>Position</span><span>${fmt(c.placement.x_m,2)}, ${fmt(c.placement.z_m,2)} m</span></div>` : ''}
      </div>
      <div class="v3d-side__row">
        <div class="v3d-side__section-title">Operations</div>
        <div class="v3d-kv"><span>Lights</span><span>${(g.lights || []).length}</span></div>
        <div class="v3d-kv"><span>Crop</span><span>${escapeHtml(g.crop || '-')}</span></div>
        <div class="v3d-kv"><span>Plan</span><span>${escapeHtml(g.planId || g.plan || '-')}</span></div>
      </div>
      ${env ? `<div class="v3d-side__row">${envBlockHtml(env)}</div>` : ''}
    `;
  } else {
    titleEl.textContent = `${groups.length} systems selected`;
    countEl.textContent = '';
    const totalLoc = groups.reduce((s, g) => s + (Number(g.customization?.totalLocations) || 0), 0);
    const totalLights = groups.reduce((s, g) => s + (g.lights?.length || 0), 0);
    const cats = new Map();
    groups.forEach(g => { const t = templateById(g.templateId); const k = t?.category || 'unknown'; cats.set(k, (cats.get(k)||0)+1); });
    const catList = Array.from(cats).map(([k,n]) => `<span class="v3d-tag">${escapeHtml(k)} x ${n}</span>`).join(' ');
    const rooms = new Set(groups.map(g => g.room).filter(Boolean));
    const zones = new Set(groups.map(g => g.zone).filter(Boolean));
    bodyEl.innerHTML = `
      <div class="v3d-side__row">
        <div class="v3d-kv"><span>Total systems</span><span>${groups.length}</span></div>
        <div class="v3d-kv"><span>Rooms</span><span>${rooms.size}</span></div>
        <div class="v3d-kv"><span>Zones</span><span>${zones.size}</span></div>
        <div class="v3d-kv"><span>Total locations</span><span>${totalLoc}</span></div>
        <div class="v3d-kv"><span>Lights assigned</span><span>${totalLights}</span></div>
      </div>
      <div class="v3d-side__row"><div style="display:flex;flex-wrap:wrap;gap:6px;">${catList}</div></div>`;
  }
  actsEl.hidden = false;
}

function renderEquipPanel(instanceId) {
  let entry = null, inst = null;
  for (const e of state.roomEquipment) {
    const i = (e.instances || []).find(x => x.instanceId === instanceId);
    if (i) { entry = e; inst = i; break; }
  }
  if (!entry || !inst) { renderFarmSummary(); return; }
  const m = catMeta(entry.category);
  const room = state.rooms.find(r => r.id === inst.roomId);
  const specEntries = Object.entries(entry.specs || {}).filter(([, v]) => v != null && v !== 0);
  $('v3dSideTitle').textContent = entry.model;
  $('v3dSideCount').textContent = entry.category;
  $('v3dSideActions').hidden = true;
  $('v3dSideBody').innerHTML = `
    <div class="v3d-equip-card">
      <span class="v3d-equip-card__cat-badge" style="background:${m.bg};">${m.icon} ${escapeHtml(entry.category)}</span>
      <div class="v3d-side__row">
        <div class="v3d-kv"><span>Vendor</span><span>${escapeHtml(entry.vendor !== '_generic' ? entry.vendor : 'Generic')}</span></div>
        <div class="v3d-kv"><span>Model</span><span>${escapeHtml(entry.model)}</span></div>
        <div class="v3d-kv"><span>Instance</span><span style="font-size:10px;color:var(--v3d-muted);">${escapeHtml(inst.instanceId)}</span></div>
        <div class="v3d-kv"><span>Room</span><span>${escapeHtml(room?.name || inst.roomId || 'unplaced')}</span></div>
        <div class="v3d-kv"><span>Zone</span><span>${escapeHtml(String(inst.zone ?? 'unassigned'))}</span></div>
        <div class="v3d-kv"><span>Position</span><span>${inst.x_m != null ? `${inst.x_m}, ${inst.z_m} m` : 'not placed'}</span></div>
      </div>
      ${specEntries.length ? `<div class="v3d-side__row">
        <div class="v3d-side__section-title">Specs</div>
        ${specEntries.map(([k, v]) => `<div class="v3d-kv"><span>${escapeHtml(SPEC_LABELS[k] || k)}</span><span>${escapeHtml(String(v))}</span></div>`).join('')}
      </div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
        <button class="v3d-btn" style="font-size:12px;padding:5px 10px;" data-equip-action="place" data-equip-id="${escapeHtml(entry.id)}" data-inst-id="${escapeHtml(inst.instanceId)}">Re-place</button>
        <button class="v3d-btn" style="font-size:12px;padding:5px 10px;" data-equip-action="print" data-inst-id="${escapeHtml(inst.instanceId)}">Print QR</button>
        <button class="v3d-btn v3d-btn--danger" style="font-size:12px;padding:5px 10px;" data-equip-action="delete" data-equip-id="${escapeHtml(entry.id)}" data-inst-id="${escapeHtml(inst.instanceId)}">Delete</button>
      </div>
    </div>`;
  $('v3dSideBody').querySelectorAll('[data-equip-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.equipAction;
      if (action === 'place') { activateInstancePlacement(btn.dataset.equipId, btn.dataset.instId); return; }
      if (action === 'print') { window.open(`/api/qr-generator/generate-equipment?instanceId=${encodeURIComponent(btn.dataset.instId)}`, '_blank', 'noopener'); return; }
      if (action === 'delete') {
        if (!confirm(`Delete this instance (${btn.dataset.instId})?`)) return;
        const eid = btn.dataset.equipId, iid = btn.dataset.instId;
        const entryIdx = state.roomEquipment.findIndex(e => e.id === eid);
        if (entryIdx === -1) return;
        state.roomEquipment[entryIdx].instances = state.roomEquipment[entryIdx].instances.filter(i => i.instanceId !== iid);
        if (!state.roomEquipment[entryIdx].instances.length) state.roomEquipment.splice(entryIdx, 1);
        state.selection.clear();
        await saveRoomEquipment({ msg: 'Instance deleted' });
        buildScene(); renderFarmSummary();
      }
    });
  });
}

function renderSidePanel() {
  const ids = Array.from(state.selection);
  if (ids.length) {
    const selectedEquip   = ids.filter(id => state.meshIndex.get(id)?.userData?.kind === 'room-equipment');
    const selectedDevices = ids.map(id => state.devices.find(d => d.id === id)).filter(Boolean);
    const selectedGroups  = ids.map(id => state.groups.find(g => g.id === id)).filter(Boolean);
    if (selectedEquip.length && !selectedDevices.length && !selectedGroups.length) { renderEquipPanel(selectedEquip[0]); return; }
    if (selectedDevices.length && !selectedGroups.length) { renderDevicePanel(selectedDevices); return; }
    if (selectedGroups.length) { renderGroupPanel(ids.filter(id => state.groups.find(g => g.id === id))); return; }
  }
  if (state.zoneSelection) { renderZonePanel(state.zoneSelection); return; }
  if (state.roomSelection) { renderRoomPanel(state.roomSelection); return; }
  renderFarmSummary();
}

$('v3dSideActions').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const ids = Array.from(state.selection);
  if (!ids.length) { toast('Select at least one system first'); return; }
  if (action === 'open-grow') { window.open('/views/grow-management.html#flow-grow-units', '_blank', 'noopener'); return; }
  if (action === 'calibrate') { window.open(`/views/calibration.html?groupIds=${encodeURIComponent(ids.join(','))}`, '_blank', 'noopener'); return; }
  if (action === 'assign-light' || action === 'assign-controller') {
    const target = window.prompt(`Enter ${action === 'assign-light' ? 'light fixture id' : 'controller id'} to assign to ${ids.length} system(s):`);
    if (!target) return;
    try {
      const r = await authFetch('/api/zones/bulk-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, groupIds: ids, targetId: target }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast(`${action} applied to ${ids.length} system(s)`);
      await loadData(); buildScene(); renderSidePanel();
    } catch (err) {
      console.error('[v3d] bulk-assign failed', err);
      toast('Bulk assign failed: ' + (err.message || 'unknown'));
    }
  }
});

async function loadData() {
  const bust = '?_=' + Date.now();
  const urls = [
    '/data/rooms.json' + bust,
    '/data/groups.json' + bust,
    '/data/grow-systems.json' + bust,
    '/data/env.json' + bust,
    '/data/iot-devices.json' + bust,
    '/data/room-equipment.json' + bust,
    '/data/equipment-kb.json' + bust,
  ];
  const results = await Promise.all(urls.map(u => authFetch(u, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null)));
  state.rooms = Array.isArray(results[0]) ? results[0] : (results[0]?.rooms || []);
  state.groups = Array.isArray(results[1]) ? results[1] : (results[1]?.groups || []);
  const gs = results[2];
  state.templates = gs && Array.isArray(gs.templates) ? gs.templates : (Array.isArray(gs) ? gs : []);
  state.env = results[3] && typeof results[3] === 'object' ? results[3] : { zones: [], rooms: {} };
  const devRaw = results[4];
  state.devices = Array.isArray(devRaw) ? devRaw : (devRaw?.devices || []);
  state.roomEquipment = Array.isArray(results[5]) ? results[5] : [];
  const kbRaw = results[6];
  if (kbRaw && Array.isArray(kbRaw.equipment)) state.equipmentKB = kbRaw;
  buildEnvIndex();
  $('v3dSubtitle').textContent = `${state.rooms.length} room(s), ${state.groups.length} system(s)`;
}

function updateStats() {
  const zones = state.rooms.reduce((s, r) => s + (r.zones?.length || 0), 0);
  $('v3dStats').textContent = `${state.rooms.length} rooms / ${zones} zones / ${state.groups.length} systems`;
}

function wireSSE() {
  let es = null; let debounce = null;
  const queueRefresh = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(async () => { await loadData(); buildScene(); renderSidePanel(); toast('Scene updated'); }, 300);
  };
  try {
    es = new EventSource('/events');
    ['data-change','rooms-updated','groups-updated','zones-updated','env-updated','sensors-updated','iot-devices'].forEach(evt => {
      es.addEventListener(evt, queueRefresh);
    });
    es.onerror = () => {};
    window.addEventListener('beforeunload', () => { try { es.close(); } catch (_) {} });
  } catch (_) {}
}

const _placeCancelBtn = $('v3dPlaceCancelBtn');
if (_placeCancelBtn) _placeCancelBtn.addEventListener('click', cancelPlacement);

const _addEquipBtn = $('v3dAddEquipBtn');
if (_addEquipBtn) _addEquipBtn.addEventListener('click', openEquipDrawer);
const _equipDrawerClose = $('v3dEquipDrawerClose');
if (_equipDrawerClose) _equipDrawerClose.addEventListener('click', closeEquipDrawer);
const _equipDrawerBack = $('v3dEquipDrawerBack');
if (_equipDrawerBack) _equipDrawerBack.addEventListener('click', () => {
  const d = state.equipDrawer;
  if (d.level === 'config') { d.level = 'model'; renderEquipDrawer(); }
  else if (d.level === 'model') { d.level = 'cat'; renderEquipDrawer(); }
  else closeEquipDrawer();
});
const _equipSaveBtn = $('v3dEquipSaveBtn');
if (_equipSaveBtn) _equipSaveBtn.addEventListener('click', confirmEquipConfig);

$('v3dFitBtn').addEventListener('click', fitView);
$('v3dGrowBtn').addEventListener('click', () => window.open('/views/grow-management.html', '_blank', 'noopener'));
const _shotBtn = $('v3dShotBtn');
if (_shotBtn) _shotBtn.addEventListener('click', () => {
  composer.render();
  const url = renderer.domElement.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `greenreach-farm-${Date.now()}.png`;
  a.click();
  toast('Screenshot saved');
});
document.querySelectorAll('.v3d-viewmode button').forEach(b => {
  b.addEventListener('click', () => setViewMode(b.dataset.view));
});
$('v3dEditBtn').addEventListener('click', () => {
  state.editMode = !state.editMode;
  $('v3dEditBtn').classList.toggle('active', state.editMode);
  canvas.classList.toggle('editing', state.editMode);
  toast(state.editMode ? 'Edit mode: drag anywhere in room — Rotate (R) or Delete (Del) selected' : 'Edit mode off');
});
$('v3dUndoBtn').addEventListener('click', () => undo());
$('v3dRedoBtn').addEventListener('click', () => redo());
$('v3dRotateBtn').addEventListener('click', () => rotateSelected());
$('v3dDeleteBtn').addEventListener('click', () => deleteSelected());
$('v3dHeatAutoBtn').addEventListener('click', () => {
  state.heatAutoScale = !state.heatAutoScale;
  applyHeatmap();
  toast(state.heatAutoScale ? 'Heatmap: auto-scale ON (relative range)' : 'Heatmap: fixed scale');
});
$('v3dWallsBtn').addEventListener('click', () => {
  state.showWalls = !state.showWalls;
  $('v3dWallsBtn').classList.toggle('active', state.showWalls);
  buildScene();
  toast(state.showWalls ? 'Walls: visible' : 'Walls: hidden');
});
$('v3dCeilingBtn').addEventListener('click', () => {
  state.showCeiling = !state.showCeiling;
  $('v3dCeilingBtn').classList.toggle('active', state.showCeiling);
  buildScene();
  toast(state.showCeiling ? 'Ceiling: visible' : 'Ceiling: hidden');
});
$('v3dHeatBtn').addEventListener('click', () => {
  state.heatmapOn = !state.heatmapOn;
  applyHeatmap();
  toast(state.heatmapOn ? `Heatmap: ${metricInfo(state.heatMetric).label}` : 'Heatmap off');
});
$('v3dHeatMetric').addEventListener('change', (e) => {
  state.heatMetric = e.target.value;
  applyHeatmap();
});

window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  bloomPass.setSize(w, h);
  outlinePass.setSize(w, h);
}, { passive: true });

window.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === 'Escape') {
    if (state.pendingPlacement) { cancelPlacement(); return; }
    state.selection.clear(); state.zoneSelection = null; state.roomSelection = null;
    applySelectionVisuals(); renderSidePanel();
  }
  if (e.key === 'e' || e.key === 'E') $('v3dEditBtn').click();
  if (e.key === 'w' || e.key === 'W') $('v3dWallsBtn').click();
  if (e.key === 'c' || e.key === 'C') $('v3dCeilingBtn').click();
  if (e.key === 'h' || e.key === 'H') $('v3dHeatBtn').click();
  if (e.key === 'r' || e.key === 'R') rotateSelected();
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.editMode) { e.preventDefault(); deleteSelected(); }
  if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); undo(); }
  if ((e.key === 'y' && (e.ctrlKey || e.metaKey)) || (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)) { e.preventDefault(); redo(); }
});

function tick(now) {
  if (camAnim && !camAnim(now)) {}
  controls.update();
  composer.render();
  requestAnimationFrame(tick);
}

(async function init() {
  try {
    await loadData();
    buildScene();
    fitView();
    renderSidePanel();
    pushHistory();
    updateHistoryButtons();
  } catch (err) {
    console.error('[v3d] init failed', err);
    toast('Failed to load farm data: ' + (err.message || 'unknown'));
  } finally {
    $('v3dLoading').classList.add('hide');
  }
  wireSSE();
  requestAnimationFrame(tick);
})();
