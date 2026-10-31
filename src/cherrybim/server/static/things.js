// Cherry BiM — вещи с габаритами (учёт вещей и обстановка): чайник, чемодан, увлажнитель, стремянка, швейная
// машина, перфоратор в кейсе, сковорода, контейнер с крышкой; для уборки и глажки — пылесос на настенной станции,
// отпариватель, швабра, совок с веником, ведро, таз; сантехнические выводы, короб для труб, умный замок. Те же
// соглашения, что в families.js: метры, Z вверх, коробка от угла по +X +Y +Z, фасад — сторона −Y; подсказки —
// props.render.
import { roundRect } from "./kit.js";
import { M, pbr } from "./materials.js";
import { fam, FREE } from "./families.js";

const BOTH = 2;                                            // THREE.DoubleSide: тонкая оболочка видна с обеих сторон

// ═══ кухня ═══════════════════════════════════════════════════════════════════
// электрочайник: круглая подставка, стеклянная колба шире книзу, обод и крышка, ручка-скоба сзади (+Y), носик
// спереди (−Y). Ширина — диаметр подставки; цвета base (подставка и низ колбы), lid (обод и крышка), handle, glass
fam("item.kettle", ({ kit, size: [W, D, H], mat }) => {
  const base = mat("base", M.black), lid = mat("lid", pbr(0xb8bcc0, { rough: 0.35, metal: 0.7 }), "metal");
  const handle = mat("handle", M.black), glass = mat("glass", pbr(0xd4dde0, { rough: 0.05, transparent: true, opacity: 0.32,
    depthWrite: false, side: BOTH }));
  const R = W / 2, spout = Math.min(0.03, D - W) * 0.4, cx = W / 2, cy = spout + R, top = H - 0.03;
  kit.cylZ(base, cx, cy, 0, 0.02, R, 40);                  // подставка
  kit.cylZ(base, cx, cy, 0.02, 0.05, R * 0.94, 40, R * 0.92);   // низ колбы с нагревателем
  kit.lathe(glass, [[R * 0.92, 0.05], [R * 0.9, 0.09], [R * 0.82, top - 0.05], [R * 0.76, top]], cx, cy, 40);
  kit.lathe(lid, [[R * 0.77, top - 0.004], [R * 0.78, top + 0.012], [R * 0.66, H - 0.008], [R * 0.2, H], [0, H]], cx, cy, 40);
  // носик: клин из колбы вперёд и чуть вверх
  kit.rod(glass, [cx, cy - R * 0.62, top - 0.04], [cx, 0.003, top - 0.006], 0.016, 16, 0.008);
  // ручка-скоба: от обода назад и вниз к нижнему кольцу
  kit.tube(handle, [[cx, cy + R * 0.7, top - 0.002], [cx, D - 0.012, top - 0.02], [cx, D - 0.01, 0.09],
    [cx, cy + R * 0.86, 0.062]], 0.011, 10);
});

// сковорода: чаша (диаметр — глубина коробки) и длинная ручка вдоль +X; цвета body (снаружи), inside (покрытие), handle
fam("item.frying_pan", ({ kit, size: [W, D, H], mat }) => {
  const out = mat("body", pbr(0x1d1d1f, { rough: 0.7, side: BOTH })), inside = mat("inside", pbr(0x34353a, { rough: 0.55 }));
  const R = D / 2, rb = R * 0.82, h = Math.min(H, 0.07);
  kit.cylZ(out, R, R, 0, 0.005, rb, 48);
  kit.lathe(out, [[rb, 0.004], [R * 0.95, h * 0.75], [R, h]], R, R, 48);
  kit.cylZ(inside, R, R, 0.005, 0.0065, rb - 0.003, 48);
  kit.rod(mat("handle", M.black), [2 * R - 0.012, R, h * 0.82], [W - 0.004, R, Math.min(H, h + 0.03)], 0.013, 14, 0.011);
});

