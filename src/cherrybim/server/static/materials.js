// Cherry BiM — материалы без текстур: цвет, шероховатость, металличность. Реализм дают форма и свет, а не картинки.
import * as THREE from "three";

const cache = new Map();

// Материал по цвету и свойствам поверхности; одинаковые запросы получают один и тот же объект
export function pbr(color, o = {}) {
  const key = JSON.stringify([color, o]);
  let m = cache.get(key);
  if (!m) {
    const { rough = 0.8, metal = 0, ...rest } = o;
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...rest });
    cache.set(key, m);
  }
  return m;
}

// Цвет из подсказок пакета: props.render.colors = {"front": "#7d8b6a", "*": "#ffffff"}
export function hex(v, fallback) {
  if (typeof v === "string" && /^#?[0-9a-f]{6}$/i.test(v.trim())) return parseInt(v.trim().replace("#", ""), 16);
  return fallback;
}

export const C = {
  paint: 0xf1eee8, ceiling: 0xfafafa, cut: 0x8d939b, slab: 0xb9b6b0, concrete: 0xc4c1bb,
  laminate: 0xe6dfd3, tile: 0xeef0f1, tileWood: 0xa9805c, loggia: 0xcdc8bf, skirting: 0xf6f5f2,
  pvc: 0xf6f6f3, white: 0xf4f3ef, oak: 0xc4a27a, walnut: 0x7a5236, hickory: 0xb39069,
  fabric: 0x9aa3ad, linen: 0xf3f1ec, duvet: 0xe9e4da, steel: 0xc6c9cc, black: 0x1f2022, graphite: 0x3a3d41,
  red: 0xa8322b, glass: 0xbfdbe6, chrome: 0xe6e8ea, ceramic: 0xfbfbfa,
};

// Палитра по назначению. Цвет конкретной вещи можно переопределить через props.render.colors.
export const M = {
  paint: pbr(C.paint, { rough: 0.93 }),
  ceiling: pbr(C.ceiling, { rough: 0.95, side: THREE.BackSide }),   // виден только снизу, из комнаты
  cutTop: pbr(C.cut, { rough: 0.9 }),
  slab: pbr(C.slab, { rough: 0.95 }),
  concrete: pbr(C.concrete, { rough: 0.95 }),
  laminate: pbr(C.laminate, { rough: 0.55 }),
  tile: pbr(C.tile, { rough: 0.22 }),
  loggia: pbr(C.loggia, { rough: 0.8 }),
  skirting: pbr(C.skirting, { rough: 0.5 }),
  pvc: pbr(C.pvc, { rough: 0.35 }),
  glass: pbr(C.glass, { rough: 0.04, transparent: true, opacity: 0.18, depthWrite: false, envMapIntensity: 1.6 }),
  mirror: pbr(0xdfe6ea, { rough: 0.08, metal: 0.25 }),   // в зеркале — светлая комната, не тёмный металл
  chrome: pbr(C.chrome, { rough: 0.12, metal: 1 }),
  steel: pbr(C.steel, { rough: 0.32, metal: 0.85 }),
  brushed: pbr(0xb9bcbf, { rough: 0.45, metal: 0.8 }),
  black: pbr(C.black, { rough: 0.45 }),
  blackGlass: pbr(0x121315, { rough: 0.06, metal: 0.2 }),
  graphite: pbr(C.graphite, { rough: 0.5 }),
  rubber: pbr(0x2a2b2d, { rough: 0.9 }),
  ceramic: pbr(C.ceramic, { rough: 0.1 }),
  enamel: pbr(0xfcfcfb, { rough: 0.14 }),
  white: pbr(C.white, { rough: 0.55 }),
  whiteMatte: pbr(C.white, { rough: 0.85 }),
  fabric: pbr(C.fabric, { rough: 0.97 }),
  linen: pbr(C.linen, { rough: 0.95 }),
  duvet: pbr(C.duvet, { rough: 0.97 }),
  oak: pbr(C.oak, { rough: 0.6 }),
  hickory: pbr(C.hickory, { rough: 0.6 }),
  walnut: pbr(C.walnut, { rough: 0.6 }),
  red: pbr(C.red, { rough: 0.5 }),
  water: pbr(0x2e86de, { rough: 0.4 }),
  heat: pbr(0xd9483b, { rough: 0.4 }),
  cold: pbr(0x3b7dd8, { rough: 0.4 }),
  cable: pbr(0xf2a23a, { rough: 0.5 }),
  copper: pbr(0xb87333, { rough: 0.35, metal: 0.9 }),
  brass: pbr(0xc9a24a, { rough: 0.35, metal: 0.9 }),
  plastic: pbr(0xe9eaec, { rough: 0.4 }),
  screen: pbr(0x0d0f12, { rough: 0.2 }),
  led: pbr(0xfff3d6, { rough: 0.3, emissive: 0xfff3d6, emissiveIntensity: 0.5 }),
  display: pbr(0x15171a, { rough: 0.2, emissive: 0x2a7fd4, emissiveIntensity: 0.25 }),
  grass: pbr(0x9cc77a, { rough: 1 }),
  asphalt: pbr(0x8e9399, { rough: 0.95 }),
  ground: pbr(0xd6d1c4, { rough: 1 }),
};

// Матовый цвет (мебель, ткань) и глянец (фасады, пластик) по hex
export const matte = color => pbr(color, { rough: 0.85 });
export const satin = color => pbr(color, { rough: 0.5 });
export const gloss = color => pbr(color, { rough: 0.18 });
