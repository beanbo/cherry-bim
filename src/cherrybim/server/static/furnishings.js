// Cherry BiM — обстановка и техника комнат: корпусная мебель по ячейкам фасада, кресла, стулья, пуфы, скамьи,
// шторы, ковры, ТВ, кондиционер, бризер, принтеры, ПК, мониторы, лампы, роутер, светильники. Те же соглашения, что
// в families.js: метры, Z вверх, коробка от угла по +X +Y +Z, фасад — сторона −Y; подсказки — props.render.
import * as THREE from "three";
import { M, pbr, matte, hex } from "./materials.js";
import { fam, FREE, front, shellChair, splayLegs, tableAt } from "./families.js";

// ═══ корпусная мебель по ячейкам ════════════════════════════════════════════
// render.cells: [[u0, v0, u1, v1, вид, петли], …] — доли ширины и высоты фасада; вид "drawer", "door", "open".
// render.legs: "wood" (расставленные ножки), "casters" (колёсики), "plinth" (цоколь), иначе стоит на полу или висит.
const CELLS = {
  chest: [[0, 2 / 3, 1, 1, "drawer"], [0, 1 / 3, 1, 2 / 3, "drawer"], [0, 0, 1, 1 / 3, "drawer"]],
  pedestal: [[0, 2 / 3, 1, 1, "drawer"], [0, 1 / 3, 1, 2 / 3, "drawer"], [0, 0, 1, 1 / 3, "drawer"]],
  nightstand: [[0, 0.55, 1, 1, "drawer"], [0, 0, 1, 0.55, "open"]],
  tv_stand: [[0, 0, 0.3, 1, "door", "left"], [0.3, 0.5, 0.7, 1, "open"], [0.3, 0, 0.7, 0.5, "open"], [0.7, 0, 1, 1, "door", "right"]],
  wall_cabinet: [[0, 0, 1, 1, "door", "left"]],
  cabinet: [[0, 0, 0.5, 1, "door", "left"], [0.5, 0, 1, 1, "door", "right"]],
};
fam("furniture.chest furniture.tv_stand furniture.wall_cabinet furniture.pedestal furniture.cabinet furniture.nightstand",
  ({ kit, e, env, size: [W, D, H], mat, r }) => {
    const body = mat("body", M.white), fr = mat("front", body), top = mat("top", body), hm = mat("handle", M.black, "metal");
    // render.base — высота ножек или колёсиков, render.leg_inset — отступ коротких ножек от боковин
    const t = 0.018, base = r.base ?? { wood: 0.12, casters: 0.07, plinth: 0.08, short: 0.05 }[r.legs] ?? 0, li = r.leg_inset ?? 0.065;
    if (r.legs === "short") for (const x of [li, W - li]) for (const y of [0.05, D - 0.05]) kit.cylZ(mat("legs", M.brushed, "satin"), x, y, 0, base, 0.02, 16);
    if (r.legs === "wood") splayLegs(kit, mat("legs", M.oak), 0.05, 0.05, W - 0.05, D - 0.05, base, 0.015, 0.02);
    if (r.legs === "casters") {
      const wr = Math.min(0.025, base * 0.45);              // колесо под корпусом, стойка до его низа
      for (const x of [0.05, W - 0.05]) for (const y of [0.06, D - 0.06]) {
        if (base > 2 * wr + 0.002) kit.cylZ(M.graphite, x, y, 2 * wr, base, 0.012, 10);
        kit.sphere(M.black, x, y, wr, wr, 12);
      }
    }
    // render.socle_inset — отступ цоколя от фасада, render.sides_to_floor — боковины до пола, цоколь между ними;
    // colors.inside — задняя стенка, а в открытых нишах и вкладыши по дну и бокам (в глубине ниша в тени; светлыми
    // остаются передние 1,5 см кромок)
    const si = r.socle_inset ?? 0.04, sf = !!r.sides_to_floor;
    if (r.legs === "plinth") kit.box(mat("socle", body), sf ? t : 0.02, si, 0, sf ? W - t : W - 0.02, D, base);
    kit.box(body, 0, 0, sf ? 0 : base, t, D, H - t);
    kit.box(body, W - t, 0, sf ? 0 : base, W, D, H - t);
    kit.box(body, t, 0, base, W - t, D, base + t);
    kit.box(top, 0, 0, H - t, W, D, H, 0.002);
    kit.box(mat("inside", body), t, D - 0.006, base + t, W - t, D, H - t);                 // задняя стенка
    const hz = H - t - base;
    if (env.kids(e.id).some(k => k.kind === "storage")) return;   // фасады нарисуют места хранения
    for (const [u0, v0, u1, v1, kind = "door", hinge] of r.cells || CELLS[e.type] || CELLS.cabinet) {
      const x0 = u0 * W, x1 = u1 * W, z0 = base + v0 * hz, z1 = base + v1 * hz;
      if (kind === "open") {                               // открытая ниша: полка снизу и перегородки по краям
        if (v0 > 0.001) kit.box(body, Math.max(x0, t), 0, z0 - t / 2, Math.min(x1, W - t), D - 0.006, z0 + t / 2);
        if (u0 > 0.001) kit.box(body, x0 - t / 2, 0, z0, x0 + t / 2, D - 0.006, z1);
        if (u1 < 0.999) kit.box(body, x1 - t / 2, 0, z0, x1 + t / 2, D - 0.006, z1);
        if (r.colors?.inside) {
          const ins = mat("inside", body), xa = Math.max(x0, t) + (u0 > 0.001 ? t / 2 : 0), xb = Math.min(x1, W - t) - (u1 < 0.999 ? t / 2 : 0);
          const zf = v0 > 0.001 ? z0 + t / 2 : base + t, zc = v1 < 0.999 ? z1 - t / 2 : H - t;
          kit.box(ins, xa, 0.015, zf, xb, D - 0.006, zf + 0.0008);
          kit.box(ins, xa, 0.015, zf, xa + 0.0008, D - 0.006, zc);
          kit.box(ins, xb - 0.0008, 0.015, zf, xb, D - 0.006, zc);
        }
        continue;
      }
      front(kit, fr, x0, z0, x1, z1, { kind, handles: r.handles ?? "bar", handleMat: hm, hinge: hinge || (u0 + u1 < 1 ? "left" : "right"),
        at: e.type === "wall_cabinet" ? "bottom" : "top", hlen: r.handle_len ?? null,   // render.handle_len — длина ручки
        outer: { l: u0 < 0.001, r: u1 > 0.999, b: v0 < 0.001, t: v1 > 0.999 } });
    }
  });

