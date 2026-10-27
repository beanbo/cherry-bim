// Cherry BiM — просмотрщик двойника: реалистичная геометрия без текстур, свет, мягкие тени и затенение углов.
// Модели по типам — families.js, детали — kit.js, материалы — materials.js. Данные — /api/twin, живые состояния —
// /api/live. Все адреса относительные: страница работает и сама по себе, и под ingress Home Assistant.
import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { EffectComposer } from "./vendor/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "./vendor/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "./vendor/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "./vendor/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "./vendor/jsm/environments/RoomEnvironment.js";
import { buildFamily } from "./families.js";
import { fixture } from "./furnishings.js";
import { Kit } from "./kit.js";
import { M, pbr, hex } from "./materials.js";
import { createDirector } from "./director.js";
import { settleCoplanar } from "./coplanar.js";

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
  building: 0xe6e0d4, roof: 0xa9a59d, ghost: 0xb9c4cf, unitAccent: 0xe4572e,
  heat: 0xe4572e, water: 0x2e86de, cable: 0xf2a23a, socket: 0x5d6d7e, vent: 0x95a5a6, mep: 0x8e44ad,
  devOff: 0xf4f4f2, lightOn: 0xffc928, heatOn: 0xff8a3d, coolOn: 0x4fc3f7, mediaOn: 0x8e6bd8, vacuum: 0x37474f, vacOn: 0x2fa86a,
  badge: 0xb7bec6, sel: 0xff7a45, rel: 0x3f9cff,
};
const FURN = { bed: 0xcdb79e, sofa: 0x9fb3c8, desk: 0xbf9f78, dining_table: 0xbf9f78, bookshelf: 0xb08d62,
  nightstand: 0xc9b08d, wardrobe: 0xd8cdbd, vanity: 0xf2f2f2, pet_bowl: 0x5d8aa8, mirror: 0xcfe3ee };
const FEATURE = [["playground", 0xd9c79c], ["parking", 0x9aa0a6], ["gazebo", 0xb7895a], ["shelter", 0xb7895a],
  ["pitch", 0x7fae68], ["sport", 0x7fae68], ["grass", 0x9cc77a], ["garden", 0x9cc77a], ["park", 0x9cc77a]];
const NEIGHBOUR = [0xc9d4e3, 0xd8cde3, 0xcfe0d2, 0xe6d5c3, 0xe3cdd2, 0xd2dde6];
const DEV_H = { light: 0, lamp: 0.9, ac: 2.2, tv: 1.1, speaker: 0.95, breezer: 1.6 };   // light — у потолка
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
  wiring_source: "разводка по", origin: "откуда", brand: "марка", model: "модель", look: "как выглядит", size: "размер",
  where: "где", history: "история", mount: "крепление", light: "свет", feed: "подводка", wall: "стена", lid: "крышка",
  faucet: "смеситель", duct: "воздуховод", fronts: "фасады", countertop: "столешница", backsplash: "фартук",
  fittings: "фурнитура", carcass: "корпус", design: "проект", inside: "внутри", lock: "замок", frame: "рама",
  sill: "подоконник", outside: "снаружи", box: "упаковка", heating_hatch: "люк отопления", access: "доступ",
  riser: "стояк", out: "выход", risers: "стояки", group: "группа", cable_project: "кабель по проекту", panel: "щиток",
  rooms_note: "комнаты", seen_on_line: "на линии", trips_2024: "отключения 2024", group_note: "группа",
  places: "мест", keys: "клавиш", height_m: "высота, м", as_built: "как сделано", copy_of: "копия страницы",
  kitchen_project: "проект кухни", outlets_by_kitchen_project: "розетки по проекту", electrics_bought_2024_08_16: "куплено 16.08.2024",
  mattress: "матрас", bed: "кровать", table: "стол", chairs: "стулья", surface: "поверхность", clear_height: "до потолка, м",
  slab_height: "до плиты, м", valve: "клапан" };
const HIDDEN_PROPS = new Set(["render", "ids"]);          // подсказки для отрисовки — не для карточки; номера — отдельно
const DOC_PROPS = new Set(["url", "file", "mime", "size", "sha256", "saved_at", "pages", "copy_of"]);   // у документа — своим блоком
const FMT = { "application/pdf": "PDF", "text/html": "страница", "image/jpeg": "фото", "image/png": "картинка", "image/webp": "картинка" };
const HIDDEN_MEP = new Set(["cable", "pipe_pair", "water_riser", "duct"]);   // в стенах и стяжке: видны в режиме «Инженерия»
const hiddenMep = e => e.kind === "mep" && HIDDEN_MEP.has(e.type) && !e.props?.render?.exposed;   // render.exposed — проложен открыто
const CUT = 1.15;                                         // срез стен над полом квартиры, м
const QS = new URLSearchParams(location.search);          // ?ao=0 — без затенения углов, ?shadows=0 — без теней, ?msaa=0
// ?tv=1 — экран телевизора: без панелей, камеру ведёт режиссёр (director.js), тёмный фон; кадр 1:1 к пикселям
const TV = QS.get("tv") === "1";
if (TV) document.body.classList.add("tv");

// ── сцена ───────────────────────────────────────────────────────────────────
const canvas = $("#c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: "high-performance" });
renderer.setClearColor(0x000000, 0);                     // фон — цвет темы под холстом (CSS), тонмаппинг его не трогает
// ?tv=1&ss=2 — кадр рисуется вдвое крупнее и ужимается в поток: 16 выборок на точку вместо 4, тонкие кромки и блики
// издалека не мерцают (RTX 5070: 7–9 мс на кадр 3840×2160)
renderer.setPixelRatio(TV ? Number(QS.get("ss")) || 1 : Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = QS.get("shadows") !== "0";
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.03, 5000);
camera.position.set(-12, -18, 22);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.maxPolarAngle = Math.PI * 0.495;
controls.screenSpacePanning = true;

// свет: мягкое окружение (без картинок — комната из примитивов three.js), небо и солнце с тенями
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
const OUTSIDE_LIGHT = [2.1, 0.55, 0.55];                  // солнце, небо, окружение: срез и виды снаружи
const INSIDE_LIGHT = (QS.get("lt") || "0,1.0,0.9").split(",").map(Number);   // квартира под потолком; ?lt= — подбор
const hemi = new THREE.HemisphereLight(0xffffff, 0xd9d5ce, OUTSIDE_LIGHT[1]);
const sun = new THREE.DirectionalLight(0xfffaf3, OUTSIDE_LIGHT[0]);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.012;
const world = new THREE.Group();
const helpers = new THREE.Group();
const backdrop = new THREE.Group();                       // земля под кварталом
const ceilings = new THREE.Group();                       // потолки комнат: только в виде квартиры без среза
const outside = new THREE.Group();                        // земля, видная из окон квартиры (вид без среза)
scene.add(hemi, sun, sun.target, world, helpers, backdrop, ceilings, outside);

// кадр: сцена в буфер со сглаживанием, затенение углов (GTAO), тонмаппинг и sRGB
// ?msaa=0 — без сглаживания в буфере: программный WebGL (SwiftShader) пропускает в MSAA-буфере кромки закрытых вещей
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(2, 2, { samples: QS.get("msaa") === "0" ? 0 : 4, type: THREE.HalfFloatType }));
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, 2, 2);
gtao.updateGtaoMaterial({ radius: 0.32, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12 });
gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 12 });
gtao.blendIntensity = 0.65;                               // сильнее — шумит точками на тонких кромках
gtao.enabled = QS.get("ao") !== "0";
gtao.overrideVisibility = function () {                   // стекло, «призраки», рентген и места щелчка не затеняют
  const cache = this._visibilityCache;
  this.scene.traverse(o => {
    cache.set(o, o.visible);
    const m = o.material;
    if (o.isPoints || o.isLine || o.isLineSegments || (o.isMesh && !Array.isArray(m) && (m.transparent || !m.visible))) o.visible = false;
  });
};
composer.addPass(gtao);
// холст прозрачный, цвета в буфере умножены на альфу: перед тонмаппингом и sRGB умножение снимаем, потом
// возвращаем — иначе полупрозрачное (стекло, «призраки») поверх фона светлеет ореолом
const output = new OutputPass();
const fs = output.material.fragmentShader;
if (fs.includes("gl_FragColor = texture2D( tDiffuse, vUv );")) {
  output.material.fragmentShader = fs
    .replace("gl_FragColor = texture2D( tDiffuse, vUv );",
      "gl_FragColor = texture2D( tDiffuse, vUv ); float pa = gl_FragColor.a; if ( pa > 0.0001 ) gl_FragColor.rgb /= pa;")
    .replace(/\}\s*$/, "gl_FragColor.rgb *= pa; }");
}
composer.addPass(output);

let dirty = true;
const invalidate = () => { dirty = true; };
controls.addEventListener("change", invalidate);


function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  invalidate();
}
new ResizeObserver(resize).observe(canvas);

// ── состояние ───────────────────────────────────────────────────────────────
const S = {
  data: null, ver: -1, by: new Map(), kids: new Map(), refsIn: new Map(), obj: new Map(), labels: [],
  unit: null, view: "unit", cut: true, mep: false, sel: null, states: {}, ha: {}, features: {},
  floorHit: null, puck: null, devices: [], fitted: false,
};

