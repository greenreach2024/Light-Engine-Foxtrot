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
const fmt = (v, d=1) => Number.isFinite(v) ? Number(v).toFixed(d) : '--';
const $ = (id) => document.getElementById(id);
const authFetch = (window.authFetch || fetch.bind(window));

const state = {
  rooms: [],
  groups: [],
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
  showWalls: true,
  showCeiling: true,
  showSensors: true,
  walkwayMode: false,
  collapsedZoneSystems: new Set(),
  // Harvest readiness + crop pricing — populated by loadData() from
  // /api/harvest/predictions/all and /api/crop-pricing. The Light Engine
  // calculates readiness server-side; the viewer just displays it.
  harvestPredictions: new Map(), // groupId -> prediction
  cropPricing: new Map(),        // crop name (lowercased) -> pricing entry
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
  // User-facing convention: data field `length_m` is the room's depth
  // (longer axis, rendered along Z) and `width_m` is the side-to-side
  // axis (rendered along X). The renderer's L is the X extent and W is
  // the Z extent, so we swap here so the visual matches the user's
  // intent.
  const lenIn = Number(room.length_m ?? room.lengthM ?? room.dimensions?.length_m ?? room.dimensions?.lengthM);
  const widIn = Number(room.width_m ?? room.widthM ?? room.dimensions?.width_m ?? room.dimensions?.widthM);
  const H = Number(room.ceiling_height_m ?? room.ceilingHeightM ?? room.height_m ?? room.heightM ?? room.dimensions?.height_m ?? room.dimensions?.heightM ?? 3.2);
  if (!Number.isFinite(lenIn) || !Number.isFinite(widIn) || lenIn <= 0 || widIn <= 0) return null;
  return { L: widIn, W: lenIn, H };
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
  const sliceLen = dims.L / zones.length;
  return zones.map((z, i) => ({
    id: z.id, name: z.name || z.id,
    x_m: i * sliceLen, y_m: 0,
    length_m: sliceLen, width_m: dims.W,
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
  // Templates use either spatialContract.unitFootprintM.{length,width} or
  // top-level footprintM.{length,width}; tolerate older spatialContract
  // variants too.
  const sc = tpl?.spatialContract;
  const fp = tpl?.footprintM || sc?.unitFootprintM || sc?.footprint_m || null;
  if (fp) {
    const L = Number(fp.length ?? fp.length_m ?? fp.lengthM);
    const W = Number(fp.width ?? fp.width_m ?? fp.widthM);
    if (Number.isFinite(L) && Number.isFinite(W) && L > 0 && W > 0) {
      return { length_m: L, width_m: W };
    }
  }
  return { length_m: 1.5, width_m: 0.6 };
}

// Resolve the template's working-area / clearance (meters) so auto-layout
// respects the operator aisles documented on the grow management template
// card. Falls back to a conservative 0.25 m gap when no clearance is set.
function clearanceForGroup(group) {
  const tpl = templateById(group.templateId);
  const wc = tpl?.spatialContract?.workspaceClearanceM || tpl?.spatialContract?.workspace_clearance_m || {};
  const front = Number(wc.front) || 0;
  const back = Number(wc.back) || 0;
  const ends = Number(wc.ends) || 0;
  const minGap = 0.25;
  return {
    front, back, ends,
    pad: Math.max(minGap, front, back, ends),
    aisle: Math.max(minGap, front),
  };
}

// Walkway helpers ---------------------------------------------------------
function getRoomWalkways(room) {
  const list = Array.isArray(room?.walkways) ? room.walkways : [];
  return list.map(w => ({
    id: w.id || `walkway-${room.id}-${list.indexOf(w)}`,
    label: w.label || 'Walkway',
    x_m: Number(w.x_m ?? w.x ?? 0),
    y_m: Number(w.y_m ?? w.z_m ?? w.z ?? 0),
    length_m: Number(w.length_m ?? w.lengthM ?? 0),
    width_m: Number(w.width_m ?? w.widthM ?? 0),
  })).filter(w => w.length_m > 0 && w.width_m > 0);
}

function rectsOverlap(a, b, tol = 0.01) {
  return !(
    a.x_m + a.length_m <= b.x_m + tol ||
    b.x_m + b.length_m <= a.x_m + tol ||
    a.y_m + a.width_m  <= b.y_m + tol ||
    b.y_m + b.width_m  <= a.y_m + tol
  );
}

// Sensor icon factory: distinct cyan stem-and-bulb that reads as a sensor.
function makeSensorIcon(label) {
  const g = new THREE.Group();
  const matStem = new THREE.MeshStandardMaterial({ color: 0x67e8f9, roughness: 0.4, metalness: 0.3 });
  const matBulb = new THREE.MeshStandardMaterial({ color: 0xa5f3fc, emissive: 0x22d3ee, emissiveIntensity: 0.9, roughness: 0.25, metalness: 0.1 });
  const matBase = new THREE.MeshStandardMaterial({ color: 0x0f4f5e, roughness: 0.7, metalness: 0.3 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.06, 16), matBase);
  base.position.y = 0.03; base.castShadow = true; g.add(base);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.55, 12), matStem);
  stem.position.y = 0.30; g.add(stem);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.10, 18, 14), matBulb);
  bulb.position.y = 0.62; bulb.castShadow = true; g.add(bulb);
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.24, 32),
    new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.65, side: THREE.DoubleSide }));
  halo.rotation.x = -Math.PI / 2; halo.position.y = 0.005; g.add(halo);
  if (label) {
    const sp = makeLabelSprite('📡 ' + label);
    sp.position.set(0, 0.95, 0); sp.scale.multiplyScalar(0.55); g.add(sp);
  }
  return g;
}

