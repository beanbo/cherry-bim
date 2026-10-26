// Cherry BiM — параметрические модели по типам: из габаритов сущности строится узнаваемая вещь (кровать с изголовьем,
// окно с рамами и подоконником, унитаз, радиатор…). Геометрия реалистичная, текстур нет — только цвета материалов.
//
// Соглашения (как у мебели в пакете): система сущности — метры, Z вверх; у коробки начало в углу, она тянется по +X,
// +Y, +Z; фасад — сторона −Y. У проёмов X — вдоль стены, −Y — сторона комнаты (у двери — куда она открывается).
// Подсказки для отрисовки лежат в props.render: colors {часть: "#rrggbb"}, hinge "left"/"right" (петли, если
// смотреть на фасад), open (угол открывания двери), front у мест хранения ("drawer", "door", "open", "shelf",
// "hooks", "none"), handles у мебели ("gola", "bar", "knob", "none"), fronts — двери шкафа [x0, z0, x1, z1, петли].
import * as THREE from "three";
import { Kit, roundRect, ellipse, sector } from "./kit.js";
import { M, C, pbr, hex, matte, satin } from "./materials.js";

const F = {};                       // "kind.type" → построитель
const fam = (keys, fn, opt = {}) => keys.split(" ").forEach(k => { F[k] = Object.assign(fn, opt); });
const FREE = { free: true };        // модель строится и у точки: центр в начале системы
const VARIANTS = { variants: true };   // проём: две сборки — целиком и со срезом стен

// Построить модель сущности. env — доступ к соседям: by(id), kids(id), rel(a, b) (матрица b в системе a),
// ceil (высота потолка квартиры), floorZ(e) (высота начала сущности над полом квартиры), own(e) (свой материал
// устройства, его красит состояние HA). Возвращает Group в системе сущности или null — тогда рисует просмотрщик.
export function buildFamily(e, env) {
  const fn = F[`${e.kind}.${e.type}`] || F[`${e.kind}.*`];
  if (!fn) return null;
  const g = e.geom || {};
  const ctx = context(e, env);
  if (fn.variants) {                                       // проёмы: целиком и со срезом стен
    const group = new THREE.Group();
    const full = draw(fn, ctx, Infinity), cut = draw(fn, ctx, env.cutAt - env.floorZ(e));
    full.userData.variant = "full";
    cut.userData.variant = "cut";
    group.add(full, cut);
    group.userData.variants = true;
    return group;
  }
  if (!ctx.size && !fn.free) return null;
  // render.hidden: true — вещь в данных есть, но не рисуется; "full" — видна только на срезе (в виде без среза её
  // закрывает штора или тюль, как на фото)
  if (ctx.r.hidden === true) return new THREE.Group();
  if (ctx.r.hidden === "full") {
    const group = new THREE.Group(), full = new THREE.Group(), cut = draw(fn, ctx, Infinity);
    full.userData.variant = "full";
    cut.userData.variant = "cut";
    group.add(full, cut);
    group.userData.variants = true;
    return group;
  }
  return draw(fn, ctx, Infinity);
}

function draw(fn, ctx, clipZ) {
  const kit = new Kit({ clipZ });
  const extra = fn({ ...ctx, kit }) || null;
  const g = kit.build();
  if (extra) g.add(extra);
  return g;
}

function context(e, env) {
  const r = e.props?.render || {};
  const colors = r.colors || {};
  const size = e.geom?.type === "box" ? e.geom.size : null;
  return {
    e, env, r, size,
    // материал части: цвет из подсказок пакета или запасной материал
    mat(part, fallback, finish = "satin") {
      const c = hex(colors[part], null) ?? (part !== "*" ? hex(colors["*"], null) : null);
      if (c == null) return fallback;
      const rough = { matte: 0.88, satin: 0.5, gloss: 0.18, fabric: 0.97, metal: 0.35, mirror: 0.25 }[finish] ?? 0.5;
      // зеркало отражает светлую комнату: чуть светится своим цветом, чтобы быть светлее стены, как на фото
      if (finish === "mirror") return pbr(c, { rough, metal: 0, emissive: c, emissiveIntensity: 0.15 });
      return pbr(c, { rough, metal: finish === "metal" ? 0.8 : 0 });
    },
  };
}

// ── общие детали ────────────────────────────────────────────────────────────
// ручка-скоба: вертикальная (along = "z") или горизонтальная ("x"), на фасаде y = yf (фасад смотрит в −Y)
// ends — стойки на самых концах («П»), mid — ещё одна стойка на таком расстоянии от верхнего конца
function bar(kit, mat, x, z, len, along = "z", yf = 0, r = 0.006, ends = false, mid = null) {
  const off = 0.032, legs = ends ? r : Math.min(len * 0.1, 0.03);
  if (along === "z") {
    kit.rod(mat, [x, yf - off, z - len / 2], [x, yf - off, z + len / 2], r, 10);
    for (const s of [-1, 1]) kit.rod(mat, [x, yf - off, z + s * (len / 2 - legs)], [x, yf, z + s * (len / 2 - legs)], r * 0.8, 8);
    if (mid != null) kit.rod(mat, [x, yf - off, z + len / 2 - mid], [x, yf, z + len / 2 - mid], r * 0.8, 8);
  } else {
    kit.rod(mat, [x - len / 2, yf - off, z], [x + len / 2, yf - off, z], r, 10);
    for (const s of [-1, 1]) kit.rod(mat, [x + s * (len / 2 - legs), yf - off, z], [x + s * (len / 2 - legs), yf, z], r * 0.8, 8);
  }
}
function knob(kit, mat, x, z, yf = 0) { kit.rod(mat, [x, yf, z], [x, yf - 0.025, z], 0.012, 14, 0.016); }
// ручка-дуга: горизонтальная скоба, плавно выгнутая от фасада
function arch(kit, mat, x, z, len, yf = 0) {
  const h = len / 2;
  kit.tube(mat, [[x - h, yf, z], [x - h * 0.75, yf - 0.02, z], [x, yf - 0.028, z], [x + h * 0.75, yf - 0.02, z], [x + h, yf, z]], 0.005, 8);
}

// ножки: круглые (r > 0) по углам прямоугольника
function legs(kit, mat, x0, y0, x1, y1, h, r = 0.02, inset = 0.04) {
  for (const x of [x0 + inset, x1 - inset]) for (const y of [y0 + inset, y1 - inset]) kit.cylZ(mat, x, y, 0, h, r * 0.8, 12, r);
}

// фасад (дверца, ящик): панель перед плоскостью y (в сторону −Y) с зазором и, если есть, ручка.
// hinge — где петли у дверцы; at — где ручка у дверцы по высоте: "top", "bottom" или "middle"
// В щели между соседними фасадами — тёмная подложка: одна лицевая плоскость в 1 мм за лицом фасада (не коробка: её
// торцы выглядывали за кромки). outer = {l, r, b, t} — наружные кромки ряда фасадов: там подложки нет, видна светлая
// кромка корпуса. Панель отступает от плоскости y на полмиллиметра. handleX — ручка дверцы от кромки, top — ручка ящика
// (откидной дверцы) от верха. У gola над фасадом канал 3 см, а между двумя фасадами (сверху сосед) — средний профиль 2 см.
const GAP = pbr(0x2e2e2c, { rough: 0.9 }), gaps = new Map();
function gapOf(m, k = 0.6) {                               // подложка щели: цвет фасада ×k (по умолчанию ×0,6)
  const c = m?.color;
  if (!c) return GAP;
  const h = c.getHex(), key = `${h}:${k}`;
  if (!gaps.has(key)) gaps.set(key, pbr([16, 8, 0].reduce((v, s) => v | Math.round(((h >> s) & 255) * k) << s, 0), { rough: 0.9 }));
  return gaps.get(key);
}
function front(kit, mat, x0, z0, x1, z1, { y = 0, t = 0.018, handles = "bar", kind = "door", hinge = "left",
  handleMat = M.black, at = "top", hlen = null, outer = null, handleX = 0.04, top = null } = {}) {
  const gap = 0.002, o = outer || {}, e = gap + 0.0005;
  if (handles === "gola") {                                // профиль gola: канал над фасадом вместо ручки, под ним губа профиля
    const gc = o.t === false ? 0.02 : 0.03;
    kit.box(M.graphite, x0, y + 0.012, z1 - gc, x1, y + 0.03, z1);
    kit.box(M.graphite, x0, y + 0.0005, z1 - gc - 0.001, x1, y + 0.012, z1 - gc + 0.001);
    z1 -= gc;
  }
  kit.slab(gapOf(mat), x0 + (o.l ? e : 0), y - t + 0.001, z0 + (o.b ? e : 0), x1 - (o.r ? e : 0), y - t + 0.0012, z1 - (o.t ? e : 0), "x-x+y+z-z+");
  kit.box(mat, x0 + gap, y - t, z0 + gap, x1 - gap, y - 0.0005, z1 - gap, 0.0007);
  if (handles === "none" || handles === "gola") return;
  const w = x1 - x0, h = z1 - z0, yf = y - t;
  if (kind === "drawer") {                                 // at = "middle" — ручка ящика по середине фасада
    const z = at === "middle" ? (z0 + z1) / 2 - 0.01 : z1 - (top ?? Math.min(0.05, h / 3));
    if (handles === "knob") knob(kit, handleMat, (x0 + x1) / 2, z, yf);
    else if (handles === "arch") arch(kit, handleMat, (x0 + x1) / 2, z, hlen ?? Math.min(0.13, w * 0.4), yf);
    else bar(kit, handleMat, (x0 + x1) / 2, z, hlen ?? Math.min(0.16, w * 0.5), "x", yf);
    return;
  }
  const len = hlen ?? Math.min(0.16, h * 0.5), hx = hinge === "right" ? x0 + handleX : x1 - handleX;
  const hz = at === "bottom" ? z0 + len / 2 + 0.05 : at === "middle" ? (z0 + z1) / 2 : z1 - len / 2 - 0.05;
  if (handles === "knob") knob(kit, handleMat, hx, hz, yf);
  else bar(kit, handleMat, hx, hz, len, "z", yf);
}

// ═══ мебель ═════════════════════════════════════════════════════════════════
fam("furniture.bed", ({ kit, size: [W, L, H], mat, r }) => {
  // изголовье у стены (+Y), изножье — фасад (−Y). render.frame = "wide" — широкая мягкая рама вокруг матраса,
  // render.headboard = "split" — две мягкие подушки на изголовье; цвета: body (ткань), bedding (бельё), pillows
  const body = mat("body", matte(0xa77d58), "fabric"), bed = mat("bedding", M.duvet, "fabric"), pil = mat("pillows", M.linen, "fabric");
  const top = r.top ?? Math.max(H, 0.5), hb = r.headboard_h ?? 1.05, hbT = r.headboard === "split" ? 0.18 : 0.1;
  const inner = r.frame === "wide" ? (r.rim ?? 0.14) : 0.025, foot = r.frame === "wide" && r.rim ? r.rim : inner * 0.6;   // render.rim — ширина борта
  // render.frame_x = [x0, x1] — рама-подиум и матрас уже изголовья (изголовье на всю ширину коробки)
  const [fx0, fx1] = r.frame === "wide" && r.frame_x ? r.frame_x : [0, W];
  if (r.frame === "wide") {                                // рама-подиум: мягкие борта, матрас утоплен в неё
    kit.box(body, fx0, 0, 0.005, fx1, L - hbT + 0.02, r.frame_h ?? top - 0.1, 0.06);
    kit.box(bed, fx0 + inner, foot, top - 0.15, fx1 - inner, L - hbT - 0.02, top + 0.02, 0.05);   // матрас в белье
  } else {
    legs(kit, M.walnut, 0.02, 0.02, W - 0.02, L - 0.12, 0.08, 0.022, 0.08);
    kit.box(body, 0.01, 0.0, 0.08, W - 0.01, L - 0.09, top - 0.2, 0.03);                  // царга
    kit.box(M.linen, 0.04, 0.03, top - 0.2, W - 0.04, L - 0.11, top, 0.05);               // матрас
  }
  kit.box(bed, fx0 + inner + 0.01, foot + 0.02, top - 0.02, fx1 - inner - 0.01, L * 0.68, top + 0.07, 0.045);   // одеяло
  const FW = fx1 - fx0, pw = FW > 1.3 ? (FW - 2 * inner - 0.2) / 2 : FW - 2 * inner - 0.12;
  for (let i = 0; i < (FW > 1.3 ? 2 : 1); i++) {
    const x0 = fx0 + inner + 0.08 + i * (pw + 0.04);
    kit.box(pil, x0, L - hbT - 0.5, top, x0 + pw, L - hbT - 0.1, top + 0.13, 0.06);       // подушки
  }
  if (r.headboard === "split") {                           // основание изголовья и две мягкие подушки на нём
    kit.box(body, 0, L - 0.08, 0.02, W, L, hb - 0.12, 0.03);
    for (const [x0, x1] of [[0.02, W / 2 - 0.005], [W / 2 + 0.005, W - 0.02]]) kit.box(body, x0, L - hbT, top - 0.05, x1, L - 0.06, hb, 0.07);
  } else {
    kit.box(body, 0, L - 0.1, 0.08, W, L, hb, 0.04);                                       // изголовье
    for (let x = 0.12; x < W - 0.1; x += (W - 0.24) / Math.max(1, Math.round((W - 0.24) / 0.3))) {
      kit.box(body, x - 0.004, L - 0.106, 0.42, x + 0.004, L - 0.1, hb - 0.07);           // строчка на изголовье
    }
  }
});