window.cherrybim = { S, scene, camera, controls, invalidate, gtao, sun, renderer, composer };   // для отладки из консоли

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
    e._unit = e.kind === "unit" ? e : chain.find(a => a.kind === "unit") || null;
  }
}

// ── окружение для моделей: соседи, системы координат, контур квартиры ───────
const mat4 = e => e._M || (e._M = new THREE.Matrix4().set(...e.m.flat()));
function floorWorldZ(e) {
  const u = e._unit;
  if (u) return mat4(u).elements[14] + (u.geom?.z0 || 0);
  const st = e.kind === "storey" ? e : ancestors(e.id).find(a => a.kind === "storey");
  return st ? mat4(st).elements[14] : 0;
}
function inPoly(poly, x, y) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
const famEnv = {
  by: id => S.by.get(id),
  kids: id => S.kids.get(id) || [],
  get ceil() { return S.unit?.props?.ceiling || 2.55; },
  cutAt: CUT,
  floor: e => { const p = S.by.get(e.parent); return p?.kind === "space" ? floorMat(p) : null; },   // пол комнаты (в проёме двери)
  floorZ: e => mat4(e).elements[14] - floorWorldZ(e),
  rel: (a, b) => mat4(a).clone().invert().multiply(mat4(b)),
  own: e => ownMat(e ? offColor(e) : COL.devOff),
  // точка в системе сущности лежит вне контура её квартиры (снаружи дома или на лестнице)
  outside(e, p) {
    const u = e._unit;
    if (!u?.geom?.outline) return false;
    const w = new THREE.Vector3(...p).applyMatrix4(mat4(e)).applyMatrix4(mat4(u).clone().invert());
    return !inPoly(u.geom.outline, w.x, w.y);
  },
  // коробки сущностей этих видов (kind.type), стоящих в пределах коробки e, — в системе e
  within(e, types) {
    const [W, D, H] = e.geom.size, inv = mat4(e).clone().invert(), out = [];
    for (const o of S.data.entities) {
      if (o === e || o.geom?.type !== "box" || !types.includes(`${o.kind}.${o.type}`) || o._unit !== e._unit) continue;
      const [sx, sy, sz] = o.geom.size, m = inv.clone().multiply(mat4(o)), b = new THREE.Box3();
      for (const x of [0, sx]) for (const y of [0, sy]) for (const z of [0, sz]) b.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(m));
      const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2;
      if (cx < 0 || cx > W || cy < -0.1 || cy > D + 0.1 || b.max.z < -0.05 || b.min.z > H + 0.05) continue;
      out.push({ x0: b.min.x, y0: b.min.y, z0: b.min.z, x1: b.max.x, y1: b.max.y, z1: b.max.z });
    }
    return out;
  },
};

// ── материалы просмотрщика ──────────────────────────────────────────────────
function ownMat(color) {                                  // у устройства свой материал: его красит состояние
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.4 });
  m.userData.own = true;
  return m;
}
function ghostMat(color, opacity) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, transparent: true, opacity, depthWrite: false });
  m.userData.ghost = true;
  return m;
}
const GHOST = ghostMat(COL.ghost, 0.16);
const GHOST2 = ghostMat(COL.building, 0.4);
const ACCENT = pbr(COL.unitAccent, { rough: 0.7 });
const PICK = new THREE.MeshBasicMaterial({ visible: false });   // невидимый объём для щелчка по месту хранения
PICK.userData.pick = true;
const ghosts = new Map();
function ghostOf(m) {                                     // полупрозрачная копия: «рентген» шкафа при выборе ящика
  if (!ghosts.has(m)) {
    const g = m.clone();
    Object.assign(g, { transparent: true, opacity: 0.16, depthWrite: false });
    g.userData = { ghost: true };
    ghosts.set(m, g);
  }
  return ghosts.get(m);
}
const xrays = new Map();
function xrayOf(color) {                                  // то, что спрятано в стене или стяжке, видно сквозь неё
  if (!xrays.has(color)) {
    xrays.set(color, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, depthFunc: THREE.GreaterDepth, depthWrite: false }));
  }
  return xrays.get(color);
}

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

// пол комнаты — по отделке: ламинат, плитка; у лоджии и общих зон — свои
function floorMat(e) {
  if (e.type === "loggia") return M.loggia;
  if (e.type === "lift_shaft") return pbr(0x8f9aa6, { rough: 0.9 });
  if (e.type === "common") return pbr(0xd6d9dc, { rough: 0.7 });
  for (const r of S.refsIn.get(e.id) || []) {
    if (r.rel !== "finishes") continue;
    const f = S.by.get(r.from), on = f?.props?.render?.on;
    if (!f || !(Array.isArray(on) ? on.includes("floor") : f.type === "floor")) continue;
    const c = hex(f.props.render?.colors?.["*"], null);
    if (c != null) return pbr(c, { rough: f.props.render?.gloss ? 0.22 : 0.55 });
    return f.type?.startsWith("tile") ? M.tile : M.laminate;
  }
  return M.laminate;
}

// ── геометрия ───────────────────────────────────────────────────────────────
function marker(e) {
  const t = e.type || "";
  let r = 0.06, color = familyColor(e);
  if (e.kind === "device") { r = 0.07; color = COL.devOff; }
  else if (t.includes("outlet") || t.includes("socket")) r = 0.035;
  else if (t === "junction_box") r = 0.03;
  else if (["radiator", "heating_manifold", "towel_warmer", "water_riser", "washbasin", "toilet"].includes(t)) r = 0.1;
  else if (t === "vent_shaft") r = 0.13;
  else if (e.kind === "furniture") { r = 0.08; color = FURN[t] ?? 0xcfe3ee; }
  const geo = new THREE.SphereGeometry(r, 16, 10);
  if (e.kind === "device") geo.translate(0, 0, 0.16);       // термостат на радиаторе — чуть выше
  const m = new THREE.Mesh(geo, e.kind === "device" ? ownMat(color) : pbr(color, { rough: 0.5 }));
  m.castShadow = true;
  return m;
}

// трасса: кабель или пара труб (подача и обратка рядом); спрятанное в стене видно на «рентгене»
function lineObject(e) {
  const g = e.geom, kit = new Kit(), t = e.type || "";
  const r = Math.max((g.diameter || 0.012) / 2, 0.006);
  if (t === "pipe_pair") {
    const pts = g.points.map(p => new THREE.Vector3(...p));
    for (const [s, m] of [[-1, M.heat], [1, M.cold]]) {
      const off = pts.map((p, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        const d = b.clone().sub(a).setZ(0).normalize();
        return p.clone().add(new THREE.Vector3(-d.y, d.x, 0).multiplyScalar(s * (r + 0.012))).toArray();
      });
      kit.tube(m, off, r, 10);
    }
  } else kit.tube(pbr(hex(e.props?.render?.color, familyColor(e)), { rough: 0.5 }), g.points, r, 10);   // render.color — цвет оболочки
  return kit.build();
}

function boxFallback(e) {
  const [x, y, z] = e.geom.size;
  const geo = new THREE.BoxGeometry(x, y, z);
  geo.translate(x / 2, y / 2, z / 2);
  const color = e.kind === "furniture" ? FURN[e.type] ?? 0xc8ad86 : e.kind === "mep" ? familyColor(e) : 0xcccccc;
  const m = new THREE.Mesh(geo, pbr(color, { rough: 0.7 }));
  m.castShadow = m.receiveShadow = true;
  return m;
}

function extrusionObject(e, nextRoomColor) {
  const g = e.geom, k = e.kind, t = e.type || "";
  const shape = shapeOf(g);
  if (k === "unit") {                                     // квартира — плита перекрытия под полом
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
    geo.translate(0, 0, (g.z0 || 0) - 0.12);
    const n = parseInt(e.props?.number, 10);              // соседи по этажу — каждая своим цветом
    const m = new THREE.Mesh(geo, e === S.unit ? M.slab : pbr(NEIGHBOUR[(isNaN(n) ? 0 : n) % NEIGHBOUR.length], { rough: 0.85 }));
    m.receiveShadow = true;
    Object.assign(m.userData, { floor: true, shape, h: g.height || 2.5 });
    return m;
  }
  if (k === "space") {                                    // комната — пол; объём рисуется только при выделении
    const geo = new THREE.ShapeGeometry(shape);
    geo.translate(0, 0, (g.z0 || 0) + 0.004);
    const mat = e._inUnit || e.type !== "room" ? floorMat(e) : pbr(nextRoomColor(), { rough: 0.85 });
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    Object.assign(m.userData, { floor: true, shape, h: g.height || 2.5 });
    return m;
  }
  const h = g.height > 0 ? g.height : 0.02;
  if (k === "building" || k === "section") return Object.assign(buildingObject(e, g, h), { userData: { h, shape } });
  if (k === "feature" && t === "gazebo") return Object.assign(gazeboObject(g), { userData: { h, shape } });
  const own = k === "wall" && e._inUnit && S.unit && !(g.holes || []).length;
  const geo = own ? wallGeometry(e, g, h) : new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  if (!own) geo.translate(0, 0, g.z0 || 0);
  let mat;
  if (k === "wall") mat = [M.cutTop, M.paint];             // верх стены — цвет среза, как на разрезе
  else if (k === "feature") mat = pbr(familyColor(e), { rough: 0.95 });
  else mat = pbr(0xd0d0d0, { rough: 0.8 });
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = k !== "feature";
  m.receiveShadow = true;
  Object.assign(m.userData, { h, shape });
  return m;
}

