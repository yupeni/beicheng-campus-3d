import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { PointerLockControls } from 'three/addons/PointerLockControls.js';
import {
  FLOOR_H, CATS, categorize, BUILDING_INFO, PARTS, COVERED, PLAZAS, PATHS, TRACK, COURTS, PLAY, FOUNTAIN, GREEN,
  BOUNDARY, GATES, MAPS_URL, rW, COVERED_COURT, FLAG,
} from './campus-data.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// 矩形 [x0, z0, x1, z1] (場景座標, z 向南) → 中心與尺寸
function R(rect) {
  const x0 = Math.min(rect[0], rect[2]); const x1 = Math.max(rect[0], rect[2]); const z0 = Math.min(rect[1], rect[3]); const z1 = Math.max(rect[1], rect[3]);
  return { x0, x1, z0, z1, x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 };
}

// ───────── 算圖器、場景 ─────────
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const DAY = { sky: 0xbfe3f7, sun: 1.9, hemi: 0.95, win: 0 };
const NIGHT = { sky: 0x0d1830, sun: 0.22, hemi: 0.4, win: 1.5 };
scene.background = new THREE.Color(DAY.sky);
scene.fog = new THREE.Fog(DAY.sky, 450, 1500);

const camera = new THREE.PerspectiveCamera(50, 1, 1, 3000);
const HOME = { pos: new THREE.Vector3(-15, 175, 215), target: new THREE.Vector3(-100, 0, 40) };
camera.position.copy(HOME.pos);

const hemi = new THREE.HemisphereLight(0xffffff, 0x9a9684, DAY.hemi);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3dc, DAY.sun);
sun.position.set(-40, 230, 160);
sun.target.position.set(-100, 0, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -170, right: 170, top: 170, bottom: -170, near: 20, far: 600 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.3;
scene.add(sun, sun.target);

// ───────── 材質 ─────────
function windowTextures() {
  const s = 128;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = s; return c; };
  const color = mk(); const glow = mk();
  const c = color.getContext('2d'); const g = glow.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, s, s);
  g.fillStyle = '#000'; g.fillRect(0, 0, s, s);
  for (const x of [12, 70]) {
    c.fillStyle = '#5f86a3'; c.fillRect(x, 40, 46, 46);
    c.fillStyle = '#a9cbe0'; c.fillRect(x + 3, 43, 40, 18);
    g.fillStyle = '#ffd98a'; g.fillRect(x, 40, 46, 46);
  }
  c.fillStyle = 'rgba(0,0,0,.12)'; c.fillRect(0, 0, s, 3); c.fillRect(0, s - 3, s, 3);
  const t = (cv) => { const x = new THREE.CanvasTexture(cv); x.wrapS = x.wrapT = THREE.RepeatWrapping; x.colorSpace = THREE.SRGBColorSpace; x.anisotropy = 4; return x; };
  return { map: t(color), glow: t(glow) };
}
const WIN = windowTextures();
const glowMats = [];
const catMats = {};
for (const [k, v] of Object.entries(CATS)) {
  const side = new THREE.MeshStandardMaterial({
    color: v.color, map: k === 'circ' ? null : WIN.map, roughness: 0.85,
    emissive: new THREE.Color(0xffc870), emissiveMap: k === 'circ' ? null : WIN.glow, emissiveIntensity: DAY.win,
  });
  const roof = new THREE.MeshStandardMaterial({ color: new THREE.Color(v.color).multiplyScalar(0.92), roughness: 0.9 });
  if (k !== 'circ') glowMats.push(side);
  catMats[k] = { side, roof, list: [side, roof] };
}
const concrete = new THREE.MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.95 });
const fillMat = new THREE.MeshStandardMaterial({ color: 0xeee3cc, map: WIN.map, roughness: 0.9, emissive: new THREE.Color(0xffc870), emissiveMap: WIN.glow, emissiveIntensity: DAY.win });
glowMats.push(fillMat);
const roofMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a5, roughness: 0.95 });

// BoxGeometry 的 UV 依實際長度重複，讓窗戶間距固定 (約每 6 公尺一組)
function boxGeo(w, h, d, floors = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const sc = [[d / 6, floors], [d / 6, floors], [1, 1], [1, 1], [w / 6, floors], [w / 6, floors]];
  sc.forEach(([su, sv], f) => { for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * Math.max(1, Math.round(su)), uv.getY(k) * sv); } });
  return g;
}

// ───────── 場景資料容器 ─────────
const floorMeshes = [];       // { mesh, fl } 用於樓層篩選
const pickables = [];
const rooms = [];              // 房間索引
const colliders = [];
const buildingBounds = new Map(); // bid → {x0,x1,z0,z1,top}
const bigLabels = [];          // 建築 / 校門 / 周邊學校標籤
const roadLabels = [];
const labelCache = new Map();

function textSprite(text, { scale = 1, bg = 'rgba(20,32,46,.86)', fg = '#fff', badge } = {}) {
  const key = `${text}|${scale}|${bg}|${fg}|${badge || ''}`;
  let cached = labelCache.get(key);
  if (!cached) {
    const cv = document.createElement('canvas'); const ctx = cv.getContext('2d');
    const font = '600 40px "PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
    ctx.font = font;
    const bw = badge ? ctx.measureText(badge).width + 26 : 0;
    const w = Math.ceil(ctx.measureText(text).width) + 34 + bw; cv.width = w; cv.height = 68;
    ctx.font = font; ctx.textBaseline = 'middle';
    ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(0, 4, w, 60, 18); ctx.fill();
    if (badge) { ctx.fillStyle = '#e8590c'; ctx.beginPath(); ctx.roundRect(w - bw - 4, 8, bw, 52, 14); ctx.fill(); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(badge, w - bw / 2 - 4, 36); }
    ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.fillText(text, 17, 36);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    cached = { tex, ratio: w / 68 }; labelCache.set(key, cached);
  }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cached.tex, depthTest: false, transparent: true }));
  const h = 3.0 * scale; sp.scale.set(cached.ratio * h, h, 1); sp.renderOrder = 10;
  return sp;
}

// ───────── 周邊環境 (OpenStreetMap) ─────────
const world = await fetch('./world.json').then((r) => r.json());

function flatShape(pts, color, y) {
  const shape = new THREE.Shape(pts.map(([x, n]) => new THREE.Vector2(x, n)));
  const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  m.position.y = y; m.receiveShadow = true; scene.add(m); return m;
}
{
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: 0xcfc9bb, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; ground.receiveShadow = true; scene.add(ground);
}
const AREA_COL = { farmland: 0xa8c47a, grass: 0x8fbf6a, meadow: 0x9ccb73, park: 0x7fb069, residential: 0xd7d0c1, pitch: 0xc9b38f, swimming_pool: 0x4aa3d8 };
for (const a of world.areas) flatShape(a.p, AREA_COL[a.k] ?? 0xcfc9bb, a.k === 'residential' ? 0 : 0.02);

// 道路 (帶狀網格)：以每個頂點的平均法線做斜接
function ribbon(pts, width, y, color, order, extra = {}) {
  const n = pts.length; if (n < 2) return null;
  const pos = []; const idx = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0]; let dy = b[1] - a[1]; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    const nx = -dy; const ny = dx; const hw = width / 2;
    pos.push(pts[i][0] + nx * hw, y, -(pts[i][1] + ny * hw), pts[i][0] - nx * hw, y, -(pts[i][1] - ny * hw));
    if (i < n - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -order, polygonOffsetUnits: -order, ...extra }));
  m.receiveShadow = true; m.renderOrder = order; scene.add(m); return m;
}
const ROAD = {
  primary: { w: 16, side: 3 }, tertiary: { w: 12, side: 3, line: true }, residential: { w: 8, side: 2 },
  unclassified: { w: 8, side: 2 }, service: { w: 5, side: 0 }, footway: { w: 2, side: 0 },
};
ROAD.primary.line = true;
for (const r of world.roads) {
  const s = ROAD[r.c] ?? ROAD.service;
  if (s.side) ribbon(r.p, s.w + s.side * 2, 0.03, 0xdad6cc, 2);
  ribbon(r.p, s.w, 0.05, r.c === 'footway' ? 0xb9a98a : 0x55595e, 3);
  if (s.line) ribbon(r.p, 0.25, 0.07, 0xf2e6a4, 4);
  if (r.n && s.side) {
    let len = 0; for (let i = 1; i < r.p.length; i++) len += Math.hypot(r.p[i][0] - r.p[i - 1][0], r.p[i][1] - r.p[i - 1][1]);
    if (len > 60) {
      const mid = r.p[Math.floor(r.p.length / 2)];
      const sp = textSprite(r.n, { scale: 0.62, bg: 'rgba(60,68,76,.8)' }); sp.position.set(mid[0], 3.2, -mid[1]); scene.add(sp); roadLabels.push(sp);
    }
  }
}
for (const w of world.water) ribbon(w.p, w.k === 'canal' ? 7 : 2.5, 0.04, 0x5da9d6, 3);

// 周邊建築：依 OSM 腳印擠出，樓高以 id 雜湊做出變化
function hash(n) { let h = n | 0; h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
const NEAR_COL = [0xd8cfc0, 0xcfc8bb, 0xddd3c2, 0xc9cdd0, 0xd4c5b3];
world.buildings.forEach((b, i) => {
  const pts = b.p.slice(0, -1); if (pts.length < 3) return;
  const school = b.t === 'school';
  const h = school ? 12 + hash(b.id) * 6 : b.t === 'church' ? 14 : 8 + Math.floor(hash(b.id) * 4) * 3.2;
  const shape = new THREE.Shape(pts.map(([x, n]) => new THREE.Vector2(x, n)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false }); g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: school ? 0xc2d0dc : NEAR_COL[i % NEAR_COL.length], roughness: 0.95 }));
  m.castShadow = m.receiveShadow = true; scene.add(m);
  const xs = pts.map((p) => p[0]); const ns = pts.map((p) => p[1]);
  colliders.push({ id: `osm${b.id}`, x0: Math.min(...xs), x1: Math.max(...xs), z0: -Math.max(...ns), z1: -Math.min(...ns) });
  if (b.n && school) { const sp = textSprite(`${b.n}（鄰近學校）`, { scale: 0.7, bg: 'rgba(70,90,110,.85)' }); sp.position.set((Math.min(...xs) + Math.max(...xs)) / 2, h + 3, -(Math.min(...ns) + Math.max(...ns)) / 2); scene.add(sp); bigLabels.push({ sp, near: 0 }); }
});

// ───────── 校園地面、邊界、人行道、校門 ─────────
const gateInfo = [];
function flatRect(rect, color, y, order = 1, extra = {}) {
  const r = R(rect);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), new THREE.MeshStandardMaterial({ color, roughness: 1, polygonOffset: true, polygonOffsetFactor: -order, polygonOffsetUnits: -order, ...extra }));
  m.rotation.x = -Math.PI / 2; m.position.set(r.x, y, r.z); m.receiveShadow = true; scene.add(m); return m;
}
function flatShapeO(shape, color, y, order, extra = {}) {
  const g = new THREE.ShapeGeometry(shape, 48); g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 1, polygonOffset: true, polygonOffsetFactor: -order, polygonOffsetUnits: -order, ...extra }));
  m.position.y = y; m.receiveShadow = true; scene.add(m); return m;
}
const solidBox = (w, h, d, color, x, y, z, rotY = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
  m.position.set(x, y, z); m.rotation.y = rotY; m.castShadow = m.receiveShadow = true; scene.add(m); return m;
};
// 沿折線 (x, north) 向右側偏移 d 公尺，用斜接法線
function offsetLine(pts, d) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(pts.length - 1, i + 1)];
    const n1 = (() => { const dx = p[0] - a[0]; const dy = p[1] - a[1]; const L = Math.hypot(dx, dy) || 1; return [dy / L, -dx / L]; })();
    const n2 = (() => { const dx = b[0] - p[0]; const dy = b[1] - p[1]; const L = Math.hypot(dx, dy) || 1; return [dy / L, -dx / L]; })();
    let nx = n1[0] + n2[0]; let ny = n1[1] + n2[1]; const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
    const k = 1 / Math.max(0.5, nx * n2[0] + ny * n2[1]);
    return [p[0] + nx * d * k, p[1] + ny * d * k];
  });
}