// декоративная панель (облицовка стены, колонна под дерево, порог): render.skirting — плинтус по фасаду (высота),
// render.nosing = [глубина, высота] — кромка-профиль по верхнему ребру фасада; цвета: body, skirting, nosing
fam("furniture.panel", ({ kit, size: [W, D, H], mat, r }) => {
  kit.box(mat("body", M.oak), 0, 0, 0, W, D, H, 0.002);
  if (r.skirting) kit.box(mat("skirting", M.skirting), 0.001, -0.012, 0, W - 0.001, 0, r.skirting, 0.002);
  if (r.nosing) kit.box(mat("nosing", M.brushed, "metal"), 0, -0.002, H - r.nosing[1], W, r.nosing[0] - 0.002, H + 0.001, 0.001);
});

// ═══ сиденья ════════════════════════════════════════════════════════════════
// офисное кресло: пятилучье на колёсиках, газлифт, сиденье, спинка с подголовником, подлокотники; render.footrest
fam("furniture.office_chair", ({ kit, size: [W, D, H], mat, r }) => {
  // render.armrests = false — без подлокотников; render.headrest = false — спинка до верха, уже и скруглённая;
  // цвета: body (сиденье), back (спинка), frame (крестовина)
  const fab = mat("body", matte(0x9ea3a8), "fabric"), fr = mat("frame", M.graphite, "metal"), backM = mat("back", fab, "fabric");
  const tall = r.headrest === false, bw = tall ? 0.19 : 0.23;
  const cx = W / 2, cy = D / 2 + 0.04, seat = 0.48;
  for (let i = 0; i < 5; i++) {
    const a = Math.PI / 2 + i * 2 * Math.PI / 5, ex = cx + Math.cos(a) * 0.3, ey = cy + Math.sin(a) * 0.3;
    kit.rod(fr, [cx, cy, 0.1], [ex, ey, 0.07], 0.016, 8);
    kit.sphere(M.black, ex, ey, 0.03, 0.03, 10);
  }
  kit.cylZ(fr, cx, cy, 0.08, seat - 0.06, 0.024, 14);                                       // газлифт
  kit.box(fab, cx - 0.25, cy - 0.27, seat - 0.06, cx + 0.25, cy + 0.2, seat + 0.02, 0.035); // сиденье
  const back = new THREE.Matrix4().makeTranslation(0, cy + 0.22, seat).multiply(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(-(r.recline ?? 12))))   // render.recline — наклон спинки, °
    .multiply(new THREE.Matrix4().makeTranslation(0, -(cy + 0.22), -seat));
  kit.at(back, () => {
    kit.box(backM, cx - bw, cy + 0.18, seat + 0.06, cx + bw, cy + 0.24, tall ? H - 0.04 : Math.min(H - 0.2, seat + 0.62), tall ? 0.06 : 0.03);   // спинка
    if (!tall) kit.box(backM, cx - 0.14, cy + 0.17, Math.min(H - 0.16, seat + 0.66), cx + 0.14, cy + 0.23, H - 0.02, 0.03);
    kit.rod(fr, [cx, cy + 0.25, seat], [cx, cy + 0.25, seat + 0.2], 0.012, 8);
  });
  for (const s of r.armrests === false ? [] : [-1, 1]) {                                     // подлокотники
    kit.rod(fr, [cx + s * 0.27, cy - 0.02, seat], [cx + s * 0.27, cy - 0.02, seat + 0.2], 0.012, 8);
    kit.box(mat("arm", M.black), cx + s * 0.27 - 0.04, cy - 0.16, seat + 0.2, cx + s * 0.27 + 0.04, cy + 0.12, seat + 0.23, 0.012);
  }
  if (r.footrest) {                                                                           // выдвижная подставка для ног
    kit.rod(fr, [cx, cy - 0.2, seat - 0.08], [cx, cy - 0.5, seat - 0.12], 0.01, 8);
    kit.box(fab, cx - 0.2, cy - 0.62, seat - 0.15, cx + 0.2, cy - 0.45, seat - 0.11, 0.02);
  }
});

// отдельный стул-«ракушка»: коробка стула, спинка у стороны +Y
fam("furniture.chair", ({ kit, size: [W, D], mat }) => {
  shellChair(kit, mat("body", matte(0x31508a), "fabric"), mat("legs", M.oak), W / 2, D - 0.01);
});

// стол без стульев (кухонный, журнальный): render.legs как у обеденного; render.leg_inset — отступ ножек от углов
// сверху, render.splay — насколько ножки-полосы разведены у пола (по диагонали)
fam("furniture.table", ({ kit, size: [W, D, H], mat, r }) => {
  tableAt(kit, mat("top", M.oak), mat("legs", M.black, "metal"), W / 2, D / 2, W, D, H, r.legs ?? "splay", r.leg_inset ?? 0.07, r.splay ?? 0.1,
    r.strip_w ?? 0.05);                                    // render.strip_w — ширина ножки-полосы
});

// мягкая скамья (банкетка) и пуф на деревянных ножках
fam("furniture.bench", ({ kit, size: [W, D, H], mat, r }) => {
  // render.leg_inset — отступ ножек от углов, render.legs_dx / legs_dy — ряд ножек сдвинут по длине / к спинке,
  // render.splay — разлёт [x, y], render.splay_corner — свой у углов {fl | fr | bl | br: [x, y]}, render.leg_r — радиус
  // ножки вверху
  const fab = mat("body", matte(0x4f6b58), "fabric"), lh = r.legs_h ?? Math.min(0.17, H * 0.4), li = r.leg_inset ?? 0.07;
  const dx = r.legs_dx ?? 0, dy = r.legs_dy ?? 0;
  splayLegs(kit, mat("legs", M.oak), li + dx, li + dy, W - li + dx, D - li + dy, lh + 0.01, r.leg_r ?? 0.017, r.splay ?? 0.03, r.splay_corner ?? null);
  if (r.lid) {                                             // render.lid — сундук: короб и откидная крышка со швом
    kit.box(fab, 0.004, 0.004, lh, W - 0.004, D - 0.004, H - 0.065, 0.03);
    kit.box(fab, 0, 0, H - 0.062, W, D, H, 0.03);
  } else kit.box(fab, 0, 0, lh, W, D, H, 0.04);
});
fam("furniture.pouf", ({ kit, size: [W, D, H], mat, r: rr }) => {   // render.legs_h — высота ножек
  const fab = mat("body", matte(0x2f6f73), "fabric"), r = Math.min(W, D) / 2, lh = rr.legs_h ?? Math.min(0.1, H * 0.3);
  splayLegs(kit, mat("legs", M.oak), W / 2 - r * 0.55, D / 2 - r * 0.55, W / 2 + r * 0.55, D / 2 + r * 0.55, lh + 0.01, 0.015, 0.03);
  kit.lathe(fab, [[0, lh], [r * 0.9, lh], [r, lh + 0.03], [r, H - 0.03], [r * 0.9, H], [0, H]], W / 2, D / 2, 40);
});
fam("furniture.ball", ({ kit, size: [W, D], mat }) => {                                    // фитбол
  const r = Math.min(W, D) / 2;
  kit.sphere(mat("body", pbr(0xd9cfc2, { rough: 0.5 })), W / 2, D / 2, r, r, 32);
});

