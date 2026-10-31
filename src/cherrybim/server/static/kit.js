// Cherry BiM — конструктор деталей для параметрических моделей: коробки со скруглением, цилиндры, тела вращения,
// выдавленные профили. Детали копятся по материалам и сливаются в один меш на материал — у сложной мебели
// остаётся несколько вызовов отрисовки. Система деталей — система сущности: метры, Z вверх, фасад — сторона −Y.
import * as THREE from "three";
import { RoundedBoxGeometry } from "./vendor/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "./vendor/jsm/utils/BufferGeometryUtils.js";

const Z = new THREE.Vector3(0, 0, 1);
const Y = new THREE.Vector3(0, 1, 0);

export class Kit {
  // clipZ — срез в системе сущности: выше этой отметки детали не строятся, пересекающие срез обрезаются
  constructor({ clipZ = Infinity } = {}) {
    this.byMat = new Map();
    this.m = new THREE.Matrix4();
    this.stack = [];
    this.clipZ = clipZ;
  }

  add(geo, mat) {
    if (!mat) { geo.dispose(); return; }
    geo.applyMatrix4(this.m);
    if (this.clipZ < Infinity) {
      geo.computeBoundingBox();
      const b = geo.boundingBox;
      if (b.min.z >= this.clipZ - 1e-5) { geo.dispose(); return; }
      if (b.max.z > this.clipZ) {                          // срез: вершины выше отметки опускаются на неё
        const p = geo.attributes.position;
        for (let i = 0; i < p.count; i++) if (p.getZ(i) > this.clipZ) p.setZ(i, this.clipZ);
        geo.computeVertexNormals();
      }
    }
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (this.m.determinant() < 0) {                       // зеркальная деталь: обход треугольников наоборот
      for (const a of [g.attributes.position, g.attributes.normal]) {
        for (let i = 0; i + 2 < a.count; i += 3) {
          for (let c = 0; c < a.itemSize; c++) {
            const t = a.array[(i + 1) * a.itemSize + c];
            a.array[(i + 1) * a.itemSize + c] = a.array[(i + 2) * a.itemSize + c];
            a.array[(i + 2) * a.itemSize + c] = t;
          }
        }
      }
    }
    let list = this.byMat.get(mat);
    if (!list) this.byMat.set(mat, list = []);
    list.push(g);
  }

  // ── системы координат ─────────────────────────────────────────────────────
  at(matrix, fn) {
    this.stack.push(this.m.clone());
    this.m.multiply(matrix);
    try { fn(); } finally { this.m = this.stack.pop(); }
  }
  move(dx, dy, dz, fn) { this.at(new THREE.Matrix4().makeTranslation(dx, dy, dz), fn); }
  // поворот вокруг вертикали через (ox, oy), градусы против часовой
  turn(deg, ox, oy, fn) {
    const r = THREE.MathUtils.degToRad(deg);
    const m = new THREE.Matrix4().makeTranslation(ox, oy, 0)
      .multiply(new THREE.Matrix4().makeRotationZ(r)).multiply(new THREE.Matrix4().makeTranslation(-ox, -oy, 0));
    this.at(m, fn);
  }
  // поворот вокруг горизонтали X через (oy, oz), градусы: +90 кладёт ось Z вдоль −Y (вещь висит на стене плашмя)
  tiltX(deg, oy, oz, fn) {
    const r = THREE.MathUtils.degToRad(deg);
    const m = new THREE.Matrix4().makeTranslation(0, oy, oz)
      .multiply(new THREE.Matrix4().makeRotationX(r)).multiply(new THREE.Matrix4().makeTranslation(0, -oy, -oz));
    this.at(m, fn);
  }
  mirrorX(cx, fn) {                                        // зеркально по X относительно x = cx (левые и правые детали)
    const m = new THREE.Matrix4().makeTranslation(cx, 0, 0).multiply(new THREE.Matrix4().makeScale(-1, 1, 1))
      .multiply(new THREE.Matrix4().makeTranslation(-cx, 0, 0));
    this.at(m, fn);
  }