// Walkway tile: subtle blue strip with directional hatching.
function makeWalkwayTile(walkway) {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#3b82f6'; ctx.globalAlpha = 0.18; ctx.fillRect(0, 0, 128, 64);
  ctx.globalAlpha = 0.6; ctx.strokeStyle = '#93c5fd'; ctx.lineWidth = 3;
  for (let x = -64; x < 192; x += 14) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 32, 64); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(Math.max(1, walkway.length_m), Math.max(1, walkway.width_m));
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.85, metalness: 0.0, transparent: true, opacity: 0.9 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(walkway.length_m, 0.03, walkway.width_m), mat);
  mesh.receiveShadow = true;
  return mesh;
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

// ---- harvest readiness + crop value helpers --------------------------------
// All readiness/value numbers are sourced from the Light Engine
// (/api/harvest/predictions/all + /api/crop-pricing). The viewer is
// purely a presentation layer for these fields.
function getGroupCrop(group) {
  if (!group) return '';
  const direct = group.crop || group.customization?.crop || '';
  if (direct) return String(direct);
  const pred = state.harvestPredictions.get(group.id);
  return pred?.crop ? String(pred.crop) : '';
}

function getGroupReadiness(group) {
  if (!group) return null;
  const pred = state.harvestPredictions.get(group.id);
  if (!pred || !pred.seedDate) return null;
  const seed = new Date(pred.seedDate);
  const harvest = pred.predictedDate ? new Date(pred.predictedDate) : null;
  if (!Number.isFinite(seed.getTime())) return null;
  const now = Date.now();
  const totalMs = harvest ? (harvest.getTime() - seed.getTime()) : null;
  const elapsedMs = now - seed.getTime();
  const dps = Math.max(0, Math.floor(elapsedMs / 86400000));
  const totalDays = totalMs ? Math.max(1, Math.round(totalMs / 86400000)) : null;
  let progressPct = null;
  if (totalDays) progressPct = Math.max(0, Math.min(1.05, elapsedMs / totalMs));
  const daysRemaining = Number.isFinite(pred.daysRemaining)
    ? pred.daysRemaining
    : (harvest ? Math.ceil((harvest.getTime() - now) / 86400000) : null);
  return {
    crop: pred.crop || getGroupCrop(group) || '',
    seedDate: pred.seedDate,
    predictedDate: pred.predictedDate || null,
    dps,
    totalDays,
    daysRemaining,
    progressPct,                                // 0..1+ (>1 means past predicted)
    overdue: daysRemaining != null && daysRemaining < 0,
    ready: daysRemaining != null && daysRemaining <= 0 && daysRemaining >= -3,
    confidence: pred.confidence || null,
  };
}

function getGroupValue(group, readiness) {
  if (!group) return null;
  const crop = (readiness?.crop || getGroupCrop(group) || '').trim();
  if (!crop) return null;
  const price = state.cropPricing.get(crop.toLowerCase());
  if (!price) return null;
  const c = group.customization || {};
  const units = Number(c.totalLocations) || Number(group.plants) || Number(group.trays) || 0;
  if (!units) return null;
  const retail = Number(price.retailPrice) || 0;
  if (!retail) return null;
  const fullValue = units * retail;
  const pct = readiness?.progressPct != null ? Math.max(0, Math.min(1, readiness.progressPct)) : 1;
  return {
    today: fullValue * pct,
    full: fullValue,
    units,
    unit: price.unit || 'unit',
    retailPrice: retail,
    currency: price.currency || 'CAD',
  };
}

// Map a 0..1 progress value to a readiness color.
// Stops: blue (just seeded) -> green (mid-veg) -> amber (approaching) ->
// hot orange (ready) -> red (overdue). Reuses the existing palette so the
// 3D viewer stays visually coherent with the env heatmap.
function readinessColor(pct) {
  if (!Number.isFinite(pct)) return null;
  return heatColor(pct, 0, 1);
}

// Replace the shared canopy material on every mesh under `meshGroup`
// with a per-group clone tinted to the readiness color. The original
// shared materials (matCanopy etc.) are never mutated.
function applyReadinessTint(meshGroup, readiness) {
  if (!meshGroup || !readiness || readiness.progressPct == null) return;
  const color = readinessColor(readiness.progressPct);
  if (!color) return;
  // Slight emissive boost when ready/overdue so the unit "glows" at harvest.
  const emissiveBoost = readiness.ready || readiness.overdue ? 0.35 : 0.10;
  const seen = new WeakMap();
  meshGroup.traverse((n) => {
    if (!n || !n.material) return;
    const mat = n.material;
    if (mat !== matCanopy) return;
    let cloned = seen.get(mat);
    if (!cloned) {
      cloned = mat.clone();
      cloned.color = color.clone();
      cloned.emissive = color.clone().multiplyScalar(0.3);
      cloned.emissiveIntensity = emissiveBoost;
      seen.set(mat, cloned);
    }
    n.material = cloned;
  });
}