// ковёр: тонкая плита цвета ворса
fam("furniture.rug", ({ kit, size: [W, D, H], mat }) => {
  kit.box(mat("body", matte(0x8d97a3), "fabric"), 0, 0, 0, W, D, Math.max(H, 0.008), 0.006);
});

// шторы: карниз сверху, по краям складчатые полотна, между ними тюль. Сторона −Y — в комнату, окно — за +Y.
// render.panel — ширина полотна или [левое, правое] (если смотреть из комнаты), render.tulle = false — без тюля,
// render.rod = [x0, x1] — штанга шире коробки (полотна — у краёв коробки), render.fold — глубина складок,
// render.tulle_opacity — плотность тюля, render.tulle_span = [x0, x1] — где висит тюль, render.tulle_skirt =
// [x0, x1, y, z] — на участке x0..x1 тюль ниже высоты z перекинут через прибор под окном и висит в плоскости y;
// render.hem — высота подола полотен над полом, render.top — на сколько полотна (на люверсах) выше штанги,
// render.finial = "cube" — наконечники штанги кубиками; цвета: fabric, tulle, rod
fam("furniture.curtains", ({ kit, size: [W, D, H], mat, r }) => {
  const fab = mat("fabric", matte(0x6e8aa3), "fabric"), rod = mat("rod", M.black, "metal");
  const tulle = pbr(0xffffff, { rough: 0.9, transparent: true, opacity: r.tulle_opacity ?? 0.55, depthWrite: false, side: THREE.DoubleSide });
  const zr = H - 0.03, yr = D * 0.45;
  const [rx0, rx1] = r.rod || [0, W], amp = r.fold ?? 0.03;
  kit.rod(rod, [rx0, yr, zr], [rx1, yr, zr], 0.011, 12);
  for (const x of [rx0, rx1]) {
    if (r.finial === "cube") kit.box(rod, x - 0.0175, yr - 0.0175, zr - 0.0175, x + 0.0175, yr + 0.0175, zr + 0.0175);
    else kit.sphere(rod, x, yr, zr, 0.02, 12);
  }
  const [pl, pr] = (Array.isArray(r.panel) ? r.panel : [r.panel ?? 0.45, r.panel ?? 0.45]).map(v => Math.min(v, W / 2));
  const pleats = (x0, x1, y, mt, amp, z0, z1 = zr - 0.04) => {   // складки: волна в плане, поднятая до карниза
    const n = Math.max(3, Math.round((x1 - x0) / 0.06)), top = [], bot = [];
    for (let i = 0; i <= n * 4; i++) {
      const x = x0 + (x1 - x0) * i / (n * 4), w = amp * Math.sin(i / 4 * Math.PI);
      top.push([x, y + w]);
      bot.push([x, y + w + 0.008]);
    }
    kit.prism(mt, [...top, ...bot.reverse()], z0, z1);
  };
  // тюль — один волнистый лист: у призмы прозрачные слои складываются в рёбра «батареи»
  const veil = (x0, x1, y0, z0, y1 = y0, z1 = zr - 0.04) => {
    const n = Math.max(3, Math.round((x1 - x0) / 0.05)) * 4, row = (y, z) => Array.from({ length: n + 1 }, (_, i) => {
      const x = x0 + (x1 - x0) * i / n;
      return [x, y + 0.01 * Math.sin(i / 2 * Math.PI), z];
    });
    kit.grid(tulle, [row(y0, z0), row(y1, z1)]);
  };
  const ty = D * 0.75, sk = r.tulle_skirt, [tx0, tx1] = r.tulle_span || [0.02, W - 0.02];
  if (r.tulle !== false && sk) {
    const [sx0, sx1, sy, sz] = sk, a = Math.max(tx0, sx0), b = Math.min(tx1, sx1);
    if (a > tx0 + 0.01) veil(tx0, a, ty, 0.01);
    if (b < tx1 - 0.01) veil(b, tx1, ty, 0.01);
    veil(a, b, ty, sz);                                    // выше прибора — как обычно
    // перегиб и подол — своей, более прозрачной тканью (render.skirt_opacity): на них смотрят под острым углом
    const thin = pbr(0xffffff, { rough: 0.9, transparent: true, opacity: r.skirt_opacity ?? 0.3, depthWrite: false, side: THREE.DoubleSide });
    const veil2 = (y0, z0, y1, z1) => kit.grid(thin, [0, 1].map(k => Array.from({ length: 41 }, (_, i) => {
      const x = a + (b - a) * i / 40;
      return [x, k ? y1 : y0, k ? z1 : z0];
    })));
    veil2(sy, sz - 0.12, ty, sz);                          // перегиб через прибор — наклонный
    veil2(sy, 0.0, sy, sz - 0.12);                         // подол перед прибором до пола
  } else if (r.tulle !== false) veil(tx0, tx1, ty, 0.01);
  // полотна: подол на render.hem, верх выше штанги на render.top (люверсы); сзади подложка из той же ткани —
  // сквозь гребни складок под острым углом не просвечивает окно
  const py = D * (r.panel_depth ?? 0.2), hem = r.hem ?? 0, ptop = zr + (r.top ?? -0.04);   // render.panel_depth — где полотна по глубине
  for (const [x0, x1] of [[0.0, pl], [W - pr, W]]) {
    pleats(x0, x1, py, fab, amp, hem, ptop);
    kit.box(fab, x0, py + amp + 0.009, hem, x1, py + amp + 0.013, ptop);
  }
});

// ═══ техника и электроника ══════════════════════════════════════════════════
// телевизор на стене: рамка и экран; включённый экран светится (свой материал устройства)
fam("device.tv", ({ kit, e, env, size: [W, D, H] }) => {
  kit.box(M.black, 0, 0, 0, W, D, H, 0.004);
  kit.box(env.own(e), 0.008, -0.001, 0.012, W - 0.008, 0.002, H - 0.008);
});

// дуга точками [y, z] (или [x, z]) для профилей: центр, радиус, углы от a0 до a1; rz — второй радиус (дуга эллипса)
const arcYZ = (cy, cz, rr, a0, a1, n = 10, rz = rr) => Array.from({ length: n + 1 }, (_, i) => {
  const a = a0 + (a1 - a0) * i / n;
  return [cy + rr * Math.cos(a), cz + rz * Math.sin(a)];
});
// прямоугольник со скруглёнными углами точками [x, z]
const roundRectXZ = (x0, z0, x1, z1, rc) => [...arcYZ(x1 - rc, z0 + rc, rc, -Math.PI / 2, 0, 6), ...arcYZ(x1 - rc, z1 - rc, rc, 0, Math.PI / 2, 6),
  ...arcYZ(x0 + rc, z1 - rc, rc, Math.PI / 2, Math.PI, 6), ...arcYZ(x0 + rc, z0 + rc, rc, Math.PI, 3 * Math.PI / 2, 6)];