fam("furniture.sofa", ({ kit, size: [W, D, H], mat, r }) => {
  // render.legs = false — без ножек: обивка почти до пола; render.arms = false — без подлокотников;
  // render.bolster — спинка ниже, по её верху во всю длину мягкий валик (render.bolster_inset — валик отступает от
  // задней грани, сверху видна полоса спинки); render.back = "tufted" — цельная стёганая спинка без подушек;
  // render.seats — число подушек сиденья; render.arm_w, arm_r, arm_h — ширина, скругление и высота подлокотников,
  // render.arm_bulge — подлокотники пухлые: шире наружу на столько же, на сколько больше скругление (верхняя кромка на
  // месте, бок ниже выступает), render.arm_flare — подлокотники расходятся наружу к спинке: сзади на столько шире;
  // у стёганой спинки render.seams_v — число вертикальных швов, render.seam_h — высота горизонтального
  const body = mat("body", matte(0x8e98a3), "fabric"), cush = mat("cushion", body, "fabric"), tufted = r.back === "tufted";
  const a = r.arms === false ? 0 : r.arm_w ?? Math.min(0.2, W * 0.12), back = Math.min(0.24, D * 0.3), lh = r.legs === false ? 0.02 : r.legs_h ?? 0.09;
  const seat = 0.35 + lh;                                  // render.legs_h — высота ножек; цвет ножек — colors.legs
  const li = r.leg_inset ?? 0.06;                          // render.leg_inset — отступ ножек от углов
  if (r.legs !== false) splayLegs(kit, mat("legs", M.walnut), li, li, W - li, D - li, lh + 0.005, 0.02, lh > 0.12 ? 0.025 : 0.0);
  kit.box(body, 0, 0.02, lh, W, D, 0.3, 0.03);                                           // основание
  if (a) {
    const ar = r.arm_r ?? 0.06, ah = r.arm_h ?? 0.64;
    const bu = r.arm_bulge ?? 0, fl = Math.atan2(r.arm_flare ?? 0, D) * 180 / Math.PI;   // поворот вокруг переднего ребра
    kit.turn(fl, 0, 0, () => kit.box(body, -bu, 0, lh, a, D, ah, ar + bu));             // подлокотники
    kit.turn(-fl, W, 0, () => kit.box(body, W - a, 0, lh, W + bu, D, ah, ar + bu));
  }
  if (r.bolster) {
    const by = r.bolster_inset != null ? D - r.bolster_inset - 0.1 : D - back / 2;
    kit.box(body, a, D - back, lh, W - a, D, H - 0.13, 0.04);                            // спинка до низа валика
    kit.box(body, a + 0.005, by - 0.1, H - 0.16, W - a - 0.005, by + 0.1, H, 0.07);       // валик — заподлицо с торцами
  } else if (tufted) {
    // спинка во всю ширину, за подлокотниками; торцы на 3 мм внутри, чтобы не мерцать с гранями подлокотников
    kit.box(body, 0.003, D - back, 0.3, W - 0.003, D, H, 0.05);
    const n = (r.seams_v ?? Math.max(1, Math.round((W - 2 * a) / 0.25) - 1)) + 1, sm = mat("seam", pbr(0x4f5257, { rough: 0.95 }));
    for (let i = 1; i < n; i++) {                                                         // вертикальные швы — тёмной вставкой
      const x = a + (W - 2 * a) * i / n;
      kit.box(sm, x - 0.003, D - back - 0.0008, seat + 0.04, x + 0.003, D - back, H - 0.05);
    }
    if (r.seam_h) kit.box(sm, a, D - back - 0.0008, r.seam_h - 0.003, W - a, D - back, r.seam_h + 0.003);   // горизонтальный шов
  } else kit.box(body, a, D - back, 0.3, W - a, D, H, 0.07);                             // спинка
  const n = r.seats ?? (W - 2 * a > 1.7 ? 3 : 2), w = (W - 2 * a) / n;
  for (let i = 0; i < n; i++) {
    const x0 = a + i * w;
    kit.box(cush, x0 + 0.005, 0.01, 0.3, x0 + w - 0.005, D - back + 0.02, seat, 0.05);   // сиденья
    if (!r.bolster && !tufted) kit.box(cush, x0 + 0.01, D - back - 0.14, seat - 0.01, x0 + w - 0.01, D - back + 0.02, H - 0.05, 0.07);  // подушки спинки
  }
});

fam("furniture.desk", ({ kit, size: [W, D, H], mat, r }) => {
  // render.legs: "panel" — боковины и экран сзади (render.screen = false — без экрана), "wood" — тонкие ножки,
  // "splay" — деревянные конические ножки, разведённые наружу (опоры выходят за коробку), иначе металлический
  // каркас; render.drawer — ящик под столешницей у фасада (render.drawers — ящики [x0, x1] вдоль стола);
  // render.panel_inset = [слева, справа] — боковины отступают от торцов столешницы; render.apron_flush — у "splay"
  // короб под столешницей во всю длину, заподлицо с её торцами
  const wood = ["panel", "wood", "splay"].includes(r.legs);
  const top = mat("top", M.oak), frame = mat("frame", wood ? top : M.white), t = 0.025;
  kit.box(top, 0, 0, H - t, W, D, H, 0.003);
  if (r.legs === "panel") {
    const [il, ir] = r.panel_inset || [0, 0];
    for (const x of [il, W - 0.025 - ir]) kit.box(frame, x, 0.02, 0, x + 0.025, D - 0.01, H - t);
    if (r.screen !== false) kit.box(frame, 0.025, D - 0.05, H * 0.35, W - 0.025, D - 0.03, H - t);   // экран сзади
  } else if (r.legs === "splay") {
    splayLegs(kit, frame, 0.05, 0.07, W - 0.05, D - 0.07, H - t, 0.022, r.splay ?? 0.1);   // render.splay — число или [dx, dy]
    if (r.apron_flush) kit.box(frame, 0, 0.04, H - t - 0.09, W, D - 0.02, H - t);       // короб заподлицо с торцами
    else kit.box(frame, 0.05, 0.05, H - t - 0.08, W - 0.05, D - 0.05, H - t);             // царга
  } else if (r.legs === "wood") {
    for (const x of [0.05, W - 0.05]) for (const y of [0.05, D - 0.05]) kit.rod(frame, [x, y, 0], [x, y, H - t], 0.018, 12, 0.022);
    kit.box(frame, 0.04, 0.04, H - t - 0.09, W - 0.04, D - 0.04, H - t);                  // царга
  } else {
    for (const x of [0.03, W - 0.07]) for (const y of [0.03, D - 0.07]) kit.box(frame, x, y, 0, x + 0.04, y + 0.04, H - t);
    kit.box(frame, 0.07, D - 0.06, H - 0.1, W - 0.07, D - 0.04, H - t);                    // царга сзади
  }
  const dr = r.drawers || (r.drawer ? [[W * 0.3, W * 0.7]] : []);
  dr.forEach(([x0, x1], i) => front(kit, mat("front", top), x0, H - t - 0.09, x1, H - t - 0.005,
    { y: 0.04, kind: "drawer", handles: r.handles ?? "none", handleMat: mat("handle", M.black, "metal"),
      outer: { l: i === 0, r: i === dr.length - 1, t: true, b: true } }));
  for (let i = 1; i < dr.length; i++) {                    // узкий промежуток между ящиками — подложка, иначе в нём царга
    const a = dr[i - 1][1], b = dr[i][0];
    if (b > a && b - a < 0.03) kit.slab(gapOf(mat("front", top)), a - 0.002, 0.023, H - t - 0.09, b + 0.002, 0.0232, H - t - 0.005, "x-x+y+z-z+");
  }
});

fam("furniture.dining_table", ({ kit, size: [W, L, H], mat, r }) => {
  // стол по центру места, стулья вдоль длинных сторон, задвинуты. render.chair_out — где спинка стула от края
  // стола: число или {side, ends} (по длинным сторонам и у торцов); render.legs — как у tableAt
  const along = L >= W, len = along ? L : W, wid = along ? W : L;
  const out = r.chair_out && typeof r.chair_out === "object" ? r.chair_out : { side: r.chair_out, ends: r.chair_out };
  const tl = r.table_l ?? Math.min(len - 0.25, 1.4), tw = r.table_w ?? Math.min(wid - 0.24, 0.8), h = Math.max(H, 0.74);
  const top = mat("top", M.oak), chair = mat("chairs", matte(0x31508a), "fabric");
  const rot = along ? new THREE.Matrix4() : new THREE.Matrix4().makeTranslation(W, 0, 0).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
  kit.at(rot, () => {
    const cx = wid / 2, cy = len / 2;
    tableAt(kit, top, mat("legs", M.black, "metal"), cx, cy, tw, tl, h, r.legs);
    const n = r.chairs_per_side ?? (tl > 1.15 ? 2 : 1), legMat = mat("chair_legs", M.oak);
    for (const side of [-1, 1]) for (let i = 0; i < n; i++) {
      const y = cy + (n === 1 ? 0 : (i - (n - 1) / 2) * tl / n);
      const xb = cx + side * (tw / 2 + (out.side ?? 0.12));     // спинка за краем стола (задвинут — 0,12)
      kit.turn(side > 0 ? -90 : 90, xb, y, () => shellChair(kit, chair, legMat, xb, y));
    }
    for (const end of r.chairs_at_ends ? [-1, 1] : []) {
      const yb = cy + end * (tl / 2 + (out.ends ?? 0.12));
      kit.turn(end > 0 ? 0 : 180, cx, yb, () => shellChair(kit, chair, legMat, cx, yb));
    }
  });
});

// стол: столешница, царга и ножки — "splay" (металлические, расставленные наружу), "trestle" (две металлические
// опоры у торцов: стойки расходятся книзу от перекладины, по полу не связаны), "strip" (плоские ножки-полосы по
// диагонали углов, расставлены наружу, без царги) или прямые деревянные
function tableAt(kit, top, legMat, cx, cy, tw, tl, h, kind, inset = 0.07, splay = 0.1, sw = 0.05) {   // splay — вынос ножки-полосы у пола, sw — её ширина
  kit.box(top, cx - tw / 2, cy - tl / 2, h - 0.03, cx + tw / 2, cy + tl / 2, h, 0.006);
  if (kind === "trestle") {
    const a = Math.min(tw / 2 - 0.12, 0.26), b = Math.min(tw / 2 - 0.04, 0.38);
    for (const sy of [-1, 1]) {
      const y = cy + sy * (tl / 2 - 0.07);
      kit.rod(legMat, [cx - a, y, h - 0.045], [cx + a, y, h - 0.045], 0.015, 4);      // перекладина под столешницей
      for (const s of [-1, 1]) kit.rod(legMat, [cx + s * b, y, 0.012], [cx + s * a, y, h - 0.045], 0.015, 4);
    }
    kit.rod(legMat, [cx, cy - tl / 2 + 0.07, h - 0.05], [cx, cy + tl / 2 - 0.07, h - 0.05], 0.012, 4);   // продольная связь
    return;
  }
  if (kind === "strip") {
    const tilt = Math.atan2(splay, h - 0.03), len = (h - 0.03) / Math.cos(tilt);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const m = new THREE.Matrix4().makeTranslation(cx + sx * (tw / 2 - inset), cy + sy * (tl / 2 - inset), h - 0.03)
        .multiply(new THREE.Matrix4().makeRotationZ(Math.atan2(sy, sx)))                  // ось X — по диагонали наружу
        .multiply(new THREE.Matrix4().makeRotationY(-tilt));
      kit.at(m, () => kit.box(legMat, -0.006, -sw / 2, -len, 0.006, sw / 2, 0));
    }
    return;
  }
  kit.box(kind === "splay" ? legMat : top, cx - tw / 2 + 0.06, cy - tl / 2 + 0.06, h - 0.09, cx + tw / 2 - 0.06, cy + tl / 2 - 0.06, h - 0.03);   // царга
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const x = cx + sx * (tw / 2 - 0.08), y = cy + sy * (tl / 2 - 0.08);
    if (kind === "splay") kit.rod(legMat, [x + sx * 0.06, y + sy * 0.03, 0], [x, y, h - 0.03], 0.016, 4, 0.024);
    else kit.box(top, x - 0.025, y - 0.025, 0, x + 0.025, y + 0.025, h - 0.03);
  }
}

// расставленные наружу конические ножки по углам прямоугольника (стулья, пуфы, скамьи); corners — свой разлёт у
// отдельных углов: {fl | fr | bl | br: [dx, dy]} (f — у фасада, r — справа, если смотреть на фасад)
function splayLegs(kit, mat, x0, y0, x1, y1, h, r = 0.016, splay = 0.04, corners = null) {
  const [sx, sy] = Array.isArray(splay) ? splay : [splay, splay];
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  for (const x of [x0, x1]) for (const y of [y0, y1]) {
    const [cs, ct] = corners?.[(y === y0 ? "f" : "b") + (x === x1 ? "r" : "l")] ?? [sx, sy];
    const dx = Math.sign(x - cx) * cs, dy = Math.sign(y - cy) * ct;
    kit.rod(mat, [x + dx, y + dy, 0], [x, y, h], r * 0.7, 10, r);
  }
}

