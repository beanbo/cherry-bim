// Cherry BiM — режиссёр показа: камера сама ведёт зрителя по двойнику. Облёт квартиры, перелёт в комнату, полёт
// над трубами на высоте глаз, подход к вещи с подсветкой.
//
// Кадр складывается из планов (облёт по кругу, качание вокруг цели, полёт по пути) и переходов между ними. Переход —
// оптимальный перелёт «панорама + наезд»: цель едет по прямой, расстояние до неё меняется так, что картинка бежит
// перед глазами с постоянной скоростью (на дальнем перелёте камера сама отъезжает и поднимается, потом подходит),
// азимут — по кратчайшему углу. Вес перехода — кривая минимального рывка (скорость и ускорение на краях нулевые),
// поэтому нет ни толчка на старте, ни дёрганья в конце, а начатое движение (облёт) продолжается внутри перехода.
// Длительность каждого перехода подбирается проигрышем так, чтобы скорость, ускорение и поворот взгляда нигде не
// выходили за пороги (fitT); полёт по пути замедляется там, где разворачивается взгляд (gazeCap).
// Сцены («покажи отопление») — последовательность планов с титрами, подписями у вещей, мини-планом и полосами кино.
// Всё поверх кадра рисует свой 2D-холст: в браузере — слоем над сценой, в режиме ТВ — склейкой с кадром для потока.
import * as THREE from "three";

const V3 = THREE.Vector3;
const UP = new V3(0, 0, 1);
const TAU = Math.PI * 2;
const rad = d => d * Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, w) => a + (b - a) * w;
const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const mj = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (10 - 15 * u + 6 * u * u));   // минимальный рывок
const mjI = y => y * y * y * y * (2.5 - 3 * y + y * y);                                // ∫₀ʸ mj
// Гладкая трапеция для долгих переходов: разгон и торможение — по кривой минимального рывка (доля rho времени
// каждое), посередине — ровная скорость. Пик скорости — 1/(1−rho) от средней (у одной кривой минимального рывка —
// 1,875), поэтому дальний перелёт при тех же порогах на четверть короче. rho = 0 — обычная кривая
function ease(u, rho) {
  if (!rho) return mj(u);
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const k = 1 / (1 - rho);
  if (u < rho) return k * rho * mjI(u / rho);
  if (u > 1 - rho) return 1 - k * rho * mjI((1 - u) / rho);
  return k * (rho / 2 + u - rho);
}
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const fmtArea = a => `${(Math.round(a * 10) / 10).toString().replace(".", ",")} м²`;

const pose = () => ({ p: new V3(), q: new V3(), fov: 40, roll: 0 });
const copyPose = (o, a) => { o.p.copy(a.p); o.q.copy(a.q); o.fov = a.fov; o.roll = a.roll || 0; return o; };
function sph(c, d, az, el, out = new V3()) {
  return out.set(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)).multiplyScalar(d).add(c);
}

// ── планы ───────────────────────────────────────────────────────────────────
// Облёт: вокруг точки c на расстоянии d, наклон el над горизонтом, азимут az (откуда камера смотрит на цель);
// w — скорость по кругу (рад/с), sway — вместо круга качание ±sway с периодом swayPer, breathe — наклон гуляет на
// ±breathe с периодом per. Всё — синусы от своего начала, чтобы облёт жил и в паузе.
class Orbit {
  constructor({ c, d, el, az, w = 0, sway = 0, swayPer = 38, breathe = 0, per = 47, fov = 40, t0 = 0 }) {
    Object.assign(this, { c: c.clone(), d, el, az, w, sway, swayPer, breathe, per, fov, t0 });
    this.kind = "orbit";
  }
  pose(t, out) {
    const dt = t - this.t0;
    const az = this.az + this.w * dt + (this.sway ? this.sway * Math.sin(TAU * dt / this.swayPer) : 0);
    const el = this.el + (this.breathe ? this.breathe * Math.sin(TAU * dt / this.per) : 0);
    out.q.copy(this.c);
    sph(this.c, this.d, az, el, out.p);
    out.fov = this.fov;
    out.roll = 0;
    return out;
  }
  // азимут и наклон в момент t — новый план продолжает с того же места
  angles(t) {
    const dt = t - this.t0;
    return { az: this.az + this.w * dt + (this.sway ? this.sway * Math.sin(TAU * dt / this.swayPer) : 0),
             el: this.el + (this.breathe ? this.breathe * Math.sin(TAU * dt / this.per) : 0) };
  }
}

// Неподвижная поза (для переходов и запасных случаев)
class Still {
  constructor(p) { this.at = copyPose(pose(), p); this.kind = "still"; }
  pose(t, out) { return copyPose(out, this.at); }
}

// Полёт по пути на высоте глаз: путь сглажен дугами в углах, скорость — по заранее рассчитанному профилю (разгон,
// торможение в поворотах и у приборов, остановка перед концом). Взгляд — вперёд по пути на look метров, к прибору,
// мимо которого летим, камера поворачивает голову; в поворотах — лёгкий крен.
const LOOK = [[0.55, 1 / 9], [0.8, 2 / 9], [1, 3 / 9], [1.2, 2 / 9], [1.45, 1 / 9]];   // точки взгляда: доля look, вес
class Glide {
  constructor({ path, prof, z, look = 2.4, pois = [], end = null, start = null, t0 = 0, delay = 0, fov = 52, side = null }) {
    Object.assign(this, { path, prof, z, look, pois, end, start, t0, delay, fov, side });
    this.kind = "glide";
    this.dur = delay + prof.dur;
    this._c = new V3(); this._o = new V3(); this._d = new V3();
    // крен в поворот: боковое ускорение v²/r со знаком поворота. На входе в дугу кривизна меняется скачком —
    // крен считается заранее по всему пути и сглаживается вдоль него (три прохода по ±0,35 м), иначе горизонт
    // дёргался бы на 2°
    const ds = 0.05, n = Math.max(2, Math.ceil(path.len / ds) + 1);
    let roll = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const s = path.len * i / (n - 1), r = path.radAt(s), v = prof.vAtS(s);
      roll[i] = r < Infinity ? clamp(-path.turnAt(s) * v * v / r * 0.09, -rad(2.5), rad(2.5)) : 0;
    }
    const k = Math.max(1, Math.round(0.35 / ds));
    for (let pass = 0; pass < 3; pass++) {
      const src = roll;
      roll = src.map((_, i) => {
        let m = 0, c = 0;
        for (let j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j++) { m += src[j]; c++; }
        return m / c;
      });
    }
    this.rolls = roll;
  }
  // полёт трогается не сразу: переход к нему длинный — камера сначала долетает до начала пути
  setDelay(d) { this.delay = d; this.dur = d + this.prof.dur; }
  s(t) { return this.prof.sAt(t - this.t0 - this.delay); }
  rollAt(s) {
    const R = this.rolls, L = R.length - 1, x = clamp(s / Math.max(this.path.len, 1e-6), 0, 1) * L, i = Math.min(Math.floor(x), L - 1);
    return cr(R[Math.max(0, i - 1)], R[i], R[i + 1], R[Math.min(L, i + 2)], x - i);
  }
  pose(t, out) {
    const s = this.s(t);
    this.posAt(s, out.p);
    out.p.z += 0.008 * Math.sin(TAU * (t - this.t0) / 4.1);       // дрон держит высоту не идеально
    this.lookAt(s, out.q);
    out.fov = this.fov;
    out.roll = this.rollAt(s);
    return out;
  }
  // где камера в точке пути s: над трубой, сбоку от неё, над стенами — выше
  posAt(s, P) {
    this.path.at(s, P);
    let rise = 0;
    if (this.side) { const o = this.side.at(s, this._o); rise = o.z; P.x += o.x; P.y += o.y; }
    P.z = this.z + rise;
    return P;
  }
  // куда смотрит камера в точке пути s
  lookAt(s, Q) {
    const { path } = this;
    // вперёд по пути: среднее нескольких точек впереди (0,55…1,45 look) — на поворотах взгляд разворачивается
    // заранее и плавно, а не вслед за одной точкой, которая резко уходит за угол. За концом пути — дальше по
    // последнему направлению (иначе у конца ноги без прибора взгляд упирался бы в точку под камерой и камера кивала
    // вниз); у конца цель съезжает на прибор в конце
    Q.set(0, 0, 0);
    for (const [f, w] of LOOK) {
      const at = s + this.look * f;
      path.at(Math.min(path.len, at), this._d);
      if (at > path.len) this._d.addScaledVector(path.dirEnd, at - path.len);
      Q.addScaledVector(this._d, w);
    }
    if (this.end) {                                        // разворот к прибору в конце — растянут на ~3 м пути
      const k = smooth(path.len - this.look - 2.6, path.len - 0.3, s + this.look * 0.6);
      Q.lerp(this.end.c, k);
    }
    // приборы по пути: голова поворачивается к ним, пока пролетаем мимо. Несколько рядом — взгляд между ними по
    // весам: каждый вес плавный, а «самый близкий прибор» сменился бы скачком, и взгляд прыгнул бы с одного на другой.
    // Прибор, с которого нога начинается (узел ввода), уже показан — к нему не оборачиваемся
    const c = this._c.set(0, 0, 0);
    let wsum = 0, miss = 1;
    for (const poi of this.pois) {
      if (poi === this.end || poi === this.start) continue;
      const d = poi.s - s;
      const w = smooth(3.2, 1.0, d) * smooth(-2.0, -0.2, d);
      if (w <= 0) continue;
      c.addScaledVector(poi.c, w);
      wsum += w;
      miss *= 1 - w;
    }
    if (wsum > 0) Q.lerp(c.divideScalar(wsum), 0.6 * (1 - miss));
    return Q;
  }
}
const NO_PROF = { dur: 0, len: 0, sAt: () => 0, vAt: () => 0, vAtS: () => 0 };
// Предел скорости полёта по взгляду: где взгляд разворачивается на метр пути сильнее (шпилька трубы, разворот к
// прибору, конец ветки), там камера летит медленнее — взгляд нигде не поворачивается быстрее wmax (рад/с). g — полёт
// без профиля (только posAt/lookAt), отдаёт функцию «наибольшая скорость в точке s»
function gazeCap(g, s1, wmax = 0.5) {
  const n = Math.max(2, Math.ceil(s1 / 0.05) + 1), ds = s1 / (n - 1), caps = new Float64Array(n).fill(Infinity);
  const P = new V3(), Q = new V3(), a = new V3(), b = new V3();
  for (let i = 0; i < n; i++) {
    g.posAt(ds * i, P); g.lookAt(ds * i, Q);
    b.subVectors(Q, P).normalize();
    if (i) {
      const cap = wmax * ds / Math.max(1e-6, Math.acos(clamp(a.dot(b), -1, 1)));
      caps[i - 1] = Math.min(caps[i - 1], cap);
      caps[i] = Math.min(caps[i], cap);
    }
    a.copy(b);
  }
  return s => { const x = clamp(s / Math.max(s1, 1e-9), 0, 1) * (n - 1), i = Math.min(Math.floor(x), n - 2); return Math.min(caps[i], caps[i + 1]); };
}