// внутренний блок сплит-системы — профиль сбоку, выдавленный по ширине: плоский фасад, внизу спереди скругление, по нему
// сетка-решётка загибается под корпус; торцевые крышки на 4 мм меньше панели (по кромке виден шов); снизу закрытые
// жалюзи заподлицо, индикатор. render.radius — скругление верхней кромки фасада, render.back_drop — днище у стены ниже
// губы; цвета: body, grille (решётка), slot (жалюзи)
fam("device.ac", ({ kit, e, env, size: [W, D, H], mat, r }) => {
  const body = mat("body", M.white), rt = r.radius ?? 0.04, zl = 0.03, R = Math.min(0.07, H * 0.2), P = Math.PI;
  const yb = D * 0.45, zb = r.back_drop ? 0 : 0.03, g = 0.0015, ce = Math.min(0.03, W * 0.05);
  const prof = d => [                                      // d — насколько профиль меньше спереди, сверху и снизу
    ...arcYZ(rt, H - rt, rt - d, P, P / 2, 8), ...arcYZ(D - 0.01, H - 0.01, 0.01 - d / 3, P / 2, 0, 4),
    [D, zb + d], [yb + 0.03, zb + d], [yb, zl + d], ...arcYZ(R, zl + R, R - d, 3 * P / 2, P, 20),
  ];
  kit.profileX(body, prof(0), ce, W - ce);
  for (const [x0, x1] of [[0, ce], [W - ce, W]]) kit.profileX(body, prof(0.004), x0, x1);   // торцевые крышки
  kit.profileX(mat("grille", body), [                      // решётка: лента по скруглению, чуть над корпусом
    ...arcYZ(R, zl + R, R + g, P, 3 * P / 2, 20), [R + 0.015, zl - g], [R + 0.015, zl + 0.003], ...arcYZ(R, zl + R, R - 0.003, 3 * P / 2, P, 20),
  ], ce + 0.012, W - ce - 0.012);
  kit.box(mat("slot", M.graphite), 0.03, R + 0.017, zl - 0.0008, W - 0.03, yb - 0.002, zl - 0.0002);   // жалюзи снизу
  kit.box(env.own(e), W * 0.82, -0.002, H * 0.45, W * 0.9, 0.003, H * 0.52, 0.004);          // индикатор
});

// бризер на стене: корпус — профиль сбоку, выдавленный по ширине, и съёмная передняя панель со скруглёнными углами.
// render.radius — скругление кромок корпуса, render.back_round = [по глубине, по высоте] — верхняя кромка у стены
// скруглена сильнее (дуга эллипса); цвета: body, front
fam("device.breezer", ({ kit, e, env, size: [W, D, H], mat, r }) => {
  const rad = r.radius ?? 0.04, [ea, eb] = r.back_round ?? [rad, rad], P = Math.PI, y0 = 0.02;
  kit.profileX(mat("body", M.white), [
    ...arcYZ(y0 + rad, rad, rad, P, 3 * P / 2, 6), ...arcYZ(D - rad, rad, rad, 3 * P / 2, 2 * P, 6),
    ...arcYZ(D - ea, H - eb, ea, 0, P / 2, 14, eb), ...arcYZ(y0 + rad, H - rad, rad, P / 2, P, 6),
  ], 0, W);
  kit.profileY(mat("front", pbr(0xeef0f2, { rough: 0.4 })), roundRectXZ(0.006, 0.006, W - 0.006, H - 0.006, Math.min(0.03, W / 4)), 0, 0.025);
  kit.box(env.own(e), W / 2 - 0.015, -0.002, 0.03, W / 2 + 0.015, 0.001, 0.045, 0.003);   // метка внизу по центру
  for (const x of [0.06, W - 0.18]) kit.box(M.graphite, x, 0.05, H - 0.001, x + 0.12, 0.062, H + 0.0005);   // щели на крыше
});

// лазерный МФУ: белый низ, тёмный сканер сверху, лоток
// render.band = [z0, z1] — тёмная полоса под сканером (доли высоты), render.slot = false — без щели выхода бумаги,
// render.tray — выдвинутая кассета внизу
fam("device.printer", ({ kit, size: [W, D, H], mat, r }) => {
  const [b0, b1] = r.band || [0.62, 0.72];
  kit.box(mat("body", M.white), 0, 0, 0, W, D, H * b0, 0.01);
  kit.box(mat("band", mat("body", M.white)), 0, 0, H * b0, W, D, H * b1, 0.004);       // полоса под сканером
  kit.box(mat("top", pbr(0x5a5f66, { rough: 0.5 })), 0, 0.02, H * b1, W, D, H, 0.01);
  if (r.slot !== false) kit.box(M.graphite, W * 0.12, -0.002, H * 0.45, W * 0.88, 0.02, H * 0.52);   // выход бумаги
  if (r.tray) kit.box(mat("body", M.white), W * 0.2, -0.03, 0.005, W * 0.98, 0.001, H * 0.17, 0.004);   // кассета
  if (r.panel !== false) kit.box(M.graphite, W * 0.62, -0.004, H * 0.6, W * 0.92, 0.01, H * 0.7, 0.004);   // панель
  const [a0, a1] = r.adf_x || [0.12, 0.88];                // render.adf_x — лоток автоподатчика по ширине
  if (r.colors?.adf) kit.box(mat("adf", M.graphite), W * a0, D * 0.3, H, W * a1, D - 0.02, H + 0.035, 0.008);   // лоток автоподатчика
});

// 3D-принтер в закрытом корпусе: чёрный короб с дверцей из тонированного стекла, крышка сверху,
// сбоку (render.spools, по умолчанию 4) — круглые боксы с катушками филамента
fam("device.printer_3d", ({ kit, size: [W, D, H], mat, r }) => {
  const n = r.spools ?? 4, sw = n ? r.spool_w ?? 0.13 : 0, bw = W - sw, body = mat("body", M.black), hb = H * 0.65;   // render.spool_w, spool_r
  kit.box(body, 0, 0, 0, bw, D, hb, 0.01);
  kit.box(pbr(0x1b1d20, { rough: 0.08, transparent: true, opacity: 0.85 }), 0.03, -0.004, H * 0.1, bw - 0.03, 0.01, hb - 0.03);   // дверца
  kit.box(pbr(0x17181a, { rough: 0.1, transparent: true, opacity: 0.92 }), 0.05, 0.05, hb, bw - 0.05, D - 0.04, H, 0.01);   // колпак
  const rr = r.spool_r ?? Math.min(0.11, D * 0.23);
  for (let i = 0; i < n; i++) {                            // барабаны: ось поперёк бока, плоской стороной наружу
    const cy = D * (i % 2 ? 0.73 : 0.24), cz = H * (i < 2 ? 0.17 : 0.45) + rr * 0.1;
    kit.rod(body, [bw + 0.004, cy, cz], [W - 0.004, cy, cz], rr, 32);
    kit.box(pbr(0xe8e8e8, { rough: 0.6 }), W - 0.004, cy - 0.015, cz + rr * 0.45, W + 0.0005, cy + 0.015, cz + rr * 0.62);   // метка
  }
});

