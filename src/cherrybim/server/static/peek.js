// Cherry BiM — предпросмотр в окошке: выбрали ящик, полку или мебель с готовой моделью (geom "mesh") и местами
// хранения внутри — сбоку крупно эта модель, места подписаны по именам. Её крутят мышью или пальцем, щелчок по месту
// выбирает его в двойнике. В основной сцене вещь размером с ладонь теряется, а здесь видно перегородки и что где.
// Своя сцена и свой контекст WebGL: основной кадр (тени, затенение углов) не трогается, модели — те же (кэш mesh.js).
import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { RoomEnvironment } from "./vendor/jsm/environments/RoomEnvironment.js";
import { loadMesh } from "./mesh.js";
import { pbr, hex } from "./materials.js";

const SEL = 0xe4572e;                                      // как выбор в основной сцене
const PICK = new THREE.MeshBasicMaterial({ visible: false });
const MARK = new THREE.MeshBasicMaterial({ color: SEL, transparent: true, opacity: 0.22, depthWrite: false });
const EDGE = new THREE.LineBasicMaterial({ color: SEL });

// что показать для выбранного: оно само или ближайшее выше по дереву с готовой моделью — место хранения или мебель
// с местами внутри (вещь в отсеке → её ящик); комната и всё, что выше мебели, окошко не открывают
export function subjectOf(e, { S, ancestors, descendants }) {
  for (const x of e ? [e, ...ancestors(e.id)] : []) {
    if (x.kind === "item") continue;
    if (x.kind !== "storage" && x.kind !== "furniture") return null;
    if (x.geom?.type === "mesh" && (x.kind === "storage" || descendants(x.id).some(k => k.kind === "storage"))) return x;
  }
  return null;
}