// стул-«ракушка» в велюре на деревянных ножках: спинка у точки (x, y), сиденье — в сторону −Y
function shellChair(kit, fabric, legMat, x, y) {
  // чаша-«ванночка»: верх почти ровный (≈0,74–0,80) и опускается только у концов подлокотников, сиденье внутри
  const d = 0.48, cy = y - d / 2;
  for (const [lx, ly, sp] of [[x - 0.15, y - d + 0.09, 0.04], [x + 0.15, y - d + 0.09, 0.04], [x - 0.15, y - 0.09, 0.12], [x + 0.15, y - 0.09, 0.12]]) {
    kit.rod(legMat, [lx + Math.sign(lx - x) * sp, ly + Math.sign(ly - cy) * sp, 0], [lx, ly, 0.42], 0.016 * 0.7, 10, 0.016);   // задние разведены шире передних
  }
  kit.prism(fabric, ellipse(x, cy + 0.005, 0.205, 0.205, 40), 0.40, 0.48, [], 0.035);     // сиденье — одна толстая подушка
  // чаша сужается книзу, кромка без излома сходит от 0,80 сзади к 0,50 у концов подлокотников
  const n = 72, nz = 6, a0 = 0, a1 = Math.PI, z0 = 0.42;
  const top = th => 0.5 + 0.3 * Math.pow(Math.sin(th), 0.35);
  const at = (th, t, rad) => {                             // точка чаши: угол, доля высоты, радиус у низа
    const z = z0 + (top(th) - z0) * t, rr = rad + 0.045 * t;
    return [x + rr * Math.cos(th), cy + rr * Math.sin(th) + 0.03 + 0.01 * t, z];
  };
  const ths = Array.from({ length: n + 1 }, (_, j) => a0 + (a1 - a0) * j / n);
  const outer = [], inner = [];
  for (let i = 0; i <= nz; i++) {
    outer.push(ths.map(th => at(th, i / nz, 0.22)));
    inner.push(ths.map(th => at(th, i / nz, 0.185)).reverse());
  }
  kit.grid(fabric, outer);                                 // снаружи
  kit.grid(fabric, inner);                                 // внутри
  kit.grid(fabric, [ths.map(th => at(th, 1, 0.22)), ths.map(th => at(th, 1, 0.185))]);   // кромка
  for (const [th, flip] of [[a0, false], [a1, true]]) {    // торцы подлокотников
    const col = rad => Array.from({ length: nz + 1 }, (_, i) => at(th, i / nz, rad));
    kit.grid(fabric, flip ? [col(0.185), col(0.22)] : [col(0.22), col(0.185)]);
  }
}

fam("furniture.bookshelf", ({ kit, size: [W, D, H], mat, r }) => {
  // render.doors_below — высота закрытой части с двумя дверцами внизу, выше открытые полки; render.handle_x — ручки
  // от среднего шва
  const b = mat("body", M.white), t = 0.018;
  kit.box(b, 0, 0, 0, t, D, H);
  kit.box(b, W - t, 0, 0, W, D, H);
  kit.box(b, t, 0, H - t, W - t, D, H);
  kit.box(b, t, 0.02, 0, W - t, D, 0.06);                                                // цоколь
  kit.box(b, t, D - 0.006, 0.06, W - t, D, H - t);                                        // задняя стенка
  const zb = r.doors_below ? Math.min(r.doors_below, H - 0.3) : 0.06;
  const n = Math.max(1, Math.round((H - zb) / 0.34));
  for (let i = 0; i <= n - 1; i++) {
    const z = zb + i * (H - zb - t) / n;
    kit.box(b, t, 0, z, W - t, D - 0.006, z + t);                                         // полки
  }
  if (r.doors_below) {
    const fr = mat("front", b), hm = mat("handle", M.brushed, "satin"), handles = r.handles ?? "bar";
    const zd = r.doors_from ?? 0.06;                       // render.doors_from — низ дверец (цоколь за ними)
    const handleX = r.handle_x ?? 0.04;
    front(kit, fr, 0, zd, W / 2, zb, { kind: "door", hinge: "left", handleMat: hm, handles, handleX, outer: { l: true, t: true, b: true } });
    front(kit, fr, W / 2, zd, W, zb, { kind: "door", hinge: "right", handleMat: hm, handles, handleX, outer: { r: true, t: true, b: true } });
  }
});

fam("furniture.nightstand", ({ kit, size: [W, D, H], mat }) => {
  const b = mat("body", M.white), f = mat("front", b);
  legs(kit, M.walnut, 0, 0, W, D, 0.1, 0.016, 0.04);
  kit.box(b, 0, 0.018, 0.1, W, D, H, 0.003);
  const n = H > 0.45 ? 2 : 1, h = (H - 0.1) / n;
  for (let i = 0; i < n; i++) front(kit, f, 0, 0.1 + i * h, W, 0.1 + (i + 1) * h, { y: 0.018, kind: "drawer", handles: "knob", handleMat: M.brass });
});

fam("furniture.wardrobe", ({ kit, e, env, size: [W, D, H], mat, r }) => {
  // корпус, цоколь с отступом, накладные двери по props.render.fronts (из проекта шкафа; иначе — по секциям),
  // ручки-скобы, нащельник до потолка
  const body = mat("body", M.hickory), fr = mat("front", body), hm = mat("handle", M.black, "metal");
  const t = 0.018, socle = r.socle ?? 0.1;
  kit.box(body, 0, 0, socle, t, D, H);
  kit.box(body, W - t, 0, socle, W, D, H);
  kit.box(body, t, 0.02, H - t, W - t, D, H);
  kit.box(body, t, 0.02, socle, W - t, D, socle + t);
  kit.box(mat("socle", body), 0, r.socle_inset ?? 0.05, 0, W, D, socle);                // цоколь (render.socle_inset — отступ от фасада)
  kit.box(M.white, t, D - 0.004, socle, W - t, D, H - t);                                // задняя стенка (ХДФ)
  let doors = Array.isArray(r.fronts) ? r.fronts : null;
  if (!doors) {                                            // проекта фасада нет — двери по ~0,5 м на всю ширину
    const n = Math.max(1, Math.round(W / 0.5));
    doors = [];
    for (let i = 0; i < n; i++) doors.push({ x: [i * W / n, (i + 1) * W / n], z: [socle, H], hinge: i % 2 ? "right" : "left" });
  }
  // двери на миллиметр впереди корпуса, за ними тёмная подложка: щель — сплошная тёмная линия, а не мерцание граней
  // мест хранения в плоскости фасада
  const fz0 = Math.min(...doors.map(d => d.z[0])), fz1 = Math.max(...doors.map(d => d.z[1]), ...(r.fillers || []).map(f => f[3]));
  kit.slab(gapOf(fr), 0.002, -t, fz0, W - 0.002, -t + 0.0002, fz1, "x-x+y+z-z+");   // подложка в 1 мм за лицом дверей
  for (const d of doors) {
    const [x0, x1] = d.x, [z0, z1] = d.z;
    kit.box(fr, x0 + 0.002, -t - 0.001, z0 + 0.002, x1 - 0.002, -0.001, z1 - 0.002, 0.002);
    if (r.handles === "none") continue;
    if (d.handle === null || d.handle === false) continue;   // false — двери без ручек (нажимные)
    if (Array.isArray(d.handle)) {
      const [hx, hz0, hz1] = d.handle;
      const hp = r.handle_posts, ends = hp === "ends" || (Array.isArray(hp) && hp[0] === "ends");   // render.handle_posts: "ends" или ["ends", от верха]
      bar(kit, hm, hx, (hz0 + hz1) / 2, hz1 - hz0, "z", -t - 0.001, 0.006, ends, Array.isArray(hp) ? hp[1] ?? null : null);
    } else {
      const hx = d.hinge === "right" ? x0 + 0.045 : x1 - 0.045, h = z1 - z0, len = Math.min(0.4, h * 0.6);
      bar(kit, hm, hx, h > 1.2 ? Math.min(z0 + h / 2, 1.1) : z0 + len / 2 + 0.06, len, "z", -t - 0.001, 0.006);
    }
  }
  for (const [x0, z0, x1, z1] of r.fillers || []) kit.box(fr, x0, -t - 0.001, z0, x1, -0.001, z1, 0.001);   // нащельник
  // перегородки между соседними секциями (места хранения type section): плита корпуса во всю глубину
  const secs = env.kids(e.id).filter(k => k.kind === "storage" && k.type === "section" && k.geom?.type === "box")
    .map(k => [k.placement?.pos?.[0] || 0, (k.placement?.pos?.[0] || 0) + k.geom.size[0]]).sort((p, q) => p[0] - q[0]);
  for (let i = 0; i + 1 < secs.length; i++) if (secs[i + 1][0] - secs[i][1] > 0.005) kit.box(body, secs[i][1], 0.02, socle + t, secs[i + 1][0], D - 0.004, H - t);
});

fam("furniture.kitchen_unit", ({ kit, e, env, size: [W, D, H], mat, r }) => {
  // нижние (у пола, до 1 м): цоколь, корпус, столешница; навесные и колонны — корпус. Фасады рисуют места
  // хранения и встроенная техника; где фасада нет — глухая панель.
  const z0 = env.floorZ(e), base = z0 < 0.2 && H <= 1.05;
  const body = mat("body", M.white), fr = mat("front", body);
  const plinth = r.plinth ?? (base || H > 1.6 ? 0.1 : 0);   // render.plinth = 0 — фасад до пола
  if (plinth) kit.box(mat("plinth", M.graphite), 0, 0.06, 0, W, D - 0.01, plinth);
  // полосы между ярусами: [z0, z1, часть, x0, x1] — по умолчанию на всю ширину
  for (const [z0s, z1s, part, xs0 = 0, xs1 = W] of r.strips || []) kit.box(mat(part || "strip", M.oak), xs0, -0.018, z0s, xs1, 0, z1s);
  const topT = base ? 0.038 : 0;
  if (base) {                                              // корпус-короб: сверху открыт, под мойкой видна чаша
    const t = 0.018, z1 = H - topT;
    kit.box(body, 0, 0, plinth, t, D - 0.01, z1);
    kit.box(body, W - t, 0, plinth, W, D - 0.01, z1);
    kit.box(body, t, 0, plinth, W - t, D - 0.01, plinth + t);
    kit.box(body, t, D - 0.014, plinth + t, W - t, D - 0.01, z1);
    kit.box(body, t, r.handles === "gola" ? 0.035 : 0, z1 - t, W - t, 0.1, z1);   // передняя царга — за каналом gola
    kit.box(body, t, D - 0.11, z1 - t, W - t, D - 0.014, z1);
  } else kit.box(body, 0, 0, r.underside ? Math.max(plinth, 0.017) : plinth, W, D, H);
  // render.underside — дно навесного модуля другого цвета: видно снизу и кромкой 18 мм под фасадами
  if (!base && r.underside) kit.box(mat("underside", body), 0, r.underside === "inset" ? 0 : -0.018, -0.001, W, D, 0.017);   // "inset" — за фасадами
  if (base) {
    const holes = [];
    for (const s of env.within(e, ["mep.sink"])) holes.push(roundRect(s.x0 + 0.012, s.y0 + 0.012, s.x1 - 0.012, s.y1 - 0.012, 0.03));
    // render.counter = [x0, x1] — столешница не на всю ширину (в углу её кладёт соседний модуль);
    // render.backsplash = {top, x: [x0, x1]} — фартук до высоты top от пола, по умолчанию на всю ширину
    const [cx0, cx1] = r.counter || [0, W], [bx0, bx1] = r.backsplash?.x || [0, W];
    kit.prism(mat("top", pbr(0xdcd7cf, { rough: 0.35 })), [[cx0, -0.028], [cx1, -0.028], [cx1, D], [cx0, D]], H - topT, H, holes, 0.002);   // свес 10 мм над фасадами
    if (r.joint) kit.box(mat("joint", pbr(0x2a2a2a, { rough: 0.5 })), cx0 - 0.0015, -0.028, H - topT, cx0 + 0.0015, D, H + 0.0004);   // render.joint — стыковочная планка у начала столешницы
    if (r.backsplash) kit.box(mat("backsplash", pbr(0xeceae6, { rough: 0.25 }), "gloss"), bx0, D - 0.008, H, bx1, D, (r.backsplash.top ?? 1.45) - z0);
  }
  // глухие панели там, где нет ни места хранения, ни техники
  const taken = [];
  for (const k of env.kids(e.id)) {
    if (k.kind !== "storage" || k.geom?.type !== "box") continue;
    const [x, , z] = k.placement?.pos || [0, 0, 0], [sx, , sz] = k.geom.size, gap = H - topT - (z + sz);
    taken.push([x, z, x + sx, base && gap > 0 && gap < 0.05 ? H - topT : z + sz]);   // фасад под столешницей тянется до неё
  }
  for (const a of env.within(e, ["device.oven", "device.microwave", "device.fridge", "device.washing_machine"])) taken.push([a.x0, a.z0, a.x1, a.z1]);
  for (const [z0s, z1s, , xs0 = 0, xs1 = W] of r.strips || []) taken.push([xs0, z0s, xs1, z1s]);
  for (const [x0, z0r, x1, z1] of freeCells(taken, 0, plinth, W, H - topT)) {
    const outer = { l: x0 < 0.001, r: x1 > W - 0.001, b: z0r < plinth + 0.001, t: z1 > H - topT - 0.001 };
    front(kit, fr, x0, z0r, x1, z1, { y: 0, handles: base && r.handles === "gola" ? "gola" : "none", outer });
  }
});