// 校地底色與各種鋪面
flatShape(BOUNDARY, 0xe3ddd0, 0.03);
for (const p of PLAZAS) flatRect(p.rect, parseInt(p.color.slice(1), 16), 0.05, 1.5);
for (const g of GREEN) flatRect(g.rect, parseInt(g.color.slice(1), 16), 0.06, 1.6);
const laneArrowShape = new THREE.Shape(); laneArrowShape.moveTo(-0.2, 0); laneArrowShape.lineTo(0.2, 0); laneArrowShape.lineTo(0.2, 1.6); laneArrowShape.lineTo(0.7, 1.6); laneArrowShape.lineTo(0, 2.8); laneArrowShape.lineTo(-0.7, 1.6); laneArrowShape.lineTo(-0.2, 1.6); laneArrowShape.closePath();
function laneArrows(pts, every) { // 沿折線每隔 every 公尺放一個行車方向箭頭
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, an] = pts[i]; const [bx, bn] = pts[i + 1]; const L = Math.hypot(bx - ax, bn - an); const ux = (bx - ax) / L; const un = (bn - an) / L;
    for (let t = every / 2; t < L; t += every) { const m = flatShapeO(laneArrowShape, 0xf3f0ea, 0.09, 9); m.position.set(ax + ux * t, 0.09, -(an + un * t)); m.rotation.y = Math.atan2(-ux, un); }
  }
}
const PATH_COLOR = { vehicle: 0x555b63, walk: 0xd9d6cf, brick: 0xc98466 };
for (const p of PATHS) {
  ribbon(p.pts, p.w, 0.07, PATH_COLOR[p.kind] ?? 0xd9d6cf, 6);
  if (p.kind === 'vehicle' && !p.loop) ribbon(p.pts, 0.15, 0.075, 0xe9dba0, 6.5); // 車道中線
  if (p.loop) laneArrows(p.pts, 13); // 單向迴圈：箭頭指出行車方向
}

{ // 操場：七色彩虹跑道 (外紅→藍→綠→黃→綠→藍→內紅)、草皮球場線、沙坑與跳遠沙池 (依實景與空拍圖)
  const { cx, n, len, wid } = TRACK; const r = wid / 2; const s = len - wid;
  const stadium = (rad, path = new THREE.Path()) => {
    path.moveTo(cx - s / 2, n - rad); path.lineTo(cx + s / 2, n - rad);
    path.absarc(cx + s / 2, n, rad, -Math.PI / 2, Math.PI / 2, false);
    path.lineTo(cx - s / 2, n + rad); path.absarc(cx - s / 2, n, rad, Math.PI / 2, Math.PI * 1.5, false); return path;
  };
  const BANDS = [0xb5483f, 0x3f7fc4, 0x4f9a5a, 0xe6b83a, 0x4f9a5a, 0x3f7fc4, 0xb5483f]; const bw = 7.6 / BANDS.length;
  BANDS.forEach((col, i) => { const ring = new THREE.Shape(); stadium(r - i * bw, ring); ring.holes.push(stadium(r - (i + 1) * bw)); flatShapeO(ring, col, 0.08, 7); });
  const turf = new THREE.Shape(); stadium(r - 7.6, turf); flatShapeO(turf, 0x5aa04a, 0.09, 8);
  for (const sx of [-1, 1]) { // 兩端沙坑 + 跳遠沙道 (白框)
    const sand = new THREE.Shape(); sand.absarc(cx + sx * s / 2, n, r - 14.5, sx > 0 ? -Math.PI / 2 : Math.PI / 2, sx > 0 ? Math.PI / 2 : Math.PI * 1.5, false); sand.closePath();
    flatShapeO(sand, 0xdcae6e, 0.1, 9);
    for (const dn of [-5.5, 5.5]) { const x0 = cx + sx * (s / 2 + 1); const lp = [[x0 - 5, n + dn - 1.6], [x0 + 5, n + dn - 1.6], [x0 + 5, n + dn + 1.6], [x0 - 5, n + dn + 1.6]]; scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(lp.map(([x, nn]) => new THREE.Vector3(x, 0.35, -nn))), new THREE.LineBasicMaterial({ color: 0xf4efe6 }))); }
  }
  const wl = new THREE.LineBasicMaterial({ color: 0xf4efe6 });
  const line3 = (pts, closed = false) => { const g = new THREE.BufferGeometry().setFromPoints(pts.map(([x, nn]) => new THREE.Vector3(x, 0.35, -nn))); scene.add(closed ? new THREE.LineLoop(g, wl) : new THREE.Line(g, wl)); };
  for (let i = 0; i <= BANDS.length; i++) { // 分道線
    const rad = r - i * bw; const pts = [];
    for (let a = 0; a <= 72; a++) { const t = (a / 72) * Math.PI * 2; const side = Math.cos(t) >= 0 ? 1 : -1; pts.push([cx + side * s / 2 + Math.cos(t) * rad, n + Math.sin(t) * rad]); }
    line3(pts, true);
  }
  { // 足球場線：邊線、中線、中圈、禁區、球門
    const L = 19; const W = 15; line3([[cx - L, n - W], [cx + L, n - W], [cx + L, n + W], [cx - L, n + W]], true); line3([[cx, n - W], [cx, n + W]]);
    const circ = []; for (let a = 0; a <= 40; a++) { const t = (a / 40) * Math.PI * 2; circ.push([cx + Math.cos(t) * 3.6, n + Math.sin(t) * 3.6]); } line3(circ, true);
    for (const sx of [-1, 1]) {
      line3([[cx + sx * L, n - 7], [cx + sx * (L - 6), n - 7], [cx + sx * (L - 6), n + 7], [cx + sx * L, n + 7]]); line3([[cx + sx * L, n - 3], [cx + sx * (L - 2), n - 3], [cx + sx * (L - 2), n + 3], [cx + sx * L, n + 3]]);
      for (const dn of [-1.8, 1.8]) solidBox(0.1, 2.2, 0.1, 0xffffff, cx + sx * (L + 0.2), 1.1, -(n + dn)); solidBox(0.1, 0.1, 3.7, 0xffffff, cx + sx * (L + 0.2), 2.2, -n);
    }
  }
  const sp = textSprite('操場', { scale: 0.9 }); sp.position.set(cx, 6, -n); scene.add(sp); bigLabels.push({ sp, near: 0 });
}
for (const c of COURTS) { // 藍色籃球場：紅色禁區、中圈、三分線、籃框，外圍灰白鋪面 (依空拍圖)
  const r = R(c); const wm = new THREE.LineBasicMaterial({ color: 0xffffff });
  const ln = (pts, closed = false) => { const g = new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x, 0.35, z))); scene.add(closed ? new THREE.LineLoop(g, wm) : new THREE.Line(g, wm)); };
  const arc = (cx0, cz0, rad, a0, a1) => Array.from({ length: 25 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / 24; return [cx0 + Math.cos(a) * rad, cz0 + Math.sin(a) * rad]; });
  flatRect([r.x0 - 2, r.z0 - 2, r.x1 + 2, r.z1 + 2], 0xd9d6cf, 0.075, 7.5);
  flatRect(c, 0x2f8fd8, 0.09, 8);
  for (const [a, b] of [[r.x0, r.x0 + 5.8], [r.x1 - 5.8, r.x1]]) flatRect([a, r.z - 2.45, b, r.z + 2.45], 0xd6453a, 0.095, 8.5);
  ln([[r.x0 + 0.4, r.z0 + 0.4], [r.x1 - 0.4, r.z0 + 0.4], [r.x1 - 0.4, r.z1 - 0.4], [r.x0 + 0.4, r.z1 - 0.4]], true); ln([[r.x, r.z0 + 0.4], [r.x, r.z1 - 0.4]]);
  const cc = new THREE.Mesh(new THREE.CircleGeometry(1.8, 28), new THREE.MeshBasicMaterial({ color: 0xd6453a, polygonOffset: true, polygonOffsetFactor: -9, polygonOffsetUnits: -9 })); cc.rotation.x = -Math.PI / 2; cc.position.set(r.x, 0.1, r.z); scene.add(cc); ln(arc(r.x, r.z, 1.8, 0, Math.PI * 2), true);
  for (const sx of [-1, 1]) {
    const base = sx > 0 ? r.x1 : r.x0; const a0 = sx > 0 ? Math.PI / 2 : -Math.PI / 2; const a1 = sx > 0 ? Math.PI * 1.5 : Math.PI / 2;
    ln([[base - sx * 5.8, r.z - 2.45], [base - sx * 5.8, r.z + 2.45]]); ln(arc(base - sx * 5.8, r.z, 1.8, a0, a1)); ln(arc(base - sx * 1.6, r.z, 6.6, a0, a1));
    solidBox(0.25, 3.6, 0.25, 0x555b60, base - sx * 0.6, 1.8, r.z); solidBox(0.12, 1.2, 1.8, 0xf4f4f4, base - sx * 1.0, 3.5, r.z);
  }
}
{ // 籃球場旁的小遊戲場 (沙地 + 黃色溜滑梯)，位於球場東側
  const sand = new THREE.Mesh(new THREE.CircleGeometry(4.8, 28), new THREE.MeshStandardMaterial({ color: 0xe9e2d0, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })); sand.rotation.x = -Math.PI / 2; sand.position.set(-104, 0.06, 128); scene.add(sand);
  solidBox(1.4, 2.4, 1.4, 0xe8b84a, -105, 1.2, 127); solidBox(1.0, 0.25, 3.8, 0xf5c542, -105, 1.5, 129.4); solidBox(1.4, 1.6, 1.4, 0xd6453a, -102.5, 0.8, 127.5);
}
{ const sp = textSprite('籃球場', { scale: 0.8 }); const r = R(COURTS[0]); sp.position.set(r.x, 6, r.z); scene.add(sp); bigLabels.push({ sp, near: 0 }); }
{ // 西南角有頂球場 (風雨球場)
  const r = R(COVERED_COURT);
  flatRect(COVERED_COURT, 0xb9735c, 0.09, 8);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(r.w + 1.2, 0.6, r.d + 1.2), new THREE.MeshStandardMaterial({ color: 0xe9ecee, roughness: 0.7, metalness: 0.2 })); roof.position.set(r.x, 7.4, r.z); roof.castShadow = true; scene.add(roof);
  for (const sx of [-1, 1]) for (let i = 0; i <= 3; i++) solidBox(0.5, 7.2, 0.5, 0xd5d0c4, r.x + sx * (r.w / 2 - 0.4), 3.6, r.z - r.d / 2 + 0.4 + (i * (r.d - 0.8)) / 3);
  for (const sx of [-1, 1]) { solidBox(0.25, 3.6, 0.25, 0x555b60, r.x + sx * (r.w / 2 - 1.2), 1.8, r.z); solidBox(0.12, 1.2, 1.8, 0xf4f4f4, r.x + sx * (r.w / 2 - 1.6), 3.5, r.z); }
  const sp = textSprite('風雨球場', { scale: 0.8 }); sp.position.set(r.x, 11, r.z); scene.add(sp); bigLabels.push({ sp, near: 0 });
}
{ // 滑梯遊戲區
  flatRect(PLAY.rect, parseInt(PLAY.color.slice(1), 16), 0.07, 2);
  const r = R(PLAY.rect);
  solidBox(2.4, 2.6, 2.4, 0xe8704f, r.x - 6, 1.3, r.z - 4); solidBox(1.2, 0.3, 5, 0xf5c542, r.x - 6, 1.5, r.z); solidBox(2.4, 2, 2.4, 0x4a90d9, r.x + 4, 1, r.z + 6);
  solidBox(1.2, 0.3, 5, 0x57b36a, r.x + 4, 1.1, r.z + 2);
  const sp = textSprite('滑梯遊戲區', { scale: 0.7 }); sp.position.set(r.x, 6, r.z); scene.add(sp); bigLabels.push({ sp, near: 0 });
}
const statue = (x, z, bodyCol, headCol, h = 2) => { // 卡通人偶 (校園吉祥物雕像)
  solidBox(0.9, h * 0.55, 0.9, bodyCol, x, h * 0.28 + 0.4, z); const hd = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 12), new THREE.MeshStandardMaterial({ color: headCol, roughness: 0.6 })); hd.position.set(x, h * 0.55 + 0.4 + 0.5, z); hd.castShadow = true; scene.add(hd);
};
{ // 噴水池 (進第四門左手邊)：石塊圍成的草丘與卡通人偶；中間島東端有圓形藍磁磚花台與人偶 (依實景)
  const x = FOUNTAIN.x; const z = -FOUNTAIN.n;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.5, 28), new THREE.MeshStandardMaterial({ color: 0xcfc6b6 })); rim.position.set(x, 0.25, z); scene.add(rim);
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.0, 0.9, 24), new THREE.MeshStandardMaterial({ color: 0x6fae5a, roughness: 1 })); mound.position.set(x, 0.65, z); scene.add(mound);
  for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; const st = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 0), new THREE.MeshStandardMaterial({ color: 0x8a8a86, flatShading: true })); st.position.set(x + Math.cos(a) * 3.0, 0.5, z + Math.sin(a) * 3.0); st.castShadow = true; scene.add(st); }
  statue(x - 0.8, z, 0xaed0ea, 0xdfeaf2); statue(x + 0.9, z + 0.6, 0xe8b84a, 0xe8c37a);
}


