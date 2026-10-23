// Cherry BiM — просмотрщик двойника: low poly, только цвета. Данные — /api/twin, живые состояния — /api/live.
// Все адреса относительные: страница работает и сама по себе, и под ingress Home Assistant.
import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);                  // как в модели: Z вверх, метры

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(path, opt = {}) {
  const headers = { ...(typeof opt.body === "string" ? { "Content-Type": "application/json" } : {}), ...(opt.headers || {}) };
  const r = await fetch(path, { ...opt, headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `${r.status} ${r.statusText}`);
  return j;
}
const send = (path, body, method = "POST") => api(path, { method, body: JSON.stringify(body) });

// ── цвета ───────────────────────────────────────────────────────────────────
const COL = {
  wallExt: 0xeeeae3, wallInt: 0xfaf8f4, glass: 0x9fd3ef, door: 0xffffff, entrance: 0xb3362f,
  building: 0xe3dccf, ghost: 0xb9c4cf, unitAccent: 0xe4572e,
  heat: 0xe4572e, water: 0x2e86de, cable: 0xf2a23a, socket: 0x5d6d7e, vent: 0x95a5a6, mep: 0x8e44ad,
  devOff: 0xb7bec6, lightOn: 0xffc928, heatOn: 0xff8a3d, coolOn: 0x4fc3f7, mediaOn: 0x8e6bd8, vacuum: 0x37474f, vacOn: 0x2fa86a,
  sel: 0xff7a45, rel: 0x3f9cff,
};
const FURN = { bed: 0xcdb79e, sofa: 0x9fb3c8, desk: 0xbf9f78, dining_table: 0xbf9f78, bookshelf: 0xb08d62,
  nightstand: 0xc9b08d, wardrobe: 0xd8cdbd, vanity: 0xf2f2f2, pet_bowl: 0x5d8aa8, mirror: 0xcfe3ee };
const FEATURE = [["playground", 0xf2c14e], ["parking", 0xa8b0b8], ["gazebo", 0xb7895a], ["shelter", 0xb7895a],
  ["pitch", 0x7fb069], ["sport", 0x7fb069], ["grass", 0xa5d17a], ["garden", 0xa5d17a], ["park", 0xa5d17a]];
const NEIGHBOUR = [0xc9d4e3, 0xd8cde3, 0xcfe0d2, 0xe6d5c3, 0xe3cdd2, 0xd2dde6];
const ROOM = [0xf3e6d3, 0xe0ecdc, 0xdce7f2, 0xf2dfe3, 0xe8e1f2, 0xefeccf, 0xd9ecec, 0xf0e2d0, 0xe2e9d4, 0xe6dcef];
const DEV_H = { light: -0.06, lamp: 0.9, ac: 2.2, tv: 1.1, speaker: 0.95, breezer: 1.6 };   // light — от потолка
const VAC = { docked: "на базе", cleaning: "убирает", returning: "едет на базу", idle: "стоит", paused: "пауза", error: "ошибка" };
const PLACE_KINDS = new Set(["storage", "furniture", "space", "unit", "item"]);
const TOGGLE = new Set(["light", "switch", "fan"]);
const REL = { feeds: "питает", controls: "управляет", serves: "обслуживает", supplied_by: "от", has_member: "в составе",
  finishes: "отделка", stacked_above: "над" };
const REL_IN = { feeds: "питается от", controls: "управляется", serves: "обслуживается", supplied_by: "питает",
  has_member: "входит в", stacked_above: "под" };
const PROP = { number: "номер", area_brti: "площадь по БРТИ, м²", area_dev: "площадь по плану, м²", area_total_brti: "общая площадь, м²",
  area_living_brti: "жилая, м²", area_with_loggia: "с лоджией, м²", ceiling: "потолок, м", ceiling_slab: "до плиты, м",
  ceiling_type: "потолок", finishing: "отделка", interior_doors: "межкомнатные двери", note: "заметка", qty: "сколько",
  by: "кто", added_at: "записано", moved_at: "переложено", breaker: "автомат", brti_room: "помещение БРТИ",
  floors: "этажей", flats: "квартир", project: "проект", material: "материал", color: "цвет", stack: "стояк квартир",
  outlet_heights_mm: "высоты розеток, мм", codes: "коды", parts: "состав", node: "узел", level: "уровень",
  width: "ширина, м", depth: "глубина, м", height: "высота, м", wiring_changed: "разводку меняли",
  wiring_source: "разводка по", origin: "откуда" };

// ── сцена ───────────────────────────────────────────────────────────────────
const canvas = $("#c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.03, 5000);
camera.position.set(-12, -18, 22);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.maxPolarAngle = Math.PI * 0.495;
controls.screenSpacePanning = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8f9aa6, 2.3));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(-40, -70, 100);
scene.add(sun);
const world = new THREE.Group();
const helpers = new THREE.Group();
scene.add(world, helpers);

function themeColors() {
  const css = getComputedStyle(document.documentElement);
  scene.background = new THREE.Color(css.getPropertyValue("--scene").trim() || "#e9edf1");
}
themeColors();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", themeColors);

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);

// ── состояние ───────────────────────────────────────────────────────────────
const S = {
  data: null, ver: -1, by: new Map(), kids: new Map(), refsIn: new Map(), obj: new Map(), labels: [],
  unit: null, view: "unit", cut: true, mep: true, sel: null, states: {}, ha: {}, features: {},
  floorHit: null, puck: null, devices: [], fitted: false,
};

window.cherrybim = { S, scene, camera, controls };        // для отладки из консоли

function ancestors(id) {
  const out = [];
  let e = S.by.get(id);
  while (e && e.parent && S.by.has(e.parent)) { e = S.by.get(e.parent); out.push(e); }
  return out;
}
function descendants(id) {
  const out = [], st = [...(S.kids.get(id) || [])];
  while (st.length) { const e = st.pop(); out.push(e); st.push(...(S.kids.get(e.id) || [])); }
  return out;
}
const push = (map, k, v) => (map.get(k) || map.set(k, []).get(k)).push(v);