// свободные прямоугольники фасада: сетка по краям занятых областей, незанятые клетки сливаются по рядам
function freeCells(taken, x0, z0, x1, z1) {
  const near = (a, b) => Math.abs(a - b) < 0.035;
  const xs = [x0, x1], zs = [z0, z1];
  for (const [a, b, c, d] of taken) { xs.push(a, c); zs.push(b, d); }
  const ux = [...new Set(xs.map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b).filter((v, i, s) => !i || !near(v, s[i - 1]));
  const uz = [...new Set(zs.map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b).filter((v, i, s) => !i || !near(v, s[i - 1]));
  const out = [];
  const covered = (cx, cz) => taken.some(([a, b, c, d]) => cx > a - 0.03 && cx < c + 0.03 && cz > b - 0.03 && cz < d + 0.03);
  for (let j = 0; j + 1 < uz.length; j++) {
    let run = null;
    for (let i = 0; i + 1 < ux.length; i++) {
      const cx = (ux[i] + ux[i + 1]) / 2, cz = (uz[j] + uz[j + 1]) / 2;
      const inside = cx > x0 && cx < x1 && cz > z0 && cz < z1;
      if (inside && !covered(cx, cz) && uz[j + 1] - uz[j] > 0.04) {
        if (run) run[2] = ux[i + 1]; else run = [ux[i], uz[j], ux[i + 1], uz[j + 1]];
      } else if (run) { out.push(run); run = null; }
    }
    if (run) out.push(run);
  }
  return out.filter(([a, b, c, d]) => c - a > 0.04);
}

fam("furniture.vanity", ({ kit, size: [W, D, H], mat }) => {
  // подвесная тумба: корпус без ножек; фасад — у ящика
  kit.box(mat("body", M.white), 0, 0.02, 0, W, D, H, 0.003);
});

fam("furniture.hallway_set furniture.*", ({ kit, e, env, size, mat, r }) => {
  // модульная мебель: вокруг каждого места хранения — короб из плит, сверху крышка; ножки, если сказано
  if (!size) return;
  const [W, D, H] = size;
  const kids = env.kids(e.id).filter(k => k.kind === "storage" && k.geom?.type === "box");
  const body = mat("body", M.white), topM = mat("top", body);
  if (!kids.length) {                                     // мебель без мест хранения — просто корпус
    kit.box(body, 0, 0, 0, W, D, H, 0.004);
    return;
  }
  const t = 0.016;
  const boxes = kids.map(k => {
    const [x, y, z] = k.placement?.pos || [0, 0, 0], [sx, sy, sz] = k.geom.size;
    return { k, x0: x, y0: y, z0: z, x1: x + sx, y1: y + sy, z1: z + sz, front: k.props?.render?.front ?? defaultFront(k, e),
      sb: k.props?.render?.setback ?? 0 };                   // render.setback — часть утоплена от фасада (скамья под тумбой)
  });
  const feet = new Map(), lids = new Map(), sides = [];    // render.piece у мест хранения — общие ножки и крышка у частей одного предмета
  for (const b of boxes) {
    if (b.front === "hooks" || b.front === "shelf") continue;
    const above = boxes.some(o => o !== b && o.front !== "hooks" && o.front !== "shelf" && o.z0 >= b.z1 - 0.03 && o.z0 < b.z1 + 0.06 && o.x0 < b.x1 - 0.02 && o.x1 > b.x0 + 0.02);
    const x0 = b.x0 - t, x1 = b.x1 + t, y1 = Math.min(D, b.y1 + 0.02);
    const sb = b.sb;
    for (const xa of [x0, x1 - t]) sides.push({ xa, y0: sb, y1, za: b.z0 - t, zb: b.z1 + t, key: b.k.props?.render?.piece ?? b.k.id });
    kit.box(body, x0 + t, sb, b.z0 - t, x1 - t, y1, b.z0);
    const piece = b.k.props?.render?.piece, lk = piece && !above ? `${piece}:${b.z1.toFixed(2)}` : null, lid = lk && lids.get(lk);
    if (lid) Object.assign(lid, { x0: Math.min(lid.x0, x0), x1: Math.max(lid.x1, x1), y1: Math.max(lid.y1, y1), y0: Math.min(lid.y0, sb) });
    else if (lk) lids.set(lk, { x0, x1, y0: sb, y1, z: b.z1 });
    else if (above) kit.box(body, x0 + t, sb, b.z1, x1 - t, y1, b.z1 + t);               // перекладина — между боковинами
    else kit.box(topM, x0 - 0.01, sb, b.z1, x1 + 0.01, y1 + 0.005, b.z1 + 0.022, 0.003);
    kit.box(body, x0 + t, y1 - 0.004, b.z0, x1 - t, y1, b.z1);
    if (r.legs !== false && b.z0 - t > 0.05 && !boxes.some(o => o !== b && o.z1 <= b.z0 + 0.03 && o.x0 < b.x1 && o.x1 > b.x0)) {
      const key = b.k.props?.render?.piece ?? b.k.id, f = feet.get(key);
      if (f) Object.assign(f, { x0: Math.min(f.x0, x0), x1: Math.max(f.x1, x1), y1: Math.max(f.y1, y1), z: Math.min(f.z, b.z0 - t), y0: Math.min(f.y0, sb) });
      else feet.set(key, { x0, x1, y0: sb, y1, z: b.z0 - t });
    }
  }
  // боковины одного предмета в одной плоскости сливаются в одну плиту: иначе верх нижней упирается ребром в грань
  // верхней и рисует на боковине светлый пунктир
  sides.sort((p, q) => p.key < q.key ? -1 : p.key > q.key ? 1 : p.xa - q.xa || p.za - q.za);
  for (let i = 0; i < sides.length; i++) {
    const c = { ...sides[i] };
    while (i + 1 < sides.length && sides[i + 1].key === c.key && Math.abs(sides[i + 1].xa - c.xa) < 0.002 && sides[i + 1].za <= c.zb + 0.002) {
      c.zb = Math.max(c.zb, sides[i + 1].zb); c.y1 = Math.max(c.y1, sides[i + 1].y1); c.y0 = Math.min(c.y0, sides[i + 1].y0); i++;
    }
    kit.box(body, c.xa, c.y0, c.za, c.xa + t, c.y1, c.zb);
  }
  // render.leg_inset — ножки от торцов, render.leg_y = [y0, y1] — ряды ножек от плоскости фасада (одни у всех частей),
  // render.leg_splay — разлёт у пола
  const li = r.leg_inset ?? 0.035, ly = r.leg_y, ls = r.leg_splay ?? 0.03;
  for (const f of feet.values()) {
    const ya = ly ? ly[0] : f.y0 + li, yb = ly ? Math.min(ly[1], f.y1 - li) : f.y1 - li;
    if (r.legs === "splay") splayLegs(kit, mat("legs", M.oak), f.x0 + li, ya, f.x1 - li, yb, f.z, 0.015, ls);
    else legs(kit, mat("legs", M.oak), f.x0 + li, ya, f.x1 - li, yb, f.z, 0.015, 0);
  }
  for (const l of lids.values()) kit.box(topM, l.x0 - 0.01, l.y0, l.z, l.x1 + 0.01, l.y1 + 0.005, l.z + 0.022, 0.003);   // цельная крышка
  const hooks = boxes.find(b => b.front === "hooks");
  if (hooks && r.panel_frame) {                            // рамка вешалки: стойки, перекладины, между ними рейки с просветами
    const [pz0, pz1] = r.panel || [hooks.z0 - 0.35, hooks.z1 + 0.05], pm = mat("panel", topM), pf = r.panel_frame;
    // stile — ширина стоек: число или [у начала, у конца]
    const [sa, sb] = Array.isArray(pf.stile) ? pf.stile : [pf.stile ?? 0.045, pf.stile ?? 0.045];
    const tr = pf.top ?? 0.17, br = pf.bottom ?? 0.06, n = pf.slats ?? 8, y0 = D - 0.022;
    const xa = hooks.x0, xb = hooks.x1;
    kit.box(pm, xa, y0, pz0, xa + sa, D, pz1, 0.003);
    kit.box(pm, xb - sb, y0, pz0, xb, D, pz1, 0.003);
    kit.box(pm, xa + sa, y0, pz1 - tr, xb - sb, D, pz1, 0.003);
    kit.box(pm, xa + sa, y0, pz0, xb - sb, D, pz0 + br, 0.003);
    // в просветах между рейками — тень, светлее щелей фасадов: просвет широкий, в нём видна освещённая кромка рейки
    kit.slab(gapOf(pm, 0.8), xa + sa, D - 0.002, pz0 + br, xb - sb, D - 0.0015, pz1 - tr, "x-x+y+z-z+");
    const gap = pf.gap ?? 0.014, sw = (xb - xa - sa - sb - (n + 1) * gap) / n;
    for (let i = 0; i < n; i++) {
      const x = xa + sa + gap + i * (sw + gap);
      kit.box(pm, x, y0, pz0 + br, x + sw, D, pz1 - tr, 0.002);
    }
  } else if (hooks) {                                      // панель вешалки: render.panel = [z0, z1]
    const [pz0, pz1] = r.panel || [hooks.z0 - 0.35, hooks.z1 + 0.05], pm = mat("panel", topM);
    const n = Math.max(1, Math.round((hooks.x1 - hooks.x0 + 0.02) / 0.07));
    for (let i = 0; i < n; i++) {                          // вертикальные рейки
      const x0 = hooks.x0 - 0.01 + i * (hooks.x1 - hooks.x0 + 0.02) / n;
      kit.box(pm, x0 + 0.004, D - 0.022, pz0, x0 + (hooks.x1 - hooks.x0 + 0.02) / n - 0.004, D, pz1, 0.003);
    }
  }
});

function defaultFront(k, furn) {
  if (k.type === "drawer") return "drawer";
  if (k.type === "hanging") return "rod";
  if (k.type === "section") return "none";
  if (furn?.type === "kitchen_unit") return "door";
  return "open";
}

// ═══ места хранения ═════════════════════════════════════════════════════════
// Рисуют свой фасад (ящик, дверца), полку, крючки или штангу. Фасад стоит в плоскости фасада мебели.
fam("storage.*", ({ kit, e, env, size: [W, D, H], r }) => {
  const furn = furnitureOf(e, env);
  const fr = furn ? furn.props?.render || {} : {};
  const kind = r.front ?? defaultFront(e, furn);
  const yf = frontOffset(e, env) + (r.setback ?? 0);       // плоскость фасада мебели в системе места (render.setback — утоплен)
  const colors = { ...(fr.colors || {}), ...(r.colors || {}) };
  const frontMat = hex(colors.front, null) != null ? satinOf(colors.front, fr.finish)
    : hex(colors.body, null) != null ? satinOf(colors.body) : M.white;
  const handles = r.handles ?? fr.handles ?? "bar", handleMat = satinOf(colors.handle) || M.black;
  const inner = !!furn && Array.isArray(fr.fronts) || furn?.type === "wardrobe";   // за дверями шкафа
  // render.abut (у места или мебели) — кромки фасада ["l", "r", "b", "t"], к которым вплотную примыкают панели:
  // там, как между фасадами, в щели тёмная подложка
  const abut = r.abut ?? fr.abut;
  const sp = () => { const s = spread(e, env, W, H); if (abut) for (const k of abut) s[4][k] = false; return s; };
  if (kind === "drawer") {                                 // render.inlay — вкладной фасад между боковинами
    // render.inset = [dx, dz] — внутренний ящик уже секции: фасад отступает от боковин и соседей
    const [ix, iz] = inner && r.inset || [0, 0];
    const [x0, x1, z0, z1, outer] = inner || r.inlay ? [ix, W - ix, iz, H - iz, null] : sp();
    const fm = inner ? (hex(colors.body, null) != null ? satinOf(colors.body) : M.white) : frontMat;
    const fy = inner ? 0 : r.inlay ? yf + 0.018 : yf;     // render.handle_at = "middle" — ручка по середине ящика
    front(kit, fm, x0, z0, x1, z1, { y: fy, kind: "drawer", handles: inner ? "none" : handles, handleMat, at: r.handle_at ?? fr.handle_at ?? "top",
      hlen: r.handle_len ?? fr.handle_len ?? null, outer });
    if (r.lock) kit.rod(M.chrome, [x1 - 0.035, fy - 0.018, z1 - 0.03], [x1 - 0.035, fy - 0.022, z1 - 0.03], 0.0075, 14);   // render.lock — замок
    kit.box(M.whiteMatte, 0.012, r.inlay ? yf + 0.02 : Math.max(yf, 0), 0.01, W - 0.012, D - 0.01, Math.min(H - 0.02, 0.14 + 0.01));   // короб ящика
  } else if (kind === "door") {
    const [x0, x1, z0, z1, outer] = r.inlay ? [0, W, 0, H, null] : sp(), fz = env.floorZ(e);
    const at = r.at ?? (fz + z1 < 1.2 ? "top" : fz + z0 > 1.2 ? "bottom" : "middle"), n = r.leaves ?? 1;   // render.at, handle_len
    for (let i = 0; i < n; i++) {                          // render.leaves — створок в фасаде
      const a = x0 + (x1 - x0) * i / n, b = x0 + (x1 - x0) * (i + 1) / n;
      const ou = outer && { ...outer, l: outer.l && i === 0, r: outer.r && i === n - 1 };
      front(kit, frontMat, a, z0, b, z1, { y: r.inlay ? yf + 0.018 : yf, kind: "door", handles, at, handleMat, hlen: r.handle_len ?? null, outer: ou,
        hinge: n > 1 ? (i % 2 ? "right" : "left") : r.hinge ?? (W > 0.5 ? "left" : "right") });
    }
  } else if (kind === "flap") {                            // откидная дверца: ручка по центру у верхнего края (render.knob_top — от верха)
    const [x0, x1, z0, z1, outer] = r.inlay ? [0, W, 0, H, null] : sp();
    front(kit, frontMat, x0, z0, x1, z1, { y: r.inlay ? yf + 0.018 : yf, kind: "drawer", handles, handleMat, outer, top: r.knob_top ?? null });
  } else if (kind === "open" || kind === "shelf") {
    const bm = satinOf(colors.body) || M.white;
    kit.box(bm, 0, Math.max(0, yf), 0, W, D, r.board ?? 0.016, r.board ? 0.004 : 0);     // render.board — толщина доски
    for (let i = 1; i <= (r.shelves ?? 0); i++) kit.box(bm, 0, Math.max(0, yf) + 0.02, H * i / ((r.shelves ?? 0) + 1) - 0.008, W, D, H * i / ((r.shelves ?? 0) + 1) + 0.008);
    if (kind === "shelf" && r.brackets !== false) {
      for (const x of [0.06, W - 0.06]) kit.box(M.black, x - 0.008, D - 0.12, -0.08, x + 0.008, D, 0);   // кронштейны
    }
  } else if (kind === "hooks") {
    const n = r.count ?? 4, step = r.pitch ?? W / n;      // render.pitch — шаг крючков, ряд по центру места
    const hm = satinOf(colors.hooks) || M.chrome;         // render.first — где первый крючок (иначе ряд по центру)
    for (let i = 0; i < n; i++) {
      const x = (r.first ?? W / 2 - (n - 1) / 2 * step) + i * step;
      const z = H * 0.6;                                   // J-образный: от панели, вниз и кончиком вверх
      kit.tube(hm, [[x, D, z], [x, D - 0.03, z - 0.004], [x, D - 0.046, z - 0.03], [x, D - 0.05, z - 0.05],
        [x, D - 0.064, z - 0.046], [x, D - 0.07, z - 0.03]], 0.005, 8);
    }
  } else if (kind === "rod") {                             // render.board — доска-дно под штангой
    kit.rod(M.chrome, [0.01, D / 2, H - 0.06], [W - 0.01, D / 2, H - 0.06], 0.0125, 16);
    if (r.board) kit.box(satinOf(colors.body) || M.white, 0, 0, 0, W, D, r.board);
  } else if (kind === "none" && e.type !== "section") {
    if (env.floorZ(e) - (env.floorZ(furn || e)) > 0.15) kit.box(satinOf(colors.body) || M.white, 0, 0.02, -0.018, W, D - 0.004, 0);   // полка снизу
  }
  if (e.type === "box") kit.box(pbr(0xc8a978, { rough: 0.9 }), 0, 0, 0, W, D, H, 0.004);
});

function satinOf(v, finish) {
  const c = hex(v, null);
  if (c == null) return null;
  return pbr(c, { rough: finish === "gloss" ? 0.2 : finish === "matte" ? 0.85 : 0.5 });
}

function furnitureOf(e, env) {
  let p = env.by(e.parent);
  while (p && p.kind === "storage") p = env.by(p.parent);
  return p && p.kind === "furniture" ? p : null;
}

// где у места хранения плоскость фасада мебели: сумма сдвигов по Y до мебели, со знаком минус
function frontOffset(e, env) {
  let y = 0, p = e;
  while (p && p.kind === "storage") { y -= p.placement?.pos?.[1] || 0; p = env.by(p.parent); }
  return y;
}

// фасад места хранения растягивается до соседних фасадов и краёв мебели, если щель меньше 3 см
function spread(e, env, W, H) {
  const p = env.by(e.parent);
  const [ex, , ez] = e.placement?.pos || [0, 0, 0];
  let x0 = ex, x1 = ex + W, z0 = ez, z1 = ez + H;
  const sibs = env.kids(p?.id).filter(k => k !== e && k.kind === "storage" && k.geom?.type === "box").map(k => {
    const [x, , z] = k.placement?.pos || [0, 0, 0], [sx, , sz] = k.geom.size;
    return [x, z, x + sx, z + sz];
  });
  const [PW, , PH] = p?.geom?.type === "box" ? p.geom.size : [x1, 0, z1];
  const lim = 0.035;
  const ov = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0) > 0.02;
  let nx1 = x1, nx0 = x0, nz1 = z1, nz0 = z0;
  const r = sibs.filter(s => ov(z0, z1, s[1], s[3]) && s[0] >= x1 - 0.001 && s[0] - x1 < lim).map(s => s[0]);
  nx1 = r.length ? (x1 + Math.min(...r)) / 2 : PW - x1 < lim ? PW : x1;
  const l = sibs.filter(s => ov(z0, z1, s[1], s[3]) && s[2] <= x0 + 0.001 && x0 - s[2] < lim).map(s => s[2]);
  nx0 = l.length ? (x0 + Math.max(...l)) / 2 : x0 < lim ? 0 : x0;
  const u = sibs.filter(s => ov(x0, x1, s[0], s[2]) && s[1] >= z1 - 0.001 && s[1] - z1 < lim).map(s => s[1]);
  nz1 = u.length ? (z1 + Math.min(...u)) / 2 : PH - z1 < lim ? PH - (p?.type === "kitchen_unit" && env.floorZ(p) < 0.2 && PH < 1.05 ? 0.038 : 0) : z1;
  const d = sibs.filter(s => ov(x0, x1, s[0], s[2]) && s[3] <= z0 + 0.001 && z0 - s[3] < lim).map(s => s[3]);
  nz0 = d.length ? (z0 + Math.max(...d)) / 2 : z0;
  // пятым — наружные кромки: у кромки нет соседнего фасада (там подложка в щели не нужна)
  return [nx0 - ex, nx1 - ex, nz0 - ez, nz1 - ez, { l: !l.length, r: !r.length, b: !d.length, t: !u.length }];
}

// ═══ техника ════════════════════════════════════════════════════════════════
fam("device.fridge", ({ kit, size: [W, D, H], mat, r }) => {
  // четырёхдверный: две двери сверху, две снизу, ручки к центру (render.handles = "none" — ручки в торцах дверей)
  const body = mat("body", M.steel, "metal"), split = H * 0.44, hm = mat("handle", M.brushed, "metal");
  kit.box(M.graphite, 0.02, 0.05, 0, W - 0.02, D, 0.05);
  kit.box(mat("sides", M.brushed, "metal"), 0, 0.06, 0.05, W, D, H, 0.01);
  for (const [x0, x1, hinge] of [[0, W / 2, "left"], [W / 2, W, "right"]]) {
    kit.box(body, x0 + 0.002, 0, split + 0.004, x1 - 0.002, 0.065, H - 0.003, 0.012);
    kit.box(body, x0 + 0.002, 0, 0.055, x1 - 0.002, 0.065, split - 0.004, 0.012);
    const hx = hinge === "left" ? x1 - 0.035 : x0 + 0.035;
    if (r.handles === "none") continue;
    bar(kit, hm, hx, split + 0.42, 0.6, "z", 0, 0.009);
    bar(kit, hm, (x0 + x1) / 2, split - 0.06, 0.24, "x", 0, 0.008);
  }
  const dp = r.display;                                    // render.display = {z: [z0, z1], w, color} — окно дисплея
  if (dp) kit.box(pbr(hex(dp.color, 0x0d0d0f), { rough: 0.15 }), W / 4 - (dp.w ?? 0.1) / 2, -0.0012, dp.z[0], W / 4 + (dp.w ?? 0.1) / 2, 0.001, dp.z[1], 0.004);
  else kit.box(M.display, W / 4 - 0.035, -0.0012, split + 0.64, W / 4 + 0.035, 0.001, split + 0.685, 0.003);   // дисплей
});

function drumDoor(kit, x, z, rOut, ring = M.chrome) {
  kit.rod(ring, [x, 0.002, z], [x, -0.035, z], rOut, 40, rOut * 0.96);
  kit.rod(M.blackGlass, [x, -0.035, z], [x, -0.045, z], rOut * 0.78, 40, rOut * 0.7);
}

fam("device.washing_machine device.tumble_dryer", ({ kit, e, size: [W, D, H], mat }) => {
  const body = mat("body", M.steel, "metal"), dryer = e.type === "tumble_dryer";
  kit.box(M.graphite, 0.02, 0.03, 0, W - 0.02, D, 0.04);
  kit.box(body, 0, 0, 0.04, W, D, H - 0.002, 0.012);
  kit.box(M.blackGlass, 0.02, -0.003, H - 0.14, W - 0.02, 0.002, H - 0.035, 0.004);   // панель управления
  kit.box(M.display, W * 0.55, -0.005, H - 0.11, W * 0.78, -0.002, H - 0.065);
  kit.rod(M.brushed, [W * 0.36, 0, H - 0.087], [W * 0.36, -0.022, H - 0.087], 0.026, 24);   // ручка программ
  kit.box(dryer ? body : M.plastic, 0.03, -0.003, H - 0.135, W * 0.28, 0.0, H - 0.04, 0.004);   // лоток или бак конденсата
  drumDoor(kit, W / 2, (H - 0.15) / 2 + 0.06, Math.min(W * 0.36, 0.21));
});

fam("device.oven", ({ kit, size: [W, D, H], r }) => {   // render.knobs = false — утопленные переключатели
  kit.box(M.graphite, 0.01, 0.01, 0, W - 0.01, D, H);
  kit.box(M.blackGlass, 0, -0.022, 0, W, 0, H - 0.07, 0.004);                           // дверца
  kit.box(M.black, 0, -0.02, H - 0.068, W, 0, H, 0.003);                                // панель управления
  kit.box(pbr(0xff3b30, { emissive: 0xff2a1a, emissiveIntensity: 0.4 }), W / 2 - 0.025, -0.0215, H - 0.055, W / 2 + 0.025, -0.0195, H - 0.043);
  if (r.knobs !== false) for (const x of [0.09, W - 0.09]) kit.rod(M.brushed, [x, -0.02, H - 0.05], [x, -0.035, H - 0.05], 0.018, 20);
  bar(kit, M.brushed, W / 2, H - 0.08, W * 0.8, "x", -0.022, 0.009);                    // ручка сразу под дисплеем
  kit.box(pbr(0x26292d, { rough: 0.1 }), 0.09, -0.0225, 0.12, W - 0.09, -0.021, H - 0.2);   // стекло смотрового окна
});

fam("device.microwave", ({ kit, size: [W, D, H], r }) => {
  kit.box(M.graphite, 0.01, 0.01, 0, W - 0.01, D, H);
  if (r.style === "glass") {                               // сплошное чёрное стекло, внизу серебристая планка
    kit.box(M.blackGlass, 0, -0.02, 0.015, W, 0, H, 0.003);
    kit.box(M.brushed, 0, -0.02, 0, W, 0, 0.015, 0.002);
    return;
  }
  kit.box(M.blackGlass, 0, -0.02, 0, W * 0.74, 0, H, 0.003);
  kit.box(M.black, W * 0.74 + 0.002, -0.02, 0, W, 0, H, 0.003);
  kit.box(M.display, W * 0.79, -0.0215, H - 0.09, W * 0.95, -0.019, H - 0.055);
  kit.box(pbr(0x2a2d31, { rough: 0.1 }), 0.05, -0.0205, 0.06, W * 0.74 - 0.08, -0.019, H - 0.06);
});

fam("device.hob", ({ kit, size: [W, D, H] }) => {
  kit.box(M.blackGlass, 0, 0, 0, W, D, Math.max(H, 0.005), 0.002);
  const z = Math.max(H, 0.005) + 0.0003, ring = pbr(0x4a4e54, { rough: 0.3 });
  for (const [x, y, rr] of [[0.27, 0.31, 0.105], [0.73, 0.31, 0.09], [0.27, 0.72, 0.085], [0.73, 0.72, 0.1]]) {
    kit.lathe(ring, [[rr - 0.004, z], [rr, z], [rr, z + 0.0004], [rr - 0.004, z + 0.0004]], x * W, y * D, 40);
  }
  kit.box(pbr(0x6b7078, { rough: 0.3 }), W * 0.3, 0.025, z - 0.0002, W * 0.7, 0.06, z + 0.0002);   // сенсорная полоса
});

fam("device.range_hood", ({ kit, size: [W, D, H] }) => {
  // встроенная: снизу видна панель с фильтрами и выдвижной козырёк
  kit.box(M.brushed, 0, 0, 0, W, D, Math.max(H, 0.01));
  for (let i = 0; i < 2; i++) kit.box(M.graphite, 0.02 + i * (W - 0.03) / 2, 0.02, -0.002, (i + 1) * (W - 0.03) / 2, D - 0.02, 0);
  kit.box(M.blackGlass, 0, -0.03, -0.005, W, 0.0, 0.012, 0.003);
});

fam("device.dishwasher", () => { /* полностью встроенная — за фасадом не видна */ });

fam("device.vacuum", ({ kit, size, mat, r }) => {
  // база робота-пылесоса: корпус с баками сверху и пандус для робота спереди
  const [W, D, H] = size || [0.34, 0.45, 0.59];
  const off = size ? [0, 0] : [-W / 2, -D / 2];
  kit.move(off[0], off[1], 0, () => {
    // база: низ с отсеком для робота, пояс (у X40 — золотистый), блок баков; спереди пандус
    const body = mat("body", M.white);
    if (r.robot) {                                         // render.robot: низкий проём, робот наполовину под полосой
      // render.body_d — глубина колонны; блок баков и полоса — одной плоскостью фасада
      const yb = D - (r.body_d ?? D * 0.6), zo = H * 0.25, zb = H * 0.5, band = mat("band", pbr(0xcdb892, { rough: 0.4, metal: 0.1 }), "satin");
      kit.box(body, 0.01, yb, zb - 0.01, W - 0.01, D, H, 0.008);                           // блок баков — одной колонной с корпусом
      kit.box(body, 0.01, yb + 0.001, zo, W - 0.01, D, zb + 0.01, 0.004);                  // корпус за полосой
      kit.box(band, 0.012, yb, zo + 0.002, W - 0.012, yb + 0.004, zb - 0.002, 0.004);      // полоса на фасаде
      for (const x of [0.01, W - 0.025]) kit.box(body, x, yb, 0, x + 0.015, D, zo);       // боковины проёма
      kit.box(body, 0.025, D * 0.78, 0, W - 0.025, D, zo);                                 // задняя стенка проёма
      kit.prism(body, [[-0.01, 0], [W - 0.03, 0], [W - 0.03, D * 0.7], [-0.01, D * 0.7]], 0, 0.014);   // рампа
      kit.cylZ(mat("robot", M.white), W / 2, D * 0.45, 0.014, 0.095, 0.17, 48);
      kit.cylZ(M.white, W / 2, D * 0.4, 0.095, 0.122, 0.04, 28);                           // башенка лидара
      kit.box(M.blackGlass, W / 2 - 0.03, D * 0.4 - 0.042, 0.1, W / 2 + 0.03, D * 0.4 - 0.03, 0.118);
      return;
    }
    kit.box(body, 0.01, D * 0.4, 0, W - 0.01, D, H * 0.42, 0.02);
    kit.box(mat("band", pbr(0xcdb892, { rough: 0.35, metal: 0.4 }), "metal"), 0.012, D * 0.4 - 0.002, H * 0.42, W - 0.012, D, H * 0.62, 0.01);
    kit.box(body, 0.01, D * 0.4, H * 0.62, W - 0.01, D, H, 0.03);
    kit.prism(body, [[0.02, 0], [W - 0.02, 0], [W - 0.02, D * 0.42], [0.02, D * 0.42]], 0, 0.014);
  });
}, FREE);

fam("device.thermostat", ({ kit, e, env }) => {
  // термостатическая головка на клапане прибора: сверху у торца прибора, если он известен; торец — render.valve
  // прибора ("left" — левый, если смотреть из комнаты), по умолчанию правый
  const rad = (e.refs || []).map(x => env.by(x.to)).find(x => x?.geom?.type === "box");
  let at = [0, 0, 0];
  if (rad) {
    const m = env.rel(e, rad), [L, D, H] = rad.geom.size;
    const x = rad.props?.render?.valve === "left" ? -0.04 : L + 0.04;
    at = new THREE.Vector3(x, D * 0.5, H - 0.02).applyMatrix4(m).toArray();
  }
  kit.cylZ(M.chrome, at[0], at[1], at[2] - 0.03, at[2] + 0.02, 0.012, 16);
  kit.cylZ(env.own(e), at[0], at[1], at[2] + 0.02, at[2] + 0.1, 0.027, 28);
}, FREE);

// ═══ сантехника и отопление ═════════════════════════════════════════════════
fam("mep.bath", ({ kit, size: [W, D, H], mat }) => {
  // ванна: борт с закруглённой чашей, экран спереди
  const shell = mat("body", M.enamel, "gloss"), rim = 0.06, top = H;
  const inner = roundRect(rim, rim, W - rim, D - rim, 0.16, 8);
  kit.prism(shell, [[0, 0], [W, 0], [W, D], [0, D]], top - 0.03, top, [inner], 0.004);   // борт
  const basin = pbr(0xfcfcfb, { rough: 0.14, side: THREE.BackSide });
  kit.prism(basin, roundRect(rim, rim, W - rim, D - rim, 0.16, 8), top - 0.42, top - 0.03);     // чаша (видна изнутри)
  kit.cylZ(M.chrome, W - 0.22, D / 2, top - 0.42, top - 0.418, 0.025, 20);               // слив
  kit.box(mat("panel", M.white), 0.0, -0.005, 0, W, 0.02, top - 0.03);                  // экран
  // смеситель на стене над бортом
  kit.box(M.chrome, W - 0.42, D - 0.03, top + 0.18, W - 0.18, D, top + 0.23, 0.012);
  kit.rod(M.chrome, [W - 0.3, D - 0.03, top + 0.2], [W - 0.3, D - 0.17, top + 0.2], 0.012, 12);
});

fam("mep.toilet", ({ kit, size, mat, env, e }) => {
  // подвесной унитаз на инсталляции: чаша, сиденье, крышка; клавиша смыва на стене за ним
  const [W, D, H] = size || [0.36, 0.53, 0.4];
  const off = size ? [0, 0] : [-W / 2, -D / 2];
  const cer = mat("body", M.ceramic, "gloss");
  kit.move(off[0], off[1], 0, () => {
    const cx = W / 2;
    kit.box(cer, cx - 0.17, D - 0.2, H - 0.2, cx + 0.17, D, H - 0.01, 0.06);            // крепление к стене
    kit.lathe(cer, [[0.0, H - 0.2], [0.1, H - 0.19], [0.16, H - 0.12], [0.175, H - 0.04], [0.172, H - 0.015], [0, H - 0.015]], cx, D * 0.48, 40, 1, (D * 0.92) / 0.35);
    kit.lathe(M.white, [[0.0, H - 0.015], [0.172, H - 0.015], [0.172, H + 0.005], [0, H + 0.005]], cx, D * 0.48, 40, 1, (D * 0.92) / 0.35);   // сиденье и крышка
    const wallY = D + 0.005, z = (env.floorZ(e) > 0.3 ? 1.0 - env.floorZ(e) + H : 1.0);
    kit.box(M.white, cx - 0.12, wallY - 0.012, z, cx + 0.12, wallY, z + 0.16, 0.006);    // клавиша смыва
    kit.box(M.chrome, cx - 0.105, wallY - 0.014, z + 0.02, cx - 0.004, wallY - 0.01, z + 0.14, 0.004);
    kit.box(M.chrome, cx + 0.004, wallY - 0.014, z + 0.02, cx + 0.105, wallY - 0.01, z + 0.14, 0.004);
  });
}, FREE);

fam("mep.washbasin", ({ kit, size, mat }) => {
  // раковина-столешница на тумбе: керамика с чашей, смеситель сзади
  const [W, D, H] = size || [0.55, 0.38, 0.15];
  const off = size ? [0, 0] : [-W / 2, -D / 2];
  const cer = mat("body", M.ceramic, "gloss");
  kit.move(off[0], off[1], 0, () => {
    const bowl = ellipse(W / 2, D * 0.45, W * 0.36, D * 0.3, 40);
    kit.prism(cer, roundRect(0, 0, W, D, 0.02), H - 0.03, H, [bowl], 0.003);
    kit.box(cer, 0, 0, 0, W, 0.015, H - 0.03, 0.004);                                   // передний край
    kit.lathe(pbr(0xfbfbfa, { rough: 0.1, side: THREE.BackSide }), [[W * 0.36, H - 0.03], [W * 0.33, H - 0.08], [W * 0.22, H - 0.12], [0, H - 0.13]], W / 2, D * 0.45, 40, 1, (D * 0.3) / (W * 0.36));
    kit.cylZ(M.chrome, W / 2, D * 0.45, H - 0.131, H - 0.128, 0.02, 16);
    tap(kit, M.chrome, W / 2, D - 0.06, H, 0.16, 0.12);
  });
}, FREE);

// смеситель: стойка и излив в сторону −Y
function tap(kit, mat, x, y, z, h, reach) {
  kit.cylZ(mat, x, y, z, z + 0.03, 0.026, 20);
  kit.cylZ(mat, x, y, z + 0.03, z + h, 0.016, 16);
  kit.tube(mat, [[x, y, z + h], [x, y - reach * 0.5, z + h + 0.015], [x, y - reach, z + h - 0.02]], 0.011, 12);
  kit.rod(mat, [x, y, z + h - 0.03], [x, y + 0.08, z + h - 0.01], 0.006, 8);           // рычаг
}

fam("mep.sink", ({ kit, size, mat, r }) => {
  // кухонная мойка: чаша в столешнице, смеситель-гусак
  const [W, D, H] = size || [0.45, 0.5, 0.2];
  const off = size ? [0, 0] : [-W / 2, -D / 2];
  const s = mat("body", pbr(0x1d1e20, { rough: 0.55 }));
  kit.move(off[0], off[1], 0, () => {
    const inner = roundRect(0.035, 0.035, W - 0.035, D - 0.11, 0.035, 6);
    kit.prism(s, roundRect(0, 0, W, D, 0.02), H, H + 0.004, [inner]);
    kit.prism(pbr(0x1d1e20, { rough: 0.55, side: THREE.BackSide }), inner, H - 0.19, H);
    kit.cylZ(M.graphite, W / 2, (D - 0.075) / 2, H - 0.19, H - 0.188, 0.035, 20);
    const t = mat("faucet", M.black, "metal");
    if (r.dispenser) kit.cylZ(t, W / 2 + (r.dispenser_dx ?? 0.13), D - 0.045, H, H + 0.045, 0.014, 16);   // render.dispenser, dispenser_dx
    kit.cylZ(t, W / 2, D - 0.045, H, H + 0.03, 0.026, 20);
    if (r.faucet === "angular") {                          // Г-образный излив 2-в-1: стойка, поворот на 90°, носик вниз;
      kit.rod(t, [W / 2, D - 0.045, H + 0.03], [W / 2, D - 0.045, H + 0.322], 0.013, 4);   // у основания два рычага по сторонам
      kit.rod(t, [W / 2, D - 0.045, H + 0.31], [W / 2, D - 0.23, H + 0.31], 0.012, 4);     // (вода и кран фильтра)
      kit.rod(t, [W / 2, D - 0.22, H + 0.31], [W / 2, D - 0.22, H + 0.26], 0.011, 4);
      kit.rod(t, [W / 2 - 0.075, D - 0.045, H + 0.07], [W / 2 + 0.075, D - 0.045, H + 0.07], 0.013, 12);   // корпус поперёк стойки
      for (const s of [-1, 1]) kit.rod(t, [W / 2 + s * 0.07, D - 0.045, H + 0.07], [W / 2 + s * 0.07, D - 0.045, H + 0.125], 0.004, 8);
    } else {
      if (r.dispenser) kit.rod(t, [W / 2 + 0.03, D - 0.045, H + 0.06], [W / 2 + 0.08, D - 0.03, H + 0.09], 0.005, 8);   // кран фильтра
      kit.tube(t, [[W / 2, D - 0.045, H + 0.03], [W / 2, D - 0.045, H + 0.34], [W / 2, D - 0.12, H + 0.4], [W / 2, D - 0.2, H + 0.36], [W / 2, D - 0.22, H + 0.26]], 0.012, 12);
    }
  });
}, FREE);

fam("mep.radiator", ({ kit, size, mat, r }) => {
  // стальной панельный радиатор с каналами или конвектор с решёткой
  const [L, D, H] = size || [1.0, 0.1, 0.5];
  const off = size ? [0, 0] : [-L / 2, -D / 2];
  const w = mat("body", M.white, "satin");
  kit.move(off[0], off[1], 0, () => {
    if (r.style === "convector") {
      kit.box(w, 0, 0, 0, L, D, H, 0.01);
      kit.box(pbr(0x7a7d81, { rough: 0.8 }), 0, 0, H - 0.001, L, D, H + 0.0005);            // решётка на всю крышку
    } else {
      kit.box(w, 0, D * 0.15, 0.01, L, D * 0.85, H - 0.01);
      for (let x = 0.015; x < L - 0.01; x += 0.033) kit.box(w, x, 0, 0.02, x + 0.022, D * 0.15 + 0.001, H - 0.02, 0.006);   // каналы
      kit.box(M.graphite, 0.02, D * 0.15, H - 0.012, L - 0.02, D * 0.85, H - 0.0105);     // верхняя решётка
      for (const x of [0, L - 0.012]) kit.box(w, x, 0, 0.01, x + 0.012, D, H - 0.01, 0.003);   // боковины
    }
    for (const x of [L * 0.15, L * 0.85]) kit.box(M.white, x - 0.015, D, H * 0.6, x + 0.015, D + 0.03, H * 0.6 + 0.04);   // кронштейны
    kit.rod(M.chrome, [L - 0.05, D * 0.5, -0.0], [L - 0.05, D * 0.5, 0.06], 0.008, 10);   // подводка
  });
}, FREE);

fam("mep.towel_warmer", ({ kit, size, mat }) => {
  // полотенцесушитель-лесенка: две стойки и перекладины
  const [W, D, H] = size || [0.5, 0.1, 0.8];
  const off = size ? [0, 0] : [-W / 2, -D / 2];
  const ch = mat("body", M.chrome, "metal");
  kit.move(off[0], off[1], 0, () => {
    const y = D * 0.45;
    for (const x of [0.03, W - 0.03]) {
      kit.rod(ch, [x, y, 0.01], [x, y, H - 0.01], 0.0125, 16);
      kit.sphere(ch, x, y, H - 0.01, 0.0125, 12);
      for (const z of [0.12, H - 0.12]) kit.rod(ch, [x, y, z], [x, D, z], 0.006, 8);    // держатели
    }
    const n = Math.max(3, Math.round(H / 0.11));
    for (let i = 0; i < n; i++) {
      const z = 0.06 + i * (H - 0.12) / (n - 1);
      kit.rod(ch, [0.03, y - 0.004, z], [W - 0.03, y - 0.004, z], 0.008, 10);
    }
    for (const x of [0.03, W - 0.03]) kit.tube(ch, [[x, y, 0.01], [x, y, -0.03], [x, D, -0.03]], 0.0125, 12);
  });
}, FREE);

fam("mep.water_riser", ({ kit, env, e }) => {
  // стояки холодной и горячей воды в коробе: от пола до потолка, краны и счётчики на отводах
  const top = env.ceil - env.floorZ(e), bottom = -env.floorZ(e);
  for (const [dx, m] of [[-0.06, M.cold], [0.06, M.heat]]) {
    kit.cylZ(pbr(0xeeeeee, { rough: 0.4 }), dx, 0, bottom, top, 0.016, 16);
    kit.rod(m, [dx, 0, 0], [dx, 0.12, 0], 0.011, 10);
    kit.rod(M.brass, [dx, 0.05, 0], [dx, 0.07, 0], 0.016, 12);
    kit.box(M.plastic, dx - 0.025, 0.08, -0.03, dx + 0.025, 0.12, 0.03, 0.006);
  }
}, FREE);

fam("mep.heating_manifold", ({ kit, r }) => {
  // узел ввода за ревизионным люком: люк на стене, внутри краны, фильтр, клапан, теплосчётчик
  const [hw, hh] = r.hatch || [0.35, 0.45];
  kit.box(M.white, -hw / 2, -0.012, -hh / 2, hw / 2, 0.0, hh / 2, 0.004);
  kit.box(M.plastic, -hw / 2 + 0.015, -0.0135, -hh / 2 + 0.015, hw / 2 - 0.015, -0.011, hh / 2 - 0.015, 0.003);
  kit.box(M.graphite, hw / 2 - 0.05, -0.016, -0.015, hw / 2 - 0.035, -0.011, 0.015);
  for (const [z, m] of [[0.08, M.heat], [-0.08, M.cold]]) {
    kit.rod(m, [-0.25, 0.08, z], [0.25, 0.08, z], 0.011, 10);
    kit.rod(M.brass, [-0.12, 0.08, z], [-0.08, 0.08, z], 0.02, 12);
  }
  kit.box(M.plastic, 0.02, 0.05, 0.03, 0.1, 0.11, 0.13, 0.008);                          // теплосчётчик
}, FREE);

fam("mep.water_filter", ({ kit, size }) => {
  // фильтр обратного осмоса под мойкой: корпус и бак
  const [W, D, H] = size || [0.4, 0.18, 0.42];
  const off = size ? [0, 0] : [-W / 2, -D / 2];
  kit.move(off[0], off[1], 0, () => {
    kit.box(M.white, 0, 0, 0, W * 0.62, D, H, 0.02);
    kit.box(pbr(0x2f6fb5, { rough: 0.4 }), 0.02, -0.002, H - 0.06, W * 0.62 - 0.02, 0.01, H - 0.02, 0.005);
    kit.cylZ(M.plastic, W * 0.82, D / 2, 0, H * 0.75, Math.min(D / 2, 0.09), 24);
  });
}, FREE);

fam("mep.vent_shaft", ({ kit }) => {
  // вентиляционная решётка на стене
  kit.box(M.white, -0.1, -0.012, -0.1, 0.1, 0, 0.1, 0.004);
  for (let z = -0.075; z <= 0.076; z += 0.025) kit.box(M.graphite, -0.08, -0.0125, z - 0.004, 0.08, -0.0115, z + 0.004);
}, FREE);

fam("mep.power_outlet mep.switch", ({ kit, e }) => {
  // розетки (рамка на N мест) и выключатели; центр группы — в точке, фасад — −Y
  const n = Math.max(1, Math.min(5, Number(e.props?.places) || 1)), s = 0.086;
  kit.box(M.white, -n * s / 2, -0.012, -s / 2, n * s / 2, 0.01, s / 2, 0.01);
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5 - n / 2) * s;
    if (e.type === "switch") {
      kit.box(M.plastic, x - 0.03, -0.017, -0.03, x + 0.03, -0.012, 0.03, 0.006);
      if ((Number(e.props?.keys) || 1) > 1) kit.box(pbr(0xc8c8c4, { rough: 0.6 }), x - 0.0006, -0.0174, -0.03, x + 0.0006, -0.0168, 0.03);   // шов между клавишами
      continue;
    }
    kit.rod(M.plastic, [x, -0.012, 0], [x, -0.016, 0], 0.024, 28);
    for (const dx of [-0.0095, 0.0095]) kit.rod(M.graphite, [x + dx, -0.0161, 0], [x + dx, -0.0158, 0], 0.0028, 10);
  }
}, FREE);