  // ── детали ────────────────────────────────────────────────────────────────
  // коробка по двум углам; r — радиус скругления рёбер
  box(mat, x0, y0, z0, x1, y1, z1, r = 0) {
    const w = Math.abs(x1 - x0), d = Math.abs(y1 - y0), h = Math.abs(z1 - z0);
    if (w < 1e-5 || d < 1e-5 || h < 1e-5) return;
    const rr = Math.min(r, w / 2 - 1e-4, d / 2 - 1e-4, h / 2 - 1e-4);
    const geo = rr > 0.004 ? new RoundedBoxGeometry(w, d, h, 2, rr) : new THREE.BoxGeometry(w, d, h);   // скругление мельче 4 мм не видно
    geo.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.add(geo, mat);
  }
  // коробка без части граней: skip — строка из "x+", "x-", "y+", "y-", "z+", "z-". Грань, упёртая в соседа, не
  // строится: иначе её ребро лежит в плоскости соседней грани и под острым углом рисуется пунктиром
  slab(mat, x0, y0, z0, x1, y1, z1, skip = "") {
    const w = Math.abs(x1 - x0), d = Math.abs(y1 - y0), h = Math.abs(z1 - z0);
    if (w < 1e-5 || d < 1e-5 || h < 1e-5) return;
    const geo = new THREE.BoxGeometry(w, d, h), names = ["x+", "x-", "y+", "y-", "z+", "z-"], src = geo.index.array, idx = [];
    geo.groups.forEach((g, i) => { if (!skip.includes(names[i])) for (let k = g.start; k < g.start + g.count; k++) idx.push(src[k]); });
    geo.setIndex(idx);
    geo.clearGroups();
    geo.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.add(geo, mat);
  }
  // коробка по центру и размерам
  cbox(mat, cx, cy, cz, w, d, h, r = 0) { this.box(mat, cx - w / 2, cy - d / 2, cz - h / 2, cx + w / 2, cy + d / 2, cz + h / 2, r); }