{ // 第四門：警衛室、波浪遮雨棚、校名牆、停車格、旗桿、椰子樹 (依第四門衛星圖與街景)
  const teal = 0x2f8f86;
  for (const [px, n] of [[-9.6, 10], [-6.4, 10]]) solidBox(0.35, 4.4, 0.35, teal, px, 2.2, -n); // 立柱只立在兩車道中間的分隔島與北端，不擋進出口
  const wave = new THREE.PlaneGeometry(9.5, 12.1, 19, 1); wave.rotateX(-Math.PI / 2);
  const wp = wave.attributes.position; for (let i = 0; i < wp.count; i++) wp.setY(i, Math.sin((wp.getX(i) / 9.5) * Math.PI * 2) * 0.35 + (wp.getZ(i) / 12.1) * 0.5);
  wave.computeVertexNormals();
  const canopy = new THREE.Mesh(wave, new THREE.MeshStandardMaterial({ color: teal, side: THREE.DoubleSide, roughness: 0.6 }));
  canopy.position.set(-7.25, 4.7, -16.25); // 只罩入口車道與警衛室 canopy.castShadow = true; scene.add(canopy);
  // 警衛室斜屋頂 (紅瓦)
  const gr = R(rW(-7.7, 22, -3, 15));
  const gRoof = new THREE.Mesh(new THREE.BoxGeometry(gr.w + 0.8, 0.5, gr.d + 0.8), new THREE.MeshStandardMaterial({ color: 0x7a2f26, roughness: 0.8 })); gRoof.position.set(gr.x, 3.45, gr.z); gRoof.castShadow = true; scene.add(gRoof);
  solidBox(gr.w + 0.3, 1.0, gr.d + 0.3, 0x8d8a85, gr.x, 0.5, gr.z);              // 花崗石基座
  solidBox(0.1, 1.1, 3.4, 0x6f94a8, gr.x1 + 0.03, 2.0, gr.z + 1.0);               // 東面櫃台窗
  solidBox(gr.w - 0.6, 2.4, gr.d * 0.55, 0xd7a58f, gr.x - 0.2, 4.9, gr.z - gr.d * 0.18); // 上層小房間 (粉紅磁磚)
  solidBox(0.1, 1.0, 2.2, 0x4a4f55, gr.x1 - 0.25, 5.0, gr.z - gr.d * 0.18);       // 上層窗
  const w2 = new THREE.PlaneGeometry(gr.w + 0.8, gr.d * 0.55 + 0.8, 8, 1); w2.rotateX(-Math.PI / 2);
  const w2p = w2.attributes.position; for (let i = 0; i < w2p.count; i++) w2p.setY(i, Math.sin((w2p.getX(i) / (gr.w + 0.8)) * Math.PI * 2) * 0.25);
  w2.computeVertexNormals(); const wr = new THREE.Mesh(w2, new THREE.MeshStandardMaterial({ color: 0x3a3735, side: THREE.DoubleSide, roughness: 0.8 })); wr.position.set(gr.x - 0.2, 6.3, gr.z - gr.d * 0.18); wr.castShadow = true; scene.add(wr);
  // 校名牆 (進門左手邊 / 南側)
  solidBox(0.7, 2.3, 9.6, 0x2f2a26, -4.6, 1.15, 0.2);                 // 校名牆取代該段圍牆
  solidBox(0.9, 0.9, 9.6, 0x5f9f4f, -3.4, 0.45, 0.2);                 // 牆前綠籬
  solidBox(0.5, 0.4, 9.6, 0xb2604a, -4.6, 2.5, 0.2);                  // 壓頂
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 160; const cx2 = cv.getContext('2d');
  cx2.fillStyle = '#3d2f22'; cx2.fillRect(0, 0, 1024, 160); cx2.fillStyle = '#e9c46a'; cx2.font = '700 92px "PingFang TC","Noto Sans TC","Microsoft JhengHei",serif'; cx2.textAlign = 'center'; cx2.textBaseline = 'middle'; cx2.fillText('宜蘭縣北成國民小學', 512, 84);
  const sTex = new THREE.CanvasTexture(cv); sTex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 1.0), new THREE.MeshBasicMaterial({ map: sTex })); sign.scale.set(1.35, 1.35, 1); sign.rotation.y = Math.PI / 2; sign.position.set(-4.22, 1.55, 0.2); scene.add(sign);
  // 停車格白線 (中庭停車場)
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2f2ee });
  // 停車格線：四列 (南牆邊 D、島南 A、島北 B、北側 C)，間距 2.2 m
  for (const [nc, xa, xb] of [[0.5, -30, -20], [8.9, -66, -17], [27.8, -66, -11]]) for (let x = xa; x <= xb + 0.01; x += 2.2) { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 4.6), lineMat); l.rotation.x = -Math.PI / 2; l.position.set(x, 0.1, -nc); scene.add(l); }
  // 升旗台 (集合場)：三支旗桿
  { const fx = FLAG.x; const fz = -FLAG.n;
    solidBox(8, 0.7, 3, 0xcfc6b6, fx, 0.35, fz); solidBox(8.4, 0.25, 3.4, 0xb9b09f, fx, 0.12, fz);
    flatRect(rW(-59, -3.8, -39, 2.8), 0xd9d6cc, 0.06, 1.7); // 集合場鋪面 (學生列隊處)
    for (const dx of [-2.4, 0, 2.4]) { solidBox(0.1, 8.5, 0.1, 0xdddddd, fx + dx, 4.9, fz); const fl = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.2), new THREE.MeshBasicMaterial({ color: dx === 0 ? 0xd8342c : 0x2a5db0, side: THREE.DoubleSide })); fl.position.set(fx + dx + 1, 8.1, fz); scene.add(fl); }
    const sp = textSprite('升旗台（集合場）', { scale: 0.85 }); sp.position.set(fx, 11, fz); scene.add(sp); bigLabels.push({ sp, near: 0 }); gateInfo.push({ name: '升旗台', x: fx, z: fz });
  }
  // 中庭椰子樹 (王棕)
  const px = []; const pn = [];
  for (let x = -61; x <= -21; x += 4.1) { px.push(x); pn.push(16); }   // 中間花圃島
  for (let x = -66; x <= -10; x += 4.6) { px.push(x); pn.push(32.6); } // 北側 (德育樓側) 外緣一排
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.34, 1, 8), new THREE.MeshStandardMaterial({ color: 0xa89f8a }), px.length);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.4, 1), new THREE.MeshStandardMaterial({ color: 0x4a9a3e, roughness: 1, flatShading: true }), px.length);
  const m4 = new THREE.Matrix4();
  px.forEach((x, i) => { const h = 9 + (i % 3) * 1.4; m4.compose(new THREE.Vector3(x, h / 2, -pn[i]), new THREE.Quaternion(), new THREE.Vector3(1, h, 1)); trunk.setMatrixAt(i, m4); m4.compose(new THREE.Vector3(x, h + 0.4, -pn[i]), new THREE.Quaternion(), new THREE.Vector3(1.5, 0.55, 1.5)); crown.setMatrixAt(i, m4); });
  trunk.castShadow = crown.castShadow = true; scene.add(trunk, crown);
}