// ═══ дом и хозяйство ═════════════════════════════════════════════════════════
// чемодан стоя: жёсткий корпус со скруглёнными рёбрами, шов-молния вокруг, 4 сдвоенных колеса, сверху ручка и
// убранная телескопическая ручка у задней стенки. render.ribs: "diagonal" — косые рёбра по лицу, "horizontal" —
// горизонтальные уступы; rib_count; wheels — высота колёс. Цвета body, ribs, wheels, handle, grip
fam("item.suitcase", ({ kit, size: [W, D, H], mat, r }) => {
  const body = mat("body", pbr(0x6f6a64, { rough: 0.4 })), ribs = mat("ribs", body);
  const wheel = mat("wheels", M.rubber), handle = mat("handle", M.brushed, "metal"), grip = mat("grip", M.black);
  const wh = r.wheels ?? 0.07, z0 = wh, z1 = H - 0.016, rr = Math.min(0.04, D / 5);
  kit.box(body, 0, 0, z0, W, D, z1, rr);
  const ys = D * 0.56;                                    // шов: передняя половина глубже задней
  kit.profileY(pbr(0x2b2b2d, { rough: 0.7 }), roundRect(-0.0015, z0 - 0.0015, W + 0.0015, z1 + 0.0015, rr + 0.0015), ys - 0.003, ys + 0.003);
  const n = r.rib_count ?? 7, m = 0.045;
  if (r.ribs === "horizontal") {                          // горизонтальные уступы по лицу
    for (let i = 1; i <= n; i++) {
      const z = z0 + (z1 - z0) * i / (n + 1);
      kit.box(ribs, m, -0.007, z - 0.009, W - m, 0.002, z + 0.009, 0.004);
    }
  } else if (r.ribs !== false) {                          // косые рёбра: прямые z = z0 + k·(x − c), обрезанные лицом
    const k = 1.6, u0 = m, u1 = W - m, v0 = z0 + m, v1 = z1 - m, span = (v1 - v0) + k * (u1 - u0);
    for (let i = 1; i <= n; i++) {
      const c = v0 - k * (u1 - u0) + span * i / (n + 1);   // где ребро пересекло бы x = u0
      const pts = [];
      for (const u of [u0, u1]) { const v = c + k * (u - u0); if (v >= v0 && v <= v1) pts.push([u, v]); }
      for (const v of [v0, v1]) { const u = u0 + (v - c) / k; if (u > u0 && u < u1) pts.push([u, v]); }
      if (pts.length >= 2) kit.rod(ribs, [pts[0][0], -0.002, pts[0][1]], [pts[1][0], -0.002, pts[1][1]], 0.007, 10);
    }
  }
  for (const x of [0.05, W - 0.05]) for (const y of [0.05, D - 0.05]) {   // колёса: корпус и две шины
    kit.box(pbr(0x2b2b2d, { rough: 0.6 }), x - 0.028, y - 0.022, wh * 0.55, x + 0.028, y + 0.022, z0 + 0.004, 0.008);
    for (const dx of [-0.012, 0.012]) kit.rod(wheel, [x + dx - 0.005, y, wh * 0.42], [x + dx + 0.005, y, wh * 0.42], wh * 0.42, 18);
  }
  kit.box(grip, W * 0.36, D * 0.3, z1 - 0.004, W * 0.64, D * 0.48, H, 0.006);   // ручка сверху
  for (const x of [W * 0.2, W * 0.8]) kit.box(handle, x - 0.012, D - 0.052, z1 - 0.004, x + 0.012, D - 0.028, H - 0.004, 0.004);
  kit.box(grip, W * 0.2 - 0.014, D - 0.054, H - 0.012, W * 0.8 + 0.014, D - 0.026, H, 0.006);   // телескопическая, убрана
});