// Оптимальный перелёт «панорама + наезд» (van Wijk, Nuij, 2003; так же d3.interpolateZoom): цель едет по прямой на
// u1 метров, расстояние до неё меняется от w0 до w1 так, что картинка бежит перед глазами с постоянной скоростью —
// на дальнем перелёте камера сама отъезжает (поднимается над квартирой) и потом подходит. s ∈ [0, 1] → доля пути
// цели f и расстояние r
const RHO = Math.SQRT2;
function zoomPath(u1, w0, w1, s) {
  const rho2 = RHO * RHO;
  if (u1 < 1e-4) return { f: 0, r: w0 * Math.exp(Math.log(w1 / w0) * s) };   // цель на месте — только наезд
  const b0 = (w1 * w1 - w0 * w0 + rho2 * rho2 * u1 * u1) / (2 * w0 * rho2 * u1);
  const b1 = (w1 * w1 - w0 * w0 - rho2 * rho2 * u1 * u1) / (2 * w1 * rho2 * u1);
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0), r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
  const x = s * (r1 - r0), c0 = Math.cosh(r0);
  return { f: w0 / (rho2 * u1) * (c0 * Math.tanh(x + r0) - Math.sinh(r0)), r: w0 * c0 / Math.cosh(x + r0) };
}
const ZW = 1.2;                                             // ширина кадра ≈ 1,2 расстояния до цели (fov 40–52°)

// Переход: из плана from в план to по оптимальному перелёту; азимут — по кратчайшему углу, наклон — плавно (на
// дальнем — с подъёмом). Оба плана продолжают двигаться внутри перехода, поэтому начатое движение не обрывается
class Blend {
  constructor(from, to, t0, T, lift) {
    Object.assign(this, { from, to, t0, T, lift });
    this.kind = "blend";
    this.rho = T > 3.5 ? clamp(2.4 / T, 0.28, 0.45) : 0;   // долгий — с ровной серединой, разгон ~2,4 с
    this.A = pose(); this.B = pose();
    this._oa = new V3(); this._ob = new V3();
  }
  done(t) { return t >= this.t0 + this.T; }
  pose(t, out) {
    const w = ease((t - this.t0) / this.T, this.rho);
    if (w >= 1) return this.to.pose(t, out);
    const A = this.from.pose(t, this.A), B = this.to.pose(t, this.B);
    if (w <= 0) return copyPose(out, A);
    const oa = this._oa.subVectors(A.p, A.q), ob = this._ob.subVectors(B.p, B.q);
    const ra = Math.max(oa.length(), 0.3), rb = Math.max(ob.length(), 0.3);
    const aza = Math.atan2(oa.y, oa.x), azb = Math.atan2(ob.y, ob.x);
    const ela = Math.asin(clamp(oa.z / ra, -1, 1)), elb = Math.asin(clamp(ob.z / rb, -1, 1));
    const z = zoomPath(A.q.distanceTo(B.q), ra * ZW, rb * ZW, w);
    out.q.lerpVectors(A.q, B.q, z.f);
    const az = aza + wrap(azb - aza) * w;
    const el = clamp(lerp(ela, elb, w) + this.lift.el * Math.sin(Math.PI * w), rad(-60), rad(84));
    sph(out.q, z.r / ZW, az, el, out.p);
    out.fov = lerp(A.fov, B.fov, w);
    out.roll = lerp(A.roll || 0, B.roll || 0, w);
    return out;
  }
}

// ── путь: сглаживание углов дугами, длина, кривизна ─────────────────────────
function smoothPath(raw, rMax = 0.7) {
  const P = [];
  for (const p of raw) if (!P.length || P[P.length - 1].distanceTo(p) > 0.01) P.push(p.clone());
  const arcs = [P[0].clone()];
  for (let i = 1; i < P.length - 1; i++) {
    const A = P[i - 1], B = P[i], C = P[i + 1];
    const u = A.clone().sub(B), v = C.clone().sub(B);
    const la = u.length(), lc = v.length();
    u.normalize(); v.normalize();
    const th = Math.acos(clamp(u.dot(v), -1, 1));            // угол между направлениями на соседей
    if (th > Math.PI - 0.03 || th < 0.05) { arcs.push(B.clone()); continue; }
    const tl = Math.min(rMax / Math.tan(th / 2), 0.45 * la, 0.45 * lc);
    const r = tl * Math.tan(th / 2);
    const T1 = B.clone().addScaledVector(u, tl), T2 = B.clone().addScaledVector(v, tl);
    const O = B.clone().addScaledVector(u.clone().add(v).normalize(), r / Math.sin(th / 2));
    const a = T1.clone().sub(O), b = T2.clone().sub(O);
    const ang = a.angleTo(b), n = Math.max(2, Math.ceil(ang * r / 0.01));
    const axis = new V3().crossVectors(a, b).normalize();
    const q = new THREE.Quaternion();
    for (let k = 0; k <= n; k++) {
      q.setFromAxisAngle(axis, ang * k / n);
      arcs.push(O.clone().add(a.clone().applyQuaternion(q)));
    }
  }
  arcs.push(P[P.length - 1].clone());
  // Ровный шаг 2 см и сглаживание (три прохода скользящего среднего ±12 см, концы на месте): на стыке прямой и дуги
  // кривизна нарастает плавно, как на переходной кривой дороги, — боковое ускорение и крен включаются без толчка
  let pts = resample(arcs, 0.02);
  for (let pass = 0; pass < 3; pass++) {
    const src = pts;
    pts = src.map((p, i) => {
      const h = Math.min(6, i, src.length - 1 - i);
      if (!h) return p.clone();
      const o = new V3();
      for (let j = i - h; j <= i + h; j++) o.add(src[j]);
      return o.divideScalar(2 * h + 1);
    });
  }
  // кривизна по трём точкам через 10 см: радиус описанной окружности и сторона поворота (налево +, направо −)
  const rads = new Array(pts.length).fill(Infinity), turn = new Array(pts.length).fill(0), m = 5;
  for (let i = m; i < pts.length - m; i++) {
    const A = pts[i - m], B = pts[i], C = pts[i + m];
    const ab = B.clone().sub(A), bc = C.clone().sub(B), cross = new V3().crossVectors(ab, bc).length();
    if (cross < 1e-9) continue;
    const r = ab.length() * bc.length() * C.distanceTo(A) / (2 * cross);
    if (r < 40) { rads[i] = r; turn[i] = Math.sign(ab.x * bc.y - ab.y * bc.x) || 0; }
  }
  const S = [0];
  for (let i = 1; i < pts.length; i++) S.push(S[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const len = S[S.length - 1];
  const dirEnd = new V3();                                  // направление в конце пути (последний ненулевой отрезок)
  for (let i = pts.length - 1; i > 0 && dirEnd.lengthSq() < 1e-12; i--) dirEnd.subVectors(pts[i], pts[i - 1]);
  if (dirEnd.lengthSq() > 1e-12) dirEnd.normalize();
  const find = s => {                                       // индекс отрезка, на котором лежит s
    let lo = 0, hi = S.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
    return lo;
  };
  return {
    pts, len, dirEnd,
    at(s, out = new V3()) {
      s = clamp(s, 0, len);
      const i = Math.min(find(s), pts.length - 2), d = S[i + 1] - S[i];
      return out.lerpVectors(pts[i], pts[i + 1], d > 1e-9 ? (s - S[i]) / d : 0);
    },
    radAt(s) { return rads[find(clamp(s, 0, len))]; },
    turnAt(s) { return turn[find(clamp(s, 0, len))]; },
    // ближайшая точка пути к p (по плану): {s, d}
    nearest(p) {
      let best = { s: 0, d: Infinity };
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], ab = b.clone().sub(a).setZ(0), l2 = ab.lengthSq();
        const ap = p.clone().sub(a).setZ(0);
        const u = l2 > 1e-12 ? clamp(ap.dot(ab) / l2, 0, 1) : 0;
        const d = ap.sub(ab.multiplyScalar(u)).length();
        if (d < best.d) best = { s: S[i] + u * (S[i + 1] - S[i]), d };
      }
      return best;
    },
  };
}

// точки ломаной через ровный шаг h (последняя — конец ломаной)
function resample(pts, h) {
  const out = [pts[0].clone()];
  let carry = 0;                                           // сколько пройдено от последней выданной точки
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], seg = a.distanceTo(b);
    let pos = h - carry;
    for (; pos <= seg; pos += h) out.push(a.clone().lerp(b, pos / seg));
    carry = seg - (pos - h);
  }
  if (out[out.length - 1].distanceTo(pts[pts.length - 1]) > 1e-4) out.push(pts[pts.length - 1].clone());
  return out;
}

// профиль скорости вдоль пути: не быстрее vmax, в поворотах — по боковому ускорению и по скорости разворота (v/r —
// столько же разворачивается и взгляд), у приборов — медленнее; разгон и торможение не резче acc; сглажен, чтобы не
// было толчков
function speedProfile(path, { vmax = 0.9, acc = 0.5, jerk = 0.8, alat = 0.35, turn = 0.62, slow = [], s1 = path.len, cap = null } = {}) {
  const ds = 0.02, n = Math.max(3, Math.ceil(s1 / ds) + 1);
  const S = new Float64Array(n), V = new Float64Array(n);
  // трогается и останавливается с нарастающим ускорением (рывок не больше jerk): с места при постоянном рывке
  // v = (j/2)·(6s/j)^(2/3)
  const ramp = s => (jerk / 2) * Math.pow(6 * Math.max(0, s) / jerk, 2 / 3);
  for (let i = 0; i < n; i++) {
    const s = s1 * i / (n - 1);
    S[i] = s;
    let v = Math.min(cap ? Math.min(vmax, cap(s)) : vmax, ramp(s), ramp(s1 - s));
    const r = path.radAt(s);
    if (r < Infinity) v = Math.min(v, Math.sqrt(alat * r), turn * r);
    for (const p of slow) {
      const d = Math.abs(s - p.s);
      if (d < p.w) v = Math.min(v, lerp(p.v, vmax, smooth(0, p.w, d)));
    }
    V[i] = v;
  }
  V[0] = 0; V[n - 1] = 0;
  const limit = () => {
    for (let i = 1; i < n; i++) V[i] = Math.min(V[i], Math.sqrt(V[i - 1] ** 2 + 2 * acc * (S[i] - S[i - 1])));
    for (let i = n - 2; i >= 0; i--) V[i] = Math.min(V[i], Math.sqrt(V[i + 1] ** 2 + 2 * acc * (S[i + 1] - S[i])));
  };
  limit();
  for (let k = 0; k < 10; k++) {                            // скругление профиля: рывок меньше
    for (let i = 1; i < n - 1; i++) V[i] = Math.min(V[i], 0.25 * V[i - 1] + 0.5 * V[i] + 0.25 * V[i + 1]);
  }
  limit();
  const T = new Float64Array(n);
  for (let i = 1; i < n; i++) T[i] = T[i - 1] + (S[i] - S[i - 1]) / Math.max(0.03, (V[i] + V[i - 1]) / 2);
  const dur = T[n - 1];
  const idx = t => { let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; } return lo; };
  // внутри шага — равноускоренно, скорость от V[i] до V[i+1] без ступенек (s по прямой давала бы скачок скорости
  // на каждом шаге в 4 см, на разгоне — до 0,1 м/с за кадр)
  const seg = t => { const i = idx(t), dt = Math.max(1e-9, T[i + 1] - T[i]); return [i, dt, t - T[i], (S[i + 1] - S[i]) / dt]; };
  return {
    dur, len: s1,
    sAt(t) {
      if (t <= 0) return 0;
      if (t >= dur) return s1;
      const [i, dt, tau, vm] = seg(t);
      return S[i] + V[i] * tau + (vm - V[i]) * tau * tau / dt;
    },
    vAt(t) {
      if (t <= 0 || t >= dur) return 0;
      const [i, dt, tau, vm] = seg(t);
      return V[i] + 2 * (vm - V[i]) * tau / dt;
    },
    vAtS(s) {                                               // скорость в точке пути
      if (s <= 0 || s >= s1) return 0;
      const x = s / s1 * (n - 1), i = Math.min(Math.floor(x), n - 2);
      return lerp(V[i], V[i + 1], x - i);
    },
  };
}