{ // 北成路一段轉角的設計：西北斜邊的專用通道 (深色磚面 + 箭頭)、紅磚步道、牆外椰子樹、綠白斑馬線 (依街景與衛星圖)
  const diag = [BOUNDARY[4], BOUNDARY[5]];
  const dxl = diag[1][0] - diag[0][0]; const dnl = diag[1][1] - diag[0][1]; const Ld = Math.hypot(dxl, dnl);
  const LV = 85; // 深色車道只到這裡，往西南變成褐色步道 (依北成路一段整建設計圖)
  const seg = (t0, t1) => [[diag[0][0] + (dxl / Ld) * t0, diag[0][1] + (dnl / Ld) * t0], [diag[0][0] + (dxl / Ld) * t1, diag[0][1] + (dnl / Ld) * t1]];
  ribbon(offsetLine(seg(LV, Ld), -2.6), 4.8, 0.07, 0xc9a37a, 6); // 褐色步道 (沿斜邊到西南端)
  ribbon(offsetLine(seg(0, LV), -1.6), 2.6, 0.07, 0xd9d6cf, 6);   // 靠牆淺灰水泥人行道
  ribbon(offsetLine(seg(0, LV), -2.95), 0.18, 0.075, 0xf3f0ea, 6.5); // 步道與車道分隔線
  ribbon(offsetLine(seg(0, LV), -5.4), 0.16, 0.075, 0xe9dba0, 6.5);  // 車道中線 (黃白)
  ribbon(offsetLine(seg(0, LV), -7.7), 0.2, 0.075, 0xf3f0ea, 6.5);   // 與紅磚廣場交界白線
  ribbon(offsetLine(seg(0, LV), -5.4), 4.4, 0.07, 0x4d535c, 6);   // 深色磚面通道
  const arrow = new THREE.Shape(); arrow.moveTo(-0.25, 0); arrow.lineTo(0.25, 0); arrow.lineTo(0.25, 2.2); arrow.lineTo(0.8, 2.2); arrow.lineTo(0, 3.4); arrow.lineTo(-0.8, 2.2); arrow.lineTo(-0.25, 2.2); arrow.closePath();
  const th = Math.atan2(dxl / Ld, dnl / Ld); // 箭頭朝西南
  const inner = offsetLine(diag, -5.4);
  for (let t = 10; t < LV - 6; t += 22) {
    const m = flatShapeO(arrow, 0xf3f0ea, 0.09, 8); m.position.set(inner[0][0] + (dxl / Ld) * t, 0.09, -(inner[0][1] + (dnl / Ld) * t)); m.rotation.y = Math.atan2(-(dxl / Ld), (dnl / Ld));
  }
  { // 通道上的咖啡色鐵管加鋼網拉門 (街景所見)
    const dirx = dxl / Ld; const dirn = dnl / Ld; const nx = dnl / Ld; const nn = -dxl / Ld; // 右法線 (朝牆外)
    const P0 = (t, dd) => [diag[0][0] + dirx * t + nx * dd, diag[0][1] + dirn * t + nn * dd];
    const rot = Math.atan2(nn, nx); const gt = 8; // 第一門：通道入口 (靠北成路口)
    const a = P0(gt, 0.4); const b = P0(gt, -7.6); const mid = P0(gt, -3.6);
    const rail = 0x5a3d33;
    for (const q of [a, b]) solidBox(0.55, 3.4, 0.55, 0x6d6a66, q[0], 1.7, -q[1], rot); // 水泥門柱
    solidBox(8.4, 0.22, 0.45, rail, mid[0], 3.35, -mid[1], rot); // 門楣
    for (const hgt of [0.5, 1.5, 2.7]) solidBox(7.6, 0.14, 0.14, rail, mid[0], hgt, -mid[1], rot);
    const cvm = document.createElement('canvas'); cvm.width = 64; cvm.height = 64; const cm = cvm.getContext('2d'); cm.strokeStyle = '#2b2623'; cm.lineWidth = 2; cm.strokeRect(0, 0, 64, 64);
    const tm = new THREE.CanvasTexture(cvm); tm.wrapS = tm.wrapT = THREE.RepeatWrapping; tm.repeat.set(16, 5);
    const meshG = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 2.4), new THREE.MeshBasicMaterial({ map: tm, transparent: true, alphaTest: 0.2, side: THREE.DoubleSide }));
    meshG.position.set(mid[0], 1.6, -mid[1]); meshG.rotation.y = rot; scene.add(meshG);
  }
  { const gp = [diag[0][0] + (dxl / Ld) * 8 + (dnl / Ld) * -3.6, diag[0][1] + (dnl / Ld) * 8 + (-dxl / Ld) * -3.6]; const sp = textSprite('第一門（機車通道）', { scale: 0.75 }); sp.position.set(gp[0], 5, -gp[1]); scene.add(sp); bigLabels.push({ sp, near: 0 }); gateInfo.push({ name: '第一門', x: gp[0], z: -gp[1] }); }
  // 牆外椰子樹 (王棕) 一排
  const out = offsetLine(diag, 3.2); const spots = [];
  for (let t = 4; t < Ld - 4; t += 7.5) spots.push([out[0][0] + (dxl / Ld) * t, -(out[0][1] + (dnl / Ld) * t), 11 + ((t * 7) % 3)]);
  const tr = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.34, 1, 8), new THREE.MeshStandardMaterial({ color: 0xa89f8a }), spots.length);
  const cr = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.4, 1), new THREE.MeshStandardMaterial({ color: 0x4a9a3e, roughness: 1, flatShading: true }), spots.length);
  const mm = new THREE.Matrix4();
  spots.forEach(([x, z, h], i) => { mm.compose(new THREE.Vector3(x, h / 2, z), new THREE.Quaternion(), new THREE.Vector3(1, h, 1)); tr.setMatrixAt(i, mm); mm.compose(new THREE.Vector3(x, h + 0.4, z), new THREE.Quaternion(), new THREE.Vector3(1.5, 0.55, 1.5)); cr.setMatrixAt(i, mm); });
  tr.castShadow = cr.castShadow = true; scene.add(tr, cr);
  // 路口斑馬線 (綠白相間)：橫過北成路一段
  const rdx = 49 / Math.hypot(49, 45); const rdn = -45 / Math.hypot(49, 45); // 北成路方向 (西北→東南)
  const C = [-74, 109.1];
  for (let k = -4; k <= 4; k++) {
    const pxn = C[0] + 0.676 * k * 1.4; const pn = C[1] + 0.737 * k * 1.4;
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 3.6), new THREE.MeshBasicMaterial({ color: k % 2 ? 0x4aa27a : 0xf2f2ee, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }));
    bar.rotation.x = -Math.PI / 2; bar.rotation.z = Math.atan2(rdx, rdn) + Math.PI / 2; bar.position.set(pxn, 0.1, -pn); scene.add(bar);
  }
  // 資源回收室：木色小門 + 白色直條拉門
  const rr = R(rW(-87, 80, -76, 73));
  solidBox(2.2, 2.2, 0.12, 0x8a6a4a, rr.x1 + 0.05, 1.1, rr.z - 1.5); solidBox(3.2, 2.0, 0.1, 0xe9e5da, rr.x1 + 0.05, 1.0, rr.z + 1.6);
}

{ // 北側門面：德育樓前褐色鋪面、粉紅花圃、北成路一段綠白(青)斑馬線 (依整建設計圖)
  const plaza = new THREE.Shape([[-3, 60.3], [-34, 67.3], [-71, 97.5], [-100, 78], [-84, 60.6]].map(([x, n]) => new THREE.Vector2(x, n)));
  flatShapeO(plaza, 0xc9a37a, 0.045, 1.8);
  solidBox(34, 0.5, 2.6, 0x6fae5a, -28, 0.3, -64.2, -0.26); // 花圃綠帶
  for (let i = 0; i < 9; i++) { const f = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 1), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xd9527a : 0xe86f95, roughness: 1, flatShading: true })); f.position.set(-43 + i * 3.6, 1.2, -(66.6 - i * 0.7)); f.castShadow = true; scene.add(f); }
  const zebra = (cx, cn, rot, along, n, colorA = 0x3fb8b0) => { // along：條紋沿此方向排列 (x, north)
    for (let k = -(n - 1) / 2; k <= (n - 1) / 2; k++) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 3.8), new THREE.MeshBasicMaterial({ color: Math.round(k * 2) % 2 ? 0xf2f2ee : colorA, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }));
      bar.rotation.x = -Math.PI / 2; bar.rotation.z = rot; bar.position.set(cx + along[0] * k * 1.4, 0.1, -(cn + along[1] * k * 1.4)); scene.add(bar);
    }
  };
  zebra(-6, 70.2, Math.atan2(0.98, -0.2) + Math.PI / 2, [0.2, 0.98], 9); // 橫過北成路 (往路口方向)
  zebra(12, 54, 0, [1, 0], 9); // 橫過敬業路 (路口南側)
}

{ // 中庭停車場：四列停車 + 中間長條花圃島 (依空拍圖，約 42 x 38 m)
  const rand = rng(2026); const colors = [0xf2f2f0, 0xf2f2f0, 0xc9ccd0, 0x2b2f36, 0xb23a3a, 0x3a6fb0, 0x6b7077];
  const spots = [];
  for (const [nc, xa, xb, p] of [[0.5, -30, -20, 0.55], [8.9, -66, -17, 0.85], [27.8, -66, -11, 0.92]])
    for (let x = xa; x <= xb + 0.01; x += 2.2) if (rand() < p) spots.push([x, nc, colors[Math.floor(rand() * colors.length)]]);
  const cars = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 1.4, 4.2), new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.3 }), spots.length);
  const mc = new THREE.Matrix4(); const cc = new THREE.Color();
  spots.forEach(([x, n, col], i) => { mc.makeTranslation(x, 0.75, -n); cars.setMatrixAt(i, mc); cc.setHex(col); cars.setColorAt(i, cc); });
  cars.castShadow = true; scene.add(cars);
  { // 花圃島北側 (使用者紅線標示處)：車輛平行島的方向停放，數量較少；南側維持垂直停放
    const par = []; for (const nc of [19.4]) for (let x = -59; x <= -24; x += 5.6) if (rand() < 0.55) par.push([x, nc, colors[Math.floor(rand() * colors.length)]]);
    const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(4.2, 1.4, 1.8), new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.3 }), par.length);
    const m2 = new THREE.Matrix4(); const c2 = new THREE.Color();
    par.forEach(([x, n, col], i) => { m2.makeTranslation(x, 0.75, -n); pm.setMatrixAt(i, m2); c2.setHex(col); pm.setColorAt(i, c2); });
    pm.castShadow = true; scene.add(pm);
  }
  solidBox(43, 0.5, 3.4, 0x6fae5a, -40.5, 0.28, -16); solidBox(43.8, 0.35, 4.2, 0xcfc6b6, -40.5, 0.18, -16);
}

{ // 第五門內側的有頂紅磚步道 (褐色波浪鐵皮雨棚)
  const ct = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.2, 36), new THREE.MeshStandardMaterial({ color: 0x6b4a36, roughness: 0.8 })); ct.position.set(-6.2, 3.1, -(-30 - 0)); ct.position.z = 30; ct.castShadow = true; scene.add(ct);
  for (let n = -47; n <= -13; n += 6) for (const dx of [-7.6, -4.6]) solidBox(0.2, 3, 0.2, 0x5a3d33, dx, 1.5, -n);
}