// увлажнитель-колонна: скруглённый корпус, сверху круглая решётка, экранчик спереди вверху, перфорация по бокам,
// прорезь спереди внизу; цвета body, grille
fam("item.humidifier", ({ kit, size: [W, D, H], mat }) => {
  const body = mat("body", M.white), grille = mat("grille", pbr(0xc9b083, { rough: 0.45, metal: 0.4 }), "metal");
  const dark = pbr(0x8f8f8c, { rough: 0.8 }), rr = Math.min(W, D) * 0.16, R = Math.min(W, D) * 0.4;
  kit.box(body, 0, 0, 0, W, D, H, rr);
  kit.cylZ(grille, W / 2, D / 2, H - 0.003, H + 0.0015, R, 48);
  for (let i = 1; i <= 4; i++) kit.torus(dark, W / 2, D / 2, H + 0.0015, R * i / 5, 0.0018, 48);
  kit.box(M.display, W * 0.3, -0.002, H * 0.84, W * 0.7, 0.001, H * 0.92, 0.004);
  kit.box(dark, W * 0.46, -0.0015, H * 0.06, W * 0.54, 0.001, H * 0.36, 0.003);
  for (let i = 0; i < 7; i++) {                           // перфорация в верхней части боков
    const z = H * (0.62 + i * 0.04);
    for (const [x0, x1] of [[-0.0015, 0.001], [W - 0.001, W + 0.0015]]) kit.box(dark, x0, D * 0.25, z, x1, D * 0.75, z + 0.006);
  }
});

// стремянка, сложенная у стены: спереди (−Y) тетивы со ступенями, за ними опоры, над площадкой U-образная дуга;
// render.steps — ступеней под площадкой, platform — высота площадки; цвета rails, caps (заглушки и ножки)
fam("item.stepladder", ({ kit, size: [W, D, H], mat, r }) => {
  const al = mat("rails", M.brushed, "metal"), cap = mat("caps", pbr(0x2457b5, { rough: 0.5 }));
  const n = r.steps ?? 4, zp = r.platform ?? Math.min(1.05, H * 0.62), rw = 0.024, sd = Math.min(0.08, D - 0.015);
  for (const x of [0, W - rw]) {
    kit.box(al, x, 0, 0.03, x + rw, 0.05, zp + 0.02, 0.003);   // тетивы
    kit.box(cap, x - 0.002, -0.002, 0, x + rw + 0.002, 0.052, 0.03, 0.004);
    kit.box(al, x + 0.004, D - 0.016, 0.03, x + rw - 0.004, D, zp - 0.05, 0.003);   // опоры
    kit.box(cap, x + 0.002, D - 0.018, 0, x + rw - 0.002, D, 0.03, 0.004);
  }
  for (let i = 1; i <= n; i++) {
    const z = zp * i / (n + 1);
    kit.box(al, rw, 0, z - 0.014, W - rw, sd, z, 0.002);
    for (const x of [rw - 0.004, W - rw]) kit.box(cap, x, sd - 0.012, z - 0.018, x + 0.004, sd, z + 0.004);
  }
  kit.box(al, rw, 0, zp - 0.02, W - rw, sd, zp + 0.02, 0.003);   // площадка сложена между рамами
  kit.box(pbr(0xc8302c, { rough: 0.5 }), 0.003, -0.0015, zp - 0.2, rw - 0.003, 0.001, zp - 0.12);   // наклейка
  kit.tube(al, [[rw / 2, 0.025, zp], [rw / 2, 0.025, H - 0.06], [rw * 1.5, 0.025, H - 0.012], [W / 2, 0.025, H - 0.012],
    [W - rw * 1.5, 0.025, H - 0.012], [W - rw / 2, 0.025, H - 0.06], [W - rw / 2, 0.025, zp]], 0.012, 12);
});