fam("mep.junction_box", ({ kit }) => {
  kit.rod(M.white, [0, 0.005, 0], [0, -0.012, 0], 0.035, 24);
}, FREE);

fam("mep.distribution_board", ({ kit }) => {
  // этажный щиток: металлический шкаф на стене
  kit.box(pbr(0xcfd2d4, { rough: 0.45, metal: 0.3 }), -0.25, -0.16, -0.4, 0.25, 0, 0.4, 0.008);
  kit.box(M.graphite, 0.2, -0.165, -0.03, 0.215, -0.158, 0.03);
}, FREE);

fam("furniture.mirror", ({ kit, size, mat, r }) => {
  // зеркало: стекло, рама или подсветка по контуру; render.inset = [бока, низ, верх] — ширина рамы,
  // цвет стекла — colors.glass (в зеркале отражается комната: светлее, чем тёмный металл)
  const [W, D, H] = size || [0.6, 0.03, 0.8];
  const off = size ? [0, 0] : [-W / 2, -D / 2], glass = mat("glass", M.mirror, "mirror");
  kit.move(off[0], off[1], size ? 0 : -H / 2, () => {
    if (r.frame) {
      const fr = mat("frame", M.oak), [is, ib, it] = r.inset || [0.05, 0.05, 0.05];
      kit.box(fr, 0, 0, 0, W, D, H, 0.006);
      kit.box(glass, is, -0.002, ib, W - is, 0, H - it);
      if (r.shelf) kit.box(mat("shelf", M.white), 0, -0.1, -0.02, W, D, 0.0, 0.003);       // полочка под зеркалом
    } else {
      kit.box(glass, 0, 0, 0, W, D, H, 0.01);
      if (r.backlight) kit.box(M.led, 0.02, D, 0.02, W - 0.02, D + 0.004, H - 0.02);
      if (r.backlight) kit.box(M.led, 0.06, -0.001, 0.05, W - 0.06, 0.0005, 0.065);
    }
  });
}, FREE);