// Сдвиг камеры вбок от трассы: туда, где до стены комнаты дальше, но не больше max и не дальше доли share свободного
// места; сглажен вдоль пути окном ±win, чтобы на переходе из комнаты в комнату камера не металась. Трубы идут вдоль
// стен и под окнами — камера над самой трубой скребла бы стену и пролетала сквозь шторы и стеллажи.
function lateral(path, polys, { max = 0.95, share = 0.5, win = 1.3 } = {}) {
  const ds = 0.1, n = Math.max(2, Math.ceil(path.len / ds) + 1);
  const raw = [], P = new V3(), A = new V3(), B = new V3();
  let last = new V3(), sign = 0;
  for (let i = 0; i < n; i++) {
    const s = path.len * i / (n - 1);
    path.at(s, P);
    path.at(Math.max(0, s - 0.15), A);
    path.at(Math.min(path.len, s + 0.15), B);
    const tx = B.x - A.x, ty = B.y - A.y, tl = Math.hypot(tx, ty);
    const poly = tl > 1e-6 && polys.find(pg => inPoly2(pg, P.x, P.y));
    if (!poly) { raw.push(last.clone()); continue; }
    const nx = -ty / tl, ny = tx / tl;
    const fp = rayPoly(poly, P.x, P.y, nx, ny), fm = rayPoly(poly, P.x, P.y, -nx, -ny);
    if (!sign || Math.abs(fp - fm) > 0.3) sign = fp >= fm ? 1 : -1;   // почти поровну — сторону не меняем
    const mag = Math.min(max, (sign > 0 ? fp : fm) * share);
    last = new V3(nx * sign * mag, ny * sign * mag, 0);
    raw.push(last.clone());
  }
  const k = Math.max(1, Math.round(win / ds));
  let cur = raw;
  for (let pass = 0; pass < 2; pass++) {
    cur = cur.map((_, i) => {
      const o = new V3();
      let c = 0;
      for (let j = Math.max(0, i - k); j <= Math.min(cur.length - 1, i + k); j++) { o.add(cur[j]); c++; }
      return o.divideScalar(c);
    });
  }
  // над стеной (точка камеры вне комнат или у самой стены) камера приподнимается: иначе срез стены закрывает кадр
  const up = cur.map((o, i) => {
    path.at(path.len * i / (cur.length - 1), P).add(o);
    const poly = polys.find(pg => inPoly2(pg, P.x, P.y));
    if (!poly) return 1;
    let d = Infinity;
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) d = Math.min(d, segDist(P, poly[b], poly[a]));
    return smooth(0.55, 0.08, d);
  });
  let lift = up;
  for (let pass = 0; pass < 2; pass++) {
    lift = lift.map((_, i) => {
      let m = 0, c = 0;
      for (let j = Math.max(0, i - 8); j <= Math.min(lift.length - 1, i + 8); j++) { m += lift[j]; c++; }
      return m / c;
    });
  }
  const L = cur.length - 1;
  return {
    // между отсчётами — сплайн, а не отрезки: у ломаной скорость камеры ступенькой менялась бы на каждом отсчёте
    at(s, out = new V3()) {
      const x = clamp(s / Math.max(path.len, 1e-6), 0, 1) * L, i = Math.min(Math.floor(x), L - 1), u = x - i;
      const a = Math.max(0, i - 1), b = i, c = i + 1, d = Math.min(L, i + 2);
      out.set(cr(cur[a].x, cur[b].x, cur[c].x, cur[d].x, u), cr(cur[a].y, cur[b].y, cur[c].y, cur[d].y, u),
              0.6 * cr(lift[a], lift[b], lift[c], lift[d], u));
      return out;
    },
  };
}
// Катмулл — Ром по равномерным отсчётам: значение и производная непрерывны
function cr(a, b, c, d, u) {
  const u2 = u * u;
  return 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (3 * b - a - 3 * c + d) * u2 * u);
}
function segDist(p, a, b) {
  const ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey;
  const u = l2 > 1e-12 ? clamp(((p.x - a.x) * ex + (p.y - a.y) * ey) / l2, 0, 1) : 0;
  return Math.hypot(p.x - a.x - ex * u, p.y - a.y - ey * u);
}
function inPoly2(pts, x, y) {
  let ins = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) ins = !ins;
  }
  return ins;
}
// расстояние по лучу (x, y) + t·(dx, dy) до первого ребра многоугольника
function rayPoly(pts, x, y, dx, dy) {
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const ax = pts[j].x, ay = pts[j].y, ex = pts[i].x - ax, ey = pts[i].y - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((ax - x) * ey - (ay - y) * ex) / den, u = ((ax - x) * dy - (ay - y) * dx) / den;
    if (t > 1e-6 && u >= 0 && u <= 1) best = Math.min(best, t);
  }
  return best;
}

// ── граф трасс: полилинии системы → узлы, рёбра, маршрут облёта ──────────────
function routeGraph(lines) {
  const nodes = [], eps = 0.035;
  const node = p => {
    for (const n of nodes) if (n.p.distanceTo(p) < eps) return n;
    const n = { p: p.clone(), adj: [] };
    nodes.push(n);
    return n;
  };
  const edges = [];
  const link = (a, b, line) => {
    if (a === b) return;
    const e = { a, b, len: a.p.distanceTo(b.p), line };
    a.adj.push(e); b.adj.push(e); edges.push(e);
  };
  for (const ln of lines) for (let i = 0; i + 1 < ln.pts.length; i++) link(node(ln.pts[i]), node(ln.pts[i + 1]), ln);
  // конец одной трассы посреди отрезка другой — тройник: режем отрезок
  for (const n of [...nodes]) {
    if (n.adj.length !== 1) continue;
    for (const e of [...edges]) {
      if (e.a === n || e.b === n || !edges.includes(e)) continue;
      const ab = e.b.p.clone().sub(e.a.p), u = clamp(n.p.clone().sub(e.a.p).dot(ab) / ab.lengthSq(), 0, 1);
      if (u <= 0.02 || u >= 0.98) continue;
      if (e.a.p.clone().addScaledVector(ab, u).distanceTo(n.p) > eps) continue;
      edges.splice(edges.indexOf(e), 1);
      e.a.adj.splice(e.a.adj.indexOf(e), 1);
      e.b.adj.splice(e.b.adj.indexOf(e), 1);
      link(e.a, n, e.line); link(n, e.b, e.line);
    }
  }
  return { nodes, edges };
}
const other = (e, n) => (e.a === n ? e.b : e.a);
function branchLen(e, from, seen = new Set()) {
  const n = other(e, from);
  seen.add(e);
  let best = 0;
  for (const f of n.adj) if (!seen.has(f)) best = Math.max(best, branchLen(f, n, seen));
  return e.len + best;
}
function farthest(start) {
  const dist = new Map([[start, 0]]), st = [start];
  let far = start;
  while (st.length) {
    const n = st.pop();
    for (const e of n.adj) {
      const m = other(e, n);
      if (dist.has(m)) continue;
      dist.set(m, dist.get(n) + e.len);
      if (dist.get(m) > dist.get(far)) far = m;
      st.push(m);
    }
  }
  return far;
}
// Ноги облёта из узла start: ветки короче minLeg только видны по пути; несколько длинных веток из одного тройника —
// по очереди, короткие раньше, самая длинная последней (ею показ и закончится).
function legsFrom(start, minLeg = 1.6) {
  const legs = [];
  const walk = (n, from, cur) => {
    const kids = n.adj.filter(e => e !== from).map(e => ({ e, len: branchLen(e, n) })).sort((a, b) => a.len - b.len);
    const flown = kids.filter(k => k.len >= minLeg);
    if (!flown.length) { legs.push(cur); return; }
    if (flown.length === 1) { walk(other(flown[0].e, n), flown[0].e, [...cur, other(flown[0].e, n)]); return; }
    if (cur.length > 1) legs.push(cur);
    for (const k of flown) walk(other(k.e, n), k.e, [n, other(k.e, n)]);
  };
  walk(start, null, [start]);
  return legs.filter(l => l.length > 1);
}