// сушилка филамента на одну катушку: короб со скруглёнными рёбрами, крышка сверху, на фасаде сенсорный экранчик,
// тёмные окна на катушку — на широких сторонах (на фасаде, если он широкий); цвета: body, lid
fam("device.filament_dryer", ({ kit, size: [W, D, H], mat }) => {
  const glass = pbr(0x16181b, { rough: 0.1 });
  kit.box(mat("body", pbr(0x2e3033, { rough: 0.5 })), 0, 0, 0, W, D, H * 0.86, 0.012);
  kit.box(mat("lid", pbr(0x3a3d41, { rough: 0.45 })), 0.004, 0.004, H * 0.86 + 0.001, W - 0.004, D - 0.004, H, 0.012);
  if (W >= D) {
    kit.box(glass, W * 0.08, -0.0015, H * 0.14, W * 0.62, 0.001, H * 0.8, 0.01);
    kit.box(M.display, W * 0.7, -0.0015, H * 0.5, W * 0.92, 0.001, H * 0.72, 0.004);
    return;
  }
  kit.box(M.display, W * 0.15, -0.0015, H * 0.52, W * 0.85, 0.001, H * 0.74, 0.004);
  for (const x of [-0.0015, W - 0.001]) kit.box(glass, x, D * 0.12, H * 0.12, x + 0.0025, D * 0.88, H * 0.8, 0.01);
});

// системный блок: корпус, стеклянная боковина, подсвеченные вентиляторы спереди
fam("device.pc", ({ kit, size: [W, D, H], mat, r }) => {
  // render.fans = false — спереди глухо, подсветка (colors.fan_light) видна сквозь стеклянную боковину (сторона −X)
  if (r.fans === false) {
    const body = mat("body", M.black), c = hex(r.colors?.fan_light, 0xe07a2a);
    kit.box(body, 0.012, 0, 0, W, D, H, 0.006);
    kit.box(mat("mesh", pbr(0x2a2b2e, { rough: 0.85 })), 0.035, -0.002, 0.035, W - 0.025, 0.0005, H - 0.035, 0.003);   // сетка фасада
    for (const [y0, y1, z0, z1] of [[0, 0.03, 0, H], [D - 0.03, D, 0, H], [0.03, D - 0.03, 0, 0.03], [0.03, D - 0.03, H - 0.03, H]]) kit.box(body, 0, y0, z0, 0.012, y1, z1);
    kit.box(pbr(c, { emissive: c, emissiveIntensity: 0.8 }), 0.005, D * 0.35, H * 0.55, 0.0115, D * 0.6, H * 0.78, 0.003);   // водоблок СВО
    kit.box(pbr(0x3a6df0, { emissive: 0x3a6df0, emissiveIntensity: 0.6 }), 0.007, D * 0.15, H * 0.35, 0.0115, D * 0.85, H * 0.4);   // видеокарта
    kit.box(pbr(0x15171a, { rough: 0.05, metal: 0.3, transparent: true, opacity: 0.45, depthWrite: false }), -0.002, 0.03, 0.03, 0.003, D - 0.03, H - 0.03);
    return;
  }
  kit.box(mat("body", M.black), 0, 0, 0, W, D, H, 0.006);
  kit.box(pbr(0x15171a, { rough: 0.05, metal: 0.3 }), -0.002, 0.03, 0.04, 0.003, D - 0.03, H - 0.04);
  for (let i = 0; i < 3; i++) kit.rod(pbr(0x9fb6ff, { emissive: 0x6f8cff, emissiveIntensity: 0.6 }), [W / 2, 0.0, 0.12 + i * (H - 0.2) / 2.2], [W / 2, -0.003, 0.12 + i * (H - 0.2) / 2.2], Math.min(W, 0.12) * 0.42, 24);
});

// монитор на подставке; render.curved — изогнутый экран
fam("device.monitor", ({ kit, size: [W, D, H], mat, r }) => {
  const sh = r.screen_h ?? Math.min(H - 0.1, W * 0.42), z0 = H - sh, body = mat("body", M.black);   // render.screen_h
  const yn = Math.min(D - 0.03, 0.06);                     // стойка сразу за корпусом экрана, основание под ней
  kit.box(body, W / 2 - 0.12, Math.max(0, yn - 0.09), 0, W / 2 + 0.12, Math.min(D, yn + 0.12), 0.015, 0.006);   // основание
  kit.box(body, W / 2 - 0.03, yn, 0.01, W / 2 + 0.03, yn + 0.03, z0 + sh * 0.4);            // стойка
  const n = r.curved ? 28 : 1, R = Math.max(1.5, 2.2 * W), a = r.curved ? 2 * Math.asin(W / 2 / R) / n : 0;
  const scr = r.curved ? pbr(0x0d0f12, { rough: 0.6 }) : M.screen;
  // корпус на 1,3 см за экраном: ближе грани мерцают вместе (z-fighting) — экран шёл полосами
  for (let i = 0; i < n; i++) {
    const w = n === 1 ? W : 2 * R * Math.sin(a / 2) + 0.002, ang = (i - (n - 1) / 2) * a;
    const m = new THREE.Matrix4().makeTranslation(W / 2, -R, 0).multiply(new THREE.Matrix4().makeRotationZ(-ang))   // центр дуги перед экраном:
      .multiply(new THREE.Matrix4().makeTranslation(-W / 2, R, 0));                                              // края к зрителю
    kit.at(m, () => {
      kit.box(body, W / 2 - w / 2, 0.03, z0, W / 2 + w / 2, 0.06, H);
      if (n === 1) kit.box(scr, 0.008, 0.017, z0 + 0.012, W - 0.008, 0.03, H - 0.008);
    });
  }
  if (r.curved) {                                          // изогнутый экран — одна гладкая поверхность по дуге
    const th = 2 * Math.asin((W - 0.016) / 2 / R), rho = R + 0.017, N = 32;
    const row = z => Array.from({ length: N + 1 }, (_, j) => {
      const t = -th / 2 + th * j / N;
      return [W / 2 + rho * Math.sin(t), -R + rho * Math.cos(t), z];
    });
    kit.grid(scr, [row(z0 + 0.012), row(H - 0.008)]);
  }
});

