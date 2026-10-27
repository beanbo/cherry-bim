// Cherry BiM — совпадающие грани. Две вещи (или две части одной) лежат гранью в одной плоскости и смотрят в одну
// сторону: дверца в плоскости корпуса, порог на уровне пола, шкафчик узла заподлицо со стеной, плинтус вдоль бока
// шкафа. Буфер глубины не знает, какая из них ближе, и при каждом движении камеры решает заново — цвета мерцают.
// После сборки сцены такие пары находятся один раз (треугольники по корзинам плоскостей, наложение — отсечением в
// плоскости), и меньшая вещь — деталь поверх основы — получает ранг. При рисовании её точки придвигаются к камере на
// EPS·ранг доли расстояния: это масштаб вида с центром в камере, на экране ничего не сдвигается, тени и затенение
// углов те же, а спор «кто ближе» всегда решается в одну сторону.
// Грани, разнесённые на миллиметр и больше, сюда не попадают: их различает сам буфер глубины, если ближняя плоскость
// отсечения не слишком близко (app.js держит её на доле расстояния до цели).
import * as THREE from "three";

const EPS = 1e-5;          // доля расстояния на ранг: у цели это ~7 шагов 24-битного буфера (ближняя плоскость —
                           // 0,04 расстояния), а на 25 м — 0,25 мм: нарочные зазоры от миллиметра не страдают
const TOL = 2e-4;          // «в одной плоскости» — ближе 0,2 мм
const MIN_TRI = 1e-4;      // треугольники меньше 1 см² не смотрим
const MIN_OVERLAP = 2e-4;  // пара считается, если грани накрывают друг друга хотя бы на 2 см²
const ROWS = [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14];   // x, y, z матрицы вида (хранится по столбцам)

let hooked = false;
// ранг применяется при каждом рисовании, после того как three.js посчитал матрицу вида вещи; материалы не трогаем
// (их делят многие вещи, их подменяет режиссёр), поэтому — общий обработчик всех материалов
function hook() {
  if (hooked) return;
  hooked = true;
  const base = THREE.Material.prototype.onBeforeRender;
  THREE.Material.prototype.onBeforeRender = function (renderer, scene, camera, geometry, object, group) {
    base.call(this, renderer, scene, camera, geometry, object, group);
    const z = object.userData.zRank;
    if (!z) return;
    const r = typeof z === "number" ? z : z[group?.materialIndex ?? 0];
    if (!r) return;
    const s = 1 - EPS * r, e = object.modelViewMatrix.elements;
    for (const i of ROWS) e[i] *= s;
  };
}

export let lastSettle = null;                               // сводка последнего разбора — для проверки и отладки