// швейная машина: платформа, стойка справа (+X) с маховиком, рукав, голова слева с иглой и лапкой, три ручки на
// рукаве спереди; цвета body, accent (верх рукава и полоса платформы), knobs. render.cover — в мягком чехле: тканевый
// короб цвета cover, сверху торчит ручка машины
fam("item.sewing_machine", ({ kit, size: [W, D, H], mat, r }) => {
  if (r.cover) {
    const cover = mat("cover", pbr(0x1d1e20, { rough: 0.95 }), "fabric");
    kit.box(cover, 0, 0, 0, W, D, H - 0.03, 0.03);
    kit.box(pbr(0x141516, { rough: 0.95 }), W * 0.08, -0.002, H * 0.3, W * 0.92, 0.001, H * 0.62, 0.01);   // карман
    kit.box(mat("body", M.white), W * 0.3, D * 0.42, H - 0.035, W * 0.7, D * 0.58, H, 0.008);              // ручка машины
    return;
  }
  const body = mat("body", M.white), acc = mat("accent", pbr(0xcf3a74, { rough: 0.45 })), knob = mat("knobs", acc);
  const bh = H * 0.27, fd = D * 0.1;
  kit.box(body, 0, fd, 0, W, D, bh, 0.012);                // платформа
  kit.box(body, 0.015, 0, 0.004, W * 0.58, fd + 0.01, bh * 0.82, 0.01);   // съёмный столик рукавной платформы
  kit.box(acc, W * 0.6, fd - 0.0015, bh * 0.3, W - 0.02, fd + 0.001, bh * 0.8, 0.004);
  kit.box(body, W * 0.7, D * 0.24, bh - 0.01, W - 0.024, D * 0.9, H * 0.86, 0.02);   // стойка
  kit.box(body, 0.02, D * 0.3, H * 0.66, W - 0.03, D * 0.86, H * 0.95, 0.03);        // рукав
  kit.box(acc, 0.03, D * 0.32, H * 0.95 - 0.006, W - 0.04, D * 0.84, H, 0.02);
  kit.box(body, 0, D * 0.24, H * 0.44, W * 0.2, D * 0.9, H * 0.97, 0.025);           // голова
  kit.rod(M.chrome, [W * 0.09, D * 0.4, H * 0.44], [W * 0.09, D * 0.4, bh + 0.02], 0.004, 8);
  kit.box(M.chrome, W * 0.06, D * 0.33, bh + 0.003, W * 0.13, D * 0.48, bh + 0.011);
  kit.rod(body, [W - 0.024, D * 0.56, H * 0.72], [W, D * 0.56, H * 0.72], H * 0.14, 32);   // маховик
  for (const u of [0.42, 0.53, 0.64]) kit.rod(knob, [W * u, D * 0.3, H * 0.8], [W * u, D * 0.3 - 0.014, H * 0.8], 0.016, 20);
});

// перфоратор: в кейсе (по умолчанию) — пластиковый кейс лежит, ручка на длинной стороне спереди, два замка, рёбра
// по крышке; render.case = false — сам инструмент лежит на боку. Цвета body (кейс или корпус), accent, latches
fam("item.hammer_drill", ({ kit, size: [W, D, H], mat, r }) => {
  if (r.case !== false) {
    const body = mat("body", pbr(0x1c1c1e, { rough: 0.55 })), latch = mat("latches", M.graphite);
    kit.box(body, 0, 0, 0, W, D, H, 0.012);
    kit.box(pbr(0x111112, { rough: 0.6 }), -0.0015, -0.0015, H * 0.52, W + 0.0015, D + 0.0015, H * 0.56, 0.01);   // шов крышки
    for (const y of [D * 0.25, D * 0.5, D * 0.75]) kit.box(body, W * 0.1, y - 0.006, H, W * 0.9, y + 0.006, H + 0.004, 0.003);
    kit.box(body, W * 0.38, -0.028, H * 0.3, W * 0.62, -0.012, H * 0.62, 0.006);   // ручка
    for (const x of [W * 0.38, W * 0.62 - 0.012]) kit.box(body, x, -0.016, H * 0.3, x + 0.012, 0.001, H * 0.62, 0.003);
    for (const x of [W * 0.16, W * 0.84]) kit.box(latch, x - 0.02, -0.006, H * 0.42, x + 0.02, 0.001, H * 0.68, 0.004);
    return;
  }
  const body = mat("body", pbr(0xe46b1f, { rough: 0.5 })), black = mat("accent", M.black);
  kit.box(body, W * 0.3, D * 0.2, 0, W * 0.8, D * 0.8, H * 0.55, 0.02);          // мотор
  kit.box(black, W * 0.06, D * 0.28, H * 0.05, W * 0.32, D * 0.72, H * 0.45, 0.015);   // редуктор и патрон
  kit.rod(M.steel, [0, D / 2, H * 0.25], [W * 0.06, D / 2, H * 0.25], 0.008, 10);
  kit.box(body, W * 0.78, D * 0.3, 0, W, D * 0.7, H, 0.02);                      // рукоять
});