fam("furniture.pet_bowl", ({ kit, size: [W, D], mat, r }) => {
  // коврик и две миски; render.stand — керамические миски на деревянной подставке; цвета: mat, bowl, stand
  const mm = mat("mat", pbr(0x6f8fa8, { rough: 0.7 }));
  if (r.stand) {                                           // силиконовый коврик-«лапа»: подушечка спереди и три пальца сзади
    kit.prism(mm, ellipse(W / 2, D * 0.4, W * 0.5, D * 0.4, 40), 0, 0.008);
    for (const u of [0.22, 0.5, 0.78]) kit.prism(mm, ellipse(W * u, D * 0.78, Math.min(0.07, W * 0.2), Math.min(0.07, D * 0.22), 24), 0, 0.008);
  } else kit.box(mm, 0, 0, 0, W, D, 0.008, 0.03);
  const zb = r.stand ? 0.045 : 0.008, bowl = mat("bowl", r.stand ? M.ceramic : M.steel, r.stand ? "gloss" : "metal");
  for (const x of [W * 0.3, W * 0.7]) {
    if (r.stand) {
      const wood = mat("stand", M.oak);
      for (const [dx, dy] of [[-0.05, -0.05], [0.05, -0.05], [-0.05, 0.05], [0.05, 0.05]]) kit.box(wood, x + dx - 0.008, D / 2 + dy - 0.008, 0.008, x + dx + 0.008, D / 2 + dy + 0.008, zb + 0.01);
      kit.lathe(bowl, [[0.045, zb], [0.068, zb + 0.002], [0.068, zb + 0.06], [0.062, zb + 0.061], [0.058, zb + 0.012], [0, zb + 0.012]], x, D / 2, 32);
    } else kit.lathe(bowl, [[0.05, zb], [0.075, zb + 0.001], [0.08, zb + 0.047], [0.075, zb + 0.048], [0.06, zb + 0.012], [0, zb + 0.012]], x, D / 2, 32);
  }
});