// Стена квартиры без внутренних торцов: грань, которая упирается в соседнюю стену или в коробку двери, не строится.
// Иначе её ребро лежит в плоскости лицевой грани соседа, бьётся с ней по глубине и рисует на стене светлый пунктир.
let NB = null;                                            // соседи в системе квартиры: контуры стен и коробки дверей
function neighbours() {
  if (NB) return NB;
  const inv = mat4(S.unit).clone().invert();
  NB = [];
  for (const o of S.data.entities) {
    if (!o._inUnit) continue;
    const box = o.kind === "opening" && ["door", "entrance_door"].includes(o.type) && o.geom?.type === "box";
    const pts = o.kind === "wall" && o.geom?.outline ? o.geom.outline : box ? [[0, 0], [o.geom.size[0], 0], [o.geom.size[0], o.geom.size[1]], [0, o.geom.size[1]]] : null;
    if (!pts) continue;
    const m = inv.clone().multiply(mat4(o));
    NB.push({ id: o.id, poly: pts.map(([x, y]) => { const v = new THREE.Vector3(x, y, 0).applyMatrix4(m); return [v.x, v.y]; }) });
  }
  return NB;
}
function wallGeometry(e, g, h) {
  const out = ccw(g.outline), z0 = g.z0 || 0, z1 = z0 + h, U = mat4(S.unit).clone().invert().multiply(mat4(e));
  const nb = neighbours().filter(n => n.id !== e.id);
  const pos = [], idx = [];
  const contour = out.map(([x, y]) => new THREE.Vector2(x, y)), tris = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const [z, down] of [[z0, true], [z1, false]]) {     // низ и верх (верх — цвет среза)
    const b = pos.length / 3;
    for (const p of contour) pos.push(p.x, p.y, z);
    for (const [i, j, k] of tris) idx.push(...(down ? [b + i, b + k, b + j] : [b + i, b + j, b + k]));
  }
  const caps = idx.length;
  for (let i = 0; i < out.length; i++) {
    const a = new THREE.Vector2(...out[i]), c = new THREE.Vector2(...out[(i + 1) % out.length]), len = a.distanceTo(c);
    if (len < 1e-4) continue;
    const d = c.clone().sub(a).divideScalar(len), n = new THREE.Vector2(d.y, -d.x);   // наружу (контур против часовой)
    const open = s => {                                    // грань в точке s видна: за ней нет соседа
      const p = a.clone().addScaledVector(d, s).addScaledVector(n, 0.004), v = new THREE.Vector3(p.x, p.y, 0).applyMatrix4(U);
      return !nb.some(q => inPoly(q.poly, v.x, v.y));
    };
    const side = (s0, s1) => {
      if (s1 - s0 < 1e-4) return;
      const p = a.clone().addScaledVector(d, s0), q = a.clone().addScaledVector(d, s1), b = pos.length / 3;
      pos.push(p.x, p.y, z0, q.x, q.y, z0, q.x, q.y, z1, p.x, p.y, z1);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    const edge = (s0, s1) => {
      const v0 = open(s0);
      for (let k = 0; k < 12; k++) { const m = (s0 + s1) / 2; if (open(m) === v0) s0 = m; else s1 = m; }
      return (s0 + s1) / 2;
    };
    const step = Math.min(0.02, len / 2);
    let prev = null, ps = 0, start = null;
    for (let s = step / 2; s < len; s += step) {
      const v = open(s);
      if (prev === null) { if (v) start = 0; }
      else if (v !== prev) { const at = edge(ps, s); if (v) start = at; else { side(start, at); start = null; } }
      prev = v; ps = s;
    }
    if (start !== null) side(start, len);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.addGroup(0, caps, 0);
  geo.addGroup(caps, idx.length - caps, 1);
  return geo;
}

// контур против часовой (внутри — слева от ребра)
function ccw(outline) {
  let a = 0;
  for (let i = 0; i < outline.length; i++) { const [x0, y0] = outline[i], [x1, y1] = outline[(i + 1) % outline.length]; a += x0 * y1 - x1 * y0; }
  return a < 0 ? [...outline].reverse() : outline;
}
// обход рёбер контура в системе ребра: x — вдоль ребра, +y — внутрь
function alongEdges(kit, outline, z0, fn) {
  for (let i = 0; i < outline.length; i++) {
    const a = new THREE.Vector2(...outline[i]), b = new THREE.Vector2(...outline[(i + 1) % outline.length]), len = a.distanceTo(b);
    if (len < 0.05) continue;
    const m = new THREE.Matrix4().makeTranslation(a.x, a.y, z0).multiply(new THREE.Matrix4().makeRotationZ(Math.atan2(b.y - a.y, b.x - a.x)));
    kit.at(m, () => fn(len));
  }
}

// дом и подъезд: стены, кровля, цоколь и парапет; у подъезда с известными этажами — межэтажные пояса.
// Окон нет: где они, данные не знают, а выдумывать их — выдавать схему за точное.
function buildingObject(e, g, h) {
  const kit = new Kit(), z0 = g.z0 || 0, pts = ccw(g.outline);
  const facade = pbr(COL.building, { rough: 0.9 }), roof = pbr(COL.roof, { rough: 0.9 });
  const plinth = pbr(0xaea79c, { rough: 0.9 }), band = pbr(0xd6cfc2, { rough: 0.85 });
  kit.prism(facade, pts, z0, z0 + h, g.holes || []);
  kit.prism(roof, pts, z0 + h - 0.01, z0 + h + 0.01);
  const levels = e.kind === "section" ? (S.kids.get(e.id) || []).filter(s => s.kind === "storey" && (s.placement?.pos?.[2] || 0) > 0.5).map(s => s.placement.pos[2]) : [];
  alongEdges(kit, pts, z0, len => {
    kit.box(plinth, 0, -0.03, 0, len, 0.01, 0.75);                                     // цоколь
    kit.box(facade, 0, 0, h, len, 0.25, h + 0.5);                                       // парапет
    kit.box(roof, 0, -0.02, h + 0.5, len, 0.27, h + 0.55);
    for (const z of levels) kit.box(band, 0, -0.025, z - 0.06, len, 0.01, z + 0.06);    // межэтажные пояса
  });
  return kit.build();
}

// беседка по контуру с карты: настил, столбы по углам, шатровая кровля
function gazeboObject(g) {
  const kit = new Kit(), pts = ccw(g.outline), n = pts.length;
  const c = pts.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n], [0, 0]);
  const wood = pbr(0x9c7350, { rough: 0.8 }), roof = pbr(0x6b5a4c, { rough: 0.85 });
  kit.prism(pbr(0xb9a58a, { rough: 0.9 }), pts, 0, 0.15);
  for (const [x, y] of pts) kit.cylZ(wood, x + (c[0] - x) * 0.08, y + (c[1] - y) * 0.08, 0.15, 2.4, 0.06, 12);
  const tri = [];
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n], k = 1.08;
    tri.push([c[0] + (ax - c[0]) * k, c[1] + (ay - c[1]) * k, 2.4], [c[0] + (bx - c[0]) * k, c[1] + (by - c[1]) * k, 2.4], [c[0], c[1], 3.4]);
  }
  kit.tris(roof, tri);
  return kit.build();
}

function makeObject(e, nextRoomColor) {
  const g = e.geom;
  if (!g) return null;
  if (g.type === "extrusion") return extrusionObject(e, nextRoomColor);
  let o = null;
  try { o = buildFamily(e, famEnv); } catch (err) { console.warn("модель", e.name, err); }
  if (o) { addPick(e, o); return o; }
  if (g.type === "box") return boxFallback(e);
  if (g.type === "polyline") return lineObject(e);
  if (g.type === "point") return marker(e);
  return null;
}

// у места хранения и у спрятанной техники — невидимый объём: по нему щёлкают, его подсвечивают
function addPick(e, o) {
  if (e.geom?.type !== "box") return;
  let meshes = 0;
  o.traverse(c => { if (c.isMesh) meshes++; });
  if (e.kind !== "storage" && meshes) return;
  const [x, y, z] = e.geom.size;
  const geo = new THREE.BoxGeometry(x, y, z);
  geo.translate(x / 2, y / 2, z / 2);
  o.add(new THREE.Mesh(geo, PICK));
}

// рентген: копия меша, видимая только там, где её закрывает стена или пол
function addXray(o, color) {
  const list = [];
  o.traverse(c => { if (c.isMesh && !c.material.userData?.pick) list.push(c); });
  for (const c of list) {
    const x = new THREE.Mesh(c.geometry, xrayOf(color));
    x.userData.noPick = true;
    x.userData.xray = true;
    c.add(x);
  }
}
const XRAY_TYPES = new Set(["cable", "pipe_pair", "water_riser", "heating_manifold", "junction_box"]);

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