// ── режиссёр ────────────────────────────────────────────────────────────────
// api — то, что даёт просмотрщик: S, scene, camera, controls, select, highlight, clearHighlight, applyView, meshFor,
// ancestors, mat4, floorZ, COL, invalidate, setMep
export function createDirector(api) {
  const { S, scene, camera, controls } = api;
  // Часы: wall — время страницы или потока (с), t — время планов: стоит на паузе, поэтому облёт замирает, а не
  // прыгает вперёд после неё. Планы, сцены и титры живут по t, бегущие штрихи на трубах — по wall.
  const D = {
    active: false, wall: 0, t: 0, held: 0, shot: null, beats: [], beat: -1, beatEnd: Infinity, paused: false,
    focus: null, op: null, cmd: null, mepWas: null, fx: new THREE.Group(), flows: [], glows: [], fade: new Map(),
    tint: new Map(), aspect: 16 / 9, fits: [],
  };
  const clock = now => {
    const w = now / 1000;
    if (D.paused) D.held += Math.max(0, w - D.wall);
    D.wall = w;
    D.t = w - D.held;
  };
  D.fx.name = "director-fx";
  D.fx.userData.noPick = true;
  scene.add(D.fx);
  const cur = pose(), tmp = pose();
  const overlay = new Overlay(api, D);

  // ── выборка из двойника ─────────────────────────────────────────────────
  const box = id => {
    const o = S.obj.get(id) || api.meshFor(id);
    if (!o) return null;
    const b = new THREE.Box3().setFromObject(o);
    return b.isEmpty() ? null : b;
  };
  const rooms = () => S.data.entities.filter(e => e.kind === "space" && e._inUnit && e.geom?.outline);
  function unitBox() {
    const b = new THREE.Box3();
    for (const r of rooms()) { const x = box(r.id); if (x) b.union(x); }
    for (const e of S.data.entities) if (e._inUnit && e.kind === "wall") { const x = box(e.id); if (x) b.union(x); }
    return b;
  }
  const floorZ = () => api.floorZ();
  function roomOf(e) {
    for (let x = e; x; x = S.by.get(x.parent)) if (x.kind === "space") return x;
    // точка в контуре комнаты
    const b = box(e.id);
    if (!b) return null;
    const c = b.getCenter(new V3());
    return rooms().find(r => inRoom(r, c)) || null;
  }
  function outlineWorld(e) {
    const m = api.mat4(e), z = e.geom.z0 || 0;
    return e.geom.outline.map(([x, y]) => new V3(x, y, z).applyMatrix4(m));
  }
  function inRoom(r, p) {
    const pts = outlineWorld(r);
    let ins = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) ins = !ins;
    }
    return ins;
  }
  // фасад вещи (сторона −Y её системы) в мире, по плану
  function frontOf(e) {
    if (!e.m || !["furniture", "device", "storage", "mep"].includes(e.kind) || e.geom?.type !== "box") return null;
    const f = new V3(-e.m[0][1], -e.m[1][1], 0);
    return f.lengthSq() > 1e-6 ? f.normalize() : null;
  }
  const area = e => e.props?.area_dev && rooms().some(r => r !== e && r.props?.brti_room && r.props.brti_room === e.props?.brti_room)
    ? e.props.area_dev : e.props?.area_brti ?? e.props?.area_dev;

  // ── кадрирование ────────────────────────────────────────────────────────
  // расстояние, с которого все точки целиком в кадре при взгляде dir (от камеры к цели) на точку c
  function fitPts(pts, c, dir, fov, margin = 0.14, aspect = D.aspect) {
    const f = dir.clone().normalize();
    let r = new V3().crossVectors(f, UP);
    if (r.lengthSq() < 1e-6) r.set(1, 0, 0);
    r.normalize();
    const u = new V3().crossVectors(r, f).normalize();
    const tv = Math.tan(rad(fov) / 2) * (1 - margin), th = tv * aspect;
    let d = 0;
    for (const p of pts) {
      const v = p.clone().sub(c);
      const px = v.dot(r), py = v.dot(u), pz = v.dot(f);
      d = Math.max(d, Math.abs(px) / th - pz, Math.abs(py) / tv - pz);
    }
    return d;
  }
  const corners = b => {
    const out = [];
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) out.push(new V3(x, y, z));
    return out;
  };
  const fitDist = (b, dir, fov, margin, aspect) => fitPts(corners(b), b.getCenter(new V3()), dir, fov, margin, aspect);
  const dirOf = (az, el) => new V3(-Math.cos(el) * Math.cos(az), -Math.cos(el) * Math.sin(az), -Math.sin(el));
  const camAz = () => { const o = cur.p.clone().sub(cur.q); return Math.atan2(o.y, o.x); };

  // ── планы для команд ────────────────────────────────────────────────────
  // углы комнат квартиры внизу и на высоте среза: по ним кадрируется облёт
  function unitPts() {
    const pts = [], z0 = floorZ();
    for (const r of rooms()) for (const p of outlineWorld(r)) pts.push(p.clone().setZ(z0), p.clone().setZ(z0 + 1.2));
    return pts;
  }
  // расстояние облёта: квартира в кадре на всём круге (проверка через 10°), середина — по углам комнат
  let orbitCache = null;
  function overviewShot(t, o = {}) {
    const el = rad(o.el ?? 50), fov = 40;
    if (!orbitCache || orbitCache.ver !== S.ver || orbitCache.el !== el || orbitCache.aspect !== D.aspect) {
      const pts = unitPts(), c = new V3();
      const b = new THREE.Box3().setFromPoints(pts);
      b.getCenter(c);
      c.z = floorZ() + 0.6;
      let d = 0;
      for (let a = 0; a < 360; a += 10) d = Math.max(d, fitPts(pts, c, dirOf(rad(a), el), fov, 0.07));
      orbitCache = { ver: S.ver, el, aspect: D.aspect, c, d };
    }
    const { c, d } = orbitCache;
    const az = o.az ?? (D.active ? camAz() : rad(-128));
    return new Orbit({ c, d: d * (o.k ?? 1), el, az, w: o.w ?? TAU / 140, breathe: rad(3.5), per: 53, fov, t0: t });
  }

  function roomShot(r, t, o = {}) {
    const b = box(r.id);
    const c = b.getCenter(new V3());
    c.z = floorZ() + 0.55;
    const flat = unitBox().getCenter(new V3());
    // камера со стороны середины квартиры, на три четверти: комната видна на фоне своих окон
    let az = Math.atan2(flat.y - c.y, flat.x - c.x);
    if (flat.distanceTo(c) < 1.5) az = camAz();
    az += rad(o.turn ?? 28);
    const el = rad(o.el ?? 56), fov = 42;
    const fb = b.clone(); fb.min.z = floorZ(); fb.max.z = floorZ() + 1.2;     // пол комнаты и мебель до среза
    const d = fitDist(fb, dirOf(az, el), fov, 0.2) * (o.k ?? 1);
    return new Orbit({ c, d, el, az, sway: rad(9), swayPer: 41, breathe: rad(2.5), per: 37, fov, t0: t });
  }

  function objectShot(e, t, o = {}) {
    const target = api.meshFor(e.id);
    const b = target ? new THREE.Box3().setFromObject(target) : null;
    if (!b || b.isEmpty()) return null;
    const c = b.getCenter(new V3()), size = b.getSize(new V3());
    // откуда смотреть: спереди на три четверти; без фасада — из середины комнаты
    const holder = [e, ...api.ancestors(e.id)].find(a => frontOf(a));
    let az = null;
    const f = holder && frontOf(holder);
    if (f) az = Math.atan2(f.y, f.x) + rad(o.turn ?? 24);
    if (az == null) {
      const r = roomOf(e), rc = r ? box(r.id)?.getCenter(new V3()) : null;
      if (rc && rc.distanceTo(c) > 0.4) az = Math.atan2(rc.y - c.y, rc.x - c.x) + rad(18);
      else az = camAz();
    }
    const hz = c.z - floorZ(), small = size.length() < 0.6;
    const el = rad(o.el ?? (hz > 1.7 ? 18 : small ? 46 : 32)), fov = 40;
    const fb = b.clone().expandByVector(new V3(0.25, 0.25, 0.12));
    const min = 1.1;                                       // мелочь — с запасом вокруг, иначе не понять, где она
    if (size.length() < min) fb.expandByScalar((min - size.length()) / 2);
    const d = Math.max(fitDist(fb, dirOf(az, el), fov, 0.24) * (o.k ?? 1), 1.4);
    return new Orbit({ c, d, el, az, sway: rad(11), swayPer: 33, breathe: rad(2), per: 29, fov, t0: t });
  }

  // кадр на несколько вещей сразу (группа без трассы, «все радиаторы»)
  function groupShot(ids, t) {
    const b = new THREE.Box3();
    for (const id of ids) { const x = box(id); if (x) b.union(x); }
    if (b.isEmpty()) return null;
    const c = b.getCenter(new V3()), flat = unitBox().getCenter(new V3());
    let az = Math.atan2(flat.y - c.y, flat.x - c.x);
    if (flat.distanceTo(c) < 1.5) az = camAz();
    az += rad(25);
    const el = rad(54), fov = 42;
    const fb = b.clone().expandByScalar(0.6);
    fb.max.z = Math.max(fb.min.z + 0.5, Math.min(fb.max.z, floorZ() + 1.5));
    return new Orbit({ c, d: fitDist(fb, dirOf(az, el), fov, 0.16), el, az, sway: rad(9), swayPer: 41,
                       breathe: rad(2.5), per: 37, fov, t0: t });
  }

  // ── переходы ────────────────────────────────────────────────────────────
  // дальний перелёт: отъезд даёт сам оптимальный перелёт, а наклон ещё и приподнимается — сверху над срезом стен
  // видно, куда летим. «Дальний» — по сравнению с тем, откуда смотрим: из комнаты в комнату на высоте глаз — да,
  // с общего плана в комнату — нет (камера и так высоко)
  function liftFor(a, b) {
    const travel = a.q.distanceTo(b.q);
    const r = Math.max(0.5, Math.min(a.p.distanceTo(a.q), b.p.distanceTo(b.q)));
    return { el: rad(16) * smooth(0.6, 3.2, travel / r), travel };
  }
  function autoT(a, b, lift) {
    const oa = a.p.clone().sub(a.q), ob = b.p.clone().sub(b.q);
    const daz = Math.abs(wrap(Math.atan2(ob.y, ob.x) - Math.atan2(oa.y, oa.x)));
    const dr = Math.abs(Math.log(Math.max(ob.length(), 0.3) / Math.max(oa.length(), 0.3)));
    return clamp(1.7 + 0.24 * lift.travel + 0.5 * daz + 0.65 * dr, 1.9, 5.4);
  }
  // Длительность перехода: не меньше заданной и такая, чтобы на всём пути камера не неслась и не крутила головой
  // быстрее порогов. Скорость — в долях расстояния до того, на что смотрим (издалека тот же метр в секунду глаз почти
  // не замечает, у стены на высоте глаз — «бросает»), причём движение прямо на цель или от неё (наезд) весит в √2
  // раз меньше бокового — как в оптимальном перелёте; поворот взгляда и наезд объективом — в градусах в секунду.
  // Переход проигрывается заранее по 90 точкам; скорости в нём ~1/T, поэтому T растягивается на худшее превышение.
  const LIM = { v: 0.5, a: 0.45, w: rad(30), fov: 7 };
  const _fa = new V3(), _fb = new V3(), _acc = new V3(), _dp = new V3();
  // видимая скорость: боковая часть целиком, часть вдоль взгляда — с весом 1/√2; в долях расстояния
  const seen = (a, b, dt) => {
    const f = _fa.subVectors(a.q, a.p), dist = Math.max(0.9, f.length());
    f.divideScalar(dist);
    const d = _dp.subVectors(b.p, a.p), along = d.dot(f), side = Math.sqrt(Math.max(0, d.lengthSq() - along * along));
    return Math.hypot(side, along / RHO) / dt / dist;
  };
  // prep(T) — подготовить план к переходу длиной T (полёт по трубе трогается к концу перехода)
  function fitT(from, to, t0, T, lift, prep = null) {
    const a = pose(), b = pose(), z = pose(), log = { T0: T, steps: [] };
    for (let it = 0; it < 5; it++) {
      prep?.(T);
      const bl = new Blend(from, to, t0, T, lift), N = 90, dt = T / N;
      const m = { T, v: 0, a: 0, w: 0, f: 0, at: {} };
      bl.pose(t0 - dt, z);
      bl.pose(t0, a);
      for (let i = 1; i <= N; i++) {
        bl.pose(t0 + dt * i, b);
        const dist = Math.max(0.9, Math.min(a.p.distanceTo(a.q), b.p.distanceTo(b.q)));
        const k = {
          v: Math.max(seen(a, b, dt), seen(b, a, dt)) / LIM.v,
          // ускорение — тоже в долях расстояния; растёт как 1/T², поэтому его превышение тянет T только на корень
          a: Math.sqrt(_acc.copy(b.p).sub(a.p).sub(a.p).add(z.p).length() / (dt * dt) / dist / LIM.a),
          w: Math.acos(clamp(_fa.subVectors(a.q, a.p).normalize().dot(_fb.subVectors(b.q, b.p).normalize()), -1, 1)) / dt / LIM.w,
          f: Math.abs(b.fov - a.fov) / dt / LIM.fov,
        };
        for (const key in k) if (k[key] > m[key]) { m[key] = k[key]; m.at[key] = i / N; }
        copyPose(z, a);
        copyPose(a, b);
      }
      log.steps.push(m);
      const worst = Math.max(m.v, m.a, m.w, m.f);
      if (worst <= 1.03) break;
      T = Math.min(T * worst * 1.03, 20);
    }
    D.fits.push(log);                                       // последние подборы — для разбора (camtrace.mjs)
    if (D.fits.length > 24) D.fits.shift();
    return T;
  }
  function go(shot, T = "auto") {
    if (!D.shot || T === 0) { D.shot = shot; return 0; }
    const a = D.shot.pose(D.t, pose()), b = shot.pose(D.t, pose());
    const lift = liftFor(a, b);
    // полёт по трубе трогается за 1,6 с до конца перехода: камера сперва долетает до начала пути
    const prep = shot.kind === "glide" ? d => shot.setDelay(Math.max(0, d - 1.6)) : null;
    const dur = fitT(D.shot, shot, D.t, T === "auto" ? autoT(a, b, lift) : T, lift, prep);
    prep?.(dur);
    D.shot = new Blend(D.shot, shot, D.t, dur, lift);
    return dur;
  }

  // ── сцены: последовательность планов ─────────────────────────────────────
  // beat: {make(t) → план, blend: секунды | "auto", hold: секунды после перехода (Infinity — остаётся), enter, exit}
  function program(beats) {
    for (const b of D.beats.slice(D.beat + 1)) b.cancel?.();
    D.beats = beats;
    D.beat = -1;
    D.beatEnd = -Infinity;
    advance();
  }
  function advance() {
    const prev = D.beats[D.beat];
    prev?.exit?.();
    D.beat++;
    const b = D.beats[D.beat];
    if (!b) { D.beatEnd = Infinity; return; }
    const shot = b.make(D.t);
    if (!shot) { D.beatEnd = D.t; return; }
    const T = go(shot, b.blend ?? "auto");
    b.started = D.t;
    b.blendT = T;
    const hold = typeof b.hold === "function" ? b.hold(shot, T) : b.hold ?? Infinity;
    D.beatEnd = D.t + T + hold;
    b.enter?.(shot, T);
  }

  // ── подсветка, рентген, потоки ───────────────────────────────────────────
  function setMep(on) {
    if (D.mepWas == null) D.mepWas = S.mep;
    if (S.mep !== on) { S.mep = on; api.applyView(); }
  }
  function restoreMep() {
    if (D.mepWas != null && S.mep !== D.mepWas) { S.mep = D.mepWas; api.applyView(); }
    D.mepWas = null;
  }
  function clearFx() {
    D.fx.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); });
    D.flows = [];
    D.glows = [];
    D.tint.clear();
    D.fx.clear();
  }
  // вещь выбрана: своё тёплое свечение поверх её цветов (а не сплошная заливка, как в панели)
  function tint(ids) { D.tint.clear(); for (const id of ids) D.tint.set(id, D.t); }
  function focus(ids, color) {
    D.lit = { ids, color };                                 // после пересборки сцены подсветку надо вернуть
    api.clearHighlight();
    for (const id of ids) { const o = S.obj.get(id); if (o) api.highlight(o, color); }
    api.invalidate();
  }

  // поток по трубе: бегущие светлые штрихи; подача — от узла, обратка — к узлу
  const FLOW_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const FLOW_FS = `uniform float uT, uLen, uDir, uA; uniform vec3 uC; varying vec2 vUv;
    void main(){ float s = vUv.x * uLen; float ph = fract((s - uDir * uT * 0.55) / 0.42);
      float dash = smoothstep(0.0, 0.12, ph) * (1.0 - smoothstep(0.5, 0.66, ph));
      gl_FragColor = vec4(uC * (0.75 + 0.9 * dash), (0.42 + 0.58 * dash) * uA); }`;
  function addFlow(pts, color, dir) {
    if (pts.length < 2) return;
    const path = new THREE.CurvePath();
    for (let i = 0; i + 1 < pts.length; i++) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
    const len = path.getLength();
    const geo = new THREE.TubeGeometry(path, Math.max(8, Math.ceil(len / 0.05)), 0.0115, 8, false);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uLen: { value: len }, uDir: { value: dir }, uA: { value: 0 }, uC: { value: new THREE.Color(color) } },
      vertexShader: FLOW_VS, fragmentShader: FLOW_FS, transparent: true, depthTest: false, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 990;
    mesh.userData.noPick = true;
    mesh.frustumCulled = false;
    D.fx.add(mesh);
    D.flows.push({ mesh, born: D.t });
  }
  // подсветка комнаты: тёплый пол, светящийся контур по низу стен и световая завеса вдоль стен, гаснущая к срезу
  const GLOW_FS = `uniform float uA; uniform vec3 uC; varying vec2 vUv;
    void main(){ float a = pow(1.0 - vUv.y, 1.6) * 0.75 * uA; gl_FragColor = vec4(uC * a, a); }`;
  function roomGlow(r) {
    let pts = outlineWorld(r).map(p => new V3(p.x, p.y, floorZ()));
    let area2 = 0;
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area2 += a.x * b.y - b.x * a.y; }
    if (area2 < 0) pts = pts.reverse();
    // контур чуть внутрь комнаты, чтобы свет не бился со стеной
    const n = pts.length, inner = pts.map((p, i) => {
      const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
      const d1 = p.clone().sub(a).normalize(), d2 = b.clone().sub(p).normalize();
      const n1 = new V3(-d1.y, d1.x, 0), n2 = new V3(-d2.y, d2.x, 0), bis = n1.clone().add(n2).normalize();
      return p.clone().addScaledVector(bis, 0.035 / Math.max(0.35, bis.dot(n1)));
    });
    const color = new THREE.Color(0xff7a18), group = new THREE.Group(), mats = [];
    const shape = new THREE.Shape(inner.map(p => new THREE.Vector2(p.x, p.y)));
    const fillMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
    const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape), fillMat);
    fill.position.z = floorZ() + 0.012;
    mats.push([fillMat, "opacity", 0.2]);
    const h = 1.05, pos = [], uv = [], idx = [];
    for (let i = 0; i < n; i++) {
      const a = inner[i], b = inner[(i + 1) % n], k = pos.length / 3;
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, b.x, b.y, a.z + h, a.x, a.y, a.z + h);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    wg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    wg.setIndex(idx);
    const wallMat = new THREE.ShaderMaterial({ uniforms: { uA: { value: 0 }, uC: { value: color } }, vertexShader: FLOW_VS,
      fragmentShader: GLOW_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    mats.push([wallMat.uniforms.uA, "value", 1]);
    const loop = new THREE.CurvePath();
    for (let i = 0; i < n; i++) loop.add(new THREE.LineCurve3(inner[i].clone().setZ(floorZ() + 0.02), inner[(i + 1) % n].clone().setZ(floorZ() + 0.02)));
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffa25a, transparent: true, opacity: 0, depthWrite: false });
    const line = new THREE.Mesh(new THREE.TubeGeometry(loop, n * 24, 0.018, 6, true), lineMat);
    mats.push([lineMat, "opacity", 0.95]);
    group.add(fill, new THREE.Mesh(wg, wallMat), line);
    group.traverse(o => { o.userData.noPick = true; o.renderOrder = 980; });
    D.fx.add(group);
    D.glows.push({ mats, born: D.t });
  }

  // пара труб (подача и обратка рядом, как их рисует просмотрщик) — по обе стороны от оси
  function flowsFor(line, dirSign) {
    const r = Math.max((line.e.geom.diameter || 0.012) / 2, 0.006);
    const pts = line.pts;
    const off = s => pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const d = b.clone().sub(a).setZ(0).normalize();
      return p.clone().add(new V3(-d.y, d.x, 0).multiplyScalar(s * (r + 0.012)));
    });
    if (line.e.type === "pipe_pair") {
      addFlow(off(-1), 0xff6a3d, dirSign);                // подача (тёплая) — от узла
      addFlow(off(1), 0x4aa3ff, -dirSign);                 // обратка — к узлу
    } else addFlow(pts, line.e.type === "cable" ? 0xffc04d : 0x7fd1ff, dirSign);
  }

  // ── пролёт по трассе системы ──────────────────────────────────────────────
  function routePlan(sys) {
    const members = new Set([sys.id]);
    if (sys.kind === "system") for (const r of sys.refs || []) if (r.rel === "has_member" && S.by.has(r.to)) members.add(r.to);
    const ents = [...members].map(id => S.by.get(id));
    const lines = ents.filter(e => e.geom?.type === "polyline" && e.geom.points?.length > 1).map(e => {
      const m = api.mat4(e);
      return { e, pts: e.geom.points.map(p => new V3(...p).applyMatrix4(m)) };
    });
    if (!lines.length) return null;
    const pois = ents.filter(e => e.geom && e.geom.type !== "polyline").map(e => {
      const b = box(e.id);
      return b ? { e, c: b.getCenter(new V3()), b } : null;
    }).filter(Boolean);
    const g = routeGraph(lines);
    // откуда: узел, который питает остальных (узел ввода), иначе — один конец самой длинной трассы
    const src = pois.find(p => (p.e.refs || []).some(r => r.rel === "feeds")) || null;
    let start = null;
    if (src) {
      let best = Infinity;
      for (const n of g.nodes) { const d = n.p.clone().setZ(0).distanceTo(src.c.clone().setZ(0)); if (d < best) { best = d; start = n; } }
    }
    if (!start) start = farthest(farthest(g.nodes[0]));
    const legs = legsFrom(start).map(nodes => {
      const raw = nodes.map(n => n.p);
      const path = smoothPath(raw, 0.65);
      return { nodes, path };
    });
    // направление каждой трубы: от источника (её первая точка ближе к началу облёта по графу)
    const hop = new Map([[start, 0]]), st = [start];
    while (st.length) { const n = st.shift(); for (const e of n.adj) { const m = other(e, n); if (!hop.has(m)) { hop.set(m, hop.get(n) + e.len); st.push(m); } } }
    const near = p => { let best = null, bd = Infinity; for (const n of g.nodes) { const d = n.p.distanceTo(p); if (d < bd) { bd = d; best = n; } } return best; };
    for (const ln of lines) {
      const a = hop.get(near(ln.pts[0])) ?? 0, b = hop.get(near(ln.pts[ln.pts.length - 1])) ?? 0;
      ln.dir = a <= b ? 1 : -1;
    }
    // приборы к ногам: где по пути ближе всего; у конца ноги — «прибор в конце»
    for (const leg of legs) {
      leg.pois = [];
      for (const p of pois) {
        const n = leg.path.nearest(p.c);
        if (n.d < 1.3) leg.pois.push({ ...p, s: n.s, d: n.d });
      }
      leg.pois.sort((a, b) => a.s - b.s);
      const last = leg.pois[leg.pois.length - 1];
      leg.end = last && leg.path.len - last.s < 1.4 ? last : null;
      leg.startPoi = leg.pois.find(p => p.s < 0.8 && p !== leg.end) || null;
    }
    return { sys, ents, lines, pois, legs, src, start };
  }

  function glideShot(leg, t, delay) {
    const z = floorZ() + 1.5;                               // высота глаз: 1,5 м над полом квартиры
    const standoff = leg.end ? Math.min(0.9, leg.path.len * 0.3) : 0;
    const s1 = Math.max(0.2, leg.path.len - standoff);
    const slow = leg.pois.filter(p => p !== leg.end && p !== leg.startPoi).map(p => ({ s: p.s, v: 0.45, w: 1.3 }));
    const how = { path: leg.path, z, pois: leg.pois, end: leg.end, start: leg.startPoi, side: null };
    leg.side ||= lateral(leg.path, rooms().map(outlineWorld));
    how.side = leg.side;
    leg.prof ||= speedProfile(leg.path, { s1, slow, cap: gazeCap(new Glide({ ...how, prof: NO_PROF }), s1) });
    return new Glide({ ...how, prof: leg.prof, t0: t, delay });
  }

  // кадр на источник трассы (узел ввода): вплотную, с той стороны, откуда к нему подходят
  function poiShot(p, t, towards) {
    const e = p.e;
    const sh = objectShot(e, t, { el: 36, k: 0.9 });
    if (!sh) return null;
    if (towards) {                                          // смотрим вдоль трубы: следующий план — полёт по ней
      const d = towards.clone().sub(p.c).setZ(0);
      if (d.lengthSq() > 1e-4) sh.az = Math.atan2(-d.y, -d.x) + rad(30);
    }
    return sh;
  }

  // ── команды ─────────────────────────────────────────────────────────────
  function begin(op, cmd) {
    clearFx();
    overlay.clear();
    D.fade.clear();
    D.op = op;
    D.cmd = cmd;
    D.paused = false;
    D.focus = null;
    D.focusBox = null;
    D.lit = null;
    D.picked = null;
    if (!D.active) {
      D.active = true;
      controls.enabled = false;
      copyPose(cur, { p: camera.position, q: controls.target, fov: camera.fov, roll: 0 });
      D.shot = new Still(cur);
      if (overlay.held) {                                   // поток начался с чёрного: из темноты, сверху
        const o = overviewShot(D.t, { k: 1.5 });
        const a = o.angles(D.t);
        D.shot = new Orbit({ c: o.c, d: o.d, el: a.el + rad(10), az: a.az - rad(40), w: o.w, fov: o.fov, t0: D.t });
      }
    }
    if (overlay.held) overlay.fadeFrom(1.3);
  }

  const play = cmd => {
    clock(api.now());                                       // сцена начинается сейчас, а не с последнего кадра
    if (camera.aspect > 0) D.aspect = camera.aspect;
    const op = cmd.op || "overview";
    if (op === "key") return key(cmd.key);
    if (op === "stop") { stop(); return { ok: true, op }; }
    if (op === "pause") { togglePause(); return { ok: true, op, paused: D.paused }; }
    const e = cmd.id ? S.by.get(cmd.id) || S.data.entities.find(x => x.key === cmd.id) : null;
    if (!["overview", "tour", "group"].includes(op) && !e) return { ok: false, error: `нет сущности ${cmd.id}` };
    if (op === "auto") return auto(e, cmd);
    if (op === "overview") return overview(cmd);
    if (op === "tour") return tour(cmd);
    if (op === "route") return route(e, cmd);
    if (op === "room") return room(e, cmd);
    if (op === "object") return object(e, cmd);
    if (op === "group") return group(cmd.ids || [], cmd);
    return { ok: false, error: `неизвестная команда ${op}` };
  };

  // вид показа — по сути сущности: квартира — облёт, комната — комната, система или труба — пролёт по трассе
  function auto(e, cmd) {
    if (e.kind === "unit" || e.kind === "building" || e.kind === "storey") return overview(cmd);
    if (e.kind === "space") return room(e, cmd);
    if (e.kind === "system") return route(e, cmd);
    if (e.kind === "mep" && e.geom?.type === "polyline") {
      const sys = (S.refsIn.get(e.id) || []).map(r => r.rel === "has_member" && S.by.get(r.from)).find(x => x?.kind === "system");
      return route(sys || e, cmd);
    }
    if (e.kind === "finish") {                              // отделка — комнаты, где она есть
      const ids = (e.refs || []).filter(r => r.rel === "finishes").map(r => r.to);
      if (ids.length === 1) return room(S.by.get(ids[0]), cmd);
      if (ids.length) return group(ids, { title: e.name, sub: cmd.sub });
    }
    return object(e, cmd);
  }

  function unitCaption() {
    const u = S.unit, p = u?.props || {};
    const storey = api.ancestors(u.id).find(a => a.kind === "storey");
    const living = rooms().filter(r => r.type === "room" && /офис|гостин|спальн|комнат|детск|кабинет/i.test(r.name)).length;
    const bits = [storey?.name, p.area_total_brti ? fmtArea(p.area_total_brti) : null,
                  living ? `${living} ${living === 1 ? "комната" : living < 5 ? "комнаты" : "комнат"}` : null];
    return { title: u?.name || "Квартира", sub: bits.filter(Boolean).join(" · ") };
  }

  function overview(cmd = {}) {
    const fresh = !D.active;
    overlay.held = false;                                   // своё появление из темноты — ниже
    begin("overview", cmd);
    api.select(null);
    restoreMep();
    const cap = unitCaption();
    if (fresh) {
      // первый кадр: издалека и сбоку, из темноты; затем подлёт к облёту
      overlay.fadeFrom(1.4);
      const end = overviewShot(D.t);
      const a = end.angles(D.t);
      D.shot = new Orbit({ c: end.c, d: end.d * 1.9, el: a.el + rad(14), az: a.az - rad(70), w: end.w, fov: 40, t0: D.t });
      program([{ make: () => end, blend: 5.2, hold: Infinity,
                 enter: () => overlay.caption(cap.title, cap.sub, D.t + 2.2, 7) }]);
    } else {
      program([{ make: t => overviewShot(t), hold: Infinity, enter: (s, T) => overlay.caption(cap.title, cap.sub, D.t + T * 0.6, 6) }]);
    }
    return { ok: true, op: "overview", id: S.unit?.id, name: cap.title, title: cap.title, sub: cap.sub };
  }

  function room(r, cmd = {}) {
    if (r.kind !== "space") return object(r, cmd);
    begin("room", cmd);
    restoreMep();
    api.select(null);
    roomGlow(r);
    D.focus = r;
    const a = area(r);
    const sub = [a ? fmtArea(a) : null, S.unit?.name].filter(Boolean).join(" · ");
    program([{ make: t => roomShot(r, t), hold: Infinity, enter: (s, T) => {
      overlay.caption(r.name, sub, D.t + T * 0.55, 7);
      overlay.minimap({ room: r.id, from: D.t + T * 0.4, to: D.t + T + 7 });
    } }]);
    return { ok: true, op: "room", id: r.id, name: r.name, title: r.name, sub };
  }

  function object(e, cmd = {}) {
    if (e.kind === "space") return room(e, cmd);
    if (e.kind === "unit") return overview(cmd);
    begin("object", cmd);
    restoreMep();
    if (e.kind === "mep" && ["cable", "pipe_pair", "water_riser", "duct"].includes(e.type)) setMep(true);
    // ящик или вещь в шкафу — выбор просмотрщика: он делает шкаф прозрачным, чтобы было видно внутри;
    // остальное — своим свечением поверх настоящих цветов
    const inside = ["storage", "item"].includes(e.kind) || !S.obj.has(e.id);
    if (inside) { api.select(e.id, { fly: false }); D.picked = e.id; }
    else { api.select(null); tint([e.id]); }
    D.focus = e;
    D.focusBox = box(e.id);
    const r = roomOf(e);
    const sub = [e.ru, r && r !== e ? r.name : null].filter(Boolean).join(" · ");
    const shot = objectShot(e, D.t);
    if (!shot) return { ok: false, error: `у «${e.name}» нет места на плане` };
    program([{ make: () => shot, hold: Infinity, enter: (s, T) => {
      overlay.caption(e.name, sub, D.t + T * 0.6, 8);
      const b = box(e.id);
      if (b) overlay.label(e.name, b.getCenter(new V3()).setZ(b.max.z), D.t + T * 0.85, D.t + T + 9, true);
    } }]);
    return { ok: true, op: "object", id: e.id, name: e.name, title: e.name, sub };
  }

  function group(ids, cmd = {}) {
    ids = ids.filter(id => S.by.has(id));
    if (!ids.length) return { ok: false, error: "нечего показать" };
    begin("group", cmd);
    restoreMep();
    focus(ids, api.COL.sel);
    const shot = groupShot(ids, D.t);
    if (!shot) return { ok: false, error: "у этих вещей нет места на плане" };
    const title = cmd.title || S.by.get(ids[0]).name, sub = cmd.sub || `${ids.length} шт.`;
    program([{ make: () => shot, hold: Infinity, enter: (s, T) => {
      overlay.caption(title, sub, D.t + T * 0.6, 7);
      ids.forEach((id, i) => { const b = box(id); if (b) overlay.label(S.by.get(id).name, b.getCenter(new V3()).setZ(b.max.z), D.t + T * 0.8 + i * 0.25, D.t + T + 8); });
    } }]);
    return { ok: true, op: "group", ids, title, sub };
  }

  function route(sys, cmd = {}) {
    const plan = routePlan(sys);
    if (!plan) {                                            // система без трасс (электрогруппа): все её части сразу
      const ids = (sys.refs || []).filter(r => ["has_member", "serves"].includes(r.rel)).map(r => r.to);
      return ids.length ? group(ids, { title: sys.name, sub: cmd.sub }) : object(sys, cmd);
    }
    begin("route", cmd);
    setMep(true);
    const color = /heat|отоплен/i.test(`${sys.type} ${sys.name}`) ? api.COL.heat : api.COL.sel;
    focus(plan.ents.filter(e => e.geom).map(e => e.id), color);
    for (const ln of plan.lines) flowsFor(ln, ln.dir);
    const all = new THREE.Box3();
    for (const p of plan.pois) all.union(p.b);
    for (const ln of plan.lines) for (const p of ln.pts) all.expandByPoint(p);
    const nPoi = plan.pois.filter(p => p !== plan.src).length;
    const srcRoom = plan.src ? roomOf(plan.src.e) : null;
    const under = plan.lines.every(l => l.pts.every(p => p.z < floorZ() + 0.02));
    const sub = [plan.src ? `${plan.src.e.name.replace(/\s*\(.*\)$/, "")}${srcRoom ? " — " + srcRoom.name.toLowerCase() : ""}` : null,
                 nPoi ? `приборов: ${nPoi}` : null, under ? "трубы в стяжке пола" : null].filter(Boolean).join(" · ");
    const wide = t => {
      const sh = groupShot(plan.ents.filter(e => e.geom).map(e => e.id), t) || overviewShot(t);
      return sh;
    };
    const beats = [];
    beats.push({ make: wide, hold: 2.6, enter: (s, T) => {
      overlay.caption(sys.name, sub, D.t + T * 0.5, T + 2.4);
      overlay.minimap({ route: plan, from: D.t + T * 0.6, to: Infinity });
    } });
    plan.legs.forEach((leg, i) => {
      const first = i === 0;
      if (first && plan.src) {
        beats.push({ make: t => poiShot(plan.src, t, leg.path.at(Math.min(leg.path.len, 2))), hold: 2.4, enter: (s, T) => {
          overlay.label(plan.src.e.name.replace(/\s*\(.*\)$/, ""), plan.src.c.clone().setZ(plan.src.b.max.z), D.t + T * 0.7, D.t + T + 2.6, true);
        } });
      }
      beats.push({
        make: t => glideShot(leg, t, 0),
        blend: first ? 2.6 : 3.8,
        hold: (s, T) => Math.max(0.4, s.dur - T * 0.6),       // полёт кончается — сразу план на прибор в конце
        enter: (s, T) => {
          overlay.bars(0.07, D.t);
          const t0 = D.t;
          for (const p of leg.pois) {
            if (p === leg.end || p === leg.startPoi) continue;
            const tp = timeAt(s, p.s);
            overlay.label(shortName(p.e), p.c.clone().setZ(p.b.max.z), t0 + tp - 2.2, t0 + tp + 1.4);
          }
        },
      });
      if (leg.end) {                                          // прибор в конце ветки: подход сбоку и титр
        const p = leg.end;
        beats.push({
          make: t => objectShot(p.e, t, { el: 30, turn: 32 }) || new Still(cur),
          blend: 2.4,
          hold: 3.4,
          enter: (s, T) => {
            const r = roomOf(p.e);
            overlay.label(shortName(p.e), p.c.clone().setZ(p.b.max.z), D.t + T * 0.5, D.t + T + 3.2, true);
            overlay.caption(p.e.name, r ? r.name : "", D.t + T * 0.45, T * 0.55 + 3.2, true);
          },
        });
      }
    });
    beats.push({ make: wide, blend: 4.2, hold: Infinity, enter: (s, T) => {
      overlay.bars(0, D.t);
      const names = plan.pois.filter(p => p !== plan.src).map(p => roomOf(p.e)?.name.toLowerCase()).filter(Boolean);
      overlay.caption(sys.name, names.length ? `${names.length} ${names.length === 1 ? "прибор" : names.length < 5 ? "прибора" : "приборов"}: ${[...new Set(names)].join(", ")}` : sub, D.t + T * 0.6, 9);
    } });
    program(beats);
    // полёты + общий план и узел ввода в начале (~20 с) + на каждую ногу переход, прибор в конце и перелёт (~14 с)
    const secs = Math.round(plan.legs.reduce((n, l) => n + glideShot(l, 0, 0).dur, 0) + 20 + plan.legs.length * 14);
    return { ok: true, op: "route", id: sys.id, name: sys.name, title: sys.name, sub, seconds: secs, legs: plan.legs.length };
  }
  // время на профиле, когда камера будет в точке s пути
  function timeAt(glide, s) {
    let lo = 0, hi = glide.prof.dur;
    for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (glide.prof.sAt(m) < s) lo = m; else hi = m; }
    return glide.delay + hi;
  }
  // короткая подпись прибора с комнатой, если комнаты нет в названии («Прибор спальни», «Конвектор … · офис»)
  const shortName = e => {
    const r = roomOf(e);
    const n = e.name.replace(/\s*\(.*\)$/, "").replace(/^Отопительный прибор\s+/i, "Прибор ");
    const stem = r ? r.name.toLowerCase().slice(0, Math.max(4, r.name.length - 2)) : "";
    return r && !n.toLowerCase().includes(stem) ? `${n} · ${r.name.toLowerCase()}` : n;
  };

  // экскурсия по комнатам: облёт, затем каждая комната по ~7 с, затем снова облёт
  function tour(cmd = {}) {
    begin("tour", cmd);
    restoreMep();
    api.select(null);
    const list = roomOrder();
    const cap = unitCaption();
    const beats = [{ make: t => overviewShot(t), hold: 3.5, enter: (s, T) => overlay.caption(cap.title, cap.sub, D.t + T * 0.5, 5) }];
    for (const r of list) {
      beats.push({ make: t => roomShot(r, t, { k: 0.95 }), hold: 5.2, enter: (s, T) => {
        clearFx();
        roomGlow(r);
        D.focus = r;
        const a = area(r);
        overlay.caption(r.name, a ? fmtArea(a) : "", D.t + T * 0.55, 5.2);
        overlay.minimap({ room: r.id, from: D.t + T * 0.3, to: D.t + T + 5.4 });
      } });
    }
    beats.push({ make: t => overviewShot(t), hold: Infinity, enter: () => { clearFx(); D.focus = null; } });
    program(beats);
    return { ok: true, op: "tour", title: cap.title, sub: `${list.length} помещений`, seconds: Math.round(8 + list.length * 8.5) };
  }
  // комнаты по кругу вокруг середины квартиры, начиная с прихожей
  function roomOrder() {
    const c = unitBox().getCenter(new V3());
    const list = rooms().map(r => { const b = box(r.id); const x = b.getCenter(new V3()); return { r, a: Math.atan2(x.y - c.y, x.x - c.x) }; });
    const start = list.find(x => /прихож|вход/i.test(x.r.name)) || list[0];
    list.sort((p, q) => wrap(p.a - start.a + TAU) - wrap(q.a - start.a + TAU));
    const i = list.indexOf(start);
    return [...list.slice(i), ...list.slice(0, i)].map(x => x.r);
  }

  // пульт: ◀ ▶ — соседняя комната, ▲ ▼ — ближе и дальше, ОК — пауза облёта
  function key(k) {
    if (k === "ok") { togglePause(); return { ok: true, op: "pause", paused: D.paused }; }
    if (k === "left" || k === "right") {
      const list = roomOrder();
      const at = D.focus ? list.findIndex(r => r.id === D.focus.id || api.ancestors(D.focus.id).some(a => a.id === r.id)) : -1;
      const n = list[(at < 0 ? (k === "right" ? 0 : list.length - 1) : at + (k === "right" ? 1 : -1) + list.length) % list.length];
      return room(n);
    }
    if (k === "up" || k === "down") {
      const s = D.shot instanceof Blend ? D.shot.to : D.shot;
      if (s instanceof Orbit) {
        const a = s.angles(D.t);
        const z = new Orbit({ c: s.c, d: clamp(s.d * (k === "up" ? 0.78 : 1.28), 1.2, 60), el: a.el, az: a.az, w: s.w,
                              sway: s.sway, swayPer: s.swayPer, breathe: s.breathe, per: s.per, fov: s.fov, t0: D.t });
        go(z, 1.4);
        return { ok: true, op: "zoom", k };
      }
      return { ok: true, op: "zoom", k, skipped: true };
    }
    return { ok: false, error: `кнопка ${k}` };
  }
  function togglePause() { D.paused = !D.paused; }

  function stop() {
    if (!D.active) return;
    clearFx();
    overlay.clear();
    restoreMep();
    D.beats = []; D.beat = -1; D.beatEnd = Infinity;
    D.active = false;
    delete camera.userData.nearCap;
    controls.target.copy(cur.q);
    camera.position.copy(cur.p);
    camera.up.copy(UP);
    controls.enabled = true;
    controls.update();
    api.invalidate();
  }

  // ── кадр ────────────────────────────────────────────────────────────────
  // now — мс (часы страницы или виртуальные часы потока)
  function tick(now) {
    clock(now);
    if (!D.active || !D.shot) return false;
    while (D.t >= D.beatEnd && D.beat < D.beats.length) advance();
    if (D.shot instanceof Blend && D.shot.done(D.t)) D.shot = D.shot.to;
    D.shot.pose(D.t, cur);
    camera.position.copy(cur.p);
    camera.up.copy(UP);
    camera.lookAt(cur.q);
    if (cur.roll) camera.rotateZ(cur.roll);
    if (Math.abs(camera.fov - cur.fov) > 1e-3) { camera.fov = cur.fov; camera.updateProjectionMatrix(); }
    controls.target.copy(cur.q);
    camera.updateMatrixWorld();
    for (const f of D.flows) {
      f.mesh.material.uniforms.uT.value = D.wall;
      f.mesh.material.uniforms.uA.value = smooth(f.born + 0.6, f.born + 2.2, D.t);
    }
    for (const g of D.glows) {                              // комната: проявляется и чуть дышит
      const k = smooth(g.born + 0.4, g.born + 1.6, D.t) * (0.88 + 0.12 * Math.sin(TAU * D.wall / 3.2));
      for (const [obj, prop, max] of g.mats) obj[prop] = max * k;
    }
    occlusion();
    return true;
  }

  // мебель и техника, в которые въезжает камера или которые закрывают цель, на время становятся прозрачными
  const ghostCache = new Map();
  const ray = new THREE.Ray();
  let fadeBoxes = null, fadeVer = -1;
  function occluders() {
    if (fadeBoxes && fadeVer === S.ver && fadeBoxes.n === S.obj.size) return fadeBoxes.list;
    const list = [];
    for (const [id, o] of S.obj) {
      const e = S.by.get(id);
      if (!e || !e._inUnit || !["furniture", "device", "storage"].includes(e.kind)) continue;
      const b = new THREE.Box3().setFromObject(o);
      if (b.isEmpty() || b.max.z - floorZ() <= 0.5) continue;
      // коробки деталей: у углового гарнитура общая коробка — это и воздух над нижними шкафами
      const parts = [];
      o.traverse(c => { if (c.isMesh) { const pb = new THREE.Box3().setFromObject(c); if (!pb.isEmpty()) parts.push(pb); } });
      list.push({ id, o, b, parts });
    }
    fadeBoxes = { list, n: S.obj.size };
    fadeVer = S.ver;
    return list;
  }
  const caster = new THREE.Raycaster();
  const blocks = new Map();                                 // id → загораживает ли (по геометрии, раз в 4 кадра)
  let occN = 0;
  function occlusion() {
    const want = new Map();
    occN++;
    // ближняя плоскость (app.js отодвигает её издалека ради точности глубины) не должна резать вещь, мимо которой
    // камера проходит вплотную: не дальше 0,6 расстояния до ближайшей детали мебели. Вещь, сквозь которую камера
    // летит, уже растворена (ниже) — её срез не виден, и она не в счёт
    let close = Infinity;
    for (const x of occluders()) {
      if ((D.fade.get(x.id) ?? 0) > 0.9 || x.b.distanceToPoint(cur.p) >= close) continue;
      for (const pb of x.parts) close = Math.min(close, pb.distanceToPoint(cur.p));
    }
    camera.userData.nearCap = 0.6 * Math.max(close, 0.03);
    if (D.op === "route" || D.op === "object" || D.op === "inside") {
      const p = cur.p;
      // лучи к цели: в центр кадра, а у выбранной вещи — ещё к её верху и верхним углам (кресло перед конвектором
      // закрывает его, хотя луч в самый центр проходит под сиденьем)
      const aims = [cur.q];
      if (D.op === "object" && D.focusBox) {
        const b = D.focusBox, c = b.getCenter(new V3());
        aims.push(c.clone().setZ(b.max.z), new V3(b.min.x, b.min.y, b.max.z), new V3(b.max.x, b.min.y, b.max.z),
                  new V3(b.min.x, b.max.y, b.max.z), new V3(b.max.x, b.max.y, b.max.z));
      }
      const rays = aims.map(q => ({ ray: new THREE.Ray(p.clone(), q.clone().sub(p).normalize()), dist: p.distanceTo(q) }));
      const hit = new V3();
      for (const x of occluders()) {
        if (D.focus && (x.id === D.focus.id || api.ancestors(D.focus.id).some(a => a.id === x.id))) continue;
        // камера внутри вещи или вплотную — вещь исчезает совсем; вещь между камерой и целью — полупрозрачна
        const near = x.b.distanceToPoint(p);
        let k = smooth(0.6, 0.1, near);
        const onWay = rays.filter(r => r.ray.intersectBox(x.b, hit) && hit.distanceTo(p) < r.dist - 0.2);
        if (onWay.length) {
          // коробка на пути — проверка по самой геометрии (у кровати коробка выше матраса, луч идёт над ним)
          if (occN % 4 === 0 || !blocks.has(x.id)) {
            blocks.set(x.id, onWay.some(r => {
              caster.ray.copy(r.ray);
              caster.near = 0; caster.far = r.dist - 0.15;
              return caster.intersectObject(x.o, true).some(h => h.object.isMesh && h.object.visible
                && !h.object.userData.xray && !h.object.material?.userData?.pick);
            }));
          }
          if (blocks.get(x.id)) k = Math.max(k, 0.8);
        } else blocks.delete(x.id);
        if (k > 0.01) want.set(x.id, k);
      }
    }
    for (const [id, f] of D.fade) if (!want.has(id)) want.set(id, 0);
    const dt = clamp(D.wall - (D.occAt ?? D.wall), 0, 0.1);
    D.occAt = D.wall;
    for (const [id, k] of want) {
      const f0 = D.fade.get(id) ?? 0, f = f0 + (k - f0) * Math.min(1, dt / 0.22);
      if (f < 0.01 && k === 0) D.fade.delete(id); else D.fade.set(id, f);
    }
  }
  // до кадра: прозрачные копии материалов у затухающей мебели; после кадра — обратно (просмотрщик ничего не теряет)
  const swapped = [];
  const tintCache = new Map(), GLOW = new THREE.Color(0xff7a18);
  function beforeRender() {
    for (const [id, born] of D.tint) {                       // выбранная вещь: тёплое свечение, дышит
      const o = S.obj.get(id);
      if (!o || !o.visible) continue;
      const k = smooth(born + 0.3, born + 1.3, D.t) * (0.5 + 0.22 * Math.sin(TAU * D.wall / 2.4));
      o.traverse(c => {
        if (!c.isMesh || !c.material || Array.isArray(c.material) || !c.material.isMeshStandardMaterial || c.userData.xray) return;
        const m0 = c.material;
        let g = tintCache.get(m0.uuid);
        if (!g) { g = m0.clone(); g.userData = {}; tintCache.set(m0.uuid, g); }
        g.color.copy(m0.color);                             // у устройства цвет меняет состояние HA
        g.emissive.copy(m0.emissive).lerp(GLOW, k);
        g.emissiveIntensity = Math.max(m0.emissiveIntensity || 0, 1) * (0.25 + 0.75 * k) * k;
        swapped.push([c, m0]);
        c.material = g;
      });
    }
    if (!D.fade.size) return;
    for (const [id, f] of D.fade) {
      const o = S.obj.get(id);
      if (!o || !o.visible) continue;
      o.traverse(c => {
        if (!c.isMesh || !c.material || Array.isArray(c.material) || c.material.userData?.pick || c.userData.xray) return;
        if (f > 0.97) { if (c.visible) { hidden.push(c); c.visible = false; } return; }
        const m0 = c.material, key = `${id}|${m0.uuid}`;      // у каждой вещи своя прозрачность
        let g = ghostCache.get(key);
        if (!g) { g = m0.clone(); g.transparent = true; g.depthWrite = false; g.userData = { ghost: true }; ghostCache.set(key, g); }
        g.opacity = (m0.opacity ?? 1) * (1 - f);
        swapped.push([c, m0]);
        c.material = g;
      });
    }
  }
  const hidden = [];
  function afterRender() {
    for (const [c, m] of swapped) c.material = m;
    for (const c of hidden) c.visible = true;
    swapped.length = 0;
    hidden.length = 0;
  }

  // Данные пересобрали (вещь добавили, пакет обновили): показ идёт дальше с того же места — планы и пути те же,
  // заново только подсветка и выбор, которые просмотрщик сбросил вместе со сценой. Начинать показ сначала нельзя:
  // камеру бросало бы к первому плану посреди пролёта.
  function onRebuild() {
    fadeBoxes = null;
    ghostCache.clear();
    tintCache.clear();
    blocks.clear();
    if (!D.active) return;
    if (D.lit) focus(D.lit.ids, D.lit.color);
    if (D.picked && S.by.has(D.picked)) api.select(D.picked, { fly: false });
    api.invalidate();
  }

  // чёрный экран до первой сцены: поток уже идёт, телевизор подключается, показ начнётся из темноты
  function blackout() { stop(); overlay.held = true; overlay.fadeA = 1; overlay.fadeT0 = Infinity; overlay.fadeDur = 1; }

  return {
    get active() { return D.active; },
    get t() { return D.t; },
    get op() { return D.op; },
    D, play, stop, tick, beforeRender, afterRender, onRebuild, overlay, rooms, roomOrder, blackout,
    setAspect(a) { D.aspect = a; },
  };
}