// пластиковый контейнер с крышкой: стенки чуть шире кверху, крышка с бортиком и ручкой-рамкой, ручки по торцам;
// цвета body, lid (по умолчанию как body)
fam("item.plastic_box", ({ kit, size: [W, D, H], mat }) => {
  const body = mat("body", pbr(0x8f7fd6, { rough: 0.45 })), lid = mat("lid", body), d = Math.min(0.012, W * 0.04, D * 0.04);
  const hb = H - 0.03;
  kit.box(body, d, d, 0, W - d, D - d, 0.02, 0.006);                                     // дно уже верха
  kit.box(body, 0, 0, 0.012, W, D, hb, 0.012);
  kit.box(lid, -0.004, -0.004, hb, W + 0.004, D + 0.004, H - 0.008, 0.01);   // крышка с бортиком
  kit.box(lid, W * 0.28, D * 0.32, H - 0.008, W * 0.72, D * 0.68, H, 0.006);  // рамка-ручка
  for (const x of [-0.006, W]) kit.box(lid, x, D * 0.3, hb - 0.05, x + 0.006, D * 0.7, hb - 0.015, 0.003);   // ручки по торцам
});

// стайлер и фен. render.style "dyson" — подставка с насадками-цилиндрами и сам стайлер лёжа перед ней (Dyson
// Airwrap); "dyson_wall" — на стене (+Y): вверху планка-держатель на кронштейнах, насадки висят в её гнёздах, стайлер —
// на крючке справа; иначе — фен: корпус-цилиндр вдоль X и ручка вниз. Цвета body (стайлер, фен), base (подставка,
// держатель), tips (насадки)
fam("item.hair_styler", ({ kit, size: [W, D, H], mat, r }) => {
  const body = mat("body", pbr(0x1c1c1e, { rough: 0.35 }), "metal");
  if (r.style === "dyson_wall") {
    const base = mat("base", pbr(0x7c4b00, { rough: 0.6 })), tip = mat("tips", pbr(0xcfc3b2, { rough: 0.4 }));
    const bw = Math.min(0.29, W - 0.08), zt = H - 0.035, n = 5, xw = W - 0.035;
    kit.box(base, 0, 0, zt, bw, D, H, 0.012);                                            // планка на n гнёзд
    for (const x of [0.03, bw - 0.05]) kit.box(base, x, D - 0.012, zt - 0.07, x + 0.02, D, zt, 0.004);   // кронштейны
    for (let i = 0; i < n; i++) kit.cylZ(tip, bw * (i + 0.5) / n, D * 0.45, zt - 0.12 - 0.03 * (i % 2), H + 0.012, 0.018, 20);
    kit.box(base, xw - 0.012, D * 0.45, H - 0.05, xw + 0.012, D, H - 0.03, 0.004);     // крючок
    kit.cylZ(body, xw, D * 0.45, 0.03, H - 0.05, 0.02, 20);                              // стайлер ручкой вверх
    kit.cylZ(pbr(0x2b2c2e, { rough: 0.6 }), xw, D * 0.45, 0.005, 0.03, 0.016, 16);
    return;
  }
  if (r.style === "dyson") {
    const base = mat("base", pbr(0xe7dccb, { rough: 0.5 })), tip = mat("tips", pbr(0xcfc3b2, { rough: 0.4 }));
    kit.box(base, 0, D * 0.45, 0, W, D, 0.035, 0.012);
    const n = 4;
    for (let i = 0; i < n; i++) kit.cylZ(tip, W * (0.14 + 0.24 * i), D * 0.72, 0.035, Math.min(H, 0.11 + 0.04 * (i % 2)), 0.022, 20);
    kit.rod(body, [0.01, D * 0.2, 0.03], [W * 0.75, D * 0.2, 0.03], 0.025, 20);          // стайлер лёжа
    kit.rod(pbr(0x2b2c2e, { rough: 0.6 }), [W * 0.75, D * 0.2, 0.03], [W - 0.01, D * 0.2, 0.03], 0.017, 16);
    return;
  }
  const R = Math.min(D, H) * 0.32;
  kit.rod(body, [0.0, D / 2, H - R], [W * 0.8, D / 2, H - R], R, 24);                     // корпус
  kit.rod(pbr(0x2b2c2e, { rough: 0.6 }), [W * 0.8, D / 2, H - R], [W, D / 2, H - R], R * 0.75, 20);   // концентратор
  kit.rod(body, [W * 0.25, D / 2, H - R * 1.6], [W * 0.18, D / 2, 0.01], R * 0.55, 16);   // ручка
});