function index(data) {
  S.data = data; S.ver = data.version; S.features = data.features || {}; S.ha = data.ha || {};
  S.states = data.states || S.states;
  S.by.clear(); S.kids.clear(); S.refsIn.clear();
  for (const e of data.entities) S.by.set(e.id, e);
  for (const e of data.entities) {
    if (e.parent && S.by.has(e.parent)) push(S.kids, e.parent, e);
    for (const r of e.refs || []) push(S.refsIn, r.to, { rel: r.rel, from: e.id });
  }
  let best = null, n = -1;
  for (const e of data.entities) {
    if (e.kind !== "unit") continue;
    const k = descendants(e.id).filter(d => d.geom).length;
    if (k > n) { best = e; n = k; }
  }
  S.unit = best;
  const bld = best && ancestors(best.id).find(a => a.kind === "building");
  for (const e of data.entities) {
    const chain = ancestors(e.id);
    e._inUnit = !!best && (e.id === best.id || chain.some(a => a.id === best.id));
    e._bld = (e.kind === "building" ? e : chain.find(a => a.kind === "building"))?.id;
    e._myBld = !!bld && e._bld === bld.id;
    e._floor = !!best && !e._inUnit && chain.some(a => a.id === best.parent);   // на том же этаже, что и квартира
  }
}

// ── геометрия ───────────────────────────────────────────────────────────────
const mats = new Map();
function mat(color, opt = {}) {
  const key = color + "|" + JSON.stringify(opt);
  if (!mats.has(key)) mats.set(key, new THREE.MeshLambertMaterial({ color, flatShading: true, ...opt }));
  return mats.get(key);
}
function ownMat(color) {                                  // у устройства свой материал: его красит состояние
  const m = new THREE.MeshLambertMaterial({ color, flatShading: true });
  m.userData.own = true;
  return m;
}
const GHOST = mat(COL.ghost, { transparent: true, opacity: 0.16, depthWrite: false });
GHOST.userData.ghost = true;
const GHOST2 = mat(COL.building, { transparent: true, opacity: 0.4, depthWrite: false });
GHOST2.userData.ghost = true;
const ACCENT = mat(COL.unitAccent);

function shapeOf(g) {
  const s = new THREE.Shape(g.outline.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of g.holes || []) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  return s;
}

function familyColor(e) {
  const t = e.type || "", n = (e.name || "").toLowerCase();
  if (e.kind === "feature") return (FEATURE.find(([k]) => t.includes(k)) || [0, 0xc8d6a0])[1];
  if (t.includes("outlet") || t.includes("socket")) return COL.socket;
  if (t.includes("cable") || t === "junction_box") return COL.cable;
  if (t.includes("radiator") || t.includes("heating") || t === "pipe_pair" || t === "towel_warmer" || n.includes("отоплен")) return COL.heat;
  if (t.includes("water") || ["washbasin", "toilet", "bath", "shower"].includes(t)) return COL.water;
  if (t.includes("vent")) return COL.vent;
  return COL.mep;
}

function boxColor(e) {
  const t = e.type || "";
  if (e.kind === "opening") return t === "entrance_door" ? COL.entrance : t.includes("door") && !t.includes("balcony") ? COL.door : COL.glass;
  if (e.kind === "furniture") return FURN[t] ?? 0xc8ad86;
  if (e.kind === "storage") return t === "drawer" ? 0xf1e9dc : t === "hanging" ? 0xe9e4f2 : 0xe6dccb;
  if (e.kind === "mep") return t === "bath" ? 0xf5f7f8 : familyColor(e);
  return 0xcccccc;
}

function marker(e) {
  const t = e.type || "";
  let r = 0.06, color = familyColor(e);
  if (e.kind === "device") { r = 0.07; color = COL.devOff; }
  else if (t.includes("outlet") || t.includes("socket")) r = 0.035;
  else if (t === "junction_box") r = 0.03;
  else if (["radiator", "heating_manifold", "towel_warmer", "water_riser", "washbasin", "toilet"].includes(t)) r = 0.1;
  else if (t === "vent_shaft") r = 0.13;
  else if (e.kind === "furniture") { r = 0.08; color = FURN[t] ?? 0xcfe3ee; }
  const geo = new THREE.IcosahedronGeometry(r, 0);
  if (e.kind === "device") geo.translate(0, 0, 0.16);       // термостат на радиаторе — чуть выше
  return new THREE.Mesh(geo, e.kind === "device" ? ownMat(color) : mat(color));
}

function pipe(points, r, color) {
  const grp = new THREE.Group(), m = mat(color), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i + 1 < points.length; i++) {
    const a = new THREE.Vector3(...points[i]), b = new THREE.Vector3(...points[i + 1]);
    const d = b.clone().sub(a), len = d.length();
    if (len < 1e-4) continue;
    const geo = new THREE.CylinderGeometry(r, r, len, 6, 1);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d.normalize()));
    geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    grp.add(new THREE.Mesh(geo, m));
    if (i > 0) {
      const j = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 1.25, 0), m);
      j.position.copy(a);
      grp.add(j);
    }
  }
  return grp;
}

function makeObject(e, nextRoomColor) {
  const g = e.geom;
  if (!g) return null;
  const k = e.kind, t = e.type || "";
  if (g.type === "extrusion") {
    const shape = shapeOf(g);
    if (k === "unit") {                                   // квартира — плита под полом; объём только при выделении
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
      geo.translate(0, 0, (g.z0 || 0) - 0.08);
      const n = parseInt(e.props?.number, 10);          // соседи по этажу — каждая своим цветом
      const m = new THREE.Mesh(geo, mat(e === S.unit ? 0xd6d0c6 : NEIGHBOUR[(isNaN(n) ? 0 : n) % NEIGHBOUR.length]));
      m.userData.floor = true;
      m.userData.shape = shape;
      m.userData.h = g.height || 2.5;
      return m;
    }
    if (k === "space") {                                  // комната — пол; объём рисуется только при выделении
      const geo = new THREE.ShapeGeometry(shape);
      geo.translate(0, 0, (g.z0 || 0) + 0.004);
      const col = t === "loggia" ? 0xd5e1e8 : t === "common" ? 0xdfe3e8 : t === "lift_shaft" ? 0x8f9aa6 : nextRoomColor();
      const m = new THREE.Mesh(geo, mat(col, { side: THREE.DoubleSide }));
      m.userData.floor = true;
      m.userData.shape = shape;
      m.userData.h = g.height || 2.5;
      return m;
    }
    const h = g.height > 0 ? g.height : 0.02;
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
    geo.translate(0, 0, g.z0 || 0);
    let color = 0xd0d0d0;
    if (k === "wall") color = t === "exterior" ? COL.wallExt : COL.wallInt;
    else if (k === "building" || k === "section") color = COL.building;
    else if (k === "feature") color = familyColor(e);
    const m = new THREE.Mesh(geo, mat(color));
    m.userData.h = h;
    m.userData.shape = shape;
    return m;
  }
  if (g.type === "box") {
    const [x, y, z] = g.size;
    const geo = new THREE.BoxGeometry(x, y, z);
    geo.translate(x / 2, y / 2, z / 2);
    const glass = boxColor(e) === COL.glass;
    const holder = (S.kids.get(e.id) || []).some(c => c.kind === "storage");   // шкаф с ящиками — полупрозрачный
    const opt = glass ? { transparent: true, opacity: 0.55 } : holder ? { transparent: true, opacity: 0.32, depthWrite: false } : {};
    return new THREE.Mesh(geo, mat(boxColor(e), opt));
  }
  if (g.type === "polyline") return pipe(g.points, Math.max((g.diameter || 0.012) / 2, 0.008) * 1.6, familyColor(e));
  if (g.type === "point") return marker(e);
  return null;
}