// ═══ проёмы ═════════════════════════════════════════════════════════════════
const IN = 0.0005;                                         // на сколько куски стены в проёме утоплены от плоскостей стены
// Система проёма: X — вдоль стены, −Y — сторона комнаты, Z — от низа проёма. Старые пакеты, где коробка проёма
// стоит поперёк (X — толщина стены), разворачиваются по наружной стороне: она там, где снаружи квартиры.
function opening(e, env) {
  const [sx, sy, sz] = e.geom.size;
  const m = new THREE.Matrix4();
  let W = sx, T = sy;
  if (sy > sx) {                                          // проём поперёк: длинная сторона по Y
    W = sy; T = sx;
    // комната со стороны −X, если снаружи квартиры точка за гранью +X; поворот без отражения
    if (env.outside(e, [sx + 0.3, sy / 2, 0.5])) m.makeRotationZ(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(0, sy, 0));
    else m.makeRotationZ(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(sx, 0, 0));
  } else if (env.outside(e, [sx / 2, -0.3, 0.5]) && !env.outside(e, [sx / 2, sy + 0.3, 0.5])) {
    m.makeRotationZ(Math.PI).premultiply(new THREE.Matrix4().makeTranslation(sx, sy, 0));
  }
  return { W, T, H: sz, m, zf: env.floorZ(e), top: env.ceil - env.floorZ(e) };
}

// окно ПВХ: стена под подоконником и над проёмом, рама, створки со стеклом и ручками, подоконник, откосы
// frameTop — высота верхнего бруса рамы (иначе как у остальных), railColor — цвет ограждения
function windowAt(kit, { W, T, H, zf, top }, { sashes, frameMat = M.pvc, sillDepth = 0.06, door = null, railing = false,
  frameTop = null, railColor = null }) {
  const fz = T * 0.42, fd = 0.07, pf = 0.06, ft = frameTop ?? pf;   // рама в толще стены ближе к улице
  // стена под окном и перемычка утоплены на полмиллиметра от плоскостей стены: иначе ребро их торца лежит в плоскости
  // соседней стены, бьётся с ней по глубине и рисует светлый пунктир
  // торцы у откосов (x = 0 и x = W) не строятся: они упираются в откос стены и под острым углом пробивали пунктиром
  // всё, что перед ними (шторы); в щель у откоса видна заглушка внутри стены
  if (zf > 0.01) kit.slab(M.paint, 0, IN, -zf, W, T - IN, 0, "x-x+");                  // стена под окном
  if (top - H > 0.01) kit.slab(M.paint, 0, IN, H, W, T - IN, top + 0.02, "x-x+");      // перемычка — до плиты над потолком
  for (const x of [-0.0045, W + 0.0005]) kit.box(M.paint, x, IN, -zf, x + 0.004, T - IN, top + 0.02);
  kit.slab(frameMat, 0, fz, 0, pf, fz + fd, H, "x-");
  kit.slab(frameMat, W - pf, fz, 0, W, fz + fd, H, "x+");
  kit.box(frameMat, pf, fz, 0, W - pf, fz + fd, pf);
  kit.box(frameMat, pf, fz, H - ft, W - pf, fz + fd, H);
  if (zf > 0.01) kit.box(frameMat, -0.04, -sillDepth, -0.025, W + 0.04, fz + 0.005, 0.0, 0.003);   // подоконник
  kit.box(pbr(0xd8dadc, { rough: 0.5, metal: 0.4 }), 0, fz + fd, -0.012, W, T + 0.04, 0.0);        // отлив
  if (railing) {                                           // ограждение снаружи: поручень и стойки до 1,1 м от пола
    // белое, как на фото; снаружи его освещает небо со всех сторон — чуть светится своим цветом, иначе против света
    // сквозь тюль читается тёмными стойками
    const rc = railColor ?? 0xe6e6e2, rz = 1.1 - zf, rail = pbr(rc, { rough: 0.5, metal: 0.1, emissive: rc, emissiveIntensity: 0.55 }), ry = T + 0.05;
    if (rz > 0.05) {
      kit.box(rail, -0.05, ry - 0.02, rz - 0.04, W + 0.05, ry + 0.02, rz);
      kit.box(rail, -0.05, ry - 0.015, 0.02, W + 0.05, ry + 0.015, 0.05);
      for (let x = 0.05; x < W; x += 0.12) kit.box(rail, x - 0.008, ry - 0.008, 0.05, x + 0.008, ry + 0.008, rz - 0.04);
    }
  }
  const parts = sashes(W - 2 * pf);
  let x = pf;
  for (const p of parts) {
    const x0 = x, x1 = x + p.w;
    x = x1;
    if (p.mullion) { kit.box(frameMat, x0, fz, pf, x1, fz + fd, H - ft); continue; }
    if (p.fixed) { kit.box(M.glass, x0, fz + 0.02, pf, x1, fz + 0.044, H - ft); continue; }   // глухое стекло прямо в раме
    const z0 = p.z0 ?? pf, z1 = H - ft;
    const sf = 0.055, sy0 = fz - 0.012, sy1 = fz + fd - 0.01;
    kit.box(frameMat, x0, sy0, z0, x0 + sf, sy1, z1, 0.003);
    kit.box(frameMat, x1 - sf, sy0, z0, x1, sy1, z1, 0.003);
    kit.box(frameMat, x0 + sf, sy0, z0, x1 - sf, sy1, z0 + sf, 0.003);
    kit.box(frameMat, x0 + sf, sy0, z1 - sf, x1 - sf, sy1, z1, 0.003);
    kit.box(M.glass, x0 + sf, fz + 0.02, z0 + sf, x1 - sf, fz + 0.044, z1 - sf);
    if (p.panel) kit.box(frameMat, x0 + sf, fz + 0.015, z0 + sf, x1 - sf, fz + 0.05, Math.min(z1 - sf, z0 + p.panel));
    if (p.handle) {
      const hx = p.handle === "left" ? x0 + 0.028 : x1 - 0.028, hz = door ? 1.05 : (z0 + z1) / 2;
      kit.box(M.white, hx - 0.016, sy0 - 0.012, hz - 0.035, hx + 0.016, sy0, hz + 0.035, 0.004);
      kit.box(M.white, hx - 0.01, sy0 - 0.03, hz - 0.12, hx + 0.01, sy0 - 0.012, hz + 0.0, 0.006);
    }
  }
}

fam("opening.window", ({ kit, e, env, r }) => {
  // створки: render.sashes или по ширине (две у окна шире 1,1 м), между ними импост; render.fixed — номера глухих
  // полотен (стекло прямо в раме, 0 — у начала проёма), render.frame_top — высота верхнего бруса,
  // render.railing_color — цвет ограждения
  const o = opening(e, env), fixed = r.fixed || [];
  kit.at(o.m, () => windowAt(kit, o, {
    railing: !!r.railing, sillDepth: r.sill_depth ?? 0.06,   // render.sill_depth — вынос подоконника в комнату
    frameTop: r.frame_top ?? null, railColor: hex(r.railing_color, null),
    sashes: w => {
      const n = Math.max(1, Math.round(r.sashes ?? (w > 1.1 ? 2 : 1))), m = 0.07, sw = (w - (n - 1) * m) / n, out = [];
      for (let i = 0; i < n; i++) {
        if (i) out.push({ w: m, mullion: true });
        if (fixed.includes(i)) { out.push({ w: sw, fixed: true }); continue; }
        out.push({ w: sw, handle: n === 1 || i % 2 ? (i % 2 ? "left" : "right") : "right" });
      }
      return out;
    },
  }));
}, VARIANTS);