// плинтус вдоль стен комнаты, если у неё есть такая отделка; в дверных проёмах его нет
function skirting(space) {
  const fin = (S.refsIn.get(space.id) || []).map(r => r.rel === "finishes" && S.by.get(r.from)).filter(Boolean);
  const sk = fin.find(f => f.type === "skirting" || f.props?.render?.on?.includes?.("skirting"));
  if (!sk || space.geom?.type !== "extrusion" || !S.unit) return null;
  const walls = [];
  for (const w of S.kids.get(S.unit.id) || []) {
    if (w.kind === "wall" && w.geom?.outline) walls.push(w.geom.outline);
    if (w.kind === "opening" && w.type === "window" && w.geom?.type === "box") {   // под окном стена есть
      const p = new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(w.placement?.yaw || 0));
      const [x0, y0] = w.placement?.pos || [0, 0], [sx, sy] = w.geom.size;
      walls.push([[0, 0], [sx, 0], [sx, sy], [0, sy]].map(([x, y]) => {
        const v = new THREE.Vector3(x, y, 0).applyMatrix4(p);
        return [v.x + x0, v.y + y0];
      }));
    }
  }
  const color = hex(sk.props?.render?.colors?.["*"], null);
  const mat = color != null ? pbr(color, { rough: 0.5 }) : M.skirting;
  // у дверей с наличником плинтус кончается у наличника (render.casing_w), а не у проёма
  const ms = mat4(space), doors = [];
  for (const o of S.data.entities) {
    if (o.kind !== "opening" || !o._inUnit || !["door", "entrance_door"].includes(o.type) || o.geom?.type !== "box") continue;
    const r = o.props?.render || {};
    if (r.casing === false) continue;
    const [sx, sy] = o.geom.size;
    const ov = r.casing_over ? (r.jamb ?? 0.03) - 0.005 : 0;   // наличник поверх коробки — ближе к проёму
    doors.push({ m: mat4(o).clone().invert().multiply(ms), sx, sy, cw: (r.casing_w ?? 0.07) - ov + 0.003 });
  }
  const atDoor = p => doors.some(({ m, sx, sy, cw }) => {
    const v = new THREE.Vector3(p.x, p.y, 0.05).applyMatrix4(m);
    return sx >= sy ? v.x > -cw && v.x < sx + cw && v.y > -0.06 && v.y < sy + 0.06
      : v.y > -cw && v.y < sy + cw && v.x > -0.06 && v.x < sx + 0.06;
  });
  const kit = new Kit(), out = space.geom.outline, z0 = space.geom.z0 || 0, H = 0.07, T = 0.014, step = 0.04;
  // фурнитура пластикового плинтуса: уголки на углах и заглушки на концах — чуть толще и выше профиля
  const CT = T + 0.004, CH = H + 0.004, CL = 0.022, EL = 0.012, edges = [];
  const frame = (a, d) => new THREE.Matrix4().makeTranslation(a.x, a.y, z0).multiply(new THREE.Matrix4().makeRotationZ(Math.atan2(d.y, d.x)));
  for (let i = 0; i < out.length; i++) {
    const a = new THREE.Vector2(...out[i]), b = new THREE.Vector2(...out[(i + 1) % out.length]);
    const len = a.distanceTo(b);
    if (len < 0.1) { edges.push(null); continue; }
    const d = b.clone().sub(a).divideScalar(len), n = new THREE.Vector2(d.y, -d.x);   // наружу из комнаты (контур против часовой)
    const isWall = s => {
      const p = a.clone().addScaledVector(d, s).addScaledVector(n, 0.03);
      return walls.some(w => inPoly(w, p.x, p.y)) && !atDoor(p);
    };
    const edge = (s0, s1) => {                             // граница между точками в разном состоянии — делением пополам
      const v0 = isWall(s0);
      for (let k = 0; k < 10; k++) { const m = (s0 + s1) / 2; if (isWall(m) === v0) s0 = m; else s1 = m; }
      return (s0 + s1) / 2;
    };
    const runs = [], m = frame(a, d);
    const put = (s0, s1) => {
      if (s1 - s0 <= 0.05) return;
      runs.push([s0, s1]);
      kit.at(m, () => kit.box(mat, s0, 0, 0, s1, T, H, 0.002));
    };
    let prev = null, ps = 0, start = null;
    for (let s = step / 2; s < len; s += step) {
      const w = isWall(s);
      if (prev === null) { if (w) start = 0; }
      else if (w !== prev) {
        const at = edge(ps, s);
        if (w) start = at; else { put(start, at); start = null; }
      }
      prev = w; ps = s;
    }
    if (start !== null) put(start, len);
    edges.push({ a, d, n, len, m, runs });
  }
  // концы участков: в вершине контура, где плинтус идёт дальше по соседней стене, — уголок (внутренний, если угол
  // комнаты выпуклый, иначе наружный). У двери и во внутреннем углу без плинтуса дальше — заглушка. Остальные концы —
  // там, где кончается стена (проход, граница с соседней комнатой): плинтус заворачивает на её торец — наружный уголок
  // (за углом плинтус кладёт проход или соседняя комната)
  edges.forEach((ed, i) => {
    if (!ed) return;
    const nx = edges[(i + 1) % edges.length], pv = edges[(i - 1 + edges.length) % edges.length];
    for (const [s0, s1] of ed.runs) {
      for (const [s, dir] of [[s0, -1], [s1, 1]]) {        // dir: куда от конца уходит стена без плинтуса
        const atV = dir > 0 ? s > ed.len - 0.001 : s < 0.001, nb = atV ? (dir > 0 ? nx : pv) : null;
        const turn = nb ? (dir > 0 ? ed.d.cross(nb.d) : pv.d.cross(ed.d)) : 0;   // > 0 — поворот влево: угол комнаты выпуклый
        if (nb && (dir > 0 ? nb.runs.some(([q]) => q < 0.001) : nb.runs.some(([, q]) => q > nb.len - 0.001))) {
          if (dir < 0) continue;                           // уголок ставит участок, который кончается в вершине
          if (turn > 1e-6) kit.at(ed.m, () => kit.box(mat, s - CL, 0, 0, s, CT, CH, 0.002));                           // внутренний: по ребру угла
          else kit.at(ed.m, () => kit.box(mat, s - CL, 0, 0, s + CT, CT, CH, 0.002));                                 // наружный
          kit.at(nb.m, () => kit.box(mat, turn > 1e-6 ? 0 : -CT, 0, 0, CL, CT, CH, 0.002));
          continue;
        }
        const past = ed.a.clone().addScaledVector(ed.d, s + dir * 0.02).addScaledVector(ed.n, 0.03);
        const nbp = nb && nb.a.clone().addScaledVector(nb.d, dir > 0 ? 0.02 : nb.len - 0.02).addScaledVector(nb.n, 0.03);
        if (turn > 1e-6 || atDoor(past) || (nbp && atDoor(nbp))) {                                                   // заглушка
          kit.at(ed.m, () => kit.box(mat, dir > 0 ? s - EL : s, 0, 0, dir > 0 ? s : s + EL, CT, CH, 0.002));
          continue;
        }
        kit.at(ed.m, () => kit.box(mat, dir > 0 ? s - CL : s - CT, 0, 0, dir > 0 ? s + CT : s + CL, CT, CH, 0.002));   // наружный уголок
        kit.at(ed.m, () => kit.box(mat, dir > 0 ? s : s - CT, -CL, 0, dir > 0 ? s + CT : s, 0, CH, 0.002));
      }
    }
  });
  const g = kit.build();
  g.userData.noPick = true;
  return g;
}

function build() {
  for (const o of S.obj.values()) o.traverse(c => c.geometry?.dispose());
  helpersLight.children.forEach(c => c.geometry.dispose());
  helpersLight.clear();
  world.clear(); S.obj.clear(); S.labels.forEach(l => l.el.remove()); S.labels = []; S.devices = []; NB = null;
  ceilings.children.forEach(c => c.geometry.dispose());
  ceilings.clear();
  let rn = 0;
  const nextRoomColor = () => [0xf3e6d3, 0xe0ecdc, 0xdce7f2, 0xf2dfe3, 0xe8e1f2, 0xefeccf][rn++ % 6];
  for (const e of S.data.entities) {
    let o = null;
    try { o = makeObject(e, nextRoomColor); } catch (err) { console.warn("геометрия", e.name, err); }
    if (!o) continue;
    o.traverse(c => { c.userData.id = e.id; });
    o.matrixAutoUpdate = false;
    o.userData.base = mat4(e).clone();
    o.matrix.copy(o.userData.base);
    if (e.kind === "section") o.add(storeyLines(e));
    if (e.kind === "mep" && (XRAY_TYPES.has(e.type) || e.geom?.type === "polyline")) addXray(o, familyColor(e));
    if (e.kind === "space" && e._inUnit) {
      const sk = skirting(e);
      if (sk) { sk.traverse(c => { c.userData.id = e.id; c.userData.noPick = true; }); o.add(sk); }
      const ce = ceilingOf(e);
      if (ce) ceilings.add(ce);
    }
    world.add(o);
    S.obj.set(e.id, o);
    if (e.kind === "device") S.devices.push(e);
  }
  world.updateMatrixWorld(true);
  placeLooseDevices();
  makeGround();
  makeLabels();
  makePuck();
  applyView();
  paintDevices();
  settleCoplanar(world);                                   // грани в одной плоскости: деталь поверх основы, без мерцания
}