function storeyLines(section) {
  // линии этажей по контуру подъезда — чтобы в виде «Дом» было видно, где какой этаж
  const g = section.geom;
  const pts = g.outline.map(([x, y]) => new THREE.Vector3(x, y, 0));
  const grp = new THREE.Group();
  const m = new THREE.LineBasicMaterial({ color: 0x7d8a96, transparent: true, opacity: 0.55 });
  for (const st of S.kids.get(section.id) || []) {
    if (st.kind !== "storey" || !st.placement) continue;
    const z = st.placement.pos[2];
    if (z <= 0.01) continue;
    const geo = new THREE.BufferGeometry().setFromPoints(pts.map(p => p.clone().setZ(z)));
    grp.add(new THREE.LineLoop(geo, m));
  }
  grp.userData.noPick = true;
  return grp;
}

function build() {
  for (const o of S.obj.values()) o.traverse(c => c.geometry?.dispose());
  world.clear(); S.obj.clear(); S.labels.forEach(l => l.el.remove()); S.labels = []; S.devices = [];
  let rn = 0;
  const nextRoomColor = () => ROOM[rn++ % ROOM.length];
  for (const e of S.data.entities) {
    let o = null;
    try { o = makeObject(e, nextRoomColor); } catch (err) { console.warn("геометрия", e.name, err); }
    if (!o) continue;
    o.traverse(c => { c.userData.id = e.id; });
    o.matrixAutoUpdate = false;
    o.userData.base = new THREE.Matrix4().set(...e.m.flat());
    o.matrix.copy(o.userData.base);
    if (e.kind === "section") o.add(storeyLines(e));
    world.add(o);
    S.obj.set(e.id, o);
    if (e.kind === "device") S.devices.push(e);
  }
  world.updateMatrixWorld(true);
  placeLooseDevices();
  makeLabels();
  makePuck();
  applyView();
  paintDevices();
}

function placeLooseDevices() {
  // устройства без геометрии — значок в своей комнате: свет под потолком, остальное рядом
  const n = new Map();
  const ceil = S.unit?.props?.ceiling || 2.5;
  for (const e of S.data.entities) {
    if (e.kind !== "device" || e.geom || !e.parent || !S.obj.has(e.parent)) continue;
    const box = new THREE.Box3().setFromObject(S.obj.get(e.parent));
    const c = box.getCenter(new THREE.Vector3());
    const i = e.type === "light" ? 0 : (n.get(e.parent) || 0) + 1;
    if (e.type !== "light") n.set(e.parent, i);
    const dz = DEV_H[e.type] ?? 1.0;
    let geo;
    if (e.type === "light") { geo = new THREE.CylinderGeometry(0.22, 0.22, 0.05, 8); geo.rotateX(Math.PI / 2); }
    else geo = new THREE.IcosahedronGeometry(0.1, 0);
    const m = new THREE.Mesh(geo, ownMat(COL.devOff));
    const ang = i * 2.1;
    m.position.set(c.x + (i ? Math.cos(ang) * 0.55 : 0), c.y + (i ? Math.sin(ang) * 0.55 : 0),
      box.min.z + (dz < 0 ? ceil + dz : dz));
    m.userData.id = e.id;
    m.userData.z = m.position.z;
    if (e.type === "light") m.userData.zCut = box.min.z + 1.35;
    world.add(m);
    S.obj.set(e.id, m);
  }
}

function makePuck() {
  const vac = S.data.entities.find(e => e.kind === "device" && e.bind?.["dreame.camera"]);
  S.puck = null;
  if (!vac) return;
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.095, 10), mat(COL.vacuum));
  body.rotation.x = Math.PI / 2;
  body.position.z = 0.05;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.04), mat(0xffc928));
  nose.position.set(0.12, 0, 0.1);
  g.add(body, nose);
  g.traverse(c => { c.userData.id = vac.id; });
  g.visible = false;
  g.userData.camera = vac.bind["dreame.camera"];
  helpers.add(g);
  S.puck = g;
}

function makeLabels() {
  const box = $("#labels");
  const add = (e, pos, view, big = false) => {
    const el = document.createElement("span");
    el.textContent = e.name;
    if (big) el.className = "big";
    box.append(el);
    S.labels.push({ el, pos, view, id: e.id });
  };
  for (const e of S.data.entities) {
    const o = S.obj.get(e.id);
    if (!o) continue;
    if (e.kind === "space" && e._inUnit) {
      const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
      add(e, c, "unit");
    } else if (e._floor && (e.kind === "unit" || e.kind === "space") && e.kind !== "section") {
      const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
      if (e.type === "lift_shaft") continue;
      const num = e.props?.number && e.props.number !== "?" ? e.props.number : null;
      add({ ...e, name: e.kind === "unit" ? (num ? `кв. ${num}` : e.props?.plan || e.name) : e.name }, c, "house");
    } else if (e.kind === "section") {
      const b = new THREE.Box3().setFromObject(o);
      add(e, new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.max.z + 1.5), e._myBld ? "house" : "-");
    } else if (e.kind === "building") {
      const b = new THREE.Box3().setFromObject(o);
      add(e, new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.max.z + 4), "site", true);
    } else if (e.kind === "feature" && e.name && !/^(Парковка|Газон|Зелень)$/i.test(e.name)) {
      const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
      add(e, c, "site");
    }
  }
}

// ── виды и переключатели ────────────────────────────────────────────────────
function hasSectionGeom(e) { return (S.kids.get(e.id) || []).some(c => c.kind === "section" && c.geom); }

function visibleIn(e) {
  const k = e.kind, v = S.view;
  if (v === "unit") return e._inUnit && (S.mep || k !== "mep");
  if (v === "house") {
    if (e._inUnit) return ["wall", "space", "opening", "unit"].includes(k);
    if (e._myBld && e._floor && ["unit", "space", "mep"].includes(k)) return true;   // соседи, общие зоны, щиток этажа
    return e._myBld && (k === "section" || (k === "building" && !hasSectionGeom(e)));
  }
  if (e._inUnit) return k === "unit" || (k === "space" && !S.unit?.geom);
  return k === "feature" || k === "section" || (k === "building" && !hasSectionGeom(e));
}