// настольная лампа на шарнирной стойке; плафон светится, когда лампа горит
fam("device.lamp", ({ kit, e, env, size, mat, r }) => {
  const [W, D, H] = size || [0.2, 0.2, 0.45], b = mat("body", M.black);
  const off = size ? [0, 0] : [-W / 2, -D / 2];
  if (r.shape === "stick") {                               // тонкая прямая стойка, сверху загиб и маленькая головка
    kit.move(off[0], off[1], 0, () => {
      kit.cylZ(b, W / 2, D / 2, 0, 0.012, 0.05, 24);
      kit.cylZ(b, W / 2, D / 2, 0.012, H - 0.05, 0.007, 10);
      kit.tube(b, [[W / 2, D / 2, H - 0.05], [W / 2, D / 2 - 0.02, H - 0.012], [W / 2, D / 2 - 0.06, H - 0.01]], 0.007, 8);
      kit.rod(mat("head", M.graphite), [W / 2, D / 2 - 0.06, H - 0.01], [W / 2, D / 2 - 0.1, H - 0.02], 0.02, 16);
      kit.disc(env.own(e), W / 2, D / 2 - 0.08, H - 0.031, 0.014, 0.003, 16);
    });
    return;
  }
  kit.move(off[0], off[1], 0, () => {
    kit.cylZ(b, W / 2, D / 2, 0, 0.02, 0.07, 24);
    kit.rod(b, [W / 2, D / 2, 0.02], [W / 2, D / 2 + 0.06, H * 0.6], 0.008, 8);
    kit.rod(b, [W / 2, D / 2 + 0.06, H * 0.6], [W / 2, D / 2 - 0.1, H - 0.04], 0.008, 8);
    kit.rod(b, [W / 2, D / 2 - 0.1, H - 0.04], [W / 2, D / 2 - 0.16, H - 0.12], 0.05, 20, 0.015);
    kit.disc(env.own(e), W / 2, D / 2 - 0.165, H - 0.125, 0.045, 0.004, 20);
  });
}, FREE);

// усечённый клин: нижний прямоугольник [x0, y0, x1, y1] на высоте z0, верхний — на z1; все грани плоские
function frustum(kit, m, [a0, f0, a1, k0], z0, [b0, f1, b1, k1], z1) {
  const B = [[a0, f0, z0], [a1, f0, z0], [a1, k0, z0], [a0, k0, z0]], T = [[b0, f1, z1], [b1, f1, z1], [b1, k1, z1], [b0, k1, z1]];
  const quad = (p, q, s, t) => [p, q, s, p, s, t];
  kit.tris(m, [...quad(...B), ...quad(...T), ...[0, 1, 2, 3].flatMap(i => quad(B[i], B[(i + 1) % 4], T[(i + 1) % 4], T[i]))]);
}

// антенна-лопасть: пятигранное сечение w × t с ребром к фасаду (−Y), сверху остриё высотой tip
function blade(kit, m, cx, cy, z0, z1, w, t, tip, tipM = m) {
  const sec = [[0, -t / 2], [w / 2, -t / 8], [w * 0.4, t / 2], [-w * 0.4, t / 2], [-w / 2, -t / 8]].map(([x, y]) => [cx + x, cy + y]);
  kit.prism(m, sec, z0, z1);
  const apex = [cx, cy - t / 6, z1 + tip];
  kit.tris(tipM, sec.flatMap(([x, y], i) => [[x, y, z1], [...sec[(i + 1) % sec.length], z1], apex]));
}

// роутер-клин (Xiaomi BE7000): длинный корпус трапецией и в сечении, и по длине; внизу юбка из рёбер, сверху узкий
// гребень с медной полосой; на передней грани индикаторы, надпись и метка NFC; средние антенны-лопасти за гребнем,
// крайние — по торцам юбки. Доли — по фото изделия 408 × 133 × 177 мм
function wedgeRouter(kit, W, D, H, r, mat) {
  const body = mat("body", pbr(0x33363b, { rough: 0.42, metal: 0.25 })), base = mat("base", pbr(0x1b1c1f, { rough: 0.6 }));
  const accent = mat("accent", M.copper), light = pbr(0xc9cbce, { rough: 0.4 });
  const zb = H * 0.113, zt = H * 0.42, e = W * 0.033, sk = W * 0.025, ft = D * 0.33, bt = D * 0.66;
  kit.box(base, sk + 0.004, 0.012, 0, W - sk - 0.004, D - 0.012, 0.004);                        // опорная планка
  kit.box(base, sk + 0.003, 0.006, 0.004, W - sk - 0.003, D - 0.006, zb - 0.0005);            // сердцевина юбки
  for (let i = 0; i < 3; i++) {                                                               // рёбра юбки
    const z = 0.006 + i * (zb - 0.008) / 3;
    kit.box(body, sk, 0.001, z, W - sk, D - 0.001, z + 0.0025);
  }
  frustum(kit, body, [e, 0.004, W - e, D - 0.004], zb, [W * 0.069, ft, W * 0.931, bt], zt);
  kit.box(accent, W * 0.09, ft + 0.0015, zt - 0.0004, W * 0.91, ft + 0.0045, zt + 0.0006);    // медная полоса гребня
  // передняя грань: начало координат у её нижнего края по центру, z — вверх вдоль грани, −y — наружу
  const L = Math.hypot(ft - 0.004, zt - zb);
  const face = new THREE.Matrix4().makeTranslation(W / 2, 0.004, zb).multiply(new THREE.Matrix4().makeRotationX(-Math.atan2(ft - 0.004, zt - zb)));
  kit.at(face, () => {
    kit.box(light, -0.001, -0.0006, 0.42 * L, 0.001, 0.0004, 0.72 * L);                       // вертикальный штрих
    for (const t of [0.44, 0.72]) kit.box(M.led, -0.0154, -0.0006, t * L - 0.0009, -0.0058, 0.0004, t * L + 0.0009);   // индикаторы
    kit.box(accent, W * 0.24, -0.0006, 0.09 * L, W * 0.385, 0.0004, 0.12 * L);                // надпись Xiaomi
    const [n0, n1, m0, m1, b] = [W * 0.3, W * 0.395, 0.62 * L, 0.74 * L, 0.0007];          // метка NFC — рамкой
    for (const [x0, z0, x1, z1] of [[n0, m0, n1, m0 + b], [n0, m1 - b, n1, m1], [n0, m0, n0 + b, m1], [n1 - b, m0, n1, m1]]) {
      kit.box(light, x0, -0.0005, z0, x1, 0.0004, z1);
    }
  });
  // антенны: средние за гребнем (по фото ±0,205 и ±0,372 длины от центра), крайние — вертикально у торцов юбки
  const n = r.antennas ?? 5, w = W * 0.0485, t = D * 0.09, tip = H * 0.045;
  const xs = n === 5 ? [-0.372, -0.205, 0, 0.205, 0.372] : Array.from({ length: n }, (_, i) => n > 1 ? -0.372 + i * 0.744 / (n - 1) : 0);
  xs.forEach(f => blade(kit, body, W / 2 + f * W, bt + t / 2, zt - 0.03, H - tip, w, t, tip, f === 0 ? M.led : body));
  for (const x of [W * 0.0168, W * 0.9832]) blade(kit, body, x, D * 0.55, H * 0.054, H * 0.96 - tip * 0.6, W * 0.0336, t, tip * 0.6);
}