// потолок комнаты на высоте потолка квартиры: виден только снизу (из комнаты), сверху на квартиру не мешает
function ceilingOf(space) {
  const g = space.geom;
  if (g?.type !== "extrusion" || !S.unit) return null;
  const geo = new THREE.ShapeGeometry(shapeOf(g));
  geo.translate(0, 0, (g.z0 || 0) + (S.unit.props?.ceiling || g.height || 2.5));
  const m = new THREE.Mesh(geo, M.ceiling);
  m.matrixAutoUpdate = false;
  m.matrix.copy(mat4(space));
  m.receiveShadow = true;
  m.userData.noPick = true;
  return m;
}

// земля под кварталом невидима, на ней только тени домов: цвет земли — фон страницы, в любой теме
function makeGround() {
  backdrop.clear();
  const box = new THREE.Box3();
  for (const e of S.data.entities) if (["building", "section", "feature"].includes(e.kind) && S.obj.has(e.id)) box.expandByObject(S.obj.get(e.id));
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const r = Math.max(s.x, s.y) * 1.2 + 40;
  const site = S.data.entities.find(e => e.kind === "site");
  const z = site ? mat4(site).elements[14] : box.min.z;
  const g = new THREE.Mesh(new THREE.CircleGeometry(r, 64), new THREE.ShadowMaterial({ opacity: 0.2, depthWrite: false }));
  g.position.set(c.x, c.y, z - 0.03);
  g.receiveShadow = true;
  g.userData.noPick = true;
  backdrop.add(g);
  // из окон квартиры (вид под потолком) земля видна: ровная, серо-зелёная — какая она на самом деле, данные не знают
  outside.clear();
  const land = new THREE.Mesh(new THREE.CircleGeometry(r, 64), pbr(0xa9ab9f, { rough: 1 }));
  land.position.set(c.x, c.y, z - 0.05);
  land.userData.noPick = true;
  outside.add(land);
}

// устройства без геометрии: светильник — у потолка в своей точке или в центре комнаты, с пятном света на полу;
// остальное — значок
function placeLooseDevices() {
  const n = new Map();
  const ceil = S.unit?.props?.ceiling || 2.5;
  for (const e of S.data.entities) {
    if (e.kind !== "device" || e.geom || !e.parent || !S.obj.has(e.parent)) continue;
    const room = S.obj.get(e.parent);
    const box = new THREE.Box3().setFromObject(room);
    const c = box.getCenter(new THREE.Vector3());
    const i = e.type === "light" ? 0 : (n.get(e.parent) || 0) + 1;
    if (e.type !== "light") n.set(e.parent, i);
    const dz = DEV_H[e.type] ?? 1.0;
    const own = ownMat(e.type === "light" ? COL.devOff : COL.badge), dot = new Kit();
    if (e.type === "light") dot.torus(own, 0, 0, 0.004, 0.11, 0.007, 40);   // на срезе — кольцо на полу под светильником
    else dot.sphere(own, 0, 0, 0, 0.035, 20);
    let m;
    if (e.type === "light") {                             // плафон у потолка; на срезе потолка нет — точка
      const kit = new Kit();
      fixture(kit, e.props?.render?.fixture, own, e.props?.render?.angle ?? 20, e.props?.render?.diameter ?? null, e.props?.render || {});
      const full = kit.build(), cut = dot.build();
      full.traverse(x => { x.castShadow = false; });     // тень люстры от «солнца» ложилась на пол пауком
      full.position.z = ceil;
      cut.position.z = 0;
      full.userData.variant = "full";
      cut.userData.variant = "cut";
      m = new THREE.Group();
      m.add(full, cut);
      m.userData.variants = true;
      m.position.set(c.x, c.y, box.min.z);
      if (e.placement?.pos) {                             // точка светильника известна (без коробки) — ставим туда
        const at = new THREE.Vector3().setFromMatrixPosition(mat4(e));
        m.position.set(at.x, at.y, box.min.z);
      }
      m.quaternion.setFromRotationMatrix(new THREE.Matrix4().extractRotation(room.matrixWorld));   // render.angle — от осей комнаты
      const pool = lightPool(S.by.get(e.parent), room);
      if (pool) { helpersLight.add(pool); m.userData.pool = pool; }
    } else {                                              // место в комнате неизвестно — индикатор состояния
      m = dot.build();
      const ang = i * 2.1;
      m.position.set(c.x + Math.cos(ang) * 0.55, c.y + Math.sin(ang) * 0.55, box.min.z + dz);
    }
    m.traverse(x => { x.userData.id = e.id; });
    world.add(m);
    S.obj.set(e.id, m);
  }
}