// root — группа со всеми вещами сцены. Возвращает сводку: сколько частей, пар и рангов, за сколько мс
export function settleCoplanar(root) {
  hook();
  const t0 = performance.now();
  root.updateMatrixWorld(true);
  const parts = [], tris = [];
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3(), box = new THREE.Box3();
  root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.userData.xray || !o.geometry?.attributes?.position) return;
    delete o.userData.zRank;
    const g = o.geometry, pos = g.attributes.position, idx = g.index;
    if (!g.boundingBox) g.computeBoundingBox();
    const size = box.copy(g.boundingBox).applyMatrix4(o.matrixWorld).getSize(n).length();
    const mats = Array.isArray(o.material) ? o.material : null;
    const groups = mats && g.groups.length ? g.groups : [{ start: 0, count: idx ? idx.count : pos.count, materialIndex: 0 }];
    for (const gr of groups) {
      const m = mats ? mats[gr.materialIndex] : o.material;
      if (!m || m.visible === false || m.colorWrite === false || m.depthTest === false) continue;
      const part = { mesh: o, gi: mats ? gr.materialIndex : -1, size, area: 0, below: new Set(), rank: 0 };
      const end = Math.min(gr.start + gr.count, idx ? idx.count : pos.count);
      for (let k = gr.start; k + 2 < end; k += 3) {
        A.fromBufferAttribute(pos, idx ? idx.getX(k) : k).applyMatrix4(o.matrixWorld);
        B.fromBufferAttribute(pos, idx ? idx.getX(k + 1) : k + 1).applyMatrix4(o.matrixWorld);
        C.fromBufferAttribute(pos, idx ? idx.getX(k + 2) : k + 2).applyMatrix4(o.matrixWorld);
        n.crossVectors(e1.subVectors(B, A), e2.subVectors(C, A));
        const area = n.length() / 2;
        if (area < MIN_TRI) continue;
        n.divideScalar(2 * area);
        if (m.side === THREE.DoubleSide) {                 // двусторонней грани сторона не важна
          const s = Math.abs(n.x) > 1e-6 ? n.x : Math.abs(n.y) > 1e-6 ? n.y : n.z;
          if (s < 0) n.negate();
        }
        part.area += area;
        tris.push({ part, nx: n.x, ny: n.y, nz: n.z, d: n.x * A.x + n.y * A.y + n.z * A.z,
                    p: [A.x, A.y, A.z, B.x, B.y, B.z, C.x, C.y, C.z] });
      }
      if (part.area > 0) parts.push(part);
    }
  });
  // корзины плоскостей: нормаль с шагом 0,01, расстояние до начала координат — с шагом TOL
  const buckets = new Map();
  for (const t of tris) {
    t.db = Math.round(t.d / TOL);
    const k = `${Math.round(t.nx * 100)},${Math.round(t.ny * 100)},${Math.round(t.nz * 100)},${t.db}`;
    let b = buckets.get(k);
    if (!b) buckets.set(k, b = []);
    b.push(t);
  }
  const over = new Map();                                   // «победитель→проигравший» → площадь наложения
  let pairs = 0;
  for (const [k, list] of buckets) {
    const head = k.slice(0, k.lastIndexOf(",") + 1), db = Number(k.slice(k.lastIndexOf(",") + 1));
    const next = buckets.get(head + (db + 1));
    const all = next ? list.concat(next) : list;
    if (new Set(all.map(t => t.part)).size < 2) continue;
    const [u, v] = basis(list[0]);
    const flat = all.map(t => {
      const q = ccw([0, 3, 6].map(i => [t.p[i] * u[0] + t.p[i + 1] * u[1] + t.p[i + 2] * u[2], t.p[i] * v[0] + t.p[i + 1] * v[1] + t.p[i + 2] * v[2]]));
      return { t, q, x0: Math.min(q[0][0], q[1][0], q[2][0]), x1: Math.max(q[0][0], q[1][0], q[2][0]),
               y0: Math.min(q[0][1], q[1][1], q[2][1]), y1: Math.max(q[0][1], q[1][1], q[2][1]) };
    });
    const nList = list.length;
    for (let i = 0; i < nList; i++) {
      const a = flat[i];
      // со своей корзиной — пары после себя, с соседней (следующий шаг расстояния) — все
      for (let j = i + 1; j < flat.length; j++) {
        const b = flat[j];
        if (a.t.part === b.t.part || Math.abs(a.t.d - b.t.d) > TOL) continue;
        if (b.x0 >= a.x1 || b.x1 <= a.x0 || b.y0 >= a.y1 || b.y1 <= a.y0) continue;
        const ov = Math.abs(area2(clip(a.q, b.q)));
        if (ov < 1e-6) continue;
        const [w, l] = wins(a.t.part, b.t.part) ? [a.t.part, b.t.part] : [b.t.part, a.t.part];
        let m = over.get(w);
        if (!m) over.set(w, m = new Map());
        m.set(l, (m.get(l) || 0) + ov);
      }
    }
  }
  // ранги: большие вещи раньше; деталь выше всех основ, на которых лежит
  const involved = new Set();
  for (const [w, m] of over) {
    for (const [l, a] of m) {
      if (a < MIN_OVERLAP) continue;
      w.below.add(l);
      involved.add(w).add(l);
      pairs++;
    }
  }
  const order = [...involved].sort(under);                  // основы раньше деталей: ранг основы уже известен
  let ranked = 0;
  for (const p of order) {
    for (const l of p.below) p.rank = Math.max(p.rank, l.rank + 1);
    if (!p.rank) continue;
    ranked++;
    const ud = p.mesh.userData;
    if (p.gi < 0) ud.zRank = p.rank;
    else (typeof ud.zRank === "object" ? ud.zRank : (ud.zRank = {}))[p.gi] = p.rank;
  }
  return (lastSettle = { parts: parts.length, triangles: tris.length, pairs, ranked, ms: Math.round(performance.now() - t0) });
}

// Порядок «основа раньше детали»: больше по размеру (диагональ коробки) — ниже; равные (части одной вещи) — больше
// по площади ниже, затем порядок в сцене. Строгий и один на всех, поэтому рангам не из-за чего зациклиться
function under(a, b) {
  return b.size - a.size || b.area - a.area || a.mesh.id - b.mesh.id || a.gi - b.gi;
}
const wins = (a, b) => under(a, b) > 0;                     // a сверху b

function basis(t) {
  const a = Math.abs(t.nx) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = [t.ny * a[2] - t.nz * a[1], t.nz * a[0] - t.nx * a[2], t.nx * a[1] - t.ny * a[0]];
  const lu = Math.hypot(u[0], u[1], u[2]);
  u[0] /= lu; u[1] /= lu; u[2] /= lu;
  return [u, [t.ny * u[2] - t.nz * u[1], t.nz * u[0] - t.nx * u[2], t.nx * u[1] - t.ny * u[0]]];
}
function area2(P) {
  let s = 0;
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}
const ccw = P => (area2(P) < 0 ? P.slice().reverse() : P);
// пересечение выпуклых многоугольников (Сазерленд — Ходжман)
function clip(subject, clipper) {
  let out = subject;
  for (let i = 0; i < clipper.length && out.length; i++) {
    const a = clipper[i], b = clipper[(i + 1) % clipper.length], inp = out;
    out = [];
    const side = p => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j], q = inp[(j + 1) % inp.length], sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const w = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * w, p[1] + (q[1] - p[1]) * w]); }
    }
  }
  return out;
}