{ // 第四門細節：入口 (北側、警衛室旁) 與出口 (南側、校名牆旁) 地面箭頭，校名牆上彩色壺，警衛室電子看板
  const mkArrow = (txt, col, dirRight) => { const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128; const g = cv.getContext('2d'); g.clearRect(0, 0, 256, 128);
    g.fillStyle = col; g.beginPath(); if (dirRight) { g.moveTo(10, 40); g.lineTo(150, 40); g.lineTo(150, 14); g.lineTo(246, 64); g.lineTo(150, 114); g.lineTo(150, 88); g.lineTo(10, 88); } else { g.moveTo(246, 40); g.lineTo(106, 40); g.lineTo(106, 14); g.lineTo(10, 64); g.lineTo(106, 114); g.lineTo(106, 88); g.lineTo(246, 88); } g.fill();
    g.fillStyle = '#fff'; g.font = '700 38px "PingFang TC","Noto Sans TC",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 128, 64);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; const m = new THREE.Mesh(new THREE.PlaneGeometry(5, 2.5), new THREE.MeshBasicMaterial({ map: t, transparent: true, polygonOffset: true, polygonOffsetFactor: -10, polygonOffsetUnits: -10 })); m.rotation.x = -Math.PI / 2; return m; };
  const inA = mkArrow('入口', '#2f6fe4', false); inA.position.set(-9.5, 0.12, -11.8); scene.add(inA);
  const outA = mkArrow('出口', '#e0457b', true); outA.position.set(-9.5, 0.12, -8.2); scene.add(outA);
  const potCols = [0x4a90d9, 0xe8704f, 0xf5c542, 0x57b36a, 0xd9527a, 0x8a6fd0];
  for (let i = 0; i < 9; i++) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.7, 14), new THREE.MeshStandardMaterial({ color: potCols[i % potCols.length], roughness: 0.5 })); p.position.set(-4.6, 2.85, 4.1 - i * 1.05); scene.add(p); }
  const led = document.createElement('canvas'); led.width = 512; led.height = 96; const lg = led.getContext('2d'); lg.fillStyle = '#120808'; lg.fillRect(0, 0, 512, 96); lg.fillStyle = '#ff3b2f'; lg.font = '700 52px "PingFang TC","Noto Sans TC",sans-serif'; lg.textBaseline = 'middle'; lg.fillText('歡迎蒞臨北成國小', 20, 50);
  const lt = new THREE.CanvasTexture(led); lt.colorSpace = THREE.SRGBColorSpace; const ledM = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.2), new THREE.MeshBasicMaterial({ map: lt })); ledM.rotation.y = Math.PI / 2; ledM.scale.set(0.65, 1, 1); ledM.position.set(-2.9, 2.9, -18.5); // 電子看板面向馬路 (東面) scene.add(ledM);
}
{ // 停車場收費機台 (校內警衛室旁)：兩車道中間的分隔島、橘黃色機櫃、道閘桿、車位計數看板 (依實景)
  const ix = -8.4; const inn = 10;
  solidBox(5.5, 0.35, 1.6, 0xb9b3a6, ix, 0.18, -inn);
  for (const dx of [-1.2, 0.9]) solidBox(0.9, 1.6, 0.7, 0xe0a85a, ix + dx, 1.15, -inn);
  for (const sgn of [1, -1]) for (let k = 0; k < 6; k++) solidBox(0.12, 0.12, 0.55, k % 2 ? 0xf2f2ee : 0xe8742f, ix + 0.5, 1.45, -(inn + sgn * (0.9 + k * 0.55)));
  solidBox(0.6, 2.0, 0.6, 0x8f8a82, ix + 2.4, 1.0, -(inn + 0.5));
  const cn = document.createElement('canvas'); cn.width = 128; cn.height = 64; const cg = cn.getContext('2d'); cg.fillStyle = '#150808'; cg.fillRect(0, 0, 128, 64); cg.fillStyle = '#ff3b2f'; cg.font = '700 44px monospace'; cg.textAlign = 'center'; cg.textBaseline = 'middle'; cg.fillText('147', 64, 34);
  const ct = new THREE.CanvasTexture(cn); const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), new THREE.MeshBasicMaterial({ map: ct })); disp.rotation.y = Math.PI / 2; disp.position.set(ix + 2.72, 2.2, -(inn + 0.5)); scene.add(disp);
}
{ // 自強館北面 (正面)：拱廊、白色磁磚立面、金色校館字、玻璃窗帶、無障礙坡道與機車停車區 (依實景照片)
  const P0 = [-46, 66]; const P1 = [-9, 72]; const L = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]);
  const u = [(P1[0] - P0[0]) / L, (P1[1] - P0[1]) / L]; const nm = [u[1], -u[0]]; const rot = -Math.atan2(u[1], u[0]);
  const at = (t, off) => [P0[0] + u[0] * t + nm[0] * off, P0[1] + u[1] * t + nm[1] * off];
  const mid = at(L / 2, 1.4);
  solidBox(L - 3, 0.35, 3.2, 0xf1efe9, mid[0], 3.6, mid[1], rot);                       // 拱廊頂板
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(L - 3, 3.2), new THREE.MeshStandardMaterial({ color: 0x8aa68e, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })); fl.rotation.x = -Math.PI / 2; fl.rotation.z = rot; fl.position.set(mid[0], 0.07, mid[1]); scene.add(fl); // 綠色地磚
  for (let t = 3; t <= L - 2; t += 5.2) { const p = at(t, 2.6); solidBox(0.8, 3.5, 0.8, 0xf3f1ea, p[0], 1.75, p[1], rot); } // 白磁磚柱
  const g1 = at(L / 2, 0.1); const glass = new THREE.Mesh(new THREE.BoxGeometry(L - 6, 2.6, 0.14), new THREE.MeshStandardMaterial({ color: 0x3f93a8, roughness: 0.2, metalness: 0.3, emissive: 0x0e3a45 })); glass.position.set(g1[0], 6.9, g1[1]); glass.rotation.y = rot; scene.add(glass);
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 160; const sg = cv.getContext('2d'); sg.font = '700 128px "PingFang TC","Noto Sans TC",serif'; sg.textAlign = 'center'; sg.textBaseline = 'middle'; sg.lineWidth = 6; sg.strokeStyle = '#7a5a1c'; sg.fillStyle = '#e3b64a'; sg.strokeText('自 強 館', 512, 84); sg.fillText('自 強 館', 512, 84);
  const st = new THREE.CanvasTexture(cv); st.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.4), new THREE.MeshBasicMaterial({ map: st, transparent: true })); const sp0 = at(L / 2, 0.12); sign.position.set(sp0[0], 4.5, sp0[1]); sign.rotation.y = rot + Math.PI; scene.add(sign);
  // 無障礙坡道 (不鏽鋼扶手) 與導盲磚
  const rp = at(3, 4.2); const ramp = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 6), new THREE.MeshStandardMaterial({ color: 0x8c8a86, roughness: 1 })); ramp.position.set(rp[0], 0.15, rp[1]); ramp.rotation.y = rot + Math.PI / 2; ramp.castShadow = true; scene.add(ramp);
  for (const s of [-1, 1]) { const q = [rp[0] + nm[0] * 0, rp[1]]; solidBox(0.06, 0.9, 6, 0xc9ced2, rp[0] + u[0] * s * 1.2, 0.85, rp[1] + u[1] * s * 1.2, rot + Math.PI / 2 + 0); }
  const tp = at(3, 1.2); solidBox(2.4, 0.04, 0.7, 0xe3a24f, tp[0], 0.1, tp[1], rot);
  // 前方機車停車區：兩排，彩色機車
  const bikeCols = [0xd6453a, 0x2b2f36, 0x4fae5a, 0xf2f2ee, 0x6b7077, 0xd6453a];
  const bikes = []; const rr = rng(48);
  for (const off of [6.2, 8.2]) for (let t = 6; t < L - 2; t += 1.25) if (rr() < 0.7) bikes.push([...at(t, off), bikeCols[Math.floor(rr() * bikeCols.length)]]);
  const bm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 1.0, 1.7), new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.3 }), bikes.length);
  const mq = new THREE.Matrix4(); const qq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)); const bc = new THREE.Color();
  bikes.forEach(([x, z, col], i) => { mq.compose(new THREE.Vector3(x, 0.55, z), qq, new THREE.Vector3(1, 1, 1)); bm.setMatrixAt(i, mq); bc.setHex(col); bm.setColorAt(i, bc); });
  bm.castShadow = true; scene.add(bm);
  const mp = at(L / 2, 7.2); const stripe = new THREE.Mesh(new THREE.PlaneGeometry(L - 8, 0.18), new THREE.MeshBasicMaterial({ color: 0xe9c53a, polygonOffset: true, polygonOffsetFactor: -9, polygonOffsetUnits: -9 })); stripe.rotation.x = -Math.PI / 2; stripe.rotation.z = rot; stripe.position.set(mp[0], 0.1, mp[1]); scene.add(stripe);
  const spr = textSprite('機車停車區', { scale: 0.6 }); spr.position.set(mp[0], 4, mp[1]); scene.add(spr); bigLabels.push({ sp: spr, near: 0 });
}
{ // 操場旁的司令台 (體育樓南側)：磁磚台座、彩虹壁畫、藍色鋼構雨棚 (依實景)
  const x0 = -133; const x1 = -123; const zN = 46; const zS = 49; const cx = (x0 + x1) / 2; const cz = (zN + zS) / 2;
  solidBox(10, 0.7, 3, 0xe9e5dc, cx, 0.35, cz);
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 192; const g = cv.getContext('2d'); g.fillStyle = '#e8e4da'; g.fillRect(0, 0, 512, 192);
  ['#d6453a', '#f08a3c', '#f2cf45', '#5fae6a', '#4a90d9'].forEach((col, i) => { g.strokeStyle = col; g.lineWidth = 14; g.beginPath(); g.arc(256, 190, 170 - i * 15, Math.PI, 0); g.stroke(); });
  g.fillStyle = '#f2a73c'; g.beginPath(); g.arc(256, 190, 36, Math.PI, 0); g.fill();
  const mt = new THREE.CanvasTexture(cv); mt.colorSpace = THREE.SRGBColorSpace; const mural = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.4), new THREE.MeshBasicMaterial({ map: mt })); mural.position.set(cx, 2.4, zN + 0.12); scene.add(mural);
  for (const px of [x0 + 0.5, x1 - 0.5]) for (const pz of [zN + 0.6, zS - 0.4]) solidBox(0.7, 3.4, 0.7, 0xdfdcd5, px, 1.7, pz);
  for (const bz of [zN + 0.6, zS - 0.4]) solidBox(10.6, 0.28, 0.32, 0x2f6fd0, cx, 3.5, bz);
  for (let i = 0; i <= 4; i++) solidBox(0.22, 0.22, 3.2, 0x2f6fd0, x0 + 0.5 + i * 2.25, 3.5, cz);
  const roofP = new THREE.Mesh(new THREE.BoxGeometry(10.8, 0.06, 3.4), new THREE.MeshStandardMaterial({ color: 0xe3eef2, transparent: true, opacity: 0.6 })); roofP.position.set(cx, 3.68, cz); scene.add(roofP);
  const sp = textSprite('司令台', { scale: 0.8 }); sp.position.set(cx, 7, cz); scene.add(sp); bigLabels.push({ sp, near: 0 }); gateInfo.push({ name: '司令台', x: cx, z: cz });
}

// 圍牆 (磚紅矮牆)：在校門位置留缺口
const brick = 0xb2604a;
for (let i = 0; i < BOUNDARY.length; i++) {
  const [ax, an] = BOUNDARY[i]; const [bx, bn] = BOUNDARY[(i + 1) % BOUNDARY.length];
  const L = Math.hypot(bx - ax, bn - an); const ux = (bx - ax) / L; const un = (bn - an) / L;
  const cuts = GATES.map((g) => ({ g, t: (g.x - ax) * ux + (g.n - an) * un, off: Math.abs((g.x - ax) * un - (g.n - an) * ux) })).filter((c) => c.off < 6 && c.t > 0 && c.t < L).sort((a, b) => a.t - b.t);
  let cur = 0; const segs = [];
  for (const c of cuts) { const hw = c.g.half || 5; segs.push([cur, c.t - hw - (c.g.cutBack || 0)]); cur = c.t + hw; }
  segs.push([cur, L]);
  for (const [s0, s1] of segs) {
    if (s1 - s0 < 0.5) continue;
    const mx = ax + ux * (s0 + s1) / 2; const mn = an + un * (s0 + s1) / 2;
    if (i === 4) solidBox(s1 - s0, 2.7, 0.35, 0x9b9689, mx, 1.35, -mn, Math.atan2(un, ux)); // 西北斜邊：高水泥圍牆 (北成路轉角往西南)
    else solidBox(s1 - s0, 1.1, 0.45, brick, mx, 0.55, -mn, Math.atan2(un, ux));
    if (i !== BOUNDARY.length - 1 && i !== 4) solidBox(s1 - s0, 0.9, 0.9, 0x5f9f4f, mx, 1.5, -mn, Math.atan2(un, ux)); // 綠籬
  }
  for (const c of cuts) { // 校門柱與頂梁
    const gx = c.g.x; const gn = c.g.n; const rot = Math.atan2(un, ux);
    if (c.g.style === 'opening') { /* 汽車出入口：無門柱，僅標示 */ } else if (c.g.style === 'sliding') { // 第六門：鋁製直條伸縮門 + 水泥門柱 + 紅磚花台綠籬 (依街景)
      const cv2 = document.createElement('canvas'); cv2.width = 256; cv2.height = 64; const c2 = cv2.getContext('2d');
      c2.fillStyle = '#c9c1b2'; c2.fillRect(0, 0, 256, 64); c2.fillStyle = '#8f887a'; for (let i = 0; i < 256; i += 8) c2.fillRect(i, 0, 3, 64); c2.fillStyle = '#a79f90'; c2.fillRect(0, 0, 256, 5); c2.fillRect(0, 59, 256, 5);
      const t2 = new THREE.CanvasTexture(cv2); t2.colorSpace = THREE.SRGBColorSpace;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(8.4, 1.9, 0.18), new THREE.MeshStandardMaterial({ map: t2, roughness: 0.8 }));
      panel.position.set(gx, 1.15, -gn); panel.rotation.y = rot; panel.castShadow = true; scene.add(panel);
      solidBox(1.0, 2.6, 1.0, 0x6d6a66, gx, 1.3, -(gn + 4.9), rot);  // 北側水泥門柱
      solidBox(0.5, 2.3, 0.5, 0x56524e, gx, 1.15, -(gn - 4.5), rot); // 南側門柱
      for (const s of [-1, 1]) { // 兩側紅磚花台加綠籬
        solidBox(5, 0.7, 1.8, 0xb2604a, gx + 1.4, 0.35, -(gn + s * 8.5), rot);
        solidBox(4.6, 0.8, 1.4, 0x5f9f4f, gx + 1.4, 1.05, -(gn + s * 8.5), rot);
      }
    } else if (c.g.style === 'small') { // 自強館後門：深色鐵欄小門 + 水泥門柱 + 灰色配電箱 + 紅磚花台綠籬 (依街景)
      const cv3 = document.createElement('canvas'); cv3.width = 128; cv3.height = 128; const c3 = cv3.getContext('2d');
      c3.fillStyle = '#3b3631'; c3.fillRect(0, 0, 128, 128); c3.fillStyle = '#6a635a'; for (let i = 6; i < 128; i += 12) c3.fillRect(i, 8, 3, 112); c3.fillRect(0, 60, 128, 4);
      const t3 = new THREE.CanvasTexture(cv3); t3.colorSpace = THREE.SRGBColorSpace;
      const door = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.1, 0.12), new THREE.MeshStandardMaterial({ map: t3, roughness: 0.8 }));
      door.position.set(gx, 1.05, -gn); door.rotation.y = rot; door.castShadow = true; scene.add(door);
      for (const s of [-1, 1]) solidBox(0.55, 2.5, 0.55, 0x6d6a66, gx, 1.25, -(gn + s * 1.5), rot);
      solidBox(1.0, 1.5, 0.7, 0xc9ccd0, gx + 1.3, 0.75, -(gn + 3.4), rot); // 配電箱
      for (const s of [-1, 1]) {
        solidBox(7, 0.6, 1.6, 0xb2604a, gx + 1.0, 0.3, -(gn + s * 6), rot);
        solidBox(6.6, 0.9, 1.2, 0x5f9f4f, gx + 1.0, 1.0, -(gn + s * 6), rot);
      }
    } else {
      for (const s of [-1, 1]) solidBox(1.1, 3.6, 1.1, 0xe8a96b, gx + ux * 5 * s, 1.8, -(gn + un * 5 * s), rot);
      solidBox(11, 0.6, 1.2, 0xe8a96b, gx, 3.8, -gn, rot);
    }
    const sp = textSprite(c.g.name, { scale: 0.75 }); sp.position.set(gx, 6.6, -gn); scene.add(sp); bigLabels.push({ sp, near: 0 });
    gateInfo.push({ name: c.g.name, x: gx, z: -gn });
  }
}