// пятно тёплого света на полу комнаты: ярче под светильником, к стенам гаснет; за стены не выходит
const helpersLight = new THREE.Group();
scene.add(helpersLight);
function lightPool(space, room) {
  if (!space?.geom?.outline) return null;
  helpersLight.matrixAutoUpdate = false;
  const geo = new THREE.ShapeGeometry(shapeOf(space.geom));
  geo.translate(0, 0, (space.geom.z0 || 0) + 0.008);
  const b = new THREE.Box2();
  for (const [x, y] of space.geom.outline) b.expandByPoint(new THREE.Vector2(x, y));
  const c = b.getCenter(new THREE.Vector2()), r = b.getSize(new THREE.Vector2()).length() * 0.62;
  const mat = new THREE.ShaderMaterial({
    uniforms: { c: { value: c }, r: { value: r }, k: { value: 0 }, color: { value: new THREE.Color(0xffd28a) } },
    vertexShader: "varying vec2 p; void main(){ p = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "uniform vec2 c; uniform float r; uniform float k; uniform vec3 color; varying vec2 p;"
      + "void main(){ float d = distance(p, c) / r; float a = k * pow(clamp(1.0 - d, 0.0, 1.0), 1.6); gl_FragColor = vec4(color * a, 1.0); }",
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(room.matrix);
  mesh.userData.noPick = true;
  mesh.visible = false;
  return mesh;
}

function makePuck() {
  const vac = S.data.entities.find(e => e.kind === "device" && e.bind?.["dreame.camera"]);
  S.puck = null;
  if (!vac) return;
  // робот-пылесос: корпус, бампер спереди (+X), башня лидара
  const kit = new Kit();
  kit.cylZ(pbr(0xeef0f2, { rough: 0.35 }), 0, 0, 0.012, 0.09, 0.175, 48);
  kit.cylZ(M.graphite, 0, 0, 0.0, 0.012, 0.16, 48);
  kit.lathe(M.graphite, [[0.176, 0.02], [0.18, 0.02], [0.18, 0.075], [0.176, 0.075]], 0, 0, 48);
  kit.cylZ(pbr(0x2b2e33, { rough: 0.3 }), 0.06, 0, 0.09, 0.115, 0.042, 32);
  kit.cylZ(M.chrome, 0.06, 0, 0.115, 0.118, 0.042, 32);
  const g = kit.build();
  g.traverse(c => { c.userData.id = vac.id; });
  g.visible = false;
  g.userData.camera = vac.bind["dreame.camera"];
  g.userData.vac = vac.id;
  g.userData.entity = (vac.bind["ha.entity"] || [])[0];
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
    } else if (e.kind === "building" && e.type !== "context") {   // окружение без подписей: их десятки
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
  if (v === "unit") {
    if (e._inUnit) return S.mep || !hiddenMep(e);
    // под потолком из окон видно окружение: соседние дома и двор; своего дома нет — квартира внутри него
    return !S.cut && !e._myBld && (k === "feature" || k === "section" || (k === "building" && !hasSectionGeom(e)));
  }
  if (v === "house") {
    if (e._inUnit) return ["wall", "space", "opening", "unit"].includes(k);
    if (e._myBld && e._floor && ["unit", "space", "mep"].includes(k)) return true;   // соседи, общие зоны, щиток этажа
    return e._myBld && (k === "section" || (k === "building" && !hasSectionGeom(e)));
  }
  if (e._inUnit) return k === "unit" || (k === "space" && !S.unit?.geom);
  return k === "feature" || k === "section" || (k === "building" && !hasSectionGeom(e));
}

// небо за окнами квартиры (вид под потолком) — по времени суток: высота солнца из sun.sun в HA; ?sky=day|dusk|night —
// вручную (снимки хозяев для сверки сделаны в сумерки). В остальных видах фон — цвет страницы
const SKY = { day: new THREE.Color(0xd3dbe4), dusk: new THREE.Color(0x56677e), night: new THREE.Color(0x1b2230) };
function paintSky() {
  if (!(S.view === "unit" && !S.cut)) { scene.background = null; return invalidate(); }
  let c = SKY[QS.get("sky")];
  if (!c) {
    const el = Number(S.states["sun.sun"]?.attributes?.elevation);
    if (!Number.isFinite(el)) c = SKY.day;
    else if (el >= 6) c = SKY.day;
    else if (el <= -6) c = SKY.night;
    else c = el >= 0 ? SKY.dusk.clone().lerp(SKY.day, el / 6) : SKY.dusk.clone().lerp(SKY.night, -el / 6);
  }
  scene.background = c;
  invalidate();
}

function applyView() {
  const cut = S.view === "unit" && S.cut;
  // глубина: в виде квартиры ближняя и дальняя плоскости ближе друг к другу — точнее буфер глубины (иначе за тонкой
  // стеной проступает силуэт вещи из соседней комнаты)
  Object.assign(camera, S.view === "unit" ? { near: 0.05, far: 800 } : { near: 0.3, far: 5000 });   // 800 — дома за окнами
  camera.userData.near0 = camera.near;                     // ближе не бывает; издалека кадр отодвигает её (frame)
  camera.updateProjectionMatrix();
  for (const [id, o] of S.obj) {
    const e = S.by.get(id);
    o.visible = visibleIn(e);
    let over = null;
    if (S.view === "house" && !e._inUnit && o.visible && !e._floor) over = GHOST;
    if (S.view === "site" && e._inUnit) over = ACCENT;
    if (S.view === "site" && e._myBld && e.kind === "section") over = GHOST2;
    o.traverse(c => {
      if (!c.isMesh || c.userData.xray || c.material === PICK) return;
      if (!c.userData.mat0) c.userData.mat0 = c.material;
      c.material = c.userData.hl || over || c.userData.mat0;
    });
    if (e.kind === "section") o.children.forEach(c => { if (c.userData.noPick) c.visible = S.view !== "site"; });
    if (o.userData.variants) o.children.forEach(c => { c.visible = c.userData.variant === (cut ? "cut" : "full"); });
    if (o.userData.zCut != null) {
      o.position.z = cut ? o.userData.zCut : o.userData.z;
      o.updateMatrix();
    }
    o.traverse(c => { if (c.userData.xray) c.visible = S.mep && S.view === "unit"; });
    // квартира целиком (под потолком): стены и проёмы не бросают тень от «солнца» внутрь комнат — свет в комнате
    // рассеянный, косых клиньев тени на стенах нет
    if ((e.kind === "wall" || e.kind === "opening") && e._inUnit) o.traverse(c => { if (c.isMesh && !c.userData.xray && !c.material?.transparent && c.material !== PICK) c.castShadow = S.view !== "unit" || cut; });
    // срез: стены квартиры ниже, чтобы видеть внутрь (проёмы срезаются своей сборкой)
    if (e.kind === "wall") {
      const h = e.geom?.height || 2.5, z0 = e.geom?.z0 || 0;
      o.matrix.copy(o.userData.base);
      if (cut && z0 + h > CUT) {
        if (z0 >= CUT) o.visible = false;
        else o.matrix.multiply(new THREE.Matrix4().makeTranslation(0, 0, z0)).multiply(new THREE.Matrix4().makeScale(1, 1, (CUT - z0) / h))
          .multiply(new THREE.Matrix4().makeTranslation(0, 0, -z0));
      }
    }
  }
  for (const p of helpersLight.children) p.visible = S.view === "unit" && p.material.uniforms.k.value > 0;
  backdrop.visible = S.view !== "unit";
  ceilings.visible = outside.visible = S.view === "unit" && !cut;
  // под потолком (квартира без среза) солнца сверху нет: свет как от ламп — рассеянный и ровный
  [sun.intensity, hemi.intensity, scene.environmentIntensity] = S.view === "unit" && !cut ? INSIDE_LIGHT : OUTSIDE_LIGHT;
  paintSky();
  world.updateMatrixWorld(true);
  document.querySelectorAll("#views button").forEach(b => b.classList.toggle("on", b.dataset.view === S.view));
  $("#t-cut").classList.toggle("on", S.cut);
  $("#t-mep").classList.toggle("on", S.mep);
  $("#t-cut").disabled = S.view !== "unit";
  $("#t-mep").disabled = S.view !== "unit";
  if (S.puck) S.puck.visible = S.view === "unit" && !!S.puck.userData.pose;
  fitShadow();
  invalidate();
}

// солнце светит в квартиру сверху-сбоку (со стороны улицы); тень считается только для того, что видно
function fitShadow() {
  const box = new THREE.Box3();
  for (const o of S.obj.values()) if (o.visible) box.expandByObject(o);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2 + 1;
  const dir = new THREE.Vector3(-0.42, -0.5, 0.76);
  if (S.unit) dir.applyMatrix4(new THREE.Matrix4().extractRotation(mat4(S.unit)));
  dir.normalize();
  sun.target.position.copy(c);
  sun.position.copy(c).addScaledVector(dir, r * 2);
  const cam = sun.shadow.camera;
  Object.assign(cam, { left: -r, right: r, top: r, bottom: -r, near: 0.1, far: r * 4 });
  cam.updateProjectionMatrix();
  sun.target.updateMatrixWorld();
  sun.updateMatrixWorld();
  sun.shadow.needsUpdate = true;
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
  invalidate();
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
  invalidate();
}

// ── режиссёр: камера, которая сама ведёт показ (облёт, перелёты, полёт по трубам) ──
const director = createDirector({
  S, scene, camera, controls, COL, invalidate,
  now: () => performance.now(),
  select: (id, o) => select(id, o), highlight: (o, c, see) => highlight(o, c, see), clearHighlight: () => clearHighlight(),
  applyView: () => applyView(), meshFor: id => meshFor(id), ancestors: id => ancestors(id), mat4: e => mat4(e),
  floorZ: () => (S.unit ? floorWorldZ(S.unit) : 0),
});
const overlayCanvas = $("#dov");
function drawOverlay() {                                  // подписи режиссёра поверх сцены (в браузере)
  if (!overlayCanvas || capturing) return;
  const w = canvas.width, h = canvas.height;
  if (overlayCanvas.width !== w || overlayCanvas.height !== h) { overlayCanvas.width = w; overlayCanvas.height = h; }
  const g = overlayCanvas.getContext("2d");
  g.clearRect(0, 0, w, h);
  if (director.active) director.overlay.draw(g, w, h);
}
let capturing = false;                                    // кадры заказывает поток (capture.js), а не экран

// ── кадр: рисуем только когда что-то изменилось (бережём батарею телефона) ──
// now — мс; force — нарисовать, даже если ничего не менялось (поток шлёт кадр всегда)
const v3 = new THREE.Vector3();
function frame(now, force = false) {
  if (director.tick(now)) dirty = true;
  else {
    if (flight) {
      const u = Math.min(1, (now - flight.t0) / 650), s = u * u * (3 - 2 * u);
      camera.position.lerpVectors(flight.p0, flight.p1, s);
      controls.target.lerpVectors(flight.q0, flight.q1, s);
      if (u >= 1) flight = null;
      dirty = true;
    }
    if (controls.update()) dirty = true;
  }
  if (!dirty && !force) return false;
  dirty = false;
  // ближняя плоскость — на доле расстояния до цели: точность буфера глубины падает как квадрат расстояния, делённый
  // на ближнюю плоскость, и с 0,05 м на облёте с 25 м шаг был больше миллиметра — грани в миллиметре друг от друга
  // (фасад и подложка, шкаф в нише стены) мерцали. На 1 м — 0,03 мм. Режиссёр не даёт ей резать вещь рядом (nearCap)
  const near = Math.min(camera.userData.nearCap ?? Infinity,
    Math.max(camera.userData.near0 ?? camera.near, 0.04 * camera.position.distanceTo(controls.target)));
  if (Math.abs(near - camera.near) > 1e-3 * near) { camera.near = near; camera.updateProjectionMatrix(); }
  const t0 = performance.now();
  director.beforeRender();
  composer.render();
  director.afterRender();
  quality(performance.now() - t0);
  drawOverlay();
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
  return true;
}
let manual = false;                                       // часы кадров снаружи: проверка сцен покадрово
renderer.setAnimationLoop(now => { if (!capturing && !manual) frame(now); });

// поток для телевизора: ?tv=1&capture=ws://… — кадры с подписями в кодировщик H.264 и по WebSocket на ПК
async function startCapture(opt = {}) {
  const { startCapture: run } = await import("./capture.js");
  capturing = true;
  try {
    return await run({ ...opt, canvas, director, frame: (t, force) => frame(t, force), onStop: () => { capturing = false; invalidate(); } });
  } catch (err) { capturing = false; throw err; }
}
async function snapshot(t) {
  const { snapshot: snap } = await import("./capture.js");
  return snap({ canvas, director, frame: (x, force) => frame(x, force), t });
}
Object.assign(window.cherrybim, { director, frame, startCapture, snapshot, manual: on => { manual = !!on; } });

// качество под устройство: если кадр стабильно дольше 30 мс, сначала без затенения углов, потом пикселей меньше.
// С ?ao=0 или ?ao=1 в адресе качество не меняется само.
const slow = { n: 0, sum: 0, step: QS.has("ao") ? 2 : 0 };
function quality(ms) {
  if (slow.step >= 2) return;
  slow.n++;
  slow.sum += ms;
  if (slow.n < 20) return;
  const avg = slow.sum / slow.n;
  slow.n = slow.sum = 0;
  if (avg < 30) return;
  if (slow.step === 0) gtao.enabled = false;
  else { renderer.setPixelRatio(1); resize(); }
  slow.step++;
  console.info(`Cherry BiM: кадр ${Math.round(avg)} мс — упрощаю картинку (шаг ${slow.step})`);
  invalidate();
}

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
  invalidate();
}

const hlMats = new Map();
function hlMat(color, see = false) {
  const key = color + (see ? "s" : "");
  if (!hlMats.has(key)) {
    hlMats.set(key, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, roughness: 0.6,
      transparent: see, opacity: see ? 0.28 : 1, depthWrite: !see }));
  }
  return hlMats.get(key);
}

