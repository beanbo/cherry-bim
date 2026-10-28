// Cherry BiM — вещи с габаритами (учёт вещей и обстановка): чайник, чемодан, увлажнитель, стремянка, швейная
// машина, перфоратор в кейсе, сковорода; сантехнические выводы, короб для труб, умный замок. Те же соглашения, что
// в families.js: метры, Z вверх, коробка от угла по +X +Y +Z, фасад — сторона −Y; подсказки — props.render.
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
// рукаве спереди; цвета body, accent (верх рукава и полоса платформы), knobs
fam("item.sewing_machine", ({ kit, size: [W, D, H], mat }) => {
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