// ── поверх кадра: титры, подписи у вещей, мини-план, полосы, затемнение ──────
const FONT = `"Manrope", "Segoe UI", system-ui, sans-serif`;
const INK = "#f4f6fb", INK2 = "rgba(233,236,243,0.78)", ACCENT = "#ff7a18", CARD = "rgba(10,12,20,0.62)";

class Overlay {
  constructor(api, D) {
    this.api = api; this.D = D;
    this.caps = []; this.labels = []; this.map = null;
    this.barH = 0; this.barFrom = 0; this.barTo = 0; this.barT0 = 0;
    this.fadeA = 0; this.fadeT0 = 0; this.fadeDur = 0;
    this.vignette = null;
  }
  clear() { this.caps = []; this.labels = []; this.map = null; this.bars(0, this.D.t); }
  caption(title, sub, at, hold = 6, small = false) {
    for (const c of this.caps) if (c.out > at) c.out = Math.max(c.in + 0.3, at);    // новый титр сменяет старый
    this.caps.push({ title, sub, in: at, out: at + hold, small });
  }
  label(text, at, from, to, strong = false) { this.labels.push({ text, at: at.clone(), from, to, strong }); }
  minimap(o) { this.map = { ...o }; }
  bars(k, t) { this.barFrom = this.barNow(t); this.barTo = k; this.barT0 = t; }
  barNow(t) { return lerp(this.barFrom, this.barTo, smooth(this.barT0, this.barT0 + 1.1, t)); }
  fadeFrom(dur) { this.fadeA = 1; this.fadeT0 = this.D.t; this.fadeDur = dur; this.held = false; }

