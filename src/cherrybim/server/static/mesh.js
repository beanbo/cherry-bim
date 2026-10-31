// Cherry BiM — готовые 3D-модели (geom.type "mesh"): GLB, который пишет cherrybim.io_mesh (модели для 3D-печати,
// переведённые в метры и упрощённые). Читаем сами, без GLTFLoader: в таком файле только вершины, индексы и цвет
// материала на часть — ни текстур, ни анимации. Нормали — со складками по углу (печатные детали — плоские грани и
// скругления), координаты — уже в системе сущности.
import * as THREE from "three";
import { toCreasedNormals } from "./vendor/jsm/utils/BufferGeometryUtils.js";

const cache = new Map();                                   // адрес → Promise<[{geo, color, rough, metal}]>
const COMP = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array };
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

export function loadMesh(url) {
  if (!cache.has(url)) {
    const p = fetch(url).then(r => {
      if (!r.ok) throw new Error(`модель ${url}: ${r.status}`);
      return r.arrayBuffer();
    }).then(parseGLB);
    p.catch(() => cache.delete(url));                      // не вышло — в следующий раз попробуем снова
    cache.set(url, p);
  }
  return cache.get(url);
}

// GLB 2.0 → части: геометрия (со складками нормалей) и материал glTF (baseColorFactor, roughness, metallic)
export function parseGLB(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2) throw new Error("не GLB 2.0");
  const jsonLen = dv.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const binAt = 20 + jsonLen + 8;
  const read = i => {
    const a = gltf.accessors[i], bv = gltf.bufferViews[a.bufferView];
    const T = COMP[a.componentType], n = a.count * WIDTH[a.type];
    const at = binAt + (bv.byteOffset || 0) + (a.byteOffset || 0);
    return new T(buf.slice(at, at + n * T.BYTES_PER_ELEMENT));
  };
  const parts = [];
  const visit = (ni, parent) => {                          // узлы сцены: матрица или TRS, дети
    const node = gltf.nodes[ni], m = new THREE.Matrix4();
    if (node.matrix) m.fromArray(node.matrix);
    else m.compose(new THREE.Vector3(...(node.translation || [0, 0, 0])),
      new THREE.Quaternion(...(node.rotation || [0, 0, 0, 1])), new THREE.Vector3(...(node.scale || [1, 1, 1])));
    m.premultiply(parent);
    for (const pr of node.mesh != null ? gltf.meshes[node.mesh].primitives : []) {
      let geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(read(pr.attributes.POSITION), 3));
      if (pr.indices != null) geo.setIndex(new THREE.BufferAttribute(read(pr.indices), 1));
      geo.applyMatrix4(m);
      geo = toCreasedNormals(geo, Math.PI / 6);
      geo.computeBoundingBox();
      const mt = gltf.materials?.[pr.material]?.pbrMetallicRoughness || {};
      const [r, g, b] = mt.baseColorFactor || [0.6, 0.6, 0.6, 1];
      parts.push({ geo, color: new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace).getHex(),
        rough: mt.roughnessFactor ?? 0.6, metal: mt.metallicFactor ?? 0 });
    }
    for (const c of node.children || []) visit(c, m);
  };
  for (const ni of gltf.scenes[gltf.scene || 0].nodes) visit(ni, new THREE.Matrix4());
  return parts;
}