// метёлка для пыли на телескопической ручке, висит пушистой головой вниз; цвета head, handle
fam("item.duster", ({ kit, size: [W, D, H], mat }) => {
  const head = mat("head", pbr(0x9c9c9c, { rough: 1 }), "fabric"), handle = mat("handle", M.brushed, "metal");
  const cx = W / 2, cy = D / 2, hh = Math.min(0.42, H * 0.65), R = Math.min(W, D) / 2;
  kit.cylZ(handle, cx, cy, hh - 0.03, H, 0.011, 12);
  kit.sphere(head, cx, cy, hh / 2, R * 0.95, 16, 1, 1, hh / (2 * R * 0.95));             // пушистая голова
  for (const [dx, dy, k] of [[0.3, 0, 0.6], [-0.3, 0.2, 0.55], [0, -0.3, 0.5]])          // неровные пряди
    kit.sphere(head, cx + dx * R, cy + dy * R, hh * 0.45, R * k, 10, 1, 1, hh / (2 * R * k) * 0.8);
});

// ═══ уборка и глажка ═════════════════════════════════════════════════════════
// вертикальный беспроводной пылесос на настенной станции (Xiaomi 1C): кронштейн на стене (+Y), под ним корпус с
// ручкой-петлёй и колбой, трубка до пола, щётка на полу поперёк, роликом вперёд (−Y). Коробка — от пола до верха
// кронштейна; цвета body (корпус, кронштейн, щётка), tube, accent (колба, шарнир, ролик)
fam("item.stick_vacuum", ({ kit, size: [W, D, H], mat }) => {
  const body = mat("body", pbr(0xf2f2ef, { rough: 0.4 })), tube = mat("tube", M.brushed, "metal");
  const acc = mat("accent", pbr(0x8b8f94, { rough: 0.45 })), cx = W / 2, yw = D, yb = D - 0.085;   // стена — y = D
  kit.box(body, cx - 0.04, yw - 0.016, H - 0.27, cx + 0.04, yw, H, 0.008);              // кронштейн на стене
  kit.box(body, cx - 0.032, yw - 0.07, H - 0.1, cx + 0.032, yw - 0.016, H - 0.06, 0.006);   // крюк
  kit.box(body, cx - 0.042, yb - 0.045, H - 0.43, cx + 0.042, yb + 0.045, H - 0.12, 0.03);  // мотор и аккумулятор
  kit.tube(body, [[cx, yb + 0.03, H - 0.13], [cx, yb + 0.03, H - 0.06], [cx, yb - 0.035, H - 0.06], [cx, yb - 0.035, H - 0.14]], 0.013, 10);
  kit.cylZ(acc, cx, yb - 0.05, H - 0.41, H - 0.27, 0.032, 24);                         // колба
  kit.cylZ(tube, cx, yb, 0.09, H - 0.43, 0.017, 16);                                   // трубка
  kit.box(acc, cx - 0.025, yb - 0.025, 0.05, cx + 0.025, yb + 0.025, 0.1, 0.01);        // шарнир щётки
  const bw = Math.min(0.13, W / 2 - 0.005);
  kit.box(body, cx - bw, Math.max(0, yb - 0.11), 0, cx + bw, Math.min(D, yb + 0.03), 0.055, 0.012);   // щётка
  kit.box(acc, cx - bw + 0.01, Math.max(0, yb - 0.11) - 0.002, 0.008, cx + bw - 0.01, Math.max(0, yb - 0.11) + 0.02, 0.03, 0.004);
});