// Floating label that identifies the crop and remaining days. Sized
// smaller than the room/zone labels so it doesn't overwhelm the scene.
function makeReadinessLabel(crop, readiness) {
  let text;
  if (readiness && readiness.daysRemaining != null) {
    if (readiness.overdue) text = `${crop || 'Crop'} · OVERDUE`;
    else if (readiness.ready) text = `${crop || 'Crop'} · READY`;
    else text = `${crop || 'Crop'} · ${readiness.daysRemaining}d`;
  } else if (crop) {
    text = crop;
  } else {
    return null;
  }
  const sp = makeLabelSprite(text);
  sp.scale.multiplyScalar(0.7);
  return sp;
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

    const floor = new THREE.Mesh(new THREE.BoxGeometry(dims.L, 0.05, dims.W), matFloor.clone());
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
      const mat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.85, metalness: 0, transparent: true, opacity: 0.55 });
      const zf = new THREE.Mesh(new THREE.BoxGeometry(zr.length_m, 0.02, zr.width_m), mat);
      zf.position.set(zr.x_m + zr.length_m/2, 0.01, zr.y_m + zr.width_m/2);
      zf.receiveShadow = true;
      zf.userData = { kind: 'zone', roomId: room.id, zoneId: zr.id, zoneName: zr.name, rect: zr, baseColor };
      roomGroup.add(zf);
      zoneFloors.set(zr.name, zr); zoneFloors.set(zr.id, zr);
      state.zoneFloorIndex.set(`${room.id}|${zr.name}`, zf);
      state.zoneFloorIndex.set(`${room.id}|${zr.id}`, zf);
      const zl = makeLabelSprite(zr.name);
      zl.position.set(zr.x_m + zr.length_m/2, 0.6, zr.y_m + zr.width_m/2);
      zl.scale.multiplyScalar(0.6); roomGroup.add(zl);
    });

    const roomGroups = state.groups.filter(g => groupInRoom(g, room));
    const buckets = new Map();
    roomGroups.forEach(gr => {
      const key = gr.zone || (zoneRects[0]?.name || 'default');
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(gr);
    });
    const walkways = getRoomWalkways(room);
    buckets.forEach((groupsArr, zoneKey) => {
      const zr = zoneFloors.get(zoneKey) || zoneRects[0];
      if (!zr) return;
      placeGroupsInZone(roomGroup, zr, groupsArr, room, walkways);
    });

    // Render walkways on top of zone floors.
    walkways.forEach((w) => {
      const tile = makeWalkwayTile(w);
      tile.position.set(w.x_m + w.length_m / 2, 0.018, w.y_m + w.width_m / 2);
      tile.userData = { kind: 'walkway', roomId: room.id, walkway: w };
      tile.name = `walkway:${w.id}`;
      roomGroup.add(tile);
      const lbl = makeLabelSprite(w.label || 'Walkway');
      lbl.position.set(tile.position.x, 0.55, tile.position.z);
      lbl.scale.multiplyScalar(0.55);
      roomGroup.add(lbl);
    });

    // Render sensors as distinct icons; pickable in edit mode.
    if (state.showSensors) {
      buildSensorsForRoom(roomGroup, room, zoneRects);
    }

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