function applyView() {
  for (const [id, o] of S.obj) {
    const e = S.by.get(id);
    o.visible = visibleIn(e);
    let over = null;
    if (S.view === "house" && !e._inUnit && o.visible && !e._floor) over = GHOST;
    if (S.view === "site" && e._inUnit) over = ACCENT;
    if (S.view === "site" && e._myBld && e.kind === "section") over = GHOST2;
    o.traverse(c => {
      if (!c.isMesh) return;
      if (!c.userData.mat0) c.userData.mat0 = c.material;
      c.material = c.userData.hl || over || c.userData.mat0;
    });
    if (e.kind === "section") o.children.forEach(c => { if (c.userData.noPick) c.visible = S.view !== "site"; });
    if (o.userData.zCut != null) {
      o.position.z = S.view === "unit" && S.cut ? o.userData.zCut : o.userData.z;
      o.updateMatrix();
    }
    // срез: стены квартиры ниже, чтобы видеть внутрь
    if (e.kind === "wall" || (e.kind === "opening" && e._inUnit)) {
      const h = e.geom?.height || e.geom?.size?.[2] || 2.5;
      const z0 = e.kind === "opening" ? e.placement?.pos?.[2] || 0 : e.geom?.z0 || 0;
      const top = 1.15, cut = S.view === "unit" && S.cut;
      o.matrix.copy(o.userData.base);
      if (cut && z0 + h > top) {
        if (z0 >= top) o.visible = false;
        else o.matrix.multiply(new THREE.Matrix4().makeScale(1, 1, (top - z0) / h));
      }
    }
  }
  world.updateMatrixWorld(true);
  document.querySelectorAll("#views button").forEach(b => b.classList.toggle("on", b.dataset.view === S.view));
  $("#t-cut").classList.toggle("on", S.cut);
  $("#t-mep").classList.toggle("on", S.mep);
  $("#t-cut").disabled = S.view !== "unit";
  $("#t-mep").disabled = S.view !== "unit";
  if (S.puck) S.puck.visible = S.view === "unit" && !!S.puck.userData.pose;
}

function setView(v, fit = true) {
  S.view = v;
  applyView();
  if (fit) fitVisible();
  setHash();
}

function fitVisible() {
  const box = new THREE.Box3();
  for (const o of S.obj.values()) if (o.visible) box.expandByObject(o);
  if (box.isEmpty()) return;
  fitBox(box, S.view === "unit" ? 1.05 : 1.25);
}

function fitBox(box, k = 1.2, animate = false) {
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const r = Math.max(s.x, s.y, s.z * 1.5, 0.6) * k;
  const dist = r / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.62;
  const dir = camera.position.clone().sub(controls.target).normalize();
  if (dir.z < 0.55) { dir.z = 0.55; dir.normalize(); }
  if (!isFinite(dir.x)) dir.set(-0.4, -0.6, 0.7).normalize();
  const to = c.clone().add(dir.multiplyScalar(dist));
  if (animate) fly(to, c); else { camera.position.copy(to); controls.target.copy(c); controls.update(); }
}

function lookAt(box, dist, elevation = 66) {
  // сверху, с той же стороны, откуда смотрели; мелочь — почти отвесно, иначе её закроет стена
  const c = box.getCenter(new THREE.Vector3());
  const az = Math.atan2(camera.position.y - controls.target.y, camera.position.x - controls.target.x);
  const el = THREE.MathUtils.degToRad(elevation);
  fly(new THREE.Vector3(c.x + Math.cos(az) * Math.cos(el) * dist, c.y + Math.sin(az) * Math.cos(el) * dist,
    c.z + Math.sin(el) * dist), c);
}

function frontView(target, furniture) {
  // ящик и полку смотрим спереди: фасад мебели — сторона −Y её системы (так у OpenFurnitureMaker)
  const c = new THREE.Box3().setFromObject(target).getCenter(new THREE.Vector3());
  const m = furniture.m;
  const front = new THREE.Vector3(-m[0][1], -m[1][1], 0).normalize();
  const size = new THREE.Vector3(...furniture.geom.size).length();
  const dist = Math.max(size * 1.6, 2.6);
  const el = THREE.MathUtils.degToRad(22);
  fly(c.clone().add(front.multiplyScalar(Math.cos(el) * dist)).add(new THREE.Vector3(0, 0, Math.sin(el) * dist)), c);
}

let flight = null;
function fly(pos, target) {
  flight = { t0: performance.now(), p0: camera.position.clone(), q0: controls.target.clone(), p1: pos, q1: target };
}

// ── кадр: полёт, подписи ────────────────────────────────────────────────────
const v3 = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  if (flight) {
    const u = Math.min(1, (performance.now() - flight.t0) / 650), s = u * u * (3 - 2 * u);
    camera.position.lerpVectors(flight.p0, flight.p1, s);
    controls.target.lerpVectors(flight.q0, flight.q1, s);
    if (u >= 1) flight = null;
  }
  controls.update();
  renderer.render(scene, camera);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  for (const l of S.labels) {
    const o = S.obj.get(l.id);
    const show = l.view === S.view && o && o.visible;
    if (!show) { l.el.style.display = "none"; continue; }
    v3.copy(l.pos).project(camera);
    if (v3.z > 1 || v3.z < -1) { l.el.style.display = "none"; continue; }
    l.el.style.display = "";
    l.el.style.left = `${(v3.x * 0.5 + 0.5) * w}px`;
    l.el.style.top = `${(-v3.y * 0.5 + 0.5) * h}px`;
  }
});

// ── выбор ───────────────────────────────────────────────────────────────────
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let down = null;
canvas.addEventListener("pointerdown", ev => { down = [ev.clientX, ev.clientY]; });
canvas.addEventListener("pointerup", ev => {
  if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 6) return;
  down = null;
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const pool = [...S.obj.values(), ...(S.puck?.visible ? [S.puck] : [])].filter(o => o.visible);
  const hits = ray.intersectObjects(pool, true).filter(h => {
    let o = h.object;
    for (; o; o = o.parent) if (!o.visible || o.userData.noPick) return false;
    return !h.object.material?.userData?.ghost;
  });
  if (!hits.length) { select(null); return; }
  // мелочь важнее пола и стен: если рядом по лучу есть розетка или вещь — берём её
  let h = hits[0];
  const big = x => { const e = S.by.get(x.object.userData.id); return e && ["space", "wall", "section", "building", "feature"].includes(e.kind); };
  if (big(h)) { const small = hits.find(x => !big(x) && x.distance - h.distance < 0.35); if (small) h = small; }
  // шкаф → секция → ящик: каждый следующий клик по тому же месту — на уровень глубже
  const chain = [h];
  for (const x of hits) {
    const last = chain[chain.length - 1].object.userData.id;
    if (x.object.userData.id !== last && ancestors(x.object.userData.id).some(a => a.id === last)) chain.push(x);
  }
  const at = chain.findIndex(x => x.object.userData.id === S.sel?.id);
  if (at >= 0) h = chain[Math.min(at + 1, chain.length - 1)];
  const e = S.by.get(h.object.userData.id);
  S.floorHit = e?.kind === "space" ? h.point.clone() : S.floorHit;
  select(e?.id, { fly: false });
});