// 校外人行道：紅磚鋪面 + 靠車道一側的綠帶 + 行道樹 (依街景)
const streetTreeSpots = [];
{
  const line = [...BOUNDARY.slice(0, 5)];
  ribbon(offsetLine(line, 2.4), 4.4, 0.06, 0xb86a52, 6);     // 紅磚
  ribbon(offsetLine(line, 5.1), 1.4, 0.065, 0x77ad5f, 6.5);  // 綠帶
  ribbon(offsetLine(line, 0.35), 0.35, 0.07, 0xd6cbb8, 6.8); // 路緣石線
  // 行道樹：沿綠帶每 11 公尺一棵
  const tl = offsetLine(line, 5.1);
  for (let i = 0; i < tl.length - 1; i++) {
    const [ax, an] = tl[i]; const [bx, bn] = tl[i + 1]; const L = Math.hypot(bx - ax, bn - an);
    for (let t = 6; t < L - 3; t += 11) { const x = ax + ((bx - ax) * t) / L; const n = an + ((bn - an) * t) / L; if (!GATES.some((g) => Math.hypot(g.x - x, g.n - n) < 9 + (g.cutBack || 0))) streetTreeSpots.push([x, -n, 1.1]); }
  }
}

// ───────── 建築：房間級模型 ─────────
const ROOM_GAP = 0.18;
function parseRow(str) {
  return str.trim().split(/\s+/).map((tok) => {
    const m = tok.match(/^(.+?)(?::([\d.]+))?$/);
    const name = m[1]; let w = m[2] ? parseFloat(m[2]) : 1;
    if (!m[2] && /廁/.test(name)) w = 0.45;
    if (!m[2] && /樓梯|電梯/.test(name)) w = 0.55;
    if (name.startsWith('_')) return { blank: true, w: parseFloat(name.slice(1)) || 1 };
    return { name, w };
  });
}
function addMesh(mesh, fl) {
  mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh); floorMeshes.push({ mesh, fl }); return mesh;
}
function addRoom(bid, name, floorLabel, floorNum, x, z, w, d, y0, h, part) {
  const cat = categorize(name);
  const mats = [catMats[cat].side, catMats[cat].side, catMats[cat].roof, catMats[cat].roof, catMats[cat].side, catMats[cat].side];
  const mesh = new THREE.Mesh(boxGeo(Math.max(0.3, w - ROOM_GAP), h, Math.max(0.3, d - ROOM_GAP)), mats);
  mesh.position.set(x, y0 + h / 2, z);
  const room = { bid, name, floor: floorLabel, fl: floorNum, cat, mesh, x, z, y: y0 + h, w, d, part, label: null };
  mesh.userData.room = room;
  mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh); pickables.push(mesh); rooms.push(room);
  return room;
}

// 屋頂材質：依空拍圖，群育樓為紅瓦、多數棟為太陽能板、樂讀館為綠色鐵皮
const ROOFS = { red: 0xc5473c, solar: 0x28375a, gray: 0x9aa0a5, green: 0x86a77c };
const ROOF_DEFAULT = { deyu: 'solar', zhiyu: 'solar', tiyu: 'solar', zixun: 'solar', xinqun: 'solar', jiuqun: 'solar', meiyu: 'solar', yuedu: 'green' };
const roofMats = {};
function roofFor(part) {
  const key = part.roof || ROOF_DEFAULT[part.bid] || 'gray';
  return roofMats[key] ||= new THREE.MeshStandardMaterial({ color: ROOFS[key], roughness: key === 'solar' ? 0.35 : 0.85, metalness: key === 'solar' ? 0.35 : 0 });
}

function buildPart(part) {
  const r = R(part.rect); const bid = part.bid;
  let bb = buildingBounds.get(bid);
  const grow = (top) => {
    if (!bb) buildingBounds.set(bid, bb = { x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1, top });
    bb.x0 = Math.min(bb.x0, r.x0); bb.x1 = Math.max(bb.x1, r.x1); bb.z0 = Math.min(bb.z0, r.z0); bb.z1 = Math.max(bb.z1, r.z1); bb.top = Math.max(bb.top, top);
  };

  if (part.col != null) {
    const k = part.col; const names = parseRow(part.names);
    grow(Math.max(k * FLOOR_H, 0.6));
    for (let f = 1; f < k; f++) { // 下方實心樓層
      const m = new THREE.Mesh(boxGeo(r.w - 0.1, FLOOR_H, r.d - 0.1, 1), [fillMat, fillMat, roofMat, roofMat, fillMat, fillMat]);
      m.position.set(r.x, (f - 1) * FLOOR_H + FLOOR_H / 2, r.z); addMesh(m, f);
    }
    const y0 = k === 0 ? 0 : (k - 1) * FLOOR_H; const h = k === 0 ? 0.5 : FLOOR_H - 0.25;
    const along = part.axis === 'x' ? r.w : r.d; const total = names.reduce((s, n) => s + n.w, 0);
    let cursor = part.axis === 'x' ? r.x0 : r.z0;
    const fLabel = k === 0 ? 'B1' : `${k}F`;
    for (const n of names) {
      const len = (n.w / total) * along; const c = cursor + len / 2; cursor += len;
      if (n.blank) continue;
      if (part.axis === 'x') addRoom(bid, n.name, fLabel, k, c, r.z, len, r.d, y0, h, part); else addRoom(bid, n.name, fLabel, k, r.x, c, r.w, len, y0, h, part);
    }
    if (k > 0) { const roof = new THREE.Mesh(new THREE.BoxGeometry(r.w, 0.25, r.d), roofFor(part)); roof.position.set(r.x, k * FLOOR_H - 0.12, r.z); addMesh(roof, k + 0.5); }
    return;
  }

  const floors = Object.keys(part.rows).map((k) => parseInt(k, 10)).sort((a, b) => a - b);
  const maxF = floors[floors.length - 1];
  grow(maxF * FLOOR_H);
  const cd = part.corridor ? 2.4 : 0;
  const band = { x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1 };
  if (part.axis === 'x') { if (part.corridor === 'S') band.z1 -= cd; else if (part.corridor === 'N') band.z0 += cd; }
  else if (part.corridor === 'E') band.x1 -= cd; else if (part.corridor === 'W') band.x0 += cd;
  for (const fl of floors) {
    const row = parseRow(part.rows[`${fl}F`]);
    const y0 = (fl - 1) * FLOOR_H;
    if (fl > 1) { const slab = new THREE.Mesh(new THREE.BoxGeometry(r.w, 0.25, r.d), concrete); slab.position.set(r.x, y0 + 0.01, r.z); addMesh(slab, fl); }
    const along = part.axis === 'x' ? band.x1 - band.x0 : band.z1 - band.z0;
    const total = row.reduce((s, n) => s + n.w, 0);
    let cursor = part.axis === 'x' ? band.x0 : band.z0;
    const bw = band.x1 - band.x0; const bd = band.z1 - band.z0; const bx = (band.x0 + band.x1) / 2; const bz = (band.z0 + band.z1) / 2;
    for (const n of row) {
      const len = (n.w / total) * along; const c = cursor + len / 2; cursor += len;
      if (n.blank) continue;
      if (part.axis === 'x') addRoom(bid, n.name, `${fl}F`, fl, c, bz, len, bd, y0 + 0.13, FLOOR_H - 0.38, part); else addRoom(bid, n.name, `${fl}F`, fl, bx, c, bw, len, y0 + 0.13, FLOOR_H - 0.38, part);
    }
    if (cd) { // 走廊欄杆
      const rail = new THREE.Mesh(part.axis === 'x' ? new THREE.BoxGeometry(r.w, 1.0, 0.12) : new THREE.BoxGeometry(0.12, 1.0, r.d), concrete);
      const rx = part.axis === 'x' ? r.x : (part.corridor === 'E' ? r.x1 - 0.06 : r.x0 + 0.06);
      const rz = part.axis === 'x' ? (part.corridor === 'S' ? r.z1 - 0.06 : r.z0 + 0.06) : r.z;
      rail.position.set(rx, y0 + 0.13 + 0.5, rz); addMesh(rail, fl);
    }
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(r.w + 0.3, 0.35, r.d + 0.3), roofFor(part));
  roof.position.set(r.x, maxF * FLOOR_H - 0.12, r.z); addMesh(roof, maxF + 0.5);
}
PARTS.forEach(buildPart);

for (const c of COVERED) { // 風雨走廊
  const r = R(c);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(r.w, 0.3, r.d), new THREE.MeshStandardMaterial({ color: 0xc8c1b3 })); roof.position.set(r.x, 3.2, r.z); addMesh(roof, 1.5);
  const n = Math.max(2, Math.round(Math.max(r.w, r.d) / 8));
  for (let i = 0; i <= n; i++) for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.1, 0.35), concrete); const t = i / n - 0.5;
    if (r.w >= r.d) p.position.set(r.x + t * (r.w - 0.4), 1.55, r.z + s * (r.d / 2 - 0.3)); else p.position.set(r.x + s * (r.w / 2 - 0.3), 1.55, r.z + t * (r.d - 0.4));
    addMesh(p, 1);
  }
}