// напольный отпариватель с доской (Philips 3000): база с баком на полу, две штанги, вертикальная доска лицом вперёд
// (−Y), сверху держатель с утюжком, шланг от базы к утюжку. Цвета body (база, утюжок), accent (кольцо базы), board,
// poles, hose
fam("item.garment_steamer", ({ kit, size: [W, D, H], mat }) => {
  const body = mat("body", pbr(0x242527, { rough: 0.45 })), ring = mat("accent", pbr(0xb98a62, { rough: 0.35, metal: 0.6 }), "metal");
  const board = mat("board", pbr(0x4a4b4e, { rough: 0.95 }), "fabric"), pole = mat("poles", M.brushed, "metal");
  const hose = mat("hose", pbr(0x2e2f31, { rough: 0.6 }));
  const cx = W / 2, cy = D * 0.58, R = Math.min(W, D * 0.84) * 0.42, top = H - 0.12, yb = cy + R * 0.25;
  kit.lathe(body, [[0, 0], [R, 0], [R * 1.02, 0.05], [R * 0.96, 0.2], [R * 0.7, 0.27], [0.03, 0.29], [0, 0.29]], cx, cy, 40);
  kit.torus(ring, cx, cy, 0.215, R * 0.95, 0.006, 40);
  for (const dx of [-0.07, 0.07]) kit.rod(pole, [cx + dx, yb, 0.27], [cx + dx, yb, top], 0.009, 12);
  const bw = Math.min(0.19, W / 2 - 0.005);
  kit.profileY(board, roundRect(cx - bw, 0.5, cx + bw, top - 0.03, 0.09), yb - 0.04, yb - 0.014);   // доска
  kit.box(body, cx - 0.06, yb - 0.03, top - 0.03, cx + 0.06, yb + 0.03, top + 0.02, 0.01);         // держатель
  kit.box(body, cx - 0.035, yb - 0.1, top - 0.05, cx + 0.035, yb - 0.02, H, 0.02);                 // утюжок
  kit.tube(hose, [[cx + R * 0.55, cy - R * 0.3, 0.24], [cx + bw - 0.02, yb - 0.09, 0.55], [cx + bw - 0.03, yb - 0.09, top - 0.25],
    [cx + 0.03, yb - 0.07, H - 0.06]], 0.011, 10);
});

// швабра на держателе: ручка до верха коробки, плоская насадка внизу сложена вдоль ручки (так её вешают), над ней
// шарнир; цвета handle, head, accent
fam("item.mop", ({ kit, size: [W, D, H], mat }) => {
  const handle = mat("handle", M.black), head = mat("head", pbr(0x2b2d33, { rough: 0.9 }), "fabric");
  const cx = W / 2, cy = D / 2;
  kit.cylZ(handle, cx, cy, 0.36, H, 0.011, 12);
  kit.box(head, 0.004, cy - 0.016, 0, W - 0.004, cy + 0.016, 0.33, 0.008);
  kit.box(mat("accent", pbr(0x2f7fd0, { rough: 0.5 })), cx - 0.02, cy - 0.02, 0.32, cx + 0.02, cy + 0.02, 0.38, 0.006);
});

// совок с длинной ручкой и веник (набор вешают за ручки): совок — лотком вперёд (−Y), веник защёлкнут в ручку совка
// щёткой вниз, в лоток. Коробка — от пола до верха ручек; цвета body (совок), handle, bristles
fam("item.dustpan", ({ kit, size: [W, D, H], mat, r }) => {
  const body = mat("body", pbr(0x3a3c40, { rough: 0.6 })), handle = mat("handle", M.black);
  const bristle = mat("bristles", pbr(0x26282c, { rough: 0.95 }), "fabric");
  const z0 = r.pan_z ?? 0.42, cx = W / 2;
  kit.box(body, 0, 0, z0, W, D * 0.55, z0 + 0.006, 0.004);                               // дно лотка
  for (const x of [0, W - 0.006]) kit.box(body, x, 0, z0, x + 0.006, D * 0.55, z0 + 0.07, 0.002);   // борта
  kit.box(body, 0, D * 0.55 - 0.006, z0, W, D * 0.55, z0 + 0.09, 0.003);                 // задний борт
  kit.box(body, cx - 0.03, D * 0.5, z0 + 0.05, cx + 0.03, D * 0.75, z0 + 0.14, 0.01);     // узел ручки
  kit.cylZ(handle, cx - 0.012, D * 0.68, z0 + 0.14, H, 0.0105, 12);                      // ручка совка
  kit.cylZ(handle, cx + 0.014, D * 0.6, z0 + 0.18, H - 0.03, 0.0095, 12);                // ручка веника
  kit.box(bristle, cx - W * 0.36, D * 0.12, z0 + 0.01, cx + W * 0.36, D * 0.5, z0 + 0.2, 0.01);   // щётка в лотке
});