function meshFor(id) {
  let e = S.by.get(id);
  while (e) {
    const o = S.obj.get(e.id);
    if (o) return o;
    e = S.by.get(e.parent);
  }
  return null;
}

function related(e) {
  const ids = new Set((e.refs || []).map(r => r.to));
  for (const r of S.refsIn.get(e.id) || []) if (r.rel !== "finishes" || e.kind === "finish") ids.add(r.from);
  if (e.kind === "finish") for (const r of e.refs || []) ids.add(r.to);
  return [...ids].filter(i => S.by.has(i));
}

function clearHighlight() {
  for (const o of S.obj.values()) o.traverse(c => { if (c.userData.hl) { delete c.userData.hl; c.material = c.userData.mat0 || c.material; } });
  helpers.children.filter(c => c !== S.puck).forEach(c => { helpers.remove(c); c.traverse(x => x.geometry?.dispose()); });
}

const hlMats = new Map();
function hlMat(color) {
  if (!hlMats.has(color)) hlMats.set(color, new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35, flatShading: true }));
  return hlMats.get(color);
}

function highlight(o, color) {
  if (!o) return;
  const e = S.by.get(o.userData.id);
  if (o.userData.floor) {                                 // комната: полупрозрачный объём и рёбра
    const geo = new THREE.ExtrudeGeometry(o.userData.shape, { depth: o.userData.h, bevelEnabled: false });
    const vol = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color }));
    for (const x of [vol, edges]) { x.matrixAutoUpdate = false; x.matrix.copy(o.matrixWorld); x.userData.noPick = true; helpers.add(x); }
  }
  if (e && ["space", "section", "building"].includes(e.kind) && o.userData.floor) return;
  o.traverse(c => { if (c.isMesh) { if (!c.userData.mat0) c.userData.mat0 = c.material; c.userData.hl = hlMat(color); c.material = c.userData.hl; } });
}

function select(id, { fly: doFly = true } = {}) {
  clearHighlight();
  S.sel = id ? S.by.get(id) : null;
  if (!S.sel) { $("#card").hidden = true; setHash(); return; }
  const e = S.sel;
  if (e._inUnit && S.view !== "unit") setView("unit", false);
  else if (e._floor && S.view !== "house") setView("house", false);
  if (e.kind === "mep" && !S.mep) { S.mep = true; applyView(); }
  const target = meshFor(e.id);
  for (const rid of related(e)) { const o = S.obj.get(rid); if (o && o !== target) highlight(o, COL.rel); }   // без подъёма к родителю: группа без геометрии не подсвечивает всю квартиру
  highlight(target, COL.sel);
  const shelf = target && [S.by.get(target.userData.id), ...ancestors(target.userData.id)].filter(a => ["storage", "furniture"].includes(a.kind)).pop();
  if (target && doFly && shelf && e._inUnit && shelf.geom?.type === "box") frontView(target, shelf);
  else if (target && doFly) {
    const box = new THREE.Box3().setFromObject(target);
    if (!box.isEmpty()) {
      const diag = box.getSize(new THREE.Vector3()).length();
      const room = ["space", "unit"].includes(e.kind);
      lookAt(box, Math.max(diag * (room ? 1.4 : 2.5), e._inUnit ? 7 : 18), room || !e._inUnit ? 62 : 80);
    }
  }
  renderCard(e);
  setHash();
}

// ── карточка ────────────────────────────────────────────────────────────────
const link = e => `<a data-sel="${e.id}">${esc(e.name)}</a>`;
function fmt(v) {
  if (Array.isArray(v)) return esc(v.map(x => (typeof x === "object" ? JSON.stringify(x) : x)).join(", "));
  if (v && typeof v === "object") return Object.entries(v).map(([k, x]) => `${esc(k)}: ${esc(typeof x === "object" ? JSON.stringify(x) : x)}`).join("<br>");
  if (typeof v === "boolean") return v ? "да" : "нет";
  return esc(v);
}
const ORIGIN = { manual: "записано вручную", voice: "записано голосом", photo: "по фото", ofm: "OpenFurnitureMaker",
  dreame: "карта пылесоса", brti: "БРТИ", osm: "OpenStreetMap", ha: "Home Assistant", measured: "замер" };
function srcText(s) {
  const acc = s.acc != null ? ` ±${s.acc >= 1 ? s.acc + " м" : Math.round(s.acc * 100) + " см"}` : "";
  const from = ORIGIN[s.from] || s.from.replace(/^project:/, "проект ").replace("zastroyshchik", "план застройщика");
  return esc(`${from}${acc}${s.at ? ", " + s.at : ""}`);
}
function bound(e) {
  const out = [];
  for (const [k, v] of Object.entries(e.bind || {})) if (k === "ha.entity") out.push(...(Array.isArray(v) ? v : [v]));
  return out;
}
function stateText(eid) {
  const s = S.states[eid];
  if (!s) return S.ha.connected ? "нет данных" : "нет связи с HA";
  const a = s.attributes || {};
  if (eid.startsWith("climate.")) {
    const t = a.current_temperature != null ? `${a.current_temperature}°` : "";
    return [t, s.state === "off" ? "выкл." : s.state, a.temperature != null ? `цель ${a.temperature}°` : ""].filter(Boolean).join(" · ");
  }
  if (eid.startsWith("light.")) return s.state === "on" ? "горит" : s.state === "off" ? "не горит" : s.state;
  if (eid.startsWith("media_player.")) return [s.state, a.media_title].filter(Boolean).join(" · ");
  if (eid.startsWith("vacuum.")) return [VAC[s.state] || s.state, a.battery_level != null ? `${a.battery_level}%` : ""].filter(Boolean).join(" · ");
  return s.state + (a.unit_of_measurement ? " " + a.unit_of_measurement : "");
}
function stateRow(eid) {
  const s = S.states[eid], on = s && ["on", "playing", "heat", "cool", "cleaning", "fan_only"].includes(s.state);
  const name = s?.attributes?.friendly_name || eid;
  const btn = TOGGLE.has(eid.split(".")[0]) && S.features.toggle && s
    ? `<button class="btn" data-act="toggle" data-eid="${esc(eid)}">${s.state === "on" ? "Выключить" : "Включить"}</button>` : "";
  return `<div class="st"><b>${esc(name)}</b><i class="${on ? "on" : ""}">${esc(stateText(eid))}</i>${btn}</div>`;
}