// env: S, esc, ancestors, descendants, mat4, meshUrl(e), select(id, opt), off (экран ТВ — окошка нет)
export function createPeek(env) {
  const { S, esc } = env;
  const root = document.querySelector("#peek");
  if (!root || env.off) return { show() {} };
  const canvas = root.querySelector("canvas"), tags = root.querySelector(".tags");
  const title = root.querySelector("header b"), hint = root.querySelector(".hint"), up = root.querySelector('[data-peek="up"]');
  let renderer = null, scene, camera, controls, content, marks, dirty = false, raf = 0;
  let subject = null, builtVer = -1, closed = null, labels = [];
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), v3 = new THREE.Vector3();

  function init() {                                        // контекст WebGL — только когда окошко впервые нужно
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.NeutralToneMapping;
    scene = new THREE.Scene();
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.6;
    const key = new THREE.DirectionalLight(0xffffff, 1.6);   // свет спереди слева сверху, как в основной сцене
    key.position.set(-0.5, -1, 1.3);
    content = new THREE.Group();
    marks = new THREE.Group();
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d5ce, 0.7), key, content, marks);
    camera = new THREE.PerspectiveCamera(30, 1, 0.005, 50);
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.15;
    controls.addEventListener("change", invalidate);
    new ResizeObserver(resize).observe(canvas);
    let down = null;
    canvas.addEventListener("pointerdown", ev => { down = [ev.clientX, ev.clientY]; });
    canvas.addEventListener("pointerup", ev => {
      if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 6) return;
      down = null;
      const r = canvas.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      // место внутри важнее того, во что оно вложено: первое по лучу место, иначе то, что попало первым
      const hits = ray.intersectObjects(content.children, true).map(h => h.object.userData.id).filter(Boolean);
      const id = hits.find(i => i !== subject?.id) || hits[0];
      if (id && id !== S.sel?.id) env.select(id, { fly: false });
    });
  }

  function invalidate() { dirty = true; kick(); }
  function kick() { if (!raf && !root.hidden) raf = requestAnimationFrame(tick); }
  function tick() {
    raf = 0;
    if (root.hidden) return;
    const moving = controls.update();
    if (dirty || moving) { dirty = false; renderer.render(scene, camera); place(); }
    if (moving) kick();
  }
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    invalidate();
  }

  // подписи мест — поверх холста, там, куда проецируется их точка; шириной не больше места на экране, у узкого
  // места — только первая строка
  const px = (p, w, h) => { v3.copy(p).project(camera); return [(v3.x * 0.5 + 0.5) * w, (-v3.y * 0.5 + 0.5) * h, v3.z]; };
  function place() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const l of labels) {
      const [x, y, z] = px(l.at, w, h);
      const out = z > 1 || z < -1 || x < -10 || y < -10 || x > w + 10 || y > h + 10;
      l.el.style.display = out ? "none" : "";
      if (out) continue;
      const span = Math.hypot(...[0, 1].map(i => px(l.a, w, h)[i] - px(l.b, w, h)[i]));
      l.el.style.maxWidth = `${Math.max(64, Math.min(140, span + 6))}px`;
      l.el.classList.toggle("short", span < 70);
      l.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    }
  }

  function clear(group) {
    for (const c of [...group.children]) {
      c.traverse(x => { if (x.userData.own) x.geometry.dispose(); });   // свои объёмы и рамки; сетки моделей — общие с кэшем
      group.remove(c);
    }
  }

  // объект места в сцене окошка и его габарит в системе показанного
  const objOf = id => content.children.find(c => c.userData.id === id);
  function boxOf(id) {
    const o = objOf(id);
    return o ? new THREE.Box3().setFromObject(o) : null;
  }

  function build(x) {
    clear(content);
    clear(marks);
    tags.innerHTML = "";
    labels = [];
    const inv = env.mat4(x).clone().invert();
    const rel = e => new THREE.Matrix4().multiplyMatrices(inv, env.mat4(e));
    const waits = [];
    for (const e of [x, ...env.descendants(x.id)]) {
      if (e.geom?.type === "mesh") {
        const g = new THREE.Group();
        g.matrixAutoUpdate = false;
        g.matrix.copy(rel(e));
        g.userData.id = e.id;
        content.add(g);
        const colors = e.props?.render?.colors || {}, paint = hex(colors.body ?? colors["*"], null);
        waits.push(loadMesh(env.meshUrl(e)).then(parts => {
          for (const p of parts) {
            const m = new THREE.Mesh(p.geo, pbr(paint ?? p.color, { rough: p.rough, metal: p.metal }));
            m.userData.id = e.id;
            g.add(m);
          }
        }).catch(err => console.warn("предпросмотр", e.name, err.message)));
      } else if (e.kind === "storage" && e.geom?.type === "box") {   // место без своей модели — невидимый объём
        const [sx, sy, sz] = e.geom.size, geo = new THREE.BoxGeometry(sx, sy, sz);
        geo.translate(sx / 2, sy / 2, sz / 2);
        const m = new THREE.Mesh(geo, PICK);
        m.matrixAutoUpdate = false;
        m.matrix.copy(rel(e));
        m.userData = { id: e.id, own: true };
        content.add(m);
      }
    }
    title.textContent = x.name;
    const top = subjectOf(env.ancestors(x.id)[0], env);
    up.hidden = !top;
    up.title = top ? `Показать: ${top.name}` : "";
    up.dataset.id = top?.id || "";
    const kids = (S.kids.get(x.id) || []).filter(k => k.kind === "storage");
    hint.textContent = kids.length ? (x.kind === "furniture" ? "Щёлкните по ящику" : "Щёлкните по отсеку") : "Внутри пусто";
    Promise.all(waits).then(() => {
      if (subject !== x) return;                           // пока грузилось, выбрали другое
      content.updateMatrixWorld(true);
      frame(x);
      for (const k of kids) {
        const b = boxOf(k.id);
        if (!b || b.isEmpty()) continue;
        const c = b.getCenter(new THREE.Vector3());
        // ящик подписан по фасаду слева (посередине — ручка с этикеткой), отсек и полка — по верху; a–b — ширина
        // места для подписи
        const front = k.type === "drawer", y = front ? b.min.y : c.y, z = front ? c.z : b.max.z;
        if (front) { const w = b.max.x - b.min.x; c.x = b.min.x + w * 0.21; b.min.x = c.x - w * 0.2; b.max.x = c.x + w * 0.2; }
        const el = document.createElement("button");
        el.className = "tag" + (k.props?.free ? " free" : "");
        el.dataset.id = k.id;
        el.title = k.name;
        el.innerHTML = String(k.props?.render?.label ?? k.name).split("\n").map(s => `<span>${esc(s)}</span>`).join("");
        tags.append(el);
        labels.push({ el, id: k.id, at: new THREE.Vector3(c.x, y, z), a: new THREE.Vector3(b.min.x, y, z), b: new THREE.Vector3(b.max.x, y, z) });
      }
      mark();
    });
  }

  // камера: мебель — спереди, ящик — сверху чуть спереди, как схема раскладки; ближе некуда, но всё в кадре
  function frame(x) {
    const box = new THREE.Box3().setFromObject(content);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const el = THREE.MathUtils.degToRad(x.kind === "furniture" ? 20 : 68), az = THREE.MathUtils.degToRad(x.kind === "furniture" ? -28 : -10);
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el));
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(i => new THREE.Vector3(i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
    let d = s.length() * 2;
    for (let i = 0; i < 6; i++) {                          // габарит на экране ~ 1/расстояние: пара шагов — и сошлось
      camera.position.copy(c).addScaledVector(dir, d);
      camera.near = d / 100;
      camera.far = d * 10;
      camera.lookAt(c);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      const m = Math.max(...corners.map(p => { v3.copy(p).project(camera); return Math.max(Math.abs(v3.x), Math.abs(v3.y)); }));
      d *= m / 0.92;
    }
    controls.target.copy(c);
    controls.update();
    invalidate();
  }

  // выбранное внутри показанного: его место (или место, где лежит выбранная вещь) — рамкой и подсветкой
  function mark() {
    clear(marks);
    const chain = S.sel ? [S.sel, ...env.ancestors(S.sel.id)] : [];
    const kid = subject && chain.find(a => a.parent === subject.id && a.kind === "storage");
    for (const l of labels) l.el.classList.toggle("on", l.id === kid?.id);
    const b = kid && boxOf(kid.id);
    if (b && !b.isEmpty()) {
      const s = b.getSize(new THREE.Vector3()), geo = new THREE.BoxGeometry(s.x, s.y, s.z);
      geo.translate(...b.getCenter(new THREE.Vector3()).toArray());
      const vol = new THREE.Mesh(geo, MARK), edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), EDGE);
      vol.userData.own = edges.userData.own = true;
      marks.add(vol, edges);
    }
    invalidate();
  }

  function show(e) {
    const x = subjectOf(e, env);
    if (!x || env.off) { closed = null; subject = null; root.hidden = true; return; }
    if (closed === x.id) return;                           // закрыли крестиком — до выбора чего-то другого
    closed = null;
    if (!renderer) {
      try { init(); } catch (err) {                        // нет WebGL для второго холста — живём без окошка
        console.warn("предпросмотр: нет WebGL", err.message);
        renderer = null;
        env.off = true;
        return;
      }
    }
    const fresh = root.hidden;
    root.hidden = false;
    if (fresh) resize();
    if (subject?.id !== x.id || builtVer !== S.ver) { subject = x; builtVer = S.ver; build(x); }
    else { subject = x; mark(); }
  }

  root.addEventListener("click", ev => {
    const t = ev.target.closest("[data-id], [data-peek]");
    if (!t) return;
    if (t.dataset.peek === "close") { closed = subject?.id ?? null; root.hidden = true; return; }
    if (t.dataset.peek === "big") { root.classList.toggle("big"); return; }
    if (t.dataset.id) env.select(t.dataset.id, { fly: false });
  });
  new ResizeObserver(() => { if (renderer && !root.hidden) resize(); }).observe(root);
  return { show };
}