{ // 自強館：使用 OSM 真實腳印
  const pts = world.gym;
  const shape = new THREE.Shape(pts.map(([x, n]) => new THREE.Vector2(x, n)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: 9, bevelEnabled: false }); g.rotateX(-Math.PI / 2);
  const body = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xf1efe9, roughness: 0.9 }));
  body.castShadow = body.receiveShadow = true; scene.add(body);
  const xs = pts.map((p) => p[0]); const ns = pts.map((p) => p[1]);
  const x0 = Math.min(...xs); const x1 = Math.max(...xs); const z0 = -Math.max(...ns); const z1 = -Math.min(...ns);
  const gw = x1 - x0; const gd = z1 - z0;
  const rg = new THREE.CylinderGeometry(gd / 2, gd / 2, gw, 28); rg.scale(0.4, 1, 1); // 壓扁成弧形屋頂
  const roof = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: 0x4f7aa8, roughness: 0.6, metalness: 0.2 }));
  roof.rotation.z = Math.PI / 2; roof.position.set((x0 + x1) / 2, 9, (z0 + z1) / 2); roof.castShadow = true; scene.add(roof);
  const room = { bid: 'gym', name: '體育館・風雨球場', floor: '1F', fl: 1, cat: 'sport', mesh: body, x: (x0 + x1) / 2, z: (z0 + z1) / 2, y: 9 + gd * 0.2, w: gw, d: gd, label: null };
  body.userData.room = room; pickables.push(body); rooms.push(room);
  buildingBounds.set('gym', { x0, x1, z0, z1, top: 9 + gd * 0.2 });
  rooms.push({ ...room, name: '聚寶屋', noMesh: true });
}

for (const [bid, bb] of buildingBounds) { // 建築名稱大標籤與碰撞盒
  const info = BUILDING_INFO[bid];
  colliders.push({ id: bid, x0: bb.x0, x1: bb.x1, z0: bb.z0, z1: bb.z1 });
  if (!info || ['wc', 'game'].includes(bid)) continue;
  const sp = textSprite(info.name, { scale: 1.1 }); sp.position.set((bb.x0 + bb.x1) / 2, bb.top + 5, (bb.z0 + bb.z1) / 2); scene.add(sp);
  bigLabels.push({ sp, near: 70 });
}

function rng(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
{ // 樹木
  const rand = rng(115);
  const zones = [[-168, -150, -135, -98], [-72, -100, -50, -62], [-192, -12, -172, 12], [-135, 28, -105, 50], [-83, 0, -74, 32]]; // [x0, n0, x1, n1]
  const blocked = [...PARTS.map((p) => R(p.rect)), ...PLAZAS.map((p) => R(p.rect)), ...COURTS.map(R), ...COVERED.map(R), R(COVERED_COURT)];
  const spots = [...streetTreeSpots];
  for (let nn = -98; nn <= -54; nn += 4.2) spots.push([-61 + rand() * 3, -nn, 1.0 + rand() * 0.4]); // 操場東側樹列 (實景照片)
  for (const [x0, n0, x1, n1] of zones) {
    const n = Math.round(((x1 - x0) * (n1 - n0)) / 90);
    for (let i = 0; i < n; i++) {
      const x = x0 + rand() * (x1 - x0); const z = -(n0 + rand() * (n1 - n0));
      if (!blocked.some((r) => x > r.x0 - 4 && x < r.x1 + 4 && z > r.z0 - 4 && z < r.z1 + 4)) spots.push([x, z, 0.8 + rand() * 0.7]);
    }
  }
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0x7a5a3a }), spots.length);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.1, 1), new THREE.MeshStandardMaterial({ color: 0x4e9a45, roughness: 1, flatShading: true }), spots.length);
  const m = new THREE.Matrix4();
  spots.forEach(([x, z, s], i) => {
    m.compose(new THREE.Vector3(x, 1.1 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)); trunk.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(x, 3.4 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s * 0.9, s)); crown.setMatrixAt(i, m);
  });
  trunk.castShadow = crown.castShadow = true; scene.add(trunk, crown);
}

// ───────── 控制 ─────────
const orbit = new OrbitControls(camera, canvas);
orbit.target.copy(HOME.target); orbit.enableDamping = true;
orbit.maxPolarAngle = Math.PI / 2 - 0.03; orbit.minDistance = 6; orbit.maxDistance = 700; orbit.update();
const walk = new PointerLockControls(camera, document.body);
let mode = 'orbit'; let flyTo = null;
const keys = new Set(); const EYE = 1.6;
const isTouch = matchMedia('(pointer: coarse)').matches;

function setMode(m) {
  mode = m;
  $('btn-orbit').classList.toggle('on', m === 'orbit'); $('btn-walk').classList.toggle('on', m === 'walk');
  $('walk-hint').hidden = m !== 'walk'; document.body.classList.toggle('walking', m === 'walk');
  if (m === 'walk') { orbit.enabled = false; flyTo = null; camera.position.y = EYE; if (!isTouch) walk.lock(); }
  else {
    orbit.enabled = true; if (walk.isLocked) walk.unlock();
    const d = new THREE.Vector3(); camera.getWorldDirection(d);
    camera.position.set(camera.position.x - d.x * 40, 70, camera.position.z - d.z * 40);
    orbit.target.set(camera.position.x + d.x * 40, 0, camera.position.z + d.z * 40); orbit.update();
  }
}
walk.addEventListener('unlock', () => { if (mode === 'walk' && !isTouch) setMode('orbit'); });
$('btn-orbit').onclick = () => setMode('orbit'); $('btn-walk').onclick = () => setMode('walk');
addEventListener('keydown', (e) => { if (e.target.tagName === 'INPUT') return; keys.add(e.code); });
addEventListener('keyup', (e) => keys.delete(e.code));
const touchDir = { f: 0, s: 0 };
for (const [id, k, v] of [['t-up', 'f', 1], ['t-down', 'f', -1], ['t-left', 's', -1], ['t-right', 's', 1]]) {
  const b = $(id); const on = (e) => { e.preventDefault(); touchDir[k] = v; }; const off = (e) => { e.preventDefault(); touchDir[k] = 0; };
  b.addEventListener('pointerdown', on); ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, off));
}
let lookTouch = null;
canvas.addEventListener('pointerdown', (e) => { if (mode === 'walk' && isTouch) lookTouch = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointermove', (e) => {
  if (!lookTouch) return; camera.rotation.order = 'YXZ';
  camera.rotation.y -= (e.clientX - lookTouch.x) * 0.005; camera.rotation.x = Math.max(-1.2, Math.min(1.2, camera.rotation.x - (e.clientY - lookTouch.y) * 0.005));
  lookTouch = { x: e.clientX, y: e.clientY };
});
addEventListener('pointerup', () => { lookTouch = null; });
function stepWalk(dt) {
  const sp = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 14 : 6) * dt;
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) + touchDir.f;
  const s = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + touchDir.s;
  if (f) walk.moveForward(f * sp); if (s) walk.moveRight(s * sp);
  const p = camera.position; p.y = EYE; p.x = Math.max(-260, Math.min(120, p.x)); p.z = Math.max(-140, Math.min(220, p.z));
  const rad = 0.7;
  for (const c of colliders) {
    if (p.x > c.x0 - rad && p.x < c.x1 + rad && p.z > c.z0 - rad && p.z < c.z1 + rad) {
      const dx = Math.min(p.x - (c.x0 - rad), c.x1 + rad - p.x); const dz = Math.min(p.z - (c.z0 - rad), c.z1 + rad - p.z);
      if (dx < dz) p.x = p.x - (c.x0 - rad) < c.x1 + rad - p.x ? c.x0 - rad : c.x1 + rad; else p.z = p.z - (c.z0 - rad) < c.z1 + rad - p.z ? c.z0 - rad : c.z1 + rad;
    }
  }
}
function fly(pos, target, ms = 1100) {
  if (mode !== 'orbit') setMode('orbit');
  flyTo = { t0: performance.now(), ms, p0: camera.position.clone(), q0: orbit.target.clone(), p1: pos, q1: target };
}
function stepFly(now) {
  if (!flyTo) return;
  const k = Math.min(1, (now - flyTo.t0) / flyTo.ms); const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  camera.position.lerpVectors(flyTo.p0, flyTo.p1, e); orbit.target.lerpVectors(flyTo.q0, flyTo.q1, e); if (k >= 1) flyTo = null;
}
orbit.addEventListener('start', () => { flyTo = null; });

// ───────── 樓層篩選、類別篩選 ─────────
let floorSel = 'all'; let catSel = null;
function applyFloor() {
  for (const { mesh, fl } of floorMeshes) mesh.visible = floorSel === 'all' || fl <= floorSel;
  for (const r of rooms) if (!r.noMesh && r.bid !== 'gym') r.mesh.visible = floorSel === 'all' || r.fl <= floorSel;
  document.querySelectorAll('#floors button').forEach((b) => b.classList.toggle('on', b.dataset.fl === String(floorSel)));
}
for (const f of ['all', 5, 4, 3, 2, 1]) {
  const b = el('button', '', f === 'all' ? '全部' : `${f}F`); b.dataset.fl = String(f); b.onclick = () => { floorSel = f; applyFloor(); refreshLabels(); }; $('floors').append(b);
}
function applyCat() {
  for (const [k, m] of Object.entries(catMats)) {
    const dim = catSel && catSel !== k;
    for (const mt of m.list) { mt.transparent = !!dim; mt.opacity = dim ? 0.15 : 1; mt.depthWrite = !dim; mt.needsUpdate = true; }
  }
  document.querySelectorAll('#legend-list button').forEach((b) => b.classList.toggle('on', b.dataset.cat === catSel));
}
for (const [k, v] of Object.entries(CATS)) {
  const b = el('button', ''); b.dataset.cat = k; const sw = el('i'); sw.style.background = v.color; b.append(sw, el('span', '', v.label));
  b.onclick = () => { catSel = catSel === k ? null : k; applyCat(); }; $('legend-list').append(b);
}
{ // 圖例：地面路線顏色
  const box = $('legend-list'); const h = el('h4', '', '地面路線'); box.append(h);
  for (const [c, t] of [['#555b63', '車道（深灰磚、黃線）'], ['#d9d6cf', '人行步道（淺灰水泥）'], ['#c98466', '紅磚步道・廣場（有頂走廊、門口）'], ['#bdb7ad', '停車場・中庭'], ['#a4554d', '操場跑道'], ['#9ccf7a', '遊戲區・綠地']]) {
    const row = el('div', 'lg'); const sw = el('i'); sw.style.background = c; row.append(sw, el('span', '', t)); box.append(row);
  }
}
$('btn-legend').onclick = () => { $('legend').hidden = !$('legend').hidden; $('btn-legend').classList.toggle('on', !$('legend').hidden); };

// ───────── 房間標籤 (依距離 / 樓層顯示) ─────────
const topFloorOf = new Map();
for (const r of rooms) topFloorOf.set(r.bid, Math.max(topFloorOf.get(r.bid) ?? 0, r.fl));
let labelsOn = true; let selectedRoom = null;
function refreshLabels() {
  const cp = camera.position;
  for (const r of rooms) {
    if (r.noMesh) continue;
    const dist = Math.hypot(cp.x - r.x, cp.z - r.z, cp.y - r.y);
    const visFloor = floorSel === 'all' ? r.fl >= (topFloorOf.get(r.bid) ?? 0) || r.part?.rows : r.fl === floorSel;
    const show = labelsOn && (r === selectedRoom || (visFloor && dist < 55 && !/廁|樓梯|電梯/.test(r.name)));
    if (show) {
      if (!r.label) {
        const badge = /^\d{3}$/.test(r.name) ? r.name : null;
        r.label = textSprite(badge ? '教室' : r.name, { scale: 0.62, badge: badge || undefined }); scene.add(r.label);
      }
      r.label.position.set(r.x, r.y + 1.4, r.z); r.label.visible = true;
    } else if (r.label) r.label.visible = false;
  }
  for (const b of bigLabels) { const d = b.sp.position.distanceTo(cp); b.sp.visible = labelsOn && (!b.near || d > b.near); }
  for (const s of roadLabels) { const d = s.position.distanceTo(cp); s.visible = labelsOn && d > 40 && d < 420; }
}