function itemsUnder(id) {
  const out = [];
  const walk = (pid, depth) => {
    for (const k of S.kids.get(pid) || []) {
      if (k.kind === "item") out.push([k, depth]);
      if (depth < 6 && ["storage", "furniture", "item", "space"].includes(k.kind)) walk(k.id, depth + 1);
    }
  };
  walk(id, 0);
  return out;
}
function relPath(e, from) {
  const chain = [];
  for (const a of ancestors(e.id)) { if (a.id === from) break; chain.unshift(a.name); }
  return chain.join(" → ");
}

function renderCard(e) {
  const chain = ancestors(e.id).reverse().filter(a => a.kind !== "site");
  let h = `<button class="x" data-act="close" title="Закрыть">×</button>`;
  h += `<div class="crumbs">${chain.map(link).join(" › ")}</div><h2>${esc(e.name)}</h2>`;
  h += `<div class="kind">${esc(e.ru || e.kind)}${e.src ? ` · ${srcText(e.src)}` : ""}</div>`;
  const ents = bound(e);
  if (e.kind === "device" && e.bind?.["dreame.camera"]) ents.push(e.bind["dreame.camera"]);
  if (ents.length) h += `<div class="ha">${ents.filter(x => !x.startsWith("camera.")).map(stateRow).join("")}</div>`;
  const props = Object.entries(e.props || {});
  if (props.length) h += `<dl class="props">${props.map(([k, v]) => `<dt>${esc(PROP[k] || k)}</dt><dd>${fmt(v)}</dd>`).join("")}</dl>`;
  if (e.aliases?.length) h += `<p class="note">Ещё называют: ${esc(e.aliases.join(", "))}</p>`;

  const fin = (S.refsIn.get(e.id) || []).filter(r => r.rel === "finishes").map(r => S.by.get(r.from)).filter(Boolean);
  if (fin.length) h += `<h3>Отделка</h3><ul>${fin.map(f => `<li>${link(f)}</li>`).join("")}</ul>`;
  const out = (e.refs || []).filter(r => S.by.has(r.to)).map(r => `<li>${esc(REL[r.rel] || r.rel)}: ${link(S.by.get(r.to))}</li>`);
  const inc = (S.refsIn.get(e.id) || []).filter(r => r.rel !== "finishes").map(r => `<li>${esc(REL_IN[r.rel] || r.rel)}: ${link(S.by.get(r.from))}</li>`);
  if (out.length + inc.length) h += `<h3>Связи</h3><ul>${[...out, ...inc].join("")}</ul>`;

  const kids = (S.kids.get(e.id) || []).filter(k => !["wall", "item", "finish", "system"].includes(k.kind));
  if (kids.length) {
    const groups = {};
    for (const k of kids) (groups[k.ru || k.kind] ||= []).push(k);
    h += `<h3>Внутри</h3><ul>${Object.entries(groups).map(([g, list]) =>
      list.length > 3 ? `<li>${esc(g)}: ${list.map(link).join(", ")}</li>` : list.map(k => `<li>${link(k)} <small>${esc(k.ru)}</small></li>`).join("")).join("")}</ul>`;
  }
  const items = PLACE_KINDS.has(e.kind) ? itemsUnder(e.id) : [];
  if (items.length) h += `<h3>Вещи (${items.length})</h3><ul>${items.map(([k]) => {
    const where = relPath(k, e.id);
    return `<li>${link(k)}${k.props?.qty ? ` ×${esc(k.props.qty)}` : ""}${where ? ` <small>${esc(where)}</small>` : ""}</li>`;
  }).join("")}</ul>`;

  // действия
  if (e.kind === "item" && e.editable) {
    h += `<h3>Вещь</h3><div class="row"><button class="btn" data-act="move">Переложить</button>`
      + `<button class="btn" data-act="edit">Изменить</button><button class="btn" data-act="remove">Вычеркнуть</button></div><div id="act"></div>`;
  } else if (e.kind === "item") {
    h += `<p class="note">Эта вещь записана в пакете квартиры: правится пересборкой.</p>`;
  }
  if (PLACE_KINDS.has(e.kind) && e.kind !== "item") {
    h += `<h3>Положить сюда</h3><form class="add" data-place="${e.id}"><input name="name" placeholder="Что положили" required>`
      + `<input name="qty" type="number" min="0" step="any" placeholder="шт."><button class="btn main">Записать</button></form>`;
    if (S.features.photos) h += `<div class="row"><button class="btn" data-act="photo">Фото → вещи</button></div><div id="photo"></div>`;
  }
  const share = [`<a href="api/plan.png?e=${encodeURIComponent(e.id)}&theme=light&label=1" target="_blank" rel="noopener">План картинкой</a>`];
  if (S.features.show) share.unshift(`<button class="btn" data-act="tv">На телевизор</button>`);
  h += `<div class="row">${share.join("")}</div>`;
  if (e.kind === "space" && S.features.vacuum) {
    const btns = [];
    if (e.bind?.["dreame.segment"]) btns.push(`<button class="btn" data-act="vac-clean">Убрать комнату</button>`);
    if (S.floorHit && insideFloor(e, S.floorHit)) btns.push(`<button class="btn" data-act="vac-goto">Пылесос сюда</button>`);
    if (btns.length) h += `<h3>Пылесос</h3><div class="row">${btns.join("")}</div>`;
  }
  const card = $("#card");
  card.innerHTML = h;
  card.hidden = false;
}

function insideFloor(e, p) {
  const o = S.obj.get(e.id);
  if (!o) return false;
  const box = new THREE.Box3().setFromObject(o).expandByScalar(0.01);
  return box.containsPoint(new THREE.Vector3(p.x, p.y, box.min.z));
}

function renderTree() {
  if (!S.unit) return;
  clearHighlight();
  S.sel = null;
  const skip = new Set(["wall", "opening", "finish", "system"]);
  const node = (e, depth) => {
    const kids = (S.kids.get(e.id) || []).filter(k => !skip.has(k.kind) && (S.mep || k.kind !== "mep"));
    const label = `${link(e)} <small>${esc(e.ru)}${e.props?.qty ? " ×" + esc(e.props.qty) : ""}</small>`;
    if (!kids.length) return `<div class="leaf">${label}</div>`;
    return `<details><summary>${label}</summary>${kids.map(k => node(k, depth + 1)).join("")}</details>`;
  };
  const top = S.kids.get(S.unit.id) || [];
  const rooms = top.filter(k => k.kind === "space");
  const fin = top.filter(k => k.kind === "finish"), sys = top.filter(k => k.kind === "system");
  let h = `<button class="x" data-act="close">×</button><h2>${esc(S.unit.name)}: всё по комнатам</h2>`;
  h += rooms.map(r => node(r, 0)).join("");
  if (fin.length) h += `<h3>Отделка</h3><ul>${fin.map(f => `<li>${link(f)}</li>`).join("")}</ul>`;
  if (sys.length) h += `<h3>Системы</h3><ul>${sys.map(f => `<li>${link(f)}</li>`).join("")}</ul>`;
  const card = $("#card");
  card.innerHTML = h;
  card.hidden = false;
}