  // ctx — 2D-контекст размером кадра; холст уже содержит кадр сцены (поток) или прозрачен (браузер)
  draw(ctx, W, H) {
    const t = this.D.t, s = H / 1080;
    if (this.D.active) this.drawVignette(ctx, W, H);
    for (const l of this.labels) this.drawLabel(ctx, l, t, W, H, s);
    if (this.map) this.drawMap(ctx, t, W, H, s);
    const bar = this.barNow(t) * H;
    if (bar > 0.5) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, bar);
      ctx.fillRect(0, H - bar, W, bar);
    }
    for (const c of this.caps) this.drawCaption(ctx, c, t, W, H, s, bar);
    this.caps = this.caps.filter(c => c.out + 1 > t);
    this.labels = this.labels.filter(l => l.to + 1 > t);
    if (this.fadeA > 0) {
      const a = this.held ? 1 : 1 - smooth(this.fadeT0, this.fadeT0 + this.fadeDur, t);
      if (a <= 0) this.fadeA = 0;
      else { ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(0, 0, W, H); }
    }
  }

  drawVignette(ctx, W, H) {
    if (!this.vignette || this.vignette.width !== W || this.vignette.height !== H) {
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const g = c.getContext("2d"), r = g.createRadialGradient(W / 2, H * 0.48, H * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
      r.addColorStop(0, "rgba(0,0,0,0)");
      r.addColorStop(1, "rgba(0,0,0,0.42)");
      g.fillStyle = r;
      g.fillRect(0, 0, W, H);
      this.vignette = c;
    }
    ctx.drawImage(this.vignette, 0, 0);
  }

  drawCaption(ctx, c, t, W, H, s, bar) {
    const a = smooth(c.in, c.in + 0.7, t) * (1 - smooth(c.out, c.out + 0.7, t));
    if (a <= 0.003) return;
    const big = c.small ? 44 : 60, sub = c.small ? 26 : 30;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = `700 ${big * s}px ${FONT}`;
    const tw = ctx.measureText(c.title).width;
    ctx.font = `500 ${sub * s}px ${FONT}`;
    const sw = c.sub ? ctx.measureText(c.sub).width : 0;
    const padX = 34 * s, padY = 26 * s, gap = c.sub ? 12 * s : 0;
    const w = Math.max(tw, sw) + padX * 2 + 14 * s, h = big * s + (c.sub ? sub * s + gap : 0) + padY * 2;
    const x = 88 * s, y = H - Math.max(bar, 0) - 70 * s - h + (1 - smooth(c.in, c.in + 0.8, t)) * 22 * s;
    round(ctx, x, y, w, h, 20 * s);
    ctx.fillStyle = CARD;
    ctx.fill();
    ctx.fillStyle = ACCENT;
    round(ctx, x + 18 * s, y + padY + 4 * s, 6 * s, h - padY * 2 - 8 * s, 3 * s);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.textBaseline = "top";
    ctx.font = `700 ${big * s}px ${FONT}`;
    ctx.fillText(c.title, x + padX + 14 * s, y + padY - 2 * s);
    if (c.sub) {
      ctx.fillStyle = INK2;
      ctx.font = `500 ${sub * s}px ${FONT}`;
      ctx.fillText(c.sub, x + padX + 14 * s, y + padY + big * s + gap);
    }
    ctx.restore();
  }

  drawLabel(ctx, l, t, W, H, s) {
    const a = smooth(l.from, l.from + 0.5, t) * (1 - smooth(l.to, l.to + 0.5, t));
    if (a <= 0.003) return;
    const v = l.at.clone().project(this.api.camera);
    if (v.z > 1 || v.z < -1) return;
    const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
    if (x < -50 || x > W + 50 || y < -50 || y > H + 50) return;
    ctx.save();
    ctx.globalAlpha = a;
    const fs = (l.strong ? 30 : 25) * s;
    ctx.font = `600 ${fs}px ${FONT}`;
    const tw = ctx.measureText(l.text).width, padX = 16 * s, h = fs + 18 * s;
    const lx = x + 34 * s, ly = y - 86 * s;
    const bx = Math.min(Math.max(lx, 16 * s), W - tw - padX * 2 - 16 * s), by = Math.max(ly - h, 16 * s);
    ctx.strokeStyle = "rgba(244,246,251,0.85)";
    ctx.lineWidth = 2 * s;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(bx + 10 * s, by + h); ctx.stroke();
    ctx.fillStyle = ACCENT;
    ctx.beginPath(); ctx.arc(x, y, 7 * s, 0, TAU); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 2 * s; ctx.stroke();
    round(ctx, bx, by, tw + padX * 2, h, h / 2);
    ctx.fillStyle = l.strong ? "rgba(255,122,24,0.92)" : CARD;
    ctx.fill();
    ctx.fillStyle = l.strong ? "#1a0c00" : INK;
    ctx.textBaseline = "middle";
    ctx.fillText(l.text, bx + padX, by + h / 2 + 1 * s);
    ctx.restore();
  }

  // мини-план в углу: комнаты, трасса, камера с конусом взгляда (план квартиры в её собственной системе)
  drawMap(ctx, t, W, H, s) {
    const m = this.map, a = smooth(m.from, m.from + 0.8, t) * (m.to === Infinity ? 1 : 1 - smooth(m.to, m.to + 0.8, t));
    if (a <= 0.003) return;
    const { S, mat4, camera } = this.api;
    if (!S.unit) return;
    if (!this.plan || this.plan.ver !== S.ver) {
      const inv = mat4(S.unit).clone().invert(), rooms = [];
      for (const e of S.data.entities) {
        if (e.kind !== "space" || !e._inUnit || !e.geom?.outline) continue;
        const m4 = inv.clone().multiply(mat4(e));
        rooms.push({ id: e.id, pts: e.geom.outline.map(([x, y]) => { const v = new V3(x, y, 0).applyMatrix4(m4); return [v.x, v.y]; }) });
      }
      const xs = rooms.flatMap(r => r.pts.map(p => p[0])), ys = rooms.flatMap(r => r.pts.map(p => p[1]));
      this.plan = { ver: S.ver, rooms, inv, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    }
    const P = this.plan, bw = 400 * s, bh = 300 * s, pad = 22 * s;
    const k = Math.min((bw - pad * 2) / (P.x1 - P.x0), (bh - pad * 2) / (P.y1 - P.y0));
    const ox = W - bw - 56 * s, oy = 56 * s + this.barNow(t) * H;
    const X = x => ox + pad + (x - P.x0) * k + ((bw - pad * 2) - (P.x1 - P.x0) * k) / 2;
    const Y = y => oy + bh - pad - (y - P.y0) * k - ((bh - pad * 2) - (P.y1 - P.y0) * k) / 2;
    const loc = v => { const u = v.clone().applyMatrix4(P.inv); return [X(u.x), Y(u.y)]; };
    ctx.save();
    ctx.globalAlpha = a;
    round(ctx, ox, oy, bw, bh, 18 * s);
    ctx.fillStyle = CARD;
    ctx.fill();
    ctx.clip();                                             // камера вдали от квартиры — её значок не вылезает за рамку
    for (const r of P.rooms) {
      ctx.beginPath();
      r.pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      ctx.closePath();
      ctx.fillStyle = r.id === m.room ? "rgba(255,122,24,0.42)" : "rgba(255,255,255,0.07)";
      ctx.fill();
      ctx.strokeStyle = "rgba(244,246,251,0.45)";
      ctx.lineWidth = 1.5 * s;
      ctx.stroke();
    }
    if (m.route) {
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (const ln of m.route.lines) {
        ctx.beginPath();
        ln.pts.forEach((p, i) => { const [x, y] = loc(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.strokeStyle = "rgba(255,106,61,0.95)";
        ctx.lineWidth = 4 * s;
        ctx.stroke();
      }
      for (const p of m.route.pois) {
        const [x, y] = loc(p.c);
        ctx.beginPath(); ctx.arc(x, y, (p === m.route.src ? 7 : 5.5) * s, 0, TAU);
        ctx.fillStyle = p === m.route.src ? ACCENT : "#ffd2bd";
        ctx.fill();
      }
    }
    // камера: точка и конус взгляда
    const [cx, cy] = loc(camera.position);
    const look = new V3(); camera.getWorldDirection(look);
    const end = camera.position.clone().addScaledVector(look.setZ(0).normalize(), 1.6);
    const [lx, ly] = loc(end), ang = Math.atan2(ly - cy, lx - cx);
    const half = Math.atan(Math.tan(rad(camera.fov / 2)) * camera.aspect);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, 46 * s, ang - half, ang + half);
    ctx.closePath();
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 46 * s);
    g.addColorStop(0, "rgba(255,255,255,0.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, 7 * s, 0, TAU);
    ctx.fillStyle = "#fff"; ctx.fill();
    ctx.restore();
  }
}

function round(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