function placeGroupsInZone(roomGroup, zr, groupsArr, room, walkways = []) {
  if (!groupsArr.length) return;
  const items = groupsArr.map(g => ({
    group: g,
    fp: groupFootprintM(g),
    clearance: clearanceForGroup(g),
  }));
  // Per-group padding comes from each template's workspaceClearanceM
  // (front aisle is the dominant constraint for picking access).
  const minPad = items.reduce((m, it) => Math.max(m, it.clearance.pad), 0.25);
  let cursorX = zr.x_m + minPad;
  let cursorY = zr.y_m + minPad;
  let rowMaxW = 0;
  const maxX = zr.x_m + zr.length_m - minPad;
  const maxY = zr.y_m + zr.width_m - minPad;
  let ralBudget = state.viewMode === 'top' ? 0 : MAX_RAL_PER_ZONE;

  // Treat walkways as occupied space for auto-layout: a candidate footprint
  // overlapping any walkway gets pushed to the next slot.
  const walkwayRects = walkways.map(w => ({
    x_m: w.x_m, y_m: w.y_m, length_m: w.length_m, width_m: w.width_m,
  }));
  const placed = []; // rects of items already placed (avoid overlap among groups too)
  const tryPlace = (L, W, startX, startY) => {
    let cx = startX, cy = startY, rmx = 0;
    let attempts = 0;
    while (attempts++ < 400) {
      if (cx + L > maxX) {
        cx = zr.x_m + minPad;
        cy += rmx + minPad;
        rmx = 0;
      }
      if (cy + W > maxY) return null;
      const cand = { x_m: cx, y_m: cy, length_m: L, width_m: W };
      const blocked = walkwayRects.some(w => rectsOverlap(cand, w))
        || placed.some(p => rectsOverlap(cand, p));
      if (!blocked) {
        return { x: cx + L / 2, y: cy + W / 2, rect: cand, nextX: cx + L + minPad, nextY: cy, rowMax: Math.max(rmx, W) };
      }
      cx += 0.10; // slide right and try again
    }
    return null;
  };

  items.forEach(({ group, fp }) => {
    let L = fp.length_m, W = fp.width_m, rotate = false;
    let posX, posY;
    const placement = group.customization?.placement;
    const hasPlacement = placement && Number.isFinite(Number(placement.x_m)) && Number.isFinite(Number(placement.z_m));
    if (hasPlacement) {
      rotate = !!placement.rotated;
      if (rotate) { L = fp.width_m; W = fp.length_m; }
      posX = Math.max(zr.x_m + L / 2, Math.min(zr.x_m + zr.length_m - L / 2, Number(placement.x_m)));
      posY = Math.max(zr.y_m + W / 2, Math.min(zr.y_m + zr.width_m - W / 2, Number(placement.z_m)));
      placed.push({ x_m: posX - L / 2, y_m: posY - W / 2, length_m: L, width_m: W });
    } else {
      // Try the natural orientation first; if blocked everywhere, rotate.
      let result = tryPlace(L, W, cursorX, cursorY);
      if (!result && fp.length_m !== fp.width_m) {
        L = fp.width_m; W = fp.length_m; rotate = true;
        result = tryPlace(L, W, cursorX, cursorY);
      }
      if (!result) return; // skip placement when nothing fits (e.g. walkways consume zone)
      posX = result.x; posY = result.y;
      placed.push(result.rect);
      cursorX = result.nextX;
      cursorY = result.rect.y_m;
      rowMaxW = result.rowMax;
    }
    const built = buildEquipmentForGroup(group);
    const mesh = built.mesh;
    mesh.position.set(posX, 0, posY);
    if (rotate) mesh.rotation.y = Math.PI / 2;
    mesh.userData = { kind: 'group', id: group.id, group, footprint: built.footprint, rotate, height: built.height || 1.5, roomId: room.id, zoneRect: zr };
    mesh.name = `group:${group.id}`;
    // Tint canopy by % of harvest progress + add a small floating crop /
    // countdown label so units are identifiable from camera distance.
    const readiness = getGroupReadiness(group);
    applyReadinessTint(mesh, readiness);
    const cropName = getGroupCrop(group);
    const lbl = makeReadinessLabel(cropName, readiness);
    if (lbl) {
      const lblY = (built.height || 1.5) + 0.35;
      lbl.position.set(posX, lblY, posY);
      lbl.userData = { kind: 'groupLabel', groupId: group.id };
      roomGroup.add(lbl);
    }
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

// Render sensors per room from env data + rooms.json placements.
function buildSensorsForRoom(roomGroup, room, zoneRects) {
  const placements = room?.sensors?.placements || {};
  const placedById = new Map();
  Object.entries(placements).forEach(([id, p]) => {
    if (!p) return;
    const x = Number(p.x_m ?? p.x); const z = Number(p.z_m ?? p.y_m ?? p.z);
    if (Number.isFinite(x) && Number.isFinite(z)) placedById.set(String(id), { x_m: x, z_m: z, name: p.name });
  });
  const zones = Array.isArray(state.env?.zones) ? state.env.zones : [];
  const seen = new Set();
  const collect = (deviceId, name, zr, fallback) => {
    const key = String(deviceId || name || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    let placed = placedById.get(key);
    let x, z;
    if (placed) { x = placed.x_m; z = placed.z_m; }
    else if (fallback) { x = fallback.x; z = fallback.z; }
    else if (zr) { x = zr.x_m + zr.length_m / 2; z = zr.y_m + zr.width_m / 2; }
    else return;
    const icon = makeSensorIcon(name || key);
    icon.position.set(x, 0, z);
    icon.userData = {
      kind: 'sensor',
      id: key,
      sensorId: key,
      name: name || key,
      roomId: room.id,
      zoneId: zr?.id,
      zoneName: zr?.name,
      footprint: { length_m: 0.4, width_m: 0.4 },
      zoneRect: zr || { x_m: 0, y_m: 0, length_m: 99, width_m: 99 },
      height: 0.7,
    };
    icon.name = `sensor:${key}`;
    roomGroup.add(icon);
  };

  zones.forEach(z => {
    const zr = zoneRects.find(r => r.id === z.id || r.name === z.name)
      || (z.location && zoneRects.find(r => r.id === z.location || r.name === z.location));
    if (!zr) return;
    const sourceMaps = [
      z.sensors?.tempC?.sources,
      z.sensors?.rh?.sources,
      z.sensorDevices,
    ].filter(Boolean);
    const all = {};
    sourceMaps.forEach(m => Object.entries(m).forEach(([k, v]) => { all[k] = v; }));
    const ids = Object.keys(all);
    ids.forEach((id, idx) => {
      const src = all[id] || {};
      const cols = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
      const rows = Math.max(1, Math.ceil(ids.length / cols));
      const ix = idx % cols; const iy = Math.floor(idx / cols);
      const fallback = {
        x: zr.x_m + (ix + 0.5) * (zr.length_m / cols),
        z: zr.y_m + (iy + 0.5) * (zr.width_m / rows),
      };
      collect(src.deviceId || id, src.name || src.deviceId || id, zr, fallback);
    });
  });
}

// Build a per-room canvas texture using inverse-distance weighting from
// every available sensor reading in the room so the heatmap shows a true
// gradient between sensor points instead of flat per-zone colors.
function makeRoomHeatmapTexture(room, zoneRects, metric) {
  const dims = readRoomDims(room);
  if (!dims) return null;
  const mi = metricInfo(metric);
  const probes = [];
  zoneRects.forEach(zr => {
    const env = envForZone(room.id, zr.name) || envForZone(room.id, zr.id);
    if (!env) return;
    const sources = env.sensors?.[metric]?.sources || env.sensorDevices || {};
    const valid = Object.values(sources).filter(s => Number.isFinite(Number(s.current)));
    if (valid.length > 1) {
      const cols = Math.max(1, Math.ceil(Math.sqrt(valid.length)));
      const rows = Math.max(1, Math.ceil(valid.length / cols));
      valid.forEach((s, i) => {
        const ix = i % cols; const iy = Math.floor(i / cols);
        // Sensor X maps to room X (renderer length, dims.L). Map to canvas U.
        probes.push({
          u: (zr.x_m + (ix + 0.5) * (zr.length_m / cols)) / dims.L,
          v: (zr.y_m + (iy + 0.5) * (zr.width_m / rows)) / dims.W,
          val: Number(s.current),
        });
      });
    } else {
      const v = Number(env.sensors?.[metric]?.current);
      if (Number.isFinite(v)) {
        probes.push({
          u: (zr.x_m + zr.length_m / 2) / dims.L,
          v: (zr.y_m + zr.width_m / 2) / dims.W,
          val: v,
        });
      }
    }
  });
  if (!probes.length) return null;
  const W = 96, H = 96;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const power = 3;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const u = px / (W - 1);
      const vv = py / (H - 1);
      let num = 0, den = 0;
      for (const p of probes) {
        const dx = u - p.u, dy = vv - p.v;
        const d2 = dx * dx + dy * dy;
        if (d2 < 1e-6) { num = p.val; den = 1; break; }
        const w = 1 / Math.pow(d2, power / 2);
        num += w * p.val; den += w;
      }
      const interp = num / den;
      const c = heatColor(interp, mi.lo, mi.hi);
      const idx = (py * W + px) * 4;
      img.data[idx]     = Math.round(c.r * 255);
      img.data[idx + 1] = Math.round(c.g * 255);
      img.data[idx + 2] = Math.round(c.b * 255);
      img.data[idx + 3] = 215;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function applyHeatmap() {
  const on = state.heatmapOn;
  const metric = state.heatMetric;
  const mi = metricInfo(metric);
  // Reset zone floors: when heatmap is on, fade them out so the room-floor
  // gradient texture is visible underneath; when off, restore base color.
  const seen = new Set();
  state.zoneFloorIndex.forEach((mesh) => {
    if (seen.has(mesh.uuid)) return;
    seen.add(mesh.uuid);
    const ud = mesh.userData; if (!ud) return;
    if (mesh.material.map) { mesh.material.map = null; mesh.material.needsUpdate = true; }
    if (!on) {
      mesh.material.color.setHex(ud.baseColor || 0x153e2e);
      mesh.material.opacity = 0.55;
      if (mesh.material.emissive) mesh.material.emissive.setHex(0x000000);
    } else {
      mesh.material.opacity = 0.0;
      if (mesh.material.emissive) mesh.material.emissive.setHex(0x000000);
    }
  });
  state.roomFloorIndex.forEach((mesh, roomId) => {
    if (mesh.material.map) { mesh.material.map.dispose?.(); mesh.material.map = null; }
    if (!on) {
      mesh.material.color.setHex(0xc9d4dc);
      mesh.material.needsUpdate = true;
      return;
    }
    const room = state.rooms.find(r => r.id === roomId);
    if (!room) return;
    const zoneRects = getZoneRects(room);
    const tex = makeRoomHeatmapTexture(room, zoneRects, metric);
    if (tex) {
      mesh.material.map = tex;
      mesh.material.color.setHex(0xffffff);
    } else {
      mesh.material.color.setHex(0x223044);
    }
    mesh.material.needsUpdate = true;
  });
  $('v3dHeatLo').textContent = `${mi.lo} ${mi.unit}`;
  $('v3dHeatHi').textContent = `${mi.hi} ${mi.unit}`;
  $('v3dHeatKey').classList.toggle('show', on);
  $('v3dHeatMode').classList.toggle('show', on);
  $('v3dHeatBtn').classList.toggle('active', on);
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
function clampPosToZone(mesh, x, z) {
  const ud = mesh.userData; const zr = ud.zoneRect; if (!zr) return { x, z };
  const fp = ud.footprint;
  const L = ud.rotate ? fp.width_m : fp.length_m;
  const W = ud.rotate ? fp.length_m : fp.width_m;
  return {
    x: Math.max(zr.x_m + L/2, Math.min(zr.x_m + zr.length_m - L/2, x)),
    z: Math.max(zr.y_m + W/2, Math.min(zr.y_m + zr.width_m - W/2, z)),
  };
}
function startDrag(targetMesh, startPoint) {
  const ud = targetMesh.userData || {};
  if (ud.kind === 'sensor') {
    drag.startMeshes = [{ mesh: targetMesh, startLocal: targetMesh.position.clone() }];
  } else {
    let ids = state.selection.has(ud.id) ? Array.from(state.selection) : [ud.id];
    drag.startMeshes = ids.map(id => state.meshIndex.get(id)).filter(Boolean).map(m => ({ mesh: m, startLocal: m.position.clone() }));
  }
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
    const c = clampPosToZone(mesh, tx, tz);
    mesh.position.set(c.x, 0, c.z);
    const room = mesh.parent;
    if (room) room.children.forEach(ch => {
      if (ch.userData?.kind === 'fixtureFor' && ch.userData.groupId === mesh.userData.id) {
        ch.position.set(c.x, 0, c.z);
      }
    });
  });
}
async function endDrag() {
  if (!drag.active) return;
  drag.active = false;
  controls.enabled = true; canvas.classList.remove('dragging');
  if (!drag.movedAtLeastOnce) { drag.startMeshes = []; return; }
  const groupChanges = [];
  const sensorChanges = []; // { roomId, sensorId, x_m, z_m }
  drag.startMeshes.forEach(({ mesh }) => {
    const ud = mesh.userData || {};
    if (ud.kind === 'sensor') {
      sensorChanges.push({ roomId: ud.roomId, sensorId: ud.sensorId || ud.id, name: ud.name, x_m: mesh.position.x, z_m: mesh.position.z });
      return;
    }
    const id = ud.id;
    const g = state.groups.find(gg => gg.id === id);
    if (!g) return;
    g.customization = g.customization || {};
    g.customization.placement = { x_m: mesh.position.x, z_m: mesh.position.z, rotated: !!ud.rotate };
    groupChanges.push(g);
  });
  try {
    if (groupChanges.length) {
      const r = await authFetch('/data/groups.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.groups),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    }
    if (sensorChanges.length) {
      sensorChanges.forEach(c => {
        const room = state.rooms.find(r => r.id === c.roomId);
        if (!room) return;
        room.sensors = room.sensors || { categories: [], placements: {} };
        room.sensors.placements = room.sensors.placements || {};
        room.sensors.placements[c.sensorId] = { x_m: Number(c.x_m.toFixed(3)), z_m: Number(c.z_m.toFixed(3)), name: c.name };
      });
      const r2 = await authFetch('/data/rooms.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rooms: state.rooms }),
      });
      if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
    }
    const total = groupChanges.length + sensorChanges.length;
    toast(`Saved ${total} item(s)`);
  } catch (err) {
    console.error('[v3d] save layout failed', err);
    toast('Save failed: ' + (err.message || 'unknown'));
  } finally {
    drag.startMeshes = [];
  }
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

// Walkway placement state. When state.walkwayMode is on, a click+drag on
// any room floor draws a preview rectangle and saves a walkway record on
// the host room when the pointer is released.
const walkwayDraw = {
  active: false,
  pointerId: null,
  roomGroup: null,
  roomId: null,
  startLocal: null,
  curLocal: null,
  preview: null,
};

function pickFloorPoint(clientX, clientY) {
  const hit = pickFirstByKind(clientX, clientY, ['room']);
  if (!hit) return null;
  const node = hit.node;
  // Walk up to the room group whose userData kind is 'roomGroup'.
  let rg = node.parent;
  while (rg && rg.userData?.kind !== 'roomGroup') rg = rg.parent;
  if (!rg) return null;
  const local = rg.worldToLocal(hit.point.clone());
  return { roomGroup: rg, roomId: rg.userData.id, point: hit.point.clone(), local };
}

function clampToRoom(rg, x, z) {
  const dims = rg.userData?.dims; if (!dims) return { x, z };
  return {
    x: Math.max(0, Math.min(dims.L, x)),
    z: Math.max(0, Math.min(dims.W, z)),
  };
}

function startWalkwayDraw(e) {
  const hit = pickFloorPoint(e.clientX, e.clientY);
  if (!hit) return false;
  walkwayDraw.active = true;
  walkwayDraw.pointerId = e.pointerId;
  walkwayDraw.roomGroup = hit.roomGroup;
  walkwayDraw.roomId = hit.roomId;
  const c = clampToRoom(hit.roomGroup, hit.local.x, hit.local.z);
  walkwayDraw.startLocal = { x: c.x, z: c.z };
  walkwayDraw.curLocal = { x: c.x, z: c.z };
  // Preview mesh updated on move.
  const geom = new THREE.BoxGeometry(0.1, 0.04, 0.1);
  const mat = new THREE.MeshBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.55 });
  walkwayDraw.preview = new THREE.Mesh(geom, mat);
  walkwayDraw.preview.position.set(c.x, 0.025, c.z);
  hit.roomGroup.add(walkwayDraw.preview);
  controls.enabled = false;
  canvas.setPointerCapture(e.pointerId);
  return true;
}

function updateWalkwayDraw(e) {
  if (!walkwayDraw.active || !walkwayDraw.preview) return;
  setNdcFrom(e.clientX, e.clientY);
  raycaster.setFromCamera(ndc, camera);
  const planeHit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), planeHit)) return;
  const local = walkwayDraw.roomGroup.worldToLocal(planeHit.clone());
  const c = clampToRoom(walkwayDraw.roomGroup, local.x, local.z);
  walkwayDraw.curLocal = { x: c.x, z: c.z };
  const sx = walkwayDraw.startLocal.x, sz = walkwayDraw.startLocal.z;
  const minX = Math.min(sx, c.x), maxX = Math.max(sx, c.x);
  const minZ = Math.min(sz, c.z), maxZ = Math.max(sz, c.z);
  const w = Math.max(0.05, maxX - minX);
  const h = Math.max(0.05, maxZ - minZ);
  walkwayDraw.preview.geometry.dispose();
  walkwayDraw.preview.geometry = new THREE.BoxGeometry(w, 0.04, h);
  walkwayDraw.preview.position.set((minX + maxX) / 2, 0.022, (minZ + maxZ) / 2);
}

async function endWalkwayDraw(e) {
  if (!walkwayDraw.active) return;
  const rg = walkwayDraw.roomGroup;
  const roomId = walkwayDraw.roomId;
  const sx = walkwayDraw.startLocal?.x, sz = walkwayDraw.startLocal?.z;
  const ex = walkwayDraw.curLocal?.x, ez = walkwayDraw.curLocal?.z;
  // Cleanup
  if (walkwayDraw.preview) {
    rg.remove(walkwayDraw.preview);
    walkwayDraw.preview.geometry?.dispose();
    walkwayDraw.preview.material?.dispose();
  }
  try { canvas.releasePointerCapture(walkwayDraw.pointerId); } catch (_) {}
  walkwayDraw.active = false;
  walkwayDraw.pointerId = null;
  walkwayDraw.roomGroup = null;
  walkwayDraw.preview = null;
  controls.enabled = true;
  if (!Number.isFinite(sx) || !Number.isFinite(ex)) return;
  const minX = Math.min(sx, ex), maxX = Math.max(sx, ex);
  const minZ = Math.min(sz, ez), maxZ = Math.max(sz, ez);
  const length_m = maxX - minX;
  const width_m = maxZ - minZ;
  if (length_m < 0.30 || width_m < 0.30) {
    toast('Walkway too small (drag a larger rectangle)');
    return;
  }
  const room = state.rooms.find(r => r.id === roomId);
  if (!room) return;
  room.walkways = Array.isArray(room.walkways) ? room.walkways : [];
  const walkway = {
    id: `walkway-${Date.now().toString(36)}`,
    label: `Walkway ${room.walkways.length + 1}`,
    x_m: Number(minX.toFixed(3)),
    y_m: Number(minZ.toFixed(3)),
    length_m: Number(length_m.toFixed(3)),
    width_m: Number(width_m.toFixed(3)),
  };
  room.walkways.push(walkway);
  buildScene();
  renderSidePanel();
  try {
    const r = await authFetch('/data/rooms.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rooms: state.rooms }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    toast(`Walkway saved (${fmt(length_m, 1)}x${fmt(width_m, 1)} m); equipment re-laid out`);
  } catch (err) {
    console.error('[v3d] walkway save failed', err);
    toast('Walkway placed locally; save failed: ' + (err.message || 'unknown'));
  }
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (state.walkwayMode) {
    if (startWalkwayDraw(e)) return;
  }
  const groupHit = pickFirstByKind(e.clientX, e.clientY, ['group', 'sensor']);
  pointerDownAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  if (state.editMode && groupHit) {
    canvas.setPointerCapture(e.pointerId); drag.pointerId = e.pointerId;
    startDrag(groupHit.node, groupHit.point); return;
  }
  // Marquee selection only on shift+click (empty space)
  if (!groupHit && e.shiftKey) {
    canvas.setPointerCapture(e.pointerId); drag.pointerId = e.pointerId;
    marqueeBegin(e.clientX, e.clientY);
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (walkwayDraw.active) { updateWalkwayDraw(e); return; }
  if (drag.active) { updateDrag(e.clientX, e.clientY); return; }
  if (marquee.active) { marquee.curX = e.clientX; marquee.curY = e.clientY; marqueeUpdateBox(); }
});
canvas.addEventListener('pointerup', (e) => {
  if (walkwayDraw.active && walkwayDraw.pointerId === e.pointerId) {
    endWalkwayDraw(e); return;
  }
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
  if (walkwayDraw.active) {
    if (walkwayDraw.preview && walkwayDraw.roomGroup) {
      walkwayDraw.roomGroup.remove(walkwayDraw.preview);
      walkwayDraw.preview.geometry?.dispose();
      walkwayDraw.preview.material?.dispose();
    }
    walkwayDraw.active = false;
    walkwayDraw.preview = null;
    controls.enabled = true;
  }
  if (drag.active) { drag.active = false; controls.enabled = true; canvas.classList.remove('dragging'); }
  if (marquee.active) { marquee.active = false; if (marquee.el) marquee.el.style.display='none'; controls.enabled = true; }
});

let _hoverMesh = null;
canvas.addEventListener('pointermove', (e) => {
  if (drag.active || marquee.active) return;
  const hit = pickFirstByKind(e.clientX, e.clientY, ['group']);
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
  const groupHit = pickFirstByKind(e.clientX, e.clientY, ['group']);
  if (groupHit) {
    const id = groupHit.node.userData.id;
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
  const groupHit = pickFirstByKind(e.clientX, e.clientY, ['group']);
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
    const dimStr = dims ? `${fmt(dims.L,1)} x ${fmt(dims.W,1)} x ${fmt(dims.H,1)} m  (${fmt(dims.L*M_TO_FT,0)} x ${fmt(dims.W*M_TO_FT,0)} ft)` : 'no dims';
    const area = dims ? `${fmt(dims.L * dims.W, 1)} m^2` : '--';
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
  bodyEl.innerHTML = `
    <div class="v3d-side__row">
      <div class="v3d-kv"><span>Total rooms</span><span>${state.rooms.length}</span></div>
      <div class="v3d-kv"><span>Total zones</span><span>${totalZones}</span></div>
      <div class="v3d-kv"><span>Total systems</span><span>${totalGroups}</span></div>
      <div class="v3d-kv"><span>Total locations</span><span>${totalLocations}</span></div>
    </div>
    <div class="v3d-side__section-title">Rooms</div>
    <div class="v3d-room-list">${cards}</div>
    <div class="v3d-empty" style="padding:12px 4px;">Click a room floor, zone, or growing system to inspect. Shift-click adds to selection. Drag empty space for marquee. Toggle Edit to drag systems.</div>
  `;
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
  const dimStr = dims ? `${fmt(dims.L,2)} x ${fmt(dims.W,2)} x ${fmt(dims.H,2)} m` : '--';
  const ftStr = dims ? `${fmt(dims.L*M_TO_FT,1)} x ${fmt(dims.W*M_TO_FT,1)} x ${fmt(dims.H*M_TO_FT,1)} ft` : '--';
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
      <div class="v3d-kv"><span>Floor area</span><span>${dims ? fmt(dims.L*dims.W,1) + ' m^2' : '--'}</span></div>
      <div class="v3d-kv"><span>Volume</span><span>${dims ? fmt(dims.L*dims.W*dims.H,1) + ' m^3' : '--'}</span></div>
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
    const readiness = getGroupReadiness(g);
    const cropName = getGroupCrop(g);
    const value = getGroupValue(g, readiness);
    const fmtDate = (iso) => {
      if (!iso) return '—';
      try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
      catch { return '—'; }
    };
    const fmtMoney = (n, cur = 'CAD') => {
      if (!Number.isFinite(n)) return '—';
      try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(n); }
      catch { return `$${n.toFixed(2)}`; }
    };
    let countdownText = '—';
    let readinessTag = '';
    if (readiness && readiness.daysRemaining != null) {
      if (readiness.overdue) {
        countdownText = `OVERDUE by ${Math.abs(readiness.daysRemaining)}d`;
        readinessTag = `<span class="v3d-tag" style="background:#5a1414;color:#ffb4b4;">Overdue</span>`;
      } else if (readiness.ready) {
        countdownText = `Ready (${readiness.daysRemaining}d)`;
        readinessTag = `<span class="v3d-tag" style="background:#3b2a08;color:#ffd089;">Ready</span>`;
      } else {
        countdownText = `${readiness.daysRemaining}d remaining`;
      }
    }
    const pctNum = readiness && readiness.progressPct != null
      ? Math.round(Math.max(0, Math.min(1, readiness.progressPct)) * 100)
      : null;
    const barColor = readiness && readiness.progressPct != null
      ? '#' + readinessColor(readiness.progressPct).getHexString()
      : '#3a4a60';
    const progressBlock = pctNum != null
      ? `<div class="v3d-kv"><span>Progress</span><span>${pctNum}%</span></div>
         <div style="height:6px;background:#1a2533;border-radius:4px;overflow:hidden;margin-top:4px;">
           <div style="width:${pctNum}%;height:100%;background:${barColor};"></div>
         </div>`
      : '';
    const harvestBlock = (cropName || readiness)
      ? `<div class="v3d-side__row">
           <div class="v3d-side__section-title">Harvest readiness</div>
           <div class="v3d-kv"><span>Crop</span><span>${escapeHtml(cropName || '—')} ${readinessTag}</span></div>
           <div class="v3d-kv"><span>Seed date</span><span>${fmtDate(readiness?.seedDate)}</span></div>
           <div class="v3d-kv"><span>Predicted harvest</span><span>${fmtDate(readiness?.predictedDate)}</span></div>
           <div class="v3d-kv"><span>Countdown</span><span>${escapeHtml(countdownText)}</span></div>
           ${progressBlock}
           ${value ? `<div class="v3d-kv" style="margin-top:6px;"><span>Value today</span><span>${escapeHtml(fmtMoney(value.today, value.currency))}</span></div>
             <div class="v3d-kv"><span>Value at harvest</span><span>${escapeHtml(fmtMoney(value.full, value.currency))} <span style="opacity:.6;">(${value.units} ${escapeHtml(value.unit)})</span></span></div>` : ''}
         </div>`
      : '';
    bodyEl.innerHTML = `
      <div class="v3d-side__row">
        <div class="v3d-kv"><span>Room</span><span>${escapeHtml(g.room || '-')}${dims?` (${fmt(dims.L,1)}x${fmt(dims.W,1)}m)`:''}</span></div>
        <div class="v3d-kv"><span>Zone</span><span>${escapeHtml(g.zone || '-')}</span></div>
        <div class="v3d-kv"><span>Template</span><span>${escapeHtml(g.templateId || '-')}</span></div>
        <div class="v3d-kv"><span>Status</span><span><span class="v3d-tag ${g.status === 'active' ? 'v3d-tag--ok' : ''}">${escapeHtml(g.status || 'pending')}</span></span></div>
      </div>
      ${harvestBlock}
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

function renderSidePanel() {
  const ids = Array.from(state.selection);
  if (ids.length) { renderGroupPanel(ids); return; }
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
  const urls = ['/data/rooms.json' + bust, '/data/groups.json' + bust, '/data/grow-systems.json' + bust, '/data/env.json' + bust];
  const results = await Promise.all(urls.map(u => authFetch(u, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null)));
  state.rooms = Array.isArray(results[0]) ? results[0] : (results[0]?.rooms || []);
  state.groups = Array.isArray(results[1]) ? results[1] : (results[1]?.groups || []);
  const gs = results[2];
  state.templates = gs && Array.isArray(gs.templates) ? gs.templates : (Array.isArray(gs) ? gs : []);
  state.env = results[3] && typeof results[3] === 'object' ? results[3] : { zones: [], rooms: {} };
  buildEnvIndex();

  // Pull LE-side harvest predictions + crop pricing in parallel. These are
  // optional — the viewer renders normally if either endpoint is missing
  // (e.g. running offline against /data/*.json only).
  await Promise.all([
    authFetch('/api/harvest/predictions/all' + bust, { cache: 'no-store' })
      .then(r => r && r.ok ? r.json() : null)
      .then(d => {
        state.harvestPredictions.clear();
        const list = Array.isArray(d?.predictions) ? d.predictions : [];
        list.forEach(p => { if (p && p.groupId) state.harvestPredictions.set(p.groupId, p); });
      })
      .catch(() => { /* keep prior map */ }),
    authFetch('/api/crop-pricing' + bust, { cache: 'no-store' })
      .then(r => r && r.ok ? r.json() : null)
      .then(d => {
        state.cropPricing.clear();
        const crops = Array.isArray(d?.pricing?.crops) ? d.pricing.crops
          : (Array.isArray(d?.crops) ? d.crops : []);
        crops.forEach(c => {
          if (c && c.crop) state.cropPricing.set(String(c.crop).toLowerCase(), c);
        });
      })
      .catch(() => { /* keep prior map */ }),
  ]);

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
    ['data-change','rooms-updated','groups-updated','zones-updated','env-updated','sensors-updated'].forEach(evt => {
      es.addEventListener(evt, queueRefresh);
    });
    es.onerror = () => {};
    window.addEventListener('beforeunload', () => { try { es.close(); } catch (_) {} });
  } catch (_) {}
}

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
  toast(state.editMode ? 'Edit mode: drag systems to reposition' : 'Edit mode off');
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
const _sensorsBtn = $('v3dSensorsBtn');
if (_sensorsBtn) _sensorsBtn.addEventListener('click', () => {
  state.showSensors = !state.showSensors;
  _sensorsBtn.classList.toggle('active', state.showSensors);
  buildScene();
  toast(state.showSensors ? 'Sensors: visible' : 'Sensors: hidden');
});
const _walkwayBtn = $('v3dWalkwayBtn');
if (_walkwayBtn) _walkwayBtn.addEventListener('click', () => {
  state.walkwayMode = !state.walkwayMode;
  _walkwayBtn.classList.toggle('active', state.walkwayMode);
  canvas.classList.toggle('walkway-mode', state.walkwayMode);
  if (state.walkwayMode) {
    state.editMode = false;
    $('v3dEditBtn').classList.remove('active');
    canvas.classList.remove('editing');
    toast('Walkway mode: click and drag on a room floor to place a walkway');
  } else {
    toast('Walkway mode off');
  }
});
if (_sensorsBtn) _sensorsBtn.classList.toggle('active', state.showSensors);
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
    state.selection.clear(); state.zoneSelection = null; state.roomSelection = null;
    applySelectionVisuals(); renderSidePanel();
  }
  if (e.key === 'e' || e.key === 'E') $('v3dEditBtn').click();
  if (e.key === 'w' || e.key === 'W') $('v3dWallsBtn').click();
  if (e.key === 'c' || e.key === 'C') $('v3dCeilingBtn').click();
  if (e.key === 'h' || e.key === 'H') $('v3dHeatBtn').click();
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
  } catch (err) {
    console.error('[v3d] init failed', err);
    toast('Failed to load farm data: ' + (err.message || 'unknown'));
  } finally {
    $('v3dLoading').classList.add('hide');
  }
  wireSSE();
  requestAnimationFrame(tick);
})();