// ── действия в карточке ─────────────────────────────────────────────────────
$("#card").addEventListener("click", async ev => {
  const a = ev.target.closest("[data-sel]");
  if (a) { ev.preventDefault(); select(a.dataset.sel); return; }
  const b = ev.target.closest("[data-act]");
  if (!b) return;
  const e = S.sel, act = b.dataset.act;
  try {
    if (act === "close") select(null);
    else if (act === "toggle") { b.disabled = true; await send("api/call", { entity_id: b.dataset.eid, service: "toggle" }); }
    else if (act === "remove" && confirm(`Вычеркнуть «${e.name}»?`)) { await api(`api/items/${e.id}`, { method: "DELETE" }); toast("Вычеркнул"); await reload(e.parent); }
    else if (act === "move") pickPlace(e);
    else if (act === "edit") editItem(e);
    else if (act === "photo") photoFlow(e.id);
    else if (act === "tv") {
      b.disabled = true;
      const r = await send("api/show", { ref: e.id });
      toast(r.ok ? "Показал на телевизоре" : r.tv_no_answer ? "Телевизор не ответил: UmediaPlus не открыт" : r.error || "Не получилось");
      b.disabled = false;
    }
    else if (act === "vac-clean" && confirm(`Отправить пылесос убирать: ${e.name}?`)) { await send("api/vacuum", { do: "clean", space: e.id }); toast("Пылесос поехал"); }
    else if (act === "vac-goto" && confirm("Отправить пылесос в эту точку?")) { await send("api/vacuum", { do: "goto", at: [S.floorHit.x, S.floorHit.y] }); toast("Пылесос едет"); }
  } catch (err) { toast(err.message); b.disabled = false; }
});

$("#card").addEventListener("submit", async ev => {
  const f = ev.target.closest("form.add");
  if (!f) return;
  ev.preventDefault();
  const name = f.name.value.trim(), qty = f.qty.value ? Number(f.qty.value) : null;
  if (!name) return;
  try {
    await send("api/items", { name, place: f.dataset.place, qty });
    toast(`Записал: ${name}`);
    await reload(f.dataset.place);
  } catch (err) { toast(err.message); }
});

function pickPlace(item) {
  const box = $("#act");
  box.innerHTML = `<div class="pick"><input placeholder="Куда? шкаф, ящик 2, кладовая…" autofocus><ul hidden></ul></div>`;
  const inp = box.querySelector("input"), ul = box.querySelector("ul");
  let t = 0;
  inp.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = inp.value.trim();
      if (!q) { ul.hidden = true; return; }
      const hits = await api(`api/search?kinds=storage,furniture,space,unit&q=${encodeURIComponent(q)}`);
      ul.innerHTML = hits.map(x => `<li data-id="${x.id}"><b>${esc(x.name)}</b> <small>${esc(x.short)}</small></li>`).join("") || `<li>Нет такого места</li>`;
      ul.hidden = false;
    }, 180);
  });
  ul.addEventListener("click", async ev => {
    const li = ev.target.closest("li[data-id]");
    if (!li) return;
    try { await send(`api/items/${item.id}`, { place: li.dataset.id }, "PATCH"); toast("Переложил"); await reload(item.id, true); }
    catch (err) { toast(err.message); }
  });
  inp.focus();
}

function editItem(item) {
  const box = $("#act");
  box.innerHTML = `<form class="add" data-edit="1"><input name="name" value="${esc(item.name)}" required>`
    + `<input name="qty" type="number" min="0" step="any" value="${esc(item.props?.qty ?? "")}" placeholder="шт.">`
    + `<input name="note" value="${esc(item.props?.note ?? "")}" placeholder="заметка" style="grid-column: 1 / -1">`
    + `<button class="btn main">Сохранить</button></form>`;
  box.querySelector("form").addEventListener("submit", async ev => {
    ev.preventDefault();
    ev.stopPropagation();
    const f = ev.target;
    try {
      await send(`api/items/${item.id}`, { name: f.name.value.trim(), qty: f.qty.value ? Number(f.qty.value) : null, note: f.note.value.trim() }, "PATCH");
      toast("Сохранил");
      await reload(item.id);
    } catch (err) { toast(err.message); }
  });
}

function photoFlow(placeId) {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "image/*";
  inp.setAttribute("capture", "environment");
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    const box = $("#photo");
    box.innerHTML = `<p class="note">Распознаю вещи на фото… это 10–30 секунд.</p>`;
    try {
      const blob = await shrink(f, 1600);
      const j = await api(`api/photo?place=${encodeURIComponent(placeId)}`, { method: "POST", body: blob, headers: { "Content-Type": "image/jpeg" } });
      if (!j.items.length) { box.innerHTML = `<p class="note">На фото не нашлось вещей для учёта.</p>`; return; }
      box.innerHTML = `<div class="photo">${j.items.map((n, i) => `<label><input type="checkbox" checked data-i="${i}"><input type="text" value="${esc(n)}"></label>`).join("")}`
        + `<div class="row"><button class="btn main" data-photo-save>Записать отмеченные</button></div></div>`;
      box.querySelector("[data-photo-save]").onclick = async ev => {
        ev.target.disabled = true;
        const rows = [...box.querySelectorAll("label")].filter(l => l.querySelector("input[type=checkbox]").checked);
        let n = 0;
        for (const l of rows) {
          const name = l.querySelector("input[type=text]").value.trim();
          if (!name) continue;
          await send("api/items", { name, place: placeId, origin: "photo" });
          n++;
        }
        toast(`Записал вещей: ${n}`);
        await reload(placeId);
      };
    } catch (err) { box.innerHTML = `<p class="note">Не вышло: ${esc(err.message)}</p>`; }
  };
  inp.click();
}

async function shrink(file, max) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise(res => c.toBlob(res, "image/jpeg", 0.85));
}

let toastT = 0;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, 3200);
}