// роутер: плоский корпус и антенны; render.style "tower" — узел Mesh башенкой без антенн: решётка сверху,
// индикатор спереди внизу; "wedge" — корпус-клин с антеннами-лопастями (wedgeRouter)
fam("device.router", ({ kit, size, r, mat }) => {   // render.antennas — число антенн
  const [W, D, H] = size || (r.style === "wedge" ? [0.408, 0.133, 0.177] : [0.28, 0.15, 0.2]);
  const off = size ? [0, 0] : [-W / 2, -D / 2];
  kit.move(off[0], off[1], 0, () => {
    if (r.style === "wedge") { wedgeRouter(kit, W, D, H, r, mat); return; }
    if (r.style === "tower") {
      kit.box(M.black, 0, 0, 0, W, D, H, Math.min(W, D) * 0.16);
      kit.box(M.graphite, W * 0.2, D * 0.2, H - 0.001, W * 0.8, D * 0.8, H + 0.0015, 0.004);
      kit.box(M.led, W / 2 - 0.003, -0.0008, 0.03, W / 2 + 0.003, 0.002, 0.036, 0.001);
      return;
    }
    kit.box(M.black, 0, 0.02, 0, W, D, 0.045, 0.01);
    const n = r.antenna_x?.length ?? r.antennas ?? 6;       // render.antenna_x — места антенн вдоль корпуса
    for (let i = 0; i < n; i++) {
      const x = r.antenna_x ? r.antenna_x[i] : 0.02 + i * (W - 0.04) / (n - 1);
      kit.box(M.black, x - 0.006, D - 0.024, 0.04, x + 0.006, D - 0.012, H, 0.004);
    }
  });
}, FREE);

// умная колонка: цилиндр в ткани, сверху кольцо подсветки
// render.shape: "cube" — кубик в ткани с часами спереди, "screen" — станция с наклонным экраном, "duo" — колонка в
// ткани и над ней на шарнире широкий экран альбомом (Яндекс Станция Дуо Макс; опущенный, он прикрывает верх
// передней стенки колонки; render.tilt — наклон экрана назад, градусы), иначе цилиндр
fam("device.speaker", ({ kit, e, env, size, mat, r }) => {
  const [W, D, H] = size || [0.14, 0.14, 0.2];
  const off = size ? [0, 0] : [-W / 2, -D / 2], body = mat("body", matte(0x3b3f45), "fabric");
  kit.move(off[0], off[1], 0, () => {
    if (r.shape === "duo") {
      const hb = H * 0.46, sh = Math.min(W * 0.66, H * 0.72), t = 0.011;   // колонка, экран 16:10 с рамкой
      kit.box(body, 0.004, D * 0.12, 0, W - 0.004, D, hb, 0.025);
      kit.box(M.graphite, W / 2 - 0.03, D * 0.5, hb - 0.01, W / 2 + 0.03, D * 0.72, hb + 0.03, 0.01);     // шарнир
      const zb = H - sh * Math.cos(THREE.MathUtils.degToRad(r.tilt ?? 12));
      const m = new THREE.Matrix4().makeTranslation(0, D * 0.04, zb).multiply(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(-(r.tilt ?? 12))));
      kit.at(m, () => {
        kit.box(M.black, 0, 0, 0, W, t, sh, 0.008);
        kit.box(env.own(e), 0.012, -0.0008, 0.012, W - 0.012, 0.001, sh - 0.012);
      });
      return;
    }
    if (r.shape === "cube") {
      kit.box(body, 0, 0, 0, W, D, H, 0.02);
      kit.box(mat("top", body), 0.016, 0.016, H - 0.004, W - 0.016, D - 0.016, H + 0.001, 0.006);   // верх вровень, по плоской части
      kit.box(env.own(e), W * 0.25, -0.002, H * 0.4, W * 0.75, 0.001, H * 0.6, 0.003);
    } else if (r.shape === "screen") {                      // низкая подставка, перед ней наклонный экран на всю высоту
      kit.box(body, 0, D * 0.45, 0, W, D, H * 0.3, 0.02);
      const m = new THREE.Matrix4().makeTranslation(0, D * 0.45, 0).multiply(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(-18)))
        .multiply(new THREE.Matrix4().makeTranslation(0, -D * 0.45, 0));
      kit.at(m, () => {
        kit.box(M.black, 0, D * 0.35, 0.01, W, D * 0.45, H, 0.008);
        kit.box(env.own(e), 0.01, D * 0.345, 0.02, W - 0.01, D * 0.35, H - 0.015);
      });
    } else {
      kit.cylZ(body, W / 2, D / 2, 0, H - 0.01, Math.min(W, D) / 2, 32);
      kit.cylZ(env.own(e), W / 2, D / 2, H - 0.01, H, Math.min(W, D) / 2 - 0.01, 32);
    }
  });
}, FREE);

// светодиодная подсветка под шкафами: render.strips — полосы [x0, y0, z0, x1, y1, z1] в системе прибора;
// светится, когда свет включён (свой материал прибора)
fam("device.backlight", ({ kit, e, env, r }) => {
  for (const [x0, y0, z0, x1, y1, z1] of r.strips || []) kit.box(env.own(e), x0, y0, z0, x1, y1, z1);
}, FREE);

// ИБП, лежанка питомца, напольные весы
fam("device.ups", ({ kit, size: [W, D, H], mat, r }) => {   // render.display = false — без экранчика
  kit.box(mat("body", M.black), 0, 0, 0, W, D, H, 0.01);
  if (r.display !== false) kit.box(M.display, W * 0.3, -0.002, H * 0.75, W * 0.7, 0.001, H * 0.85);
});
// лежанка: подушка на канте (render.rim_w — ширина канта) или render.bolster — толстый мягкий бортик по кругу
// (ширина render.rim_w, ≈0,1) и низкая подушка внутри; цвета: body (подушка), rim (кант, бортик)
fam("furniture.pet_bed", ({ kit, size: [W, D, H], mat, r }) => {
  const h = Math.max(H, 0.06), rim = mat("rim", pbr(0x8f9086, { rough: 0.95 }), "fabric"), body = mat("body", matte(0xd8b13a), "fabric");
  if (r.bolster) {
    const b = r.rim_w ?? 0.1, rr = Math.min(b, h) / 2 - 0.004;
    kit.box(rim, 0, 0, 0, W, b, h, rr);
    kit.box(rim, 0, D - b, 0, W, D, h, rr);
    kit.box(rim, 0, b * 0.5, 0, b, D - b * 0.5, h, rr);
    kit.box(rim, W - b, b * 0.5, 0, W, D - b * 0.5, h, rr);
    kit.box(body, b - 0.02, b - 0.02, 0, W - b + 0.02, D - b + 0.02, h * 0.45, 0.03);
    return;
  }
  if (r.rim_w != null) {                                   // мягкая подушка, по нижней кромке тонкий кант
    kit.box(rim, 0, 0, 0, W, D, 0.012, 0.005);
    kit.box(body, r.rim_w, r.rim_w, 0.004, W - r.rim_w, D - r.rim_w, h + 0.01, Math.min(0.05, h / 2 - 0.005));
    return;
  }
  kit.box(rim, 0, 0, 0, W, D, h, 0.03);
  kit.box(body, 0.05, 0.05, 0.02, W - 0.05, D - 0.05, h + 0.01, 0.03);
});
fam("furniture.scale", ({ kit, size: [W, D, H] }) => {
  kit.box(pbr(0xf2f2f0, { rough: 0.1 }), 0, 0, 0, W, D, Math.max(H, 0.02), 0.02);
  const z = Math.max(H, 0.02), el = pbr(0xa8a8a8, { rough: 0.5 });
  for (const [x, y] of [[0.055, 0.055], [W - 0.055, 0.055], [0.055, D - 0.055], [W - 0.055, D - 0.055]]) kit.disc(el, x, y, z, 0.025, 0.001, 24);
});