function highlight(o, color, see = false) {
  if (!o) return;
  const e = S.by.get(o.userData.id);
  if (o.userData.floor) {                                 // комната: полупрозрачный объём и рёбра
    const geo = new THREE.ExtrudeGeometry(o.userData.shape, { depth: o.userData.h, bevelEnabled: false });
    const vol = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color }));
    for (const x of [vol, edges]) { x.matrixAutoUpdate = false; x.matrix.copy(o.matrixWorld); x.userData.noPick = true; helpers.add(x); }
  }
  if (e && ["space", "section", "building"].includes(e.kind) && o.userData.floor) return;
  o.traverse(c => {
    if (!c.isMesh || c.userData.xray) return;
    if (!c.userData.mat0) c.userData.mat0 = c.material;
    c.userData.hl = hlMat(color, see || c.userData.mat0 === PICK);
    c.material = c.userData.hl;
  });
  invalidate();
}

// шкаф, в котором выбрано место хранения, становится полупрозрачным — видно ящик внутри
function seeThrough(e) {
  const chain = [e, ...ancestors(e.id)];
  const holder = chain.find(a => a.kind === "furniture" && (S.kids.get(a.id) || []).some(k => k.kind === "storage"));
  if (!holder || holder === e && !S.obj.has(holder.id)) return null;
  const o = S.obj.get(holder.id);
  if (!o) return null;
  o.traverse(c => {
    if (!c.isMesh || c.userData.xray || c.material === PICK || c.userData.hl) return;
    if (!c.userData.mat0) c.userData.mat0 = c.material;
    c.userData.hl = ghostOf(c.userData.mat0);
    c.material = c.userData.hl;
  });
  return holder;
}