// ───────── 選取 / 資訊面板 / 搜尋 ─────────
const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xffb020, depthTest: false }));
outline.renderOrder = 20; outline.visible = false; scene.add(outline);
const pin = new THREE.Group();
{
  const mat = () => new THREE.MeshStandardMaterial({ color: 0xf5a800, emissive: 0x553300 });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.4, 20), mat()); cone.rotation.x = Math.PI; cone.position.y = 1.2;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1.0, 20, 14), mat()); ball.position.y = 2.7;
  pin.add(cone, ball); pin.visible = false; scene.add(pin);
}
const hiddenRoom = (r) => /廁|樓梯|電梯/.test(r.name);
function showBuildingCard(bid) {
  const info = BUILDING_INFO[bid];
  $('info-tag').hidden = true; $('info-title').textContent = info?.name ?? bid; $('info-sub').textContent = info?.note ?? ''; $('info-facts').textContent = '';
  const box = $('info-rooms'); box.textContent = '';
  const byFloor = new Map();
  for (const r of rooms) if (r.bid === bid) { if (!byFloor.has(r.floor)) byFloor.set(r.floor, []); byFloor.get(r.floor).push(r); }
  const rank = (f) => (f === 'B1' ? -1 : parseInt(f, 10));
  for (const f of [...byFloor.keys()].sort((a, b) => rank(b) - rank(a))) {
    const row = el('div', 'fl'); row.append(el('b', '', f)); const wrap = el('div', 'chips');
    for (const r of byFloor.get(f)) { if (hiddenRoom(r)) continue; const c = el('button', 'chip', r.name); c.style.setProperty('--c', CATS[r.cat].color); c.onclick = () => selectRoom(r, { focus: true }); wrap.append(c); }
    row.append(wrap); box.append(row);
  }
  $('info').hidden = false;
}
function selectRoom(r, { focus = false } = {}) {
  selectedRoom = r;
  if (!r) { outline.visible = false; pin.visible = false; $('info').hidden = true; refreshLabels(); return; }
  const info = BUILDING_INFO[r.bid];
  const facts = $('info-facts'); facts.textContent = '';
  for (const [k, v] of [['位置', `${info?.name ?? ''}・${r.floor}`], ['類別', CATS[r.cat].label]]) { const row = el('div', 'fact'); row.append(el('span', '', k), el('b', '', v)); facts.append(row); }
  const badge = /^\d{3}$/.test(r.name);
  $('info-tag').hidden = !badge; $('info-tag').textContent = badge ? r.name : '';
  $('info-title').textContent = badge ? '普通教室' : r.name; $('info-sub').textContent = '';
  const more = el('button', 'more', `看${info?.name ?? ''}全部空間`); more.onclick = () => showBuildingCard(r.bid);
  $('info-rooms').textContent = ''; $('info-rooms').append(more); $('info').hidden = false;
  if (!r.noMesh && r.bid !== 'gym') { outline.visible = true; outline.scale.set(r.w + 0.3, 3.1, r.d + 0.3); outline.position.set(r.x, r.y - 1.55, r.z); } else outline.visible = false;
  pin.visible = true; pin.position.set(r.x, r.y + 0.6, r.z);
  if (floorSel !== 'all' && r.fl > floorSel) { floorSel = r.fl; applyFloor(); }
  if (focus) {
    const bb = buildingBounds.get(r.bid); const span = Math.max(32, Math.min(90, Math.max((bb?.x1 - bb?.x0) || 0, (bb?.z1 - bb?.z0) || 0) * 0.45));
    fly(new THREE.Vector3(r.x + span * 0.4, r.y + span * 0.75 + 8, r.z + span * 0.95), new THREE.Vector3(r.x, r.y - 1, r.z));
  }
  refreshLabels();
}
$('info-close').onclick = () => selectRoom(null);

{ // 側欄：建築清單與校門
  for (const [bid, info] of Object.entries(BUILDING_INFO)) {
    const bb = buildingBounds.get(bid); if (!bb || ['wc', 'game'].includes(bid)) continue;
    const b = el('button', ''); b.append(el('span', 'nm', info.name), el('em', '', bb.top < 1 ? 'B1' : `${Math.max(1, Math.round(bb.top / FLOOR_H))}F`));
    b.onclick = () => {
      selectedRoom = null; outline.visible = false; pin.visible = false; showBuildingCard(bid);
      const cx = (bb.x0 + bb.x1) / 2; const cz = (bb.z0 + bb.z1) / 2; const s = Math.max(bb.x1 - bb.x0, bb.z1 - bb.z0, 30);
      fly(new THREE.Vector3(cx + s * 0.4, bb.top + s * 0.75 + 12, cz + s * 0.9), new THREE.Vector3(cx, bb.top * 0.4, cz));
    };
    $('list').append(b);
  }
  for (const g of gateInfo) { const b = el('button', ''); b.append(el('span', 'nm', g.name)); b.onclick = () => fly(new THREE.Vector3(g.x + 28, 20, g.z + 28), new THREE.Vector3(g.x, 2, g.z)); $('places').append(b); }
}

const searchIndex = [];
for (const r of rooms) if (!/^廁/.test(r.name)) { const nm = BUILDING_INFO[r.bid]?.name ?? ''; searchIndex.push({ r, text: `${r.name} ${nm} ${r.floor}`.toLowerCase(), label: r.name, sub: `${nm}・${r.floor}` }); }
{
  const inp = $('search'); const res = $('results');
  const run = () => {
    const q = inp.value.trim().toLowerCase(); res.textContent = ''; res.hidden = !q; if (!q) return;
    const hits = searchIndex.filter((s) => s.text.includes(q)).slice(0, 12);
    if (!hits.length) { res.append(el('div', 'none', '找不到符合的空間')); return; }
    for (const h of hits) { const b = el('button', ''); b.append(el('span', 'nm', h.label), el('em', '', h.sub)); b.onclick = () => { res.hidden = true; inp.value = h.label; selectRoom(h.r, { focus: true }); }; res.append(b); }
  };
  inp.addEventListener('input', run); inp.addEventListener('focus', run);
  addEventListener('pointerdown', (e) => { if (!$('searchbox').contains(e.target)) res.hidden = true; });
}

const ray = new THREE.Raycaster(); const ptr = new THREE.Vector2(); let down = null;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || mode !== 'orbit') return; if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
  const rc = canvas.getBoundingClientRect(); ptr.set(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1); ray.setFromCamera(ptr, camera);
  const hit = ray.intersectObjects(pickables.filter((m) => m.visible), false)[0];
  selectRoom(hit ? hit.object.userData.room : null);
});

// ───────── 日夜 / 標籤 / 其他按鈕 ─────────
let night = false;
function applyTime() {
  const p = night ? NIGHT : DAY; scene.background.setHex(p.sky); scene.fog.color.setHex(p.sky);
  sun.intensity = p.sun; hemi.intensity = p.hemi; glowMats.forEach((m) => { m.emissiveIntensity = p.win; });
  $('btn-night').classList.toggle('on', night); $('btn-night').textContent = night ? '☀ 白天' : '☾ 夜晚';
}
$('btn-night').onclick = () => { night = !night; applyTime(); };
$('btn-labels').classList.add('on');
$('btn-labels').onclick = () => { labelsOn = !labelsOn; $('btn-labels').classList.toggle('on', labelsOn); refreshLabels(); };
$('btn-home').onclick = () => { selectRoom(null); floorSel = 'all'; applyFloor(); fly(HOME.pos.clone(), HOME.target.clone()); };
$('btn-side').onclick = () => $('side').classList.toggle('open');
$('btn-maps').href = MAPS_URL;
$('btn-spin').onclick = () => { const on = !orbit.autoRotate; orbit.autoRotate = on; orbit.autoRotateSpeed = 1.2; $('btn-spin').classList.toggle('on', on); };

// ───────── 小地圖 ─────────
const mini = $('minimap'); const mctx = mini.getContext('2d'); const MW = mini.width; const MH = mini.height;
const EXT = { x0: -215, x1: 40, z0: -90, z1: 170 };
const mx = (x) => ((x - EXT.x0) / (EXT.x1 - EXT.x0)) * MW; const mz = (z) => ((z - EXT.z0) / (EXT.z1 - EXT.z0)) * MH;
const miniBase = document.createElement('canvas'); miniBase.width = MW; miniBase.height = MH;
{
  const c = miniBase.getContext('2d'); c.fillStyle = '#e9e4d6'; c.fillRect(0, 0, MW, MH); c.lineCap = 'round'; c.lineJoin = 'round';
  const path = (pts) => { c.beginPath(); pts.forEach(([x, n], i) => (i ? c.lineTo(mx(x), mz(-n)) : c.moveTo(mx(x), mz(-n)))); };
  for (const a of world.areas) if (['farmland', 'grass', 'park', 'meadow'].includes(a.k)) { c.fillStyle = '#c4d9a4'; path(a.p); c.fill(); }
  for (const r of world.roads) { const s = ROAD[r.c] ?? ROAD.service; c.strokeStyle = '#fff'; c.lineWidth = Math.max(1.5, s.w * 0.9); path(r.p); c.stroke(); c.strokeStyle = '#b8b2a4'; c.lineWidth = Math.max(0.8, s.w * 0.9 - 2); path(r.p); c.stroke(); }
  for (const b of world.buildings) { c.fillStyle = '#c9c1b0'; path(b.p); c.fill(); }
  for (const r of rooms) { if (r.noMesh) continue; c.fillStyle = CATS[r.cat].color; c.fillRect(mx(r.x - r.w / 2), mz(r.z - r.d / 2), Math.max(1.2, (r.w / (EXT.x1 - EXT.x0)) * MW), Math.max(1.2, (r.d / (EXT.z1 - EXT.z0)) * MH)); }
}
const compassNeedle = $('compass-needle');
function drawMini() {
  mctx.drawImage(miniBase, 0, 0);
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  const cx = mx(camera.position.x); const cy = mz(camera.position.z); const ang = Math.atan2(dir.x, -dir.z);
  mctx.save(); mctx.translate(cx, cy); mctx.rotate(ang);
  mctx.fillStyle = 'rgba(255,90,20,.28)'; mctx.beginPath(); mctx.moveTo(0, 0); mctx.arc(0, 0, 48, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); mctx.fill();
  mctx.fillStyle = '#ff5a14'; mctx.beginPath(); mctx.arc(0, 0, 4, 0, 7); mctx.fill(); mctx.restore();
  compassNeedle.style.transform = `rotate(${-ang}rad)`;
}
mini.addEventListener('click', (e) => {
  if (mode !== 'orbit') return; const r = mini.getBoundingClientRect();
  const x = EXT.x0 + ((e.clientX - r.left) / r.width) * (EXT.x1 - EXT.x0); const z = EXT.z0 + ((e.clientY - r.top) / r.height) * (EXT.z1 - EXT.z0);
  fly(new THREE.Vector3(x + 20, 60, z + 70), new THREE.Vector3(x, 0, z), 800);
});

// ───────── 主迴圈 ─────────
function resize() { const w = canvas.clientWidth; const h = canvas.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
let last = performance.now(); let slowT = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (mode === 'walk') stepWalk(dt); else { stepFly(now); orbit.update(); }
  if (pin.visible && selectedRoom) pin.position.y = selectedRoom.y + 0.6 + Math.sin(now / 300) * 0.35;
  if (now - slowT > 150) { drawMini(); refreshLabels(); slowT = now; }
  renderer.render(scene, camera); requestAnimationFrame(loop);
}
applyFloor(); applyCat(); refreshLabels();
requestAnimationFrame(loop);
$('loading').remove();

{ // 網址參數：?night=1 ?floor=2 ?room=教務處
  const q = new URLSearchParams(location.search);
  if (q.get('night') === '1') { night = true; applyTime(); }
  const fl = parseInt(q.get('floor'), 10); if (fl >= 1 && fl <= 5) { floorSel = fl; applyFloor(); }
  const roomQ = q.get('room'); if (roomQ) { const h = searchIndex.find((s) => s.r.name === roomQ); if (h) selectRoom(h.r, { focus: true }); }
}
window.__campus = { camera, orbit, selectRoom, setMode, scene, rooms, buildingBounds, fly, THREE, setFloor: (f) => { floorSel = f; applyFloor(); } };