// ═══ потолочные светильники (у устройства света без коробки) ════════════════
// вид — props.render.fixture: "cross" (четыре светодиодные планки), "ring" (спираль из колец), "disc" (плоский
// круглый), иначе плафон. Строится от потолка вниз, glow — светящаяся часть (свой материал устройства).
// size — длина планок решётки, размах лучей, диаметр диска или колец; opt.tilt — наклон внешнего кольца, °;
// opt.drop — на сколько светильник висит ниже обычного; opt.rays = [[угол°, длина], …] — лучи по месту
export function fixture(kit, kind, glow, angle = 20, size = null, opt = {}) {
  const dz = opt.drop ?? 0;
  if (kind === "cross" || kind === "grid") {                // решётка «#» из двух пар планок
    const h = (size ?? 0.68) / 2, zb = -0.05 - dz, sp = opt.spacing ?? 0.06, hub = pbr(0xd8d9db, { rough: 0.4, metal: 0.3 });
    if (dz) {                                              // корпус — плоская тёмная рамка у потолка, планки висят ниже
      const fr = pbr(0x4a4d52, { rough: 0.5, metal: 0.3 });
      kit.at(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(angle)), () => {
        for (const [x0, y0, x1, y1] of [[-0.055, -0.055, 0.055, -0.04], [-0.055, 0.04, 0.055, 0.055], [-0.055, -0.04, -0.04, 0.04], [0.04, -0.04, 0.055, 0.04]])
          kit.box(fr, x0, y0, -0.05, x1, y1, -0.03, 0.003);
      });
      kit.cylZ(hub, 0, 0, -0.03, 0, 0.012, 12);
    } else kit.cylZ(hub, 0, 0, -0.04, 0, 0.06, 24);
    const st = opt.stagger ?? 0;                           // opt.stagger — планки пары сдвинуты вдоль длины в разные стороны
    for (const [a, off] of [[angle, sp], [angle, -sp], [angle + 90, sp], [angle + 90, -sp]]) {   // opt.spacing — полушаг пар
      const r = THREE.MathUtils.degToRad(a), c = Math.cos(r), s = Math.sin(r), sh = off > 0 ? -st : st, nx = -s * off + c * sh, ny = c * off + s * sh;
      kit.rod(M.white, [nx - c * h, ny - s * h, zb], [nx + c * h, ny + s * h, zb], 0.014, 8);
      // свечение — под планкой, не пересекаясь с ней (иначе грани мерцают крапинками)
      kit.rod(glow, [nx - c * (h - 0.01), ny - s * (h - 0.01), zb - 0.019], [nx + c * (h - 0.01), ny + s * (h - 0.01), zb - 0.019], 0.005, 8);
    }
  } else if (kind === "rays") {                           // лучи: планки разной длины из центра, торцы золотистые
    kit.cylZ(M.brass, 0, 0, -0.04, 0, 0.05, 24);
    const gold = pbr(0xb08a4a, { rough: 0.35, metal: 0.8 }), R = (size ?? 1.0) / 2;
    const rays = opt.rays || Array.from({ length: 8 }, (_, i) => [angle + i * 45 + (i % 2) * 8, (i % 2 ? 0.72 : 1) * R]);
    rays.forEach(([deg, len], i) => {
      const a = THREE.MathUtils.degToRad(deg), c = Math.cos(a), s = Math.sin(a);
      kit.rod(glow, [c * 0.04, s * 0.04, -0.035], [c * len, s * len, -0.035 - (i % 3) * 0.01], 0.011, 8);
      kit.sphere(gold, c * len, s * len, -0.035 - (i % 3) * 0.01, 0.012, 10);
    });
  } else if (kind === "ring") {                           // size — внешний диаметр колец
    const R = (size ?? 0.63) / 2 - 0.012, disc = pbr(0x8a8d91, { rough: 0.45, metal: 0.1 });
    kit.cylZ(disc, 0, 0, -0.033 - dz, -0.018 - dz, Math.min(0.083, R * 0.37), 32);       // тонкий диск
    if (dz) kit.cylZ(M.brushed, 0, 0, -0.018 - dz, 0, 0.015, 16);                       // стойка к потолку
    const ribbon = (rr, z, dx, tilt, t = 0.008, k = 2.2) => {   // лента: тор, вытянутый по высоте; внутренняя кромка светится
      const m = new THREE.Matrix4().makeTranslation(dx, 0, z).multiply(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(tilt)))
        .multiply(new THREE.Matrix4().makeScale(1, 1, k));
      kit.at(m, () => {
        kit.torus(M.brushed, 0, 0, 0, rr, t, 72);
        kit.torus(glow, 0, 0, 0, rr - t * 0.75, t * 0.62, 72);
      });
    };
    ribbon(R * 0.64, -0.035 - dz, 0, 5);
    if (opt.tilt != null) ribbon(R, -0.085 - dz, 0.02, opt.tilt, 0.006, 2.1);   // плоская лента 12 × 25 мм
    else ribbon(R, -0.085 - dz, 0.02, 13);
  } else if (kind === "disc") {
    const R = (size ?? 0.44) / 2;
    kit.cylZ(M.white, 0, 0, -0.04, 0, R, 48);
    kit.cylZ(glow, 0, 0, -0.045, -0.039, R - 0.006, 48);   // рассеиватель почти во весь диаметр
  } else {
    kit.cylZ(M.white, 0, 0, -0.025, 0, 0.21, 40);
    kit.lathe(glow, [[0.2, -0.025], [0.205, -0.045], [0.17, -0.085], [0.0, -0.095]], 0, 0, 40);
  }
}


// кабель-канал на стене: узкий короб цвета стены
fam("mep.cable_channel", ({ kit, size: [W, D, H], mat }) => { kit.box(mat("body", M.white), 0, 0, 0, W, D, H, 0.003); });