  cylZ(mat, x, y, z0, z1, r, seg = 24, rTop = r) {
    if (z1 - z0 < 1e-5) return;
    const geo = new THREE.CylinderGeometry(rTop, r, z1 - z0, seg, 1);
    geo.rotateX(Math.PI / 2);
    geo.translate(x, y, (z0 + z1) / 2);
    this.add(geo, mat);
  }
  // цилиндр между двумя точками
  rod(mat, a, b, r, seg = 12, r2 = r) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length();
    if (len < 1e-5) return;
    const geo = new THREE.CylinderGeometry(r2, r, len, seg, 1);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, d.normalize()));
    geo.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
    this.add(geo, mat);
  }
  sphere(mat, x, y, z, r, seg = 16, sx = 1, sy = 1, sz = 1) {
    const geo = new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1));
    geo.scale(sx, sy, sz);
    geo.translate(x, y, z);
    this.add(geo, mat);
  }
  // труба по точкам: отрезки и шарниры
  tube(mat, pts, r, seg = 10) {
    for (let i = 0; i + 1 < pts.length; i++) this.rod(mat, pts[i], pts[i + 1], r, seg);
    for (let i = 1; i + 1 < pts.length; i++) this.sphere(mat, ...pts[i], r, seg);
  }
  // тело вращения вокруг вертикали (x, y): профиль [[радиус, z], …]; sx, sy — сплюснуть в эллипс
  lathe(mat, profile, x, y, seg = 32, sx = 1, sy = 1) {
    const geo = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(Math.max(r, 0), z)), seg);
    geo.rotateX(Math.PI / 2);                              // ось вращения Y → Z
    geo.scale(sx, sy, 1);
    geo.translate(x, y, 0);
    this.add(geo, mat);
  }
  // контур в плоскости XY, поднятый от z0 до z1; holes — вырезы; bevel — фаска по краям (внутрь контура)
  prism(mat, outline, z0, z1, holes = [], bevel = 0) {
    const h = z1 - z0;
    if (h < 1e-5) return;
    const b = Math.min(bevel, h / 2 - 1e-4);
    const geo = new THREE.ExtrudeGeometry(shape(outline, holes), b > 0
      ? { depth: h - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2, curveSegments: 12 }
      : { depth: h, bevelEnabled: false, curveSegments: 12 });
    geo.translate(0, 0, z0 + Math.max(b, 0));
    this.add(geo, mat);
  }
  // профиль в плоскости XZ ([[x, z], …]), выдавленный вдоль Y от y0 до y1
  profileY(mat, outline, y0, y1, holes = []) {
    const geo = new THREE.ExtrudeGeometry(shape(outline, holes), { depth: y1 - y0, bevelEnabled: false, curveSegments: 12 });
    geo.rotateX(Math.PI / 2);                              // (x, y, z) → (x, −z, y)
    geo.translate(0, y1, 0);
    this.add(geo, mat);
  }
  // профиль в плоскости YZ ([[y, z], …]), выдавленный вдоль X от x0 до x1
  profileX(mat, outline, x0, x1, holes = []) {
    const geo = new THREE.ExtrudeGeometry(shape(outline, holes), { depth: x1 - x0, bevelEnabled: false, curveSegments: 12 });
    geo.rotateX(Math.PI / 2);
    geo.rotateZ(Math.PI / 2);                              // профиль (y, z), выдавливание вдоль +X
    geo.translate(x0, 0, 0);
    this.add(geo, mat);
  }
  // треугольники по вершинам [[x, y, z], …] (по три на грань), видны с обеих сторон
  tris(mat, pts) {
    const arr = [];
    for (let i = 0; i + 2 < pts.length; i += 3) arr.push(...pts[i], ...pts[i + 1], ...pts[i + 2], ...pts[i], ...pts[i + 2], ...pts[i + 1]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
    geo.computeVertexNormals();
    this.add(geo, mat);
  }
  // гладкая поверхность по сетке точек rows[i][j] = [x, y, z]: лицевая сторона — та, откуда обход
  // (i, j) → (i, j + 1) → (i + 1, j + 1) идёт против часовой; нормали усреднены (без граней)
  grid(mat, rows) {
    const pos = [], idx = [], nj = rows[0].length;
    for (const r of rows) for (const p of r) pos.push(...p);
    for (let i = 0; i + 1 < rows.length; i++) for (let j = 0; j + 1 < nj; j++) {
      const a = i * nj + j, b = a + 1, c = a + nj, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.add(geo, mat);
  }
  // тор в горизонтальной плоскости (кольцо светильника); tilt — наклон вокруг X, градусы
  torus(mat, x, y, z, r, tube, seg = 48, tilt = 0) {
    const geo = new THREE.TorusGeometry(r, tube, 10, seg);
    if (tilt) geo.rotateX(THREE.MathUtils.degToRad(tilt));
    geo.translate(x, y, z);
    this.add(geo, mat);
  }
  // плоская круглая шайба (конфорка, кнопка) на высоте z, смотрит вверх
  disc(mat, x, y, z, r, h = 0.002, seg = 32) { this.cylZ(mat, x, y, z, z + h, r, seg); }

  build() {
    const g = new THREE.Group();
    for (const [mat, list] of this.byMat) {
      const geo = list.length === 1 ? list[0] : mergeGeometries(list, false);
      list.forEach(x => { if (x !== geo) x.dispose(); });
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = !mat.transparent;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    this.byMat.clear();
    return g;
  }
}

export function shape(outline, holes = []) {
  const s = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  return s;
}

// прямоугольник со скруглёнными углами (против часовой), для профилей и вырезов
export function roundRect(x0, y0, x1, y1, r, seg = 6) {
  r = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
  if (r < 1e-4) return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const out = [];
  const arc = (cx, cy, a0) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * Math.PI / 2;
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  arc(x1 - r, y0 + r, -Math.PI / 2);
  arc(x1 - r, y1 - r, 0);
  arc(x0 + r, y1 - r, Math.PI / 2);
  arc(x0 + r, y0 + r, Math.PI);
  return out;
}

// кольцевой сектор (против часовой): дуга радиусов r0…r1 от угла a0 до a1, градусы
export function sector(cx, cy, r0, r1, a0, a1, seg = 24) {
  const out = [];
  for (let i = 0; i <= seg; i++) {
    const a = THREE.MathUtils.degToRad(a0 + (a1 - a0) * i / seg);
    out.push([cx + Math.cos(a) * r1, cy + Math.sin(a) * r1]);
  }
  for (let i = seg; i >= 0; i--) {
    const a = THREE.MathUtils.degToRad(a0 + (a1 - a0) * i / seg);
    out.push([cx + Math.cos(a) * r0, cy + Math.sin(a) * r0]);
  }
  return out;
}

// эллипс (против часовой)
export function ellipse(cx, cy, rx, ry, seg = 40) {
  const out = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

export { Z as AXIS_Z };