// ведро: конус шире кверху, стенка 3 мм, валик по краю, дужка; цвета body, handle
fam("item.bucket", ({ kit, size: [W, D, H], mat }) => {
  const body = mat("body", pbr(0x1e88d8, { rough: 0.4, side: BOTH })), R = Math.min(W, D) / 2, rb = R * 0.76;
  kit.lathe(body, [[0, 0], [rb, 0], [R, H], [R - 0.003, H], [rb - 0.003, 0.003], [0, 0.003]], W / 2, D / 2, 40);
  kit.torus(body, W / 2, D / 2, H - 0.002, R - 0.0015, 0.004, 40);
  const hm = mat("handle", M.steel, "metal"), pts = [];
  for (let i = 0; i <= 12; i++) { const a = Math.PI * i / 12; pts.push([W / 2 + Math.cos(a) * (R - 0.004), D / 2, H - 0.03 + Math.sin(a) * R * 0.75]); }
  kit.tube(hm, pts, 0.0025, 8);
});

// таз: широкая низкая чаша с бортом. render.hang — висит на стене плашмя, дном к стене (+Y), чашей в комнату: тогда
// ширина и высота коробки — диаметр, глубина — высота таза; цвет body
fam("item.basin", ({ kit, size: [W, D, H], mat, r }) => {
  const body = mat("body", pbr(0x1e88d8, { rough: 0.4, side: BOTH })), hang = r.hang === true;
  const R = Math.min(W, hang ? H : D) / 2, h = hang ? D : H, rb = R * 0.62;
  const bowl = () => kit.lathe(body, [[0, 0], [rb, 0], [R * 0.9, h * 0.8], [R, h], [R - 0.004, h], [R * 0.9 - 0.003, h * 0.8],
    [rb - 0.003, 0.003], [0, 0.003]], W / 2, hang ? 0 : D / 2, 48);
  if (hang) kit.move(0, D, H / 2, () => kit.tiltX(90, 0, 0, bowl));
  else bowl();
});

// ═══ инженерия ══════════════════════════════════════════════════════════════
// короб для труб (сантехнический): гладкий короб цвета body
fam("mep.pipe_box", ({ kit, size: [W, D, H], mat }) => { kit.box(mat("body", M.white), 0, 0, 0, W, D, H, 0.003); });

// вывод воды из стены или короба: тёмное кольцо отверстия, патрубок с заглушкой; центр в точке, наружу — −Y; cap
fam("mep.water_outlet", ({ kit, mat }) => {
  const cap = mat("cap", pbr(0xe0262b, { rough: 0.4 }));
  kit.rod(pbr(0x3b3b3b, { rough: 0.8 }), [0, 0.001, 0], [0, -0.0015, 0], 0.017, 24);
  kit.rod(cap, [0, 0, 0], [0, -0.035, 0], 0.0115, 20);
  kit.rod(cap, [0, -0.035, 0], [0, -0.05, 0], 0.0135, 6);   // шестигранник заглушки
}, FREE);

// вывод канализации: раструб с серой заглушкой и наклейкой; центр в точке, наружу — −Y; цвет cap
fam("mep.drain_outlet", ({ kit, mat }) => {
  kit.rod(pbr(0x2e2e2e, { rough: 0.8 }), [0, 0.001, 0], [0, -0.002, 0], 0.032, 32);
  kit.rod(mat("cap", pbr(0x6d7074, { rough: 0.55 })), [0, 0, 0], [0, -0.008, 0], 0.0265, 32);
  kit.box(M.white, -0.004, -0.0086, -0.013, 0.005, -0.0079, 0.013);
}, FREE);

// умный замок рисует сама входная дверь (render.lock у opening.entrance_door); у устройства — только невидимый объём,
// по которому его выбирают и подсвечивают
fam("device.smart_lock", () => {});
