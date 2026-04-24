// =====================================================================
// GreenReach 3D Farm Viewer v2 - cinematic HD rebuild
// =====================================================================
// Self-contained Three.js viewer. Pulls /data/rooms.json and
// /data/groups.json from LE (via Central proxy), partitions zones by
// equal-column slicing across the room footprint when zone geometry is
// missing, and packs each group's equipment mesh inside its zone using
// the persisted footprint dims.
//
// Live updates via /events SSE - the scene repaints automatically when
// the LE reconciler rewrites groups.json after a save-rooms call.
// =====================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const IN_TO_M = 0.0254;
const fmt = (v, d=1) => Number.isFinite(v) ? Number(v).toFixed(d) : '--';
const $ = (id) => document.getElementById(id);
const authFetch = (window.authFetch || fetch.bind(window));

const state = {
  rooms: [],
  groups: [],
  templates: [],
  selection: new Set(),
  meshIndex: new Map(),
  roomMeshes: [],
  viewMode: 'iso',
};

let toastTimer = null;
function toast(msg, ms=2200) {
  const el = $('v3dToast'); if (!el) return;
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ------- scene -------
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

// lights
scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x202830, 0.45));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(40, 60, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 200;
sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
sun.shadow.bias = -0.0005;
scene.add(sun);
const fill = new THREE.DirectionalLight(0x6ab1ff, 0.35);
fill.position.set(-30, 25, -20);
scene.add(fill);

// ground + grid
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

// shared materials
const matFloor = new THREE.MeshStandardMaterial({ color: 0xc9d4dc, roughness: 0.35, metalness: 0.05 });
const matWall = new THREE.MeshStandardMaterial({ color: 0x1a2433, roughness: 0.85, metalness: 0.0, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
const matWallTrim = new THREE.MeshStandardMaterial({ color: 0x2a3a52, roughness: 0.6, metalness: 0.1 });
const matCeilingFrame = new THREE.MeshStandardMaterial({ color: 0x394758, roughness: 0.55, metalness: 0.4 });
const zoneMats = [
  new THREE.MeshStandardMaterial({ color: 0x153e2e, roughness: 0.85, metalness: 0, transparent: true, opacity: 0.55 }),
  new THREE.MeshStandardMaterial({ color: 0x14334a, roughness: 0.85, metalness: 0, transparent: true, opacity: 0.55 }),
  new THREE.MeshStandardMaterial({ color: 0x3a2a16, roughness: 0.85, metalness: 0, transparent: true, opacity: 0.55 }),
];
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
  const L = Number(room.length_m ?? room.lengthM ?? room.dimensions?.length_m ?? room.dimensions?.lengthM);
  const W = Number(room.width_m ?? room.widthM ?? room.dimensions?.width_m ?? room.dimensions?.widthM);
  const H = Number(room.height_m ?? room.heightM ?? room.dimensions?.height_m ?? room.dimensions?.heightM ?? 3.2);
  if (!Number.isFinite(L) || !Number.isFinite(W) || L <= 0 || W <= 0) return null;
  return { L, W, H };
}

function getZoneRects(room) {
  const dims = readRoomDims(room);
  if (!dims) return [];
  const zones = Array.isArray(room.zones) ? room.zones : [];
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

function templateById(id) {
  return state.templates.find(t => t.id === id) || null;
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

// ------- equipment factories -------
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

function makeFixtureAbove(footprint, mountHeight, count=1) {
  const g = new THREE.Group();
  const cols = Math.max(1, Math.min(4, count));
  const span = footprint.length_m * 0.85;
  for (let i = 0; i < cols; i++) {
    const fixture = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(span / cols * 0.9, 0.08, footprint.width_m * 0.7), matFixtureBody);
    body.position.y = mountHeight + 0.45; body.castShadow = true; fixture.add(body);
    const lens = new THREE.Mesh(new THREE.BoxGeometry(span / cols * 0.86, 0.02, footprint.width_m * 0.66), matFixtureLens);
    lens.position.y = mountHeight + 0.41; fixture.add(lens);
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

function buildScene() {
  clearGroupChildren(farmRoot);
  state.meshIndex.clear();
  state.roomMeshes = [];

  let cursorX = 0;
  const gap = 2.0;
  state.rooms.forEach((room) => {
    const dims = readRoomDims(room);
    if (!dims) return;
    const roomGroup = new THREE.Group();
    roomGroup.name = `room:${room.id}`;
    roomGroup.userData = { kind: 'room', id: room.id, name: room.name };

    const floor = new THREE.Mesh(new THREE.BoxGeometry(dims.L, 0.05, dims.W), matFloor);
    floor.position.set(dims.L/2, -0.025, dims.W/2); floor.receiveShadow = true; roomGroup.add(floor);

    const wallT = 0.06;
    [
      [dims.L/2, dims.H/2, 0, dims.L, dims.H, wallT],
      [dims.L/2, dims.H/2, dims.W, dims.L, dims.H, wallT],
      [dims.L, dims.H/2, dims.W/2, wallT, dims.H, dims.W],
      [0, dims.H/2, dims.W/2, wallT, dims.H, dims.W],
    ].forEach(([x,y,z,sx,sy,sz]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), matWall);
      m.position.set(x, y, z); roomGroup.add(m);
    });

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

    const label = makeLabelSprite(room.name || room.id);
    label.position.set(dims.L/2, dims.H + 0.6, dims.W/2);
    roomGroup.add(label);

    const zoneRects = getZoneRects(room);
    const zoneFloors = new Map();
    zoneRects.forEach((zr, idx) => {
      const mat = zoneMats[idx % zoneMats.length];
      const zf = new THREE.Mesh(new THREE.BoxGeometry(zr.length_m, 0.02, zr.width_m), mat);
      zf.position.set(zr.x_m + zr.length_m/2, 0.01, zr.y_m + zr.width_m/2);
      zf.receiveShadow = true; roomGroup.add(zf);
      zoneFloors.set(zr.name, zr); zoneFloors.set(zr.id, zr);
      const zl = makeLabelSprite(zr.name);
      zl.position.set(zr.x_m + zr.length_m/2, 0.6, zr.y_m + zr.width_m/2);
      zl.scale.multiplyScalar(0.6); roomGroup.add(zl);
    });

    const roomGroups = state.groups.filter(g => g.room === room.name || g.room === room.id);
    const buckets = new Map();
    roomGroups.forEach(gr => {
      const key = gr.zone || (zoneRects[0]?.name || 'default');
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(gr);
    });
    buckets.forEach((groupsArr, zoneKey) => {
      const zr = zoneFloors.get(zoneKey) || zoneRects[0];
      if (!zr) return;
      placeGroupsInZone(roomGroup, zr, groupsArr);
    });

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

  fitView();
  applySelectionVisuals();
  updateStats();
}

function placeGroupsInZone(roomGroup, zr, groupsArr) {
  if (!groupsArr.length) return;
  const items = groupsArr.map(g => ({ group: g, fp: groupFootprintM(g) }));
  const padding = 0.25;
  let cursorX = zr.x_m + padding;
  let cursorY = zr.y_m + padding;
  let rowMaxW = 0;
  const maxX = zr.x_m + zr.length_m - padding;
  const maxY = zr.y_m + zr.width_m - padding;

  items.forEach(({ group, fp }) => {
    let L = fp.length_m, W = fp.width_m, rotate = false;
    if (cursorX + L > maxX && cursorX + W <= maxX && cursorY + L <= maxY) {
      L = fp.width_m; W = fp.length_m; rotate = true;
    }
    if (cursorX + L > maxX) {
      cursorX = zr.x_m + padding;
      cursorY += rowMaxW + padding;
      rowMaxW = 0;
    }
    const built = buildEquipmentForGroup(group);
    const mesh = built.mesh;
    mesh.position.set(cursorX + L/2, 0, cursorY + W/2);
    if (rotate) mesh.rotation.y = Math.PI / 2;
    mesh.userData = { kind: 'group', id: group.id, group, footprint: built.footprint, rotate };
    mesh.name = `group:${group.id}`;
    roomGroup.add(mesh);
    state.meshIndex.set(group.id, mesh);

    const lightsCount = Array.isArray(group.lights) ? group.lights.length : 0;
    if (lightsCount > 0) {
      const fix = makeFixtureAbove(built.footprint, built.height || 1.5, Math.min(lightsCount, 4));
      fix.position.copy(mesh.position);
      fix.rotation.y = mesh.rotation.y;
      roomGroup.add(fix);
    }

    cursorX += L + padding;
    rowMaxW = Math.max(rowMaxW, W);
  });
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
function pickGroupAt(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(farmRoot, true);
  for (const h of hits) {
    let n = h.object;
    while (n && !(n.userData && n.userData.kind === 'group')) n = n.parent;
    if (n) return n;
  }
  return null;
}

canvas.addEventListener('click', (e) => {
  const target = pickGroupAt(e.clientX, e.clientY);
  if (!target) {
    if (!e.shiftKey) state.selection.clear();
    applySelectionVisuals(); renderSidePanel(); return;
  }
  const id = target.userData.id;
  if (e.shiftKey) {
    if (state.selection.has(id)) state.selection.delete(id);
    else state.selection.add(id);
  } else {
    state.selection.clear();
    state.selection.add(id);
  }
  applySelectionVisuals(); renderSidePanel();
});

canvas.addEventListener('dblclick', (e) => {
  const target = pickGroupAt(e.clientX, e.clientY);
  if (!target) return;
  const fp = target.userData.footprint || { length_m: 1, width_m: 1 };
  const wp = new THREE.Vector3(); target.getWorldPosition(wp);
  const dist = Math.max(fp.length_m, fp.width_m) * 2.6 + 1.2;
  animateCamera(new THREE.Vector3(wp.x + dist * 0.6, dist * 0.7, wp.z + dist * 0.8), wp.clone());
});

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}

function renderSidePanel() {
  const ids = Array.from(state.selection);
  const titleEl = $('v3dSideTitle');
  const countEl = $('v3dSideCount');
  const bodyEl = $('v3dSideBody');
  const actsEl = $('v3dSideActions');
  if (!ids.length) {
    titleEl.textContent = 'Nothing selected';
    countEl.textContent = '';
    bodyEl.innerHTML = '<div class="v3d-empty">Click a growing system to inspect it. Shift-click to add to a selection. Drag to orbit.</div>';
    actsEl.hidden = true; return;
  }
  const groups = ids.map(id => state.groups.find(g => g.id === id)).filter(Boolean);
  if (groups.length === 1) {
    const g = groups[0];
    const c = g.customization || {};
    const tpl = templateById(g.templateId);
    titleEl.textContent = g.name || g.id;
    countEl.textContent = tpl?.category || '';
    const fp = groupFootprintM(g);
    bodyEl.innerHTML = `
      <div class="v3d-side__row">
        <div class="v3d-kv"><span>Room</span><span>${escapeHtml(g.room || '-')}</span></div>
        <div class="v3d-kv"><span>Zone</span><span>${escapeHtml(g.zone || '-')}</span></div>
        <div class="v3d-kv"><span>Template</span><span>${escapeHtml(g.templateId || '-')}</span></div>
        <div class="v3d-kv"><span>Status</span><span><span class="v3d-tag ${g.status === 'active' ? 'v3d-tag--ok' : ''}">${escapeHtml(g.status || 'pending')}</span></span></div>
      </div>
      <div class="v3d-side__row">
        <div class="v3d-kv"><span>Levels</span><span>${fmt(c.levels, 0)}</span></div>
        <div class="v3d-kv"><span>Locations / level</span><span>${fmt(c.locationsPerLevel, 0)}</span></div>
        <div class="v3d-kv"><span>Total locations</span><span>${fmt(c.totalLocations, 0)}</span></div>
        <div class="v3d-kv"><span>Footprint</span><span>${fmt(fp.length_m, 2)} x ${fmt(fp.width_m, 2)} m</span></div>
      </div>
      <div class="v3d-side__row">
        <div class="v3d-kv"><span>Lights</span><span>${(g.lights || []).length}</span></div>
        <div class="v3d-kv"><span>Crop</span><span>${escapeHtml(g.crop || '-')}</span></div>
        <div class="v3d-kv"><span>Plan</span><span>${escapeHtml(g.planId || g.plan || '-')}</span></div>
      </div>`;
  } else {
    titleEl.textContent = `${groups.length} systems selected`;
    countEl.textContent = '';
    const totalLoc = groups.reduce((s, g) => s + (Number(g.customization?.totalLocations) || 0), 0);
    const totalLights = groups.reduce((s, g) => s + (g.lights?.length || 0), 0);
    const cats = new Map();
    groups.forEach(g => { const t = templateById(g.templateId); const k = t?.category || 'unknown'; cats.set(k, (cats.get(k)||0)+1); });
    const catList = Array.from(cats).map(([k,n]) => `<span class="v3d-tag">${escapeHtml(k)} x ${n}</span>`).join(' ');
    bodyEl.innerHTML = `
      <div class="v3d-side__row">
        <div class="v3d-kv"><span>Total systems</span><span>${groups.length}</span></div>
        <div class="v3d-kv"><span>Total locations</span><span>${totalLoc}</span></div>
        <div class="v3d-kv"><span>Lights assigned</span><span>${totalLights}</span></div>
      </div>
      <div class="v3d-side__row"><div style="display:flex;flex-wrap:wrap;gap:6px;">${catList}</div></div>`;
  }
  actsEl.hidden = false;
}

$('v3dSideActions').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const ids = Array.from(state.selection);
  if (!ids.length) { toast('Select at least one system first'); return; }
  if (action === 'open-grow') {
    window.open('/views/grow-management.html#flow-grow-units', '_blank', 'noopener'); return;
  }
  if (action === 'calibrate') {
    window.open(`/views/calibration.html?groupIds=${encodeURIComponent(ids.join(','))}`, '_blank', 'noopener'); return;
  }
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
      await loadData(); buildScene();
    } catch (err) {
      console.error('[v3d] bulk-assign failed', err);
      toast('Bulk assign failed: ' + (err.message || 'unknown'));
    }
  }
});

async function loadData() {
  const bust = '?_=' + Date.now();
  const urls = ['/data/rooms.json' + bust, '/data/groups.json' + bust, '/data/grow-systems.json' + bust];
  const results = await Promise.all(urls.map(u => authFetch(u, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null)));
  state.rooms = Array.isArray(results[0]) ? results[0] : (results[0]?.rooms || []);
  state.groups = Array.isArray(results[1]) ? results[1] : (results[1]?.groups || []);
  const gs = results[2];
  state.templates = gs && Array.isArray(gs.templates) ? gs.templates : (Array.isArray(gs) ? gs : []);
  $('v3dSubtitle').textContent = `${state.rooms.length} room(s), ${state.groups.length} system(s)`;
}

function updateStats() {
  const zones = state.rooms.reduce((s, r) => s + (r.zones?.length || 0), 0);
  $('v3dStats').textContent = `${state.rooms.length} rooms / ${zones} zones / ${state.groups.length} systems`;
}

function wireSSE() {
  let es = null;
  let debounce = null;
  const queueRefresh = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(async () => { await loadData(); buildScene(); toast('Scene updated'); }, 300);
  };
  try {
    es = new EventSource('/events');
    ['data-changed','rooms-updated','groups-updated','zones-updated','message'].forEach(evt => {
      es.addEventListener(evt, queueRefresh);
    });
    es.onerror = () => {};
    window.addEventListener('beforeunload', () => { try { es.close(); } catch (_) {} });
  } catch (_) {}
}

$('v3dFitBtn').addEventListener('click', fitView);
$('v3dGrowBtn').addEventListener('click', () => window.open('/views/grow-management.html', '_blank', 'noopener'));
document.querySelectorAll('.v3d-viewmode button').forEach(b => {
  b.addEventListener('click', () => setViewMode(b.dataset.view));
});

window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}, { passive: true });

function tick(now) {
  if (camAnim && !camAnim(now)) {}
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

(async function init() {
  try {
    await loadData();
    buildScene();
  } catch (err) {
    console.error('[v3d] init failed', err);
    toast('Failed to load farm data: ' + (err.message || 'unknown'));
  } finally {
    $('v3dLoading').classList.add('hide');
  }
  wireSSE();
  requestAnimationFrame(tick);
})();