fam("opening.balcony_door", ({ kit, e, env, r }) => {
  // балконный блок: распашная остеклённая дверь и глухая остеклённая часть
  const o = opening(e, env), leaf = Math.min(r.leaf ?? 0.9, o.W - 0.14);
  const hinge = r.hinge ?? "left";
  kit.at(o.m, () => windowAt(kit, o, {
    door: true,
    sashes: w => {
      const fixed = w - leaf;
      const d = { w: leaf, handle: hinge === "left" ? "right" : "left", panel: r.panel ?? 0.42 };   // render.panel = 0 — остеклена до низа
      if (fixed < 0.12) return [{ ...d, w }];
      const f = { w: fixed - 0.07, fixed: true };
      return hinge === "left" ? [d, { w: 0.07, mullion: true }, f] : [f, { w: 0.07, mullion: true }, d];
    },
  }));
}, VARIANTS);

// дверь: коробка, наличники с двух сторон, полотно на петлях (открыто на угол open), ручки, стена над проёмом
// jamb — ширина боковин коробки, jambTop — её верха; casingW — ширина наличника; leafW — ширина полотна (иначе — по
// коробке), leafInset — полотно утоплено в проём; handleZ — высота ручки, escutcheon "plate" — ручка на узкой накладке
// с фиксатором, rosette "round" — круглая розетка; latch — планка замка на торце полотна; peephole — сдвиг глазка
function doorAt(kit, { W, T, H, top }, { hinge = "left", open = 90, leafMat = M.white, backMat = null, frameMat = M.white,
  handleMat = M.chrome, leafT = 0.04, casing = true, steel = false, sliding = false, lock = null, grille = false, floorMat = null,
  jamb = null, jambTop = null, casingW = 0.07, handleZ = 1.0, escutcheon = null, rosette = null, peephole = 0, leafW = null,
  leafInset = 0, latch = false, latchMat = M.brushed, frameInset = 0, frameH = null, sill = 0, casingOver = false,
  backset = 0.065, leafOverlap = 0, seam = [0, 0.003] }) {
  if (frameInset > 0) {                                    // коробка уже проёма: по бокам полосы стены, коробка внутри
    for (const [x0, x1] of [[0, frameInset], [W - frameInset, W]]) kit.slab(M.paint, x0, IN, 0, x1, T - IN, top, "x-x+");
    for (const x of [-0.004, W]) kit.box(M.paint, x, IN, 0, x + 0.004, T - IN, top);   // заглушки у краёв проёма
    if (floorMat) {
      kit.box(floorMat, 0, -0.01, -0.02, W, T + 0.01, 0.0035);
      kit.box(SEAM, 0, -0.0015, 0.0035, W, 0.0015, 0.0047);
    }
    kit.move(frameInset, 0, 0, () => doorAt(kit, { W: W - 2 * frameInset, T, H, top }, { hinge, open, leafMat, backMat, frameMat,
      handleMat, leafT, casing, steel, sliding, lock, grille, jamb, jambTop, casingW, handleZ, escutcheon, rosette, peephole,
      leafW, leafInset, latch, latchMat, frameH, sill, casingOver, backset, leafOverlap }));
    return;
  }
  const jf = jamb ?? (steel ? 0.05 : 0.03), jt = jambTop ?? jf, hd = frameH ?? Math.min(H, 2.1);
  if (floorMat) {                                          // пол в проёме на полмиллиметра ниже пола комнат и заходит под него:
    kit.box(floorMat, 0, -0.01, -0.02, W, T + 0.01, 0.0035);   // общих кромок нет; со стороны открывания — тонкий порожек
    const [so, sw] = seam;                                 // seam = [сдвиг в комнату, ширина]
    kit.slab(SEAM, 0, -so - sw / 2, 0.0049, W, -so + sw / 2, 0.005, "x-x+y-y+z-");   // лента на 1 мм над полом комнаты
  }
  // стена над дверью и боковины коробки утоплены, как у окна, и без граней, упёртых в стену: ребро такой грани
  // лежало бы в плоскости соседней и под острым углом рисовало пунктир
  if (top - hd > 0.01) kit.slab(M.paint, 0, IN, hd, W, T - IN, top, "x-x+");
  // заглушки внутри стен по краям проёма (торцы стен у двери не строятся): в щели в пиксель видна краска, а не
  // то, что за стеной; на 2 мм за плоскостями стены — с её гранями не спорят
  for (const x of [-0.004, W]) kit.box(M.paint, x, IN, 0, x + 0.004, T - IN, top);
  kit.slab(frameMat, 0, IN, 0, jf, T - IN, hd, "x-");
  kit.slab(frameMat, W - jf, IN, 0, W, T - IN, hd, "x+");
  kit.box(frameMat, jf, IN, hd - jt, W - jf, T - IN, hd);
  if (sill > 0) kit.box(frameMat, jf, IN, 0, W - jf, T - IN, sill);                   // порог
  if (casing) {                                            // наличник на миллиметр от стены: торец не бьётся с её гранью;
    const cw = casingW, ov = casingOver ? jf - 0.005 : 0, zt = casingOver ? hd - jt + 0.005 : hd;   // casingOver — поверх коробки
    for (const [y0, y1] of [[-0.011, -0.001], [T + 0.001, T + 0.011]]) {
      kit.box(frameMat, ov - cw, y0, 0, ov, y1, zt + cw, 0.002);
      kit.box(frameMat, W - ov, y0, 0, W - ov + cw, y1, zt + cw, 0.002);
      kit.box(frameMat, ov, y0, zt, W - ov, y1, zt + cw, 0.002);
    }
  }
  const lw = leafW ?? W - 2 * jf - 0.006, lh = hd - jt - 0.012 + leafOverlap, li = leafInset;   // leafOverlap — полотно заходит за перемычку
  if (sliding) {                                           // полотно уезжает в стену (пенал) в сторону петель
    const shown = Math.max(0.04, lw * (1 - Math.min(1, open / 90))), y0 = T / 2 - leafT / 2;
    const x0 = hinge === "left" ? jf : W - jf - shown;
    kit.box(leafMat, x0, y0, 0.008, x0 + shown, y0 + leafT, lh, 0.002);
    const ex = hinge === "left" ? x0 + shown : x0;         // торцевая ручка-ракушка
    kit.box(M.black, ex - 0.004, y0 - 0.002, 0.95, ex + 0.004, y0 + leafT + 0.002, 1.1);
    return;
  }
  const hx = hinge === "left" ? jf + 0.003 : W - jf - 0.003;
  const ang = (hinge === "left" ? -1 : 1) * open;
  kit.turn(ang, hx, li, () => kit.move(0, li, 0, () => {
    const x0 = hinge === "left" ? hx : hx - lw, x1 = x0 + lw;
    const lz = sill > 0 ? sill + 0.004 : 0.008;
    kit.box(leafMat, x0, 0, lz, x1, leafT * (backMat ? 0.5 : 1), lh, 0.003);
    if (latch) {                                           // лицевая планка замка с язычком на торце свободной кромки
      const ex = hinge === "left" ? x1 : x0, o = hinge === "left" ? 1 : -1;
      kit.box(latchMat, Math.min(ex, ex + o * 0.001), leafT / 2 - 0.011, handleZ - 0.135, Math.max(ex, ex + o * 0.001), leafT / 2 + 0.011, handleZ + 0.055, 0.001);
      kit.box(latchMat, Math.min(ex, ex + o * 0.006), leafT / 2 - 0.006, handleZ - 0.052, Math.max(ex, ex + o * 0.006), leafT / 2 + 0.006, handleZ - 0.028);
    }
    if (grille) {                                          // вентрешётка внизу полотна, ближе к петлям, с обеих сторон
      const gx = hinge === "left" ? x0 + lw * 0.1 : x0 + lw * 0.55;
      for (const [y0g, y1g] of [[-0.003, 0], [leafT, leafT + 0.003]]) kit.box(M.graphite, gx, y0g, 0.06, gx + lw * 0.35, y1g, 0.16);
    }
    if (backMat) kit.box(backMat, x0, leafT * 0.5, lz, x1, leafT, lh, 0.003);
    const kx = hinge === "left" ? x1 - backset : x0 + backset, dir = hinge === "left" ? -1 : 1;   // backset — от кромки до оси ручки
    for (const [y, s] of [[0, -1], [leafT, 1]]) {                                         // ручки с обеих сторон
      if (lock === "smart" && s < 0) {                      // умный замок: чёрная планка, на ней блок-ручка; выше второй замок
        kit.box(pbr(0x141414, { rough: 0.35 }), kx - 0.035, y - 0.03, 0.85, kx + 0.035, y, 1.24, 0.008);
        kit.box(pbr(0x5a3a2e, { rough: 0.45 }), kx - 0.0225, y - 0.065, 0.9, kx + 0.0225, y - 0.03, 1.06, 0.008);
        kit.rod(M.white, [kx, y, 1.37], [kx, y - 0.006, 1.37], 0.035, 24);                 // поворотник на розетке
        kit.rod(pbr(0x111111, { rough: 0.4 }), [kx, y - 0.006, 1.37], [kx, y - 0.024, 1.37], 0.024, 24);
        const cx = (x0 + x1) / 2 + peephole;
        kit.box(pbr(0x111111, { rough: 0.3 }), cx - 0.015, y - 0.004, 1.475, cx + 0.015, y, 1.505);   // глазок
        for (const z of [0.31, 1.79]) kit.box(pbr(0xe6e6e6, { rough: 0.4 }), hx - 0.002, y - 0.02, z - 0.065, hx + 0.016 * (hinge === "left" ? 1 : -1), y, z + 0.065, 0.004);   // петли
        continue;
      }
      const hz = handleZ;
      kit.rod(handleMat, [kx, y, hz], [kx, y + s * 0.05, hz], 0.009, 12);
      kit.rod(handleMat, [kx, y + s * 0.05, hz], [kx + dir * 0.12, y + s * 0.05, hz], 0.009, 12);
      if (escutcheon === "plate") {                          // узкая накладка, под ручкой фиксатор-вертушка
        kit.box(handleMat, kx - 0.015, y + s * 0.006 - 0.003, hz - 0.12, kx + 0.015, y + s * 0.006 + 0.003, hz + 0.08, 0.003);
        kit.box(handleMat, kx - 0.004, y + s * 0.006, hz - 0.085, kx + 0.004, y + s * 0.02, hz - 0.06, 0.002);
      } else if (rosette === "round") kit.rod(handleMat, [kx, y, hz], [kx, y + s * 0.009, hz], 0.026, 24);
      else kit.box(handleMat, kx - 0.02, y + s * 0.006 - 0.003, hz - 0.03, kx + 0.02, y + s * 0.006 + 0.003, hz + 0.03, 0.003);
    }
  }));
}
const SEAM = pbr(0x9a948a, { rough: 0.7 });               // порожек-стык пола в проёме

// общие подсказки двери: render.jamb, jamb_top, casing_w, casing_over (наличник поверх коробки), leaf_w, leaf_inset,
// handle_z, escutcheon, rosette, frame_inset (коробка уже проёма), frame_h (высота коробки), sill (порог)
const doorOpts = r => ({ jamb: r.jamb ?? null, jambTop: r.jamb_top ?? null, casingW: r.casing_w ?? 0.07, leafW: r.leaf_w ?? null,
  leafInset: r.leaf_inset ?? 0, handleZ: r.handle_z ?? 1.0, escutcheon: r.escutcheon ?? null, rosette: r.rosette ?? null,
  frameInset: r.frame_inset ?? 0, frameH: r.frame_h ?? null, sill: r.sill ?? 0, casingOver: !!r.casing_over,
  backset: r.handle_backset ?? 0.065, leafOverlap: r.leaf_overlap ?? 0, seam: r.seam ?? [0, 0.003] });

fam("opening.door", ({ kit, e, env, r, mat }) => {
  const o = opening(e, env);
  kit.at(o.m, () => doorAt(kit, o, { hinge: r.hinge ?? "left", open: r.open ?? 90, leafMat: mat("leaf", M.white),
    frameMat: mat("frame", M.white), handleMat: mat("handle", M.chrome, "metal"), sliding: !!r.sliding, grille: !!r.grille,
    floorMat: env.floor?.(e) ?? null, latch: !r.sliding && r.latch !== false, latchMat: mat("latch", M.brushed, "metal"), ...doorOpts(r) }));
}, VARIANTS);

fam("opening.entrance_door", ({ kit, e, env, r, mat }) => {
  // входная металлическая дверь: снаружи и внутри разного цвета; render.peephole — сдвиг глазка от середины
  const o = opening(e, env);
  kit.at(o.m, () => doorAt(kit, o, { hinge: r.hinge ?? "left", open: r.open ?? 0, steel: true, leafT: 0.07,
    leafMat: mat("inside", M.white), backMat: mat("outside", M.red), frameMat: mat("frame", M.graphite),
    handleMat: mat("handle", M.chrome, "metal"), casing: r.casing ?? true, lock: r.lock ?? null, floorMat: env.floor?.(e) ?? null,
    peephole: r.peephole ?? 0, ...doorOpts(r) }));
}, VARIANTS);

fam("opening.*", ({ kit, e, env }) => {
  // проход без двери: перемычка, пол в проёме как в комнате, плинтус по обоим откосам
  const o = opening(e, env), fm = env.floor?.(e);
  kit.at(o.m, () => {
    if (o.top - o.H > 0.01) kit.slab(M.paint, 0, -IN, o.H, o.W, o.T + IN, o.top, "x-x+");   // перед плоскостями стены
    if (fm) kit.box(fm, 0, -0.01, -0.02, o.W, o.T + 0.01, 0.0035);   // под пол комнат: общих кромок нет
    if (e.type === "passage") for (const [x0, x1] of [[0, 0.014], [o.W - 0.014, o.W]]) kit.box(M.skirting, x0, -0.001, 0, x1, o.T + 0.001, 0.07, 0.002);
  });
}, VARIANTS);

export { F as FAMILIES, fam, FREE, VARIANTS, bar, knob, legs, front, shellChair, splayLegs, tableAt };