// ── поиск ───────────────────────────────────────────────────────────────────
const q = $("#q"), res = $("#results");
let qt = 0, qseq = 0;
q.addEventListener("input", () => { clearTimeout(qt); qt = setTimeout(doSearch, 160); });
q.addEventListener("keydown", ev => {
  if (ev.key === "Enter") { const li = res.querySelector("li[data-id]"); if (li) pick(li.dataset.id); else doSearch(); }
  if (ev.key === "Escape") { res.hidden = true; q.blur(); }
});
q.addEventListener("focus", () => { if (res.children.length && q.value.trim()) res.hidden = false; });
document.addEventListener("pointerdown", ev => { if (!ev.target.closest("#searchbox")) res.hidden = true; });
document.addEventListener("keydown", ev => {
  if (ev.key === "/" && document.activeElement?.tagName !== "INPUT") { ev.preventDefault(); q.focus(); }
});
async function doSearch() {
  const s = q.value.trim(), my = ++qseq;
  if (!s) { res.hidden = true; return; }
  const hits = await api(`api/search?q=${encodeURIComponent(s)}`).catch(() => []);
  if (my !== qseq) return;
  res.innerHTML = hits.length
    ? hits.map(x => `<li data-id="${x.id}"><b>${esc(x.name)}</b><small>${esc(x.short)}</small></li>`).join("")
    : `<li class="none">Ничего не нашлось. Вещь можно записать в карточке места.</li>`;
  res.hidden = false;
}
res.addEventListener("click", ev => { const li = ev.target.closest("li[data-id]"); if (li) pick(li.dataset.id); });
function pick(id) { res.hidden = true; q.blur(); select(id); }

// ── кнопки ──────────────────────────────────────────────────────────────────
document.querySelectorAll("#views button").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
$("#t-cut").addEventListener("click", () => { S.cut = !S.cut; applyView(); });
$("#t-mep").addEventListener("click", () => { S.mep = !S.mep; applyView(); });
$("#t-tree").addEventListener("click", () => { if (S.view !== "unit") setView("unit"); renderTree(); });

// ── живые состояния ─────────────────────────────────────────────────────────
function devColor(e) {
  const st = bound(e).map(x => S.states[x]).filter(Boolean);
  const any = s => st.some(x => s.includes(x.state));
  if (e.type === "light" || e.type === "lamp") return any(["on"]) ? COL.lightOn : COL.devOff;
  if (["ac", "breezer", "thermostat"].includes(e.type)) return any(["heat"]) ? COL.heatOn : any(["cool", "fan_only", "auto", "dry"]) ? COL.coolOn : COL.devOff;
  if (["tv", "speaker"].includes(e.type)) return any(["on", "playing", "paused", "idle"]) ? COL.mediaOn : COL.devOff;
  if (e.type === "vacuum") return any(["cleaning", "returning"]) ? COL.vacOn : COL.vacuum;
  return COL.devOff;
}
function paintDevices(changed) {
  for (const e of S.devices.concat(S.data.entities.filter(x => x.kind === "device" && !x.geom))) {
    if (changed && !bound(e).includes(changed)) continue;
    const o = S.obj.get(e.id);
    if (!o) continue;
    const c = devColor(e), lit = c !== COL.devOff && c !== COL.vacuum;
    o.traverse(m => {
      if (!m.isMesh) return;
      const base = m.userData.mat0 || m.material;
      if (!base.userData?.own) return;
      base.color.setHex(c);
      base.emissive.setHex(lit ? c : 0x000000);
      base.emissiveIntensity = lit ? 0.55 : 0;
    });
  }
  // пылесос
  if (S.puck) {
    const s = S.states[S.puck.userData.camera];
    const pose = s?.pose;
    S.puck.userData.pose = pose || null;
    if (pose) {
      S.puck.position.set(pose[0], pose[1], pose[2]);
      S.puck.rotation.set(0, 0, THREE.MathUtils.degToRad(pose[3] || 0));
    }
    S.puck.visible = S.view === "unit" && !!pose;
  }
}

function status() {
  const dot = $("#dot"), t = $("#stxt");
  const items = S.data ? S.data.entities.filter(e => e.kind === "item").length : 0;
  const ha = !S.ha.enabled ? "без Home Assistant" : S.ha.rejected ? "HA отклонил токен" : S.ha.connected ? "HA на связи" : "HA: нет связи";
  dot.className = S.ha.connected ? "ok" : S.ha.enabled ? "bad" : "";
  t.textContent = `${ha} · вещей: ${items}`;
}

let ws = null;
function connect() {
  const u = new URL("api/live", location.href);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(u);
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.type === "hello" || m.type === "states") {
      S.states = m.states || {};
      S.ha = m.ha || S.ha;
      if (m.version != null && m.version !== S.ver) reload(S.sel?.id);
      else { paintDevices(); if (S.sel) renderCard(S.sel); }
      status();
    } else if (m.type === "state") {
      if (m.s) S.states[m.id] = m.s; else delete S.states[m.id];
      paintDevices(m.id);
      if (S.sel && (bound(S.sel).includes(m.id))) renderCard(S.sel);
    } else if (m.type === "twin" && m.version !== S.ver) reload(S.sel?.id);
  };
  ws.onclose = () => { S.ha = { ...S.ha, connected: false }; status(); setTimeout(connect, 5000); };
}

// ── загрузка и ссылки ───────────────────────────────────────────────────────
function setHash() {
  const p = new URLSearchParams();
  if (S.view !== "unit") p.set("v", S.view);
  if (S.sel) p.set("e", S.sel.key || S.sel.id);
  const h = p.toString();
  history.replaceState(null, "", h ? "#" + h : location.pathname + location.search);
}

async function reload(keepId, flyTo = false) {
  const cam = { p: camera.position.clone(), t: controls.target.clone() };
  const data = await api("api/twin");
  index(data);
  build();
  camera.position.copy(cam.p);
  controls.target.copy(cam.t);
  status();
  const id = keepId && S.by.has(keepId) ? keepId : null;
  if (id) select(id, { fly: flyTo }); else if (S.sel) select(null);
}

async function start() {
  try {
    const data = await api("api/twin");
    index(data);
    build();
    const p = new URLSearchParams(location.hash.slice(1));
    S.view = ["unit", "house", "site"].includes(p.get("v")) ? p.get("v") : S.unit ? "unit" : "site";
    applyView();
    resize();
    fitVisible();
    status();
    const want = p.get("e");
    if (want) { const e = S.by.get(want) || S.data.entities.find(x => x.key === want); if (e) select(e.id); }
    if (p.get("q")) { q.value = p.get("q"); doSearch(); }
    connect();
  } catch (err) {
    $("#stxt").textContent = "Не загрузилось: " + err.message;
  }
}
start();