function select(id, { fly: doFly = true } = {}) {
  clearHighlight();
  S.sel = id ? S.by.get(id) : null;
  if (!S.sel) { $("#card").hidden = true; setHash(); return; }
  const e = S.sel;
  if (e._inUnit && S.view !== "unit") setView("unit", false);
  else if (e._floor && S.view !== "house") setView("house", false);
  if (hiddenMep(e) && !S.mep) { S.mep = true; applyView(); }
  const target = meshFor(e.id);
  for (const rid of related(e)) { const o = S.obj.get(rid); if (o && o !== target) highlight(o, COL.rel); }   // без подъёма к родителю: группа без геометрии не подсвечивает всю квартиру
  const holder = target && seeThrough(S.by.get(target.userData.id) || e);
  if (holder && S.obj.get(holder.id) === target) highlight(target, COL.sel, true);   // сам шкаф — прозрачным оранжевым
  else highlight(target, COL.sel);
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

// ── документы: свои — дети вида document и документы со связью documents на сущность ────
function docsOf(id) {
  const out = (S.kids.get(id) || []).filter(k => k.kind === "document");
  for (const r of S.refsIn.get(id) || []) {
    const d = r.rel === "documents" && S.by.get(r.from);
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}
const kb = n => n >= 2 ** 20 ? `${(n / 2 ** 20).toFixed(1).replace(".", ",")} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`;
const dmy = s => String(s).slice(0, 10).split("-").reverse().join(".");
// d.copy — сервер проверил, что копия лежит в папке документов (пакет могли выложить раньше копий)
function docMeta(d) {
  const p = d.props || {};
  return [FMT[p.mime] || (p.mime ? p.mime.split("/").pop() : ""), p.pages ? `${p.pages} стр.` : "", p.size ? kb(p.size) : "",
    d.copy && p.saved_at ? `копия от ${dmy(p.saved_at)}` : "", p.url && !d.copy ? "копии нет, только ссылка" : ""].filter(Boolean).join(" · ");
}
function docLinks(d) {
  const p = d.props || {}, out = [];
  if (d.copy) out.push(`<a href="api/doc/${encodeURIComponent(d.id)}" target="_blank" rel="noopener">открыть</a>`);
  if (p.url) out.push(`<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">сайт ↗</a>`);
  return out.join(" · ");
}
function docRow(d) {
  const meta = [d.ru, docMeta(d)].filter(Boolean).join(" · "), acts = docLinks(d);
  return `<li>${link(d)} <small>${esc(meta)}</small>${acts ? `<div class="acts">${acts}</div>` : ""}</li>`;
}
// видно хвост только у длинного номера: у IMEI и MAC — 4 знака, у серийного из 8–11 — 2, короткий скрыт целиком
const mask = v => { const s = String(v), n = s.length >= 12 ? 4 : s.length >= 8 ? 2 : 0; return n ? "•••• " + s.slice(-n) : "••••"; };
function docForm(e) {
  const types = Object.entries(S.data.doc_types || {}).map(([k, ru]) => `<option value="${k}"${k === "manual" ? " selected" : ""}>${esc(ru)}</option>`).join("");
  return `<details class="adddoc"><summary>Добавить документ или ссылку</summary><form class="doc" data-to="${e.id}">`
    + `<input name="title" placeholder="Название: инструкция, чек, гарантия…"><select name="type">${types}</select>`
    + `<input name="url" type="url" placeholder="Ссылка (необязательно)"><input name="file" type="file">`
    + `<label class="note"><input name="copy" type="checkbox" checked> сохранить копию страницы по ссылке</label>`
    + `<button class="btn main">Записать</button></form></details>`;
}

// живое состояние HA перерисовывает только свой блок: иначе каждое новое значение температуры стирало бы
// начатую форму документа или вещи в карточке, а во время загрузки давало бы нажать «Записать» второй раз
function refreshHa(e) {
  const box = $("#card .ha");
  if (!box) return;
  const ents = bound(e);
  if (e.kind === "device" && e.bind?.["dreame.camera"]) ents.push(e.bind["dreame.camera"]);
  box.innerHTML = ents.filter(x => !x.startsWith("camera.")).map(stateRow).join("");
}

function renderCard(e) {
  const chain = ancestors(e.id).reverse().filter(a => a.kind !== "site");
  let h = `<button class="x" data-act="close" title="Закрыть">×</button>`;
  h += `<div class="crumbs">${chain.map(link).join(" › ")}</div><h2>${esc(e.name)}</h2>`;
  h += `<div class="kind">${esc(e.ru || e.kind)}${e.src ? ` · ${srcText(e.src)}` : ""}</div>`;
  const ents = bound(e);
  if (e.kind === "device" && e.bind?.["dreame.camera"]) ents.push(e.bind["dreame.camera"]);
  if (ents.length) h += `<div class="ha">${ents.filter(x => !x.startsWith("camera.")).map(stateRow).join("")}</div>`;
  const props = Object.entries(e.props || {}).filter(([k]) => !HIDDEN_PROPS.has(k) && !(e.kind === "document" && DOC_PROPS.has(k)));
  if (e.kind === "document") {                             // документ: открыть копию, скачать, на сайт; к чему относится
    const p = e.props || {}, btns = [];
    if (e.copy) btns.push(`<a class="btn main" href="api/doc/${encodeURIComponent(e.id)}" target="_blank" rel="noopener">Открыть копию</a>`,
      `<a class="btn" href="api/doc/${encodeURIComponent(e.id)}?dl=1" download>Скачать</a>`);
    if (p.url) btns.push(`<a class="btn" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">На сайте ↗</a>`);
    if (btns.length) h += `<div class="row">${btns.join("")}</div>`;
    const meta = [docMeta(e), p.file && !e.copy ? "копию ещё не положили в папку документов" : ""].filter(Boolean).join(" · ");
    if (meta) h += `<p class="note">${esc(meta)}</p>`;
  }
  if (props.length) h += `<dl class="props">${props.map(([k, v]) => `<dt>${esc(PROP[k] || k)}</dt><dd>${fmt(v)}</dd>`).join("")}</dl>`;
  const ids = Object.entries(e.props?.ids || {});          // закрытые номера: скрыты, показать по кнопке
  if (ids.length) h += `<h3>Номера</h3><dl class="props">${ids.map(([k, v]) => `<dt>${esc(k)}</dt><dd><span class="secret" data-v="${esc(v)}">${esc(mask(v))}</span> `
    + `<button class="lnk" data-act="reveal">показать</button></dd>`).join("")}</dl>`;
  if (e.aliases?.length) h += `<p class="note">Ещё называют: ${esc(e.aliases.join(", "))}</p>`;

  const fin = (S.refsIn.get(e.id) || []).filter(r => r.rel === "finishes").map(r => S.by.get(r.from)).filter(Boolean);
  if (fin.length) h += `<h3>Отделка</h3><ul>${fin.map(f => `<li>${link(f)}</li>`).join("")}</ul>`;
  if (e.kind === "document") {
    const about = [S.by.get(e.parent), ...(e.refs || []).filter(r => r.rel === "documents").map(r => S.by.get(r.to))].filter(Boolean);
    if (about.length) h += `<h3>Относится к</h3><ul>${about.map(a => `<li>${link(a)} <small>${esc(a.ru)}</small></li>`).join("")}</ul>`;
    if (e.editable) h += `<div class="row"><button class="btn" data-act="doc-remove">Убрать документ</button></div>`;
  }
  const out = (e.refs || []).filter(r => S.by.has(r.to) && r.rel !== "documents").map(r => `<li>${esc(REL[r.rel] || r.rel)}: ${link(S.by.get(r.to))}</li>`);
  const inc = (S.refsIn.get(e.id) || []).filter(r => !["finishes", "documents"].includes(r.rel)).map(r => `<li>${esc(REL_IN[r.rel] || r.rel)}: ${link(S.by.get(r.from))}</li>`);
  if (out.length + inc.length) h += `<h3>Связи</h3><ul>${[...out, ...inc].join("")}</ul>`;
  if (e.kind !== "document") {                             // документы: свои и ближайшего родителя (у ящика — проект кухни)
    const own = docsOf(e.id);
    const whole = new Set(S.data.doc_inherited || ["project", "assembly", "contract"]);   // проект — и у частей; чеки — нет
    // вещь в шкафу — не часть шкафа; документ, который уже в своих, второй раз «у родителя» не показывается
    const up = e.kind === "item" ? null
      : ancestors(e.id).map(a => [a, docsOf(a.id).filter(d => whole.has(d.type) && !own.includes(d))]).find(([, ds]) => ds.length);
    if (own.length || up || S.features.docs) {
      h += `<h3>Документы${own.length ? ` (${own.length})` : ""}</h3>`;
      if (own.length) h += `<ul class="docs">${own.map(docRow).join("")}</ul>`;
      if (up) h += `<p class="note">У «${esc(up[0].name)}»:</p><ul class="docs">${up[1].map(docRow).join("")}</ul>`;
      if (S.features.docs) h += docForm(e);
    }
  }

  const kids = (S.kids.get(e.id) || []).filter(k => !["wall", "item", "finish", "system", "document"].includes(k.kind));
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
    const kids = (S.kids.get(e.id) || []).filter(k => !skip.has(k.kind) && (S.mep || !hiddenMep(k)));
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
    else if (act === "reveal") {                           // показать номер; второй щелчок — скопировать
      const sp = b.previousElementSibling;
      if (b.textContent === "показать") { sp.textContent = sp.dataset.v; b.textContent = "скопировать"; }
      else if (navigator.clipboard) { await navigator.clipboard.writeText(sp.dataset.v); toast("Скопировал"); }
      else {                                               // HA по http: буфера обмена нет — выделить и скопировать по-старому
        getSelection().selectAllChildren(sp);
        toast(document.execCommand("copy") ? "Скопировал" : "Выделил номер: скопируйте вручную");
      }
    }
    else if (act === "doc-remove" && confirm(`Убрать документ «${e.name}»?`)) {
      await api(`api/docs/${e.id}`, { method: "DELETE" }); toast("Убрал"); await reload(e.parent);
    }
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
  const fd = ev.target.closest("form.doc");
  if (fd) { ev.preventDefault(); await addDoc(fd); return; }
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

// документ к сущности: файл грузится как есть, ссылка — со скачанной сервером копией (или только ссылкой)
async function addDoc(f) {
  const file = f.file.files[0], url = f.url.value.trim(), title = f.title.value.trim(), type = f.type.value;
  if (!file && !url) { toast("Нужен файл или ссылка"); return; }
  if (file && !file.size) { toast("Файл пустой"); return; }
  const btn = f.querySelector("button");
  btn.disabled = true;
  btn.textContent = file ? "Загружаю…" : f.copy.checked ? "Сохраняю копию…" : "Записываю…";
  try {
    if (file) {
      const qs = new URLSearchParams({ to: f.dataset.to, title: title || file.name.replace(/\.[^.]+$/, ""), type, url, filename: file.name });
      await api(`api/docs?${qs}`, { method: "POST", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
    } else await send("api/docs", { to: f.dataset.to, title, type, url, copy: f.copy.checked });
    toast("Документ записан");
    await reload(f.dataset.to);
  } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = "Записать"; }
}

function editItem(item) {
  const box = $("#act");
  const ids = Object.entries(item.props?.ids || {}).map(([k, v]) => `${k}: ${v}`).join("\n");
  box.innerHTML = `<form class="add" data-edit="1"><input name="name" value="${esc(item.name)}" required>`
    + `<input name="qty" type="number" min="0" step="any" value="${esc(item.props?.qty ?? "")}" placeholder="шт.">`
    + `<input name="note" value="${esc(item.props?.note ?? "")}" placeholder="заметка" style="grid-column: 1 / -1">`
    + `<textarea name="ids" rows="2" placeholder="Номера, каждый с новой строки: IMEI: 356…, Серийный номер: …" style="grid-column: 1 / -1">${esc(ids)}</textarea>`
    + `<button class="btn main">Сохранить</button></form>`;
  box.querySelector("form").addEventListener("submit", async ev => {
    ev.preventDefault();
    ev.stopPropagation();
    const f = ev.target;
    const ids = {};                                        // «IMEI: 356…» по строке; второй IMEI — «IMEI 2»
    for (const l of f.ids.value.split("\n").map(s => s.trim()).filter(Boolean)) {
      const [k, v] = l.split(/:(.*)/s).map(x => (x || "").trim());
      if (!k || !v) { toast(`Не понял строку «${l}»: нужно «название: номер»`); return; }
      let key = k, n = 2;
      while (key in ids) key = `${k} ${n++}`;
      ids[key] = v;
    }
    try {
      await send(`api/items/${item.id}`, { name: f.name.value.trim(), qty: f.qty.value ? Number(f.qty.value) : null, note: f.note.value.trim(), ids }, "PATCH");
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
  if (e.type === "light" || e.type === "lamp" || e.type === "backlight") return any(["on"]) ? COL.lightOn : COL.devOff;
  if (["ac", "breezer", "thermostat"].includes(e.type)) return any(["heat"]) ? COL.heatOn : any(["cool", "fan_only", "auto", "dry"]) ? COL.coolOn : COL.devOff;
  if (e.type === "tv") return any(["on", "playing", "paused", "idle"]) ? 0x3d6fd6 : COL.devOff;
  if (e.type === "speaker") return any(["on", "playing", "paused", "idle"]) ? COL.mediaOn : COL.devOff;
  if (e.type === "vacuum") return any(["cleaning", "returning"]) ? COL.vacOn : COL.vacuum;
  return COL.devOff;
}
// выключенный экран ТВ и станции — тёмный, остальные свои части (индикаторы, плафоны) — светлые
const offColor = e => (e.type === "tv" ? 0x16181b : e.type === "speaker" ? 0x1b2233 : COL.devOff);
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
      base.color.setHex(lit ? c : e.geom || e.type === "light" ? offColor(e) : COL.badge);
      base.emissive.setHex(lit ? c : 0x000000);
      base.emissiveIntensity = lit ? (e.type === "light" || e.type === "backlight" ? 1.1 : 0.55) : 0;
    });
    const pool = o.userData.pool;                          // включённый свет — пятно на полу комнаты
    if (pool) {
      pool.material.uniforms.k.value = lit && e.type === "light" ? 0.5 : 0;
      pool.visible = S.view === "unit" && pool.material.uniforms.k.value > 0;
    }
  }
  // пылесос: живой робот по позе с карты и робот, нарисованный в доке базы, — один и тот же. Пока он в доке
  // (состояние docked/charging или поза ближе 0,4 м к доку), виден робот базы, иначе — только живой
  if (S.puck) {
    const s = S.states[S.puck.userData.camera];
    const pose = s?.pose, dock = [];
    S.obj.get(S.puck.userData.vac)?.traverse(m => { if (m.isMesh && m.material?.userData?.dock) dock.push(m); });
    let docked = !pose || ["docked", "charging"].includes(S.states[S.puck.userData.entity]?.state);
    if (!docked && dock.length) {
      const c = new THREE.Box3().setFromObject(dock[0]).getCenter(new THREE.Vector3());
      docked = Math.hypot(c.x - pose[0], c.y - pose[1]) < 0.4;
    }
    dock.forEach(m => { m.visible = docked; });
    S.puck.userData.pose = pose && !docked ? pose : null;
    if (pose) {
      S.puck.position.set(pose[0], pose[1], pose[2]);
      S.puck.rotation.set(0, 0, THREE.MathUtils.degToRad(pose[3] || 0));
    }
    S.puck.visible = S.view === "unit" && !!S.puck.userData.pose;
  }
  invalidate();
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
      paintSky();
      if (m.version != null && m.version !== S.ver) reload(S.sel?.id);
      else { paintDevices(); if (S.sel) refreshHa(S.sel); }
      status();
    } else if (m.type === "state") {
      if (m.s) S.states[m.id] = m.s; else delete S.states[m.id];
      if (m.id === "sun.sun") paintSky();
      paintDevices(m.id);
      if (S.sel && (bound(S.sel).includes(m.id))) refreshHa(S.sel);
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
  if (director.active) { director.onRebuild(); return; }  // показ продолжается на новых данных
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
    if (TV) { controls.enabled = false; resize(); if (QS.get("autoplay") === "1") director.play({ op: "overview" }); }
    window.cherrybim.ready = true;
  } catch (err) {
    $("#stxt").textContent = "Не загрузилось: " + err.message;
    window.cherrybim.error = err.message;
  }
}
start();
