# -*- coding: utf-8 -*-
"""Готовые 3D-модели для двойника: из 3MF или STL (модели для 3D-печати) — в компактный glTF (GLB) для просмотрщика.

Сущность с такой моделью — геометрия `mesh` с путём `asset` внутри папки моделей сервера (по умолчанию DATA/assets).
Модели для печати тяжёлые (держатель швабры — 15 тыс. треугольников, плита мультиборда — сотни тысяч) и в
миллиметрах. `mesh_to_glb` переводит в метры, поворачивает, кладёт начало в угол габарита (как у коробки: модель
тянется по +X, +Y, +Z от начала своей системы), упрощает слиянием вершин по сетке, пока треугольников больше
max_tris, и пишет GLB: по сетке на часть модели, цвет — материалом. Нормали просмотрщик считает сам (со складками),
поэтому в файле только вершины и индексы.

    python -m cherrybim.io_mesh ВХОД.3mf ВЫХОД.glb [--rot-z 45] [--color "#222222"] [--max-tris 20000]
"""
from __future__ import annotations

import argparse
import json
import math
import struct
import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree as ET

import numpy as np

_CORE = "{http://schemas.microsoft.com/3dmanufacturing/core/2015/02}"
_PROD = "{http://schemas.microsoft.com/3dmanufacturing/production/2015/06}"


class MeshError(ValueError):
    """Файл не прочитать как модель."""


@dataclass
class Part:
    name: str
    vertices: np.ndarray            # (n, 3) float64, единицы исходника
    triangles: np.ndarray           # (m, 3) int64


# ── чтение ────────────────────────────────────────────────────────────────────
def _transform(t: str | None) -> np.ndarray:
    """Матрица 3MF «m00 m01 m02 m10 … m32» (строки — оси) → 4×4 для столбцов-векторов."""
    m = np.eye(4)
    if t:
        v = [float(x) for x in t.split()]
        if len(v) != 12:
            raise MeshError(f"странная матрица 3MF: {t!r}")
        m[:3, :3] = np.array(v[:9]).reshape(3, 3).T
        m[:3, 3] = v[9:]
    return m


def read_3mf(path: str | Path) -> list[Part]:
    """Все объекты сборки 3MF с учётом компонентов (в том числе в других файлах архива, как у Bambu и Orca) и
    матриц размещения на столе."""
    try:
        z = zipfile.ZipFile(path)
    except zipfile.BadZipFile as e:
        raise MeshError(f"{path}: не 3MF") from e
    models = {"/" + n: ET.fromstring(z.read(n)) for n in z.namelist() if n.endswith(".model")}
    if "/3D/3dmodel.model" not in models:
        raise MeshError(f"{path}: нет 3D/3dmodel.model")
    objects = {}
    for fname, root in models.items():
        for o in root.iter(_CORE + "object"):
            objects[(fname, o.get("id"))] = o
    parts: list[Part] = []

    def walk(fname: str, oid: str, m: np.ndarray, name: str | None, depth: int = 0) -> None:
        o = objects.get((fname, oid))
        if o is None or depth > 16:
            raise MeshError(f"{path}: нет объекта {oid} в {fname}")
        name = o.get("name") or name or f"object {oid}"
        mesh = o.find(_CORE + "mesh")
        if mesh is not None:
            vs = np.array([[float(v.get("x")), float(v.get("y")), float(v.get("z"))]
                           for v in mesh.find(_CORE + "vertices")], dtype=np.float64)
            ts = np.array([[int(t.get("v1")), int(t.get("v2")), int(t.get("v3"))]
                           for t in mesh.find(_CORE + "triangles")], dtype=np.int64)
            if len(vs) and len(ts):
                parts.append(Part(name, (np.c_[vs, np.ones(len(vs))] @ m.T)[:, :3], ts))
        comps = o.find(_CORE + "components")
        for c in comps if comps is not None else []:
            walk(c.get(_PROD + "path") or fname, c.get("objectid"), m @ _transform(c.get("transform")), name, depth + 1)

    build = models["/3D/3dmodel.model"].find(_CORE + "build")
    for item in build if build is not None else []:
        walk("/3D/3dmodel.model", item.get("objectid"), _transform(item.get("transform")), None)
    if not parts:
        raise MeshError(f"{path}: в сборке нет сеток")
    return parts


def read_stl(path: str | Path) -> list[Part]:
    data = Path(path).read_bytes()
    if len(data) >= 84:
        n = struct.unpack_from("<I", data, 80)[0]
        if 84 + n * 50 == len(data):                      # двоичный
            rec = np.frombuffer(data, dtype=np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")]),
                                count=n, offset=84)
            return [_from_soup(Path(path).stem, rec["v"].reshape(-1, 3).astype(np.float64))]
    text = data.decode("ascii", "replace")
    if "facet" not in text:
        raise MeshError(f"{path}: не STL")
    vs = [[float(x) for x in ln.split()[1:4]] for ln in text.splitlines() if ln.strip().startswith("vertex")]
    return [_from_soup(Path(path).stem, np.array(vs, dtype=np.float64))]


def _from_soup(name: str, soup: np.ndarray) -> Part:
    """Треугольники без индексов (STL) → общие вершины."""
    v, inv = np.unique(np.round(soup, 6), axis=0, return_inverse=True)
    return Part(name, v, inv.reshape(-1, 3).astype(np.int64))


def read_mesh(path: str | Path) -> list[Part]:
    suffix = Path(path).suffix.lower()
    if suffix == ".3mf":
        return read_3mf(path)
    if suffix == ".stl":
        return read_stl(path)
    raise MeshError(f"{path}: умею 3MF и STL")


# ── упрощение ─────────────────────────────────────────────────────────────────
def cluster(vertices: np.ndarray, triangles: np.ndarray, cell: float) -> tuple[np.ndarray, np.ndarray]:
    """Слить вершины в ячейках сетки шага cell (среднее), выбросить выродившиеся и повторные треугольники."""
    keys = np.floor(vertices / cell).astype(np.int64)
    uniq, inv = np.unique(keys, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    sums = np.zeros((len(uniq), 3))
    np.add.at(sums, inv, vertices)
    counts = np.bincount(inv, minlength=len(uniq)).reshape(-1, 1)
    t = inv[triangles]
    t = t[(t[:, 0] != t[:, 1]) & (t[:, 1] != t[:, 2]) & (t[:, 0] != t[:, 2])]
    _, first = np.unique(np.sort(t, axis=1), axis=0, return_index=True)
    t = t[np.sort(first)]
    used = np.unique(t)
    remap = np.full(len(uniq), -1, dtype=np.int64)
    remap[used] = np.arange(len(used))
    return (sums / counts)[used], remap[t]


def simplify(vertices: np.ndarray, triangles: np.ndarray, max_tris: int) -> tuple[np.ndarray, np.ndarray]:
    """Укрупнять сетку слияния, пока треугольников больше max_tris (шаг от 1/2000 габарита, ×1,25 за раз)."""
    if len(triangles) <= max_tris:
        return vertices, triangles
    span = float(np.linalg.norm(vertices.max(0) - vertices.min(0))) or 1.0
    cell = span / 2000
    v, t = vertices, triangles
    for _ in range(40):
        v, t = cluster(vertices, triangles, cell)
        if len(t) <= max_tris:
            break
        cell *= 1.25
    return v, t


# ── запись GLB ────────────────────────────────────────────────────────────────
def _rgb(color: str | tuple | None) -> list[float]:
    if color is None:
        return [0.6, 0.6, 0.6]
    if isinstance(color, str):
        c = color.lstrip("#")
        if len(c) == 3:
            c = "".join(ch * 2 for ch in c)
        if len(c) != 6:
            raise MeshError(f"цвет {color!r}: нужен #rrggbb")
        color = tuple(int(c[i:i + 2], 16) / 255 for i in (0, 2, 4))
    # baseColorFactor в glTF — линейный цвет, а #rrggbb — sRGB
    return [round(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4, 5) for x in map(float, color[:3])]


def write_glb(path: str | Path, parts: list[dict]) -> None:
    """parts: {name, vertices (n, 3) в метрах, triangles (m, 3), color, rough, metal}. Сетка на часть, без узлов с
    преобразованиями: координаты уже в системе сущности."""
    gltf: dict = {"asset": {"version": "2.0", "generator": "cherrybim.io_mesh"}, "scene": 0,
                  "scenes": [{"nodes": list(range(len(parts)))}], "nodes": [], "meshes": [], "materials": [],
                  "accessors": [], "bufferViews": [], "buffers": []}
    blob = bytearray()

    def view(data: bytes, target: int) -> int:
        while len(blob) % 4:
            blob.append(0)
        gltf["bufferViews"].append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data), "target": target})
        blob.extend(data)
        return len(gltf["bufferViews"]) - 1

    for i, p in enumerate(parts):
        v = np.asarray(p["vertices"], dtype=np.float32)
        t = np.asarray(p["triangles"]).reshape(-1)
        big = len(v) > 65535
        idx = t.astype(np.uint32 if big else np.uint16)
        pos = view(v.tobytes(), 34962)
        gltf["accessors"].append({"bufferView": pos, "componentType": 5126, "count": len(v), "type": "VEC3",
                                  "min": [float(x) for x in v.min(0)], "max": [float(x) for x in v.max(0)]})
        ind = view(idx.tobytes(), 34963)
        gltf["accessors"].append({"bufferView": ind, "componentType": 5125 if big else 5123, "count": len(idx),
                                  "type": "SCALAR"})
        gltf["materials"].append({"name": p.get("name") or f"part {i}", "pbrMetallicRoughness": {
            "baseColorFactor": _rgb(p.get("color")) + [1.0], "metallicFactor": float(p.get("metal", 0.0)),
            "roughnessFactor": float(p.get("rough", 0.6))}})
        gltf["meshes"].append({"name": p.get("name") or f"part {i}", "primitives": [
            {"attributes": {"POSITION": 2 * i}, "indices": 2 * i + 1, "material": i}]})
        gltf["nodes"].append({"mesh": i, "name": p.get("name") or f"part {i}"})
    while len(blob) % 4:
        blob.append(0)
    gltf["buffers"].append({"byteLength": len(blob)})
    js = json.dumps(gltf, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    js += b" " * (-len(js) % 4)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
    out += struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(blob), 0x004E4942) + bytes(blob)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(out)


def read_glb(path: str | Path) -> tuple[dict, list[tuple[np.ndarray, np.ndarray]]]:
    """Обратно: JSON и [(вершины, треугольники)] по примитивам — для проверок."""
    data = Path(path).read_bytes()
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67 or version != 2 or length != len(data):
        raise MeshError(f"{path}: не GLB 2.0")
    jl, _ = struct.unpack_from("<II", data, 12)
    gltf = json.loads(data[20:20 + jl])
    bin0 = 20 + jl + 8
    out = []

    def acc(i: int) -> np.ndarray:
        a = gltf["accessors"][i]
        bv = gltf["bufferViews"][a["bufferView"]]
        dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16}[a["componentType"]]
        n = a["count"] * (3 if a["type"] == "VEC3" else 1)
        return np.frombuffer(data, dtype=dt, count=n, offset=bin0 + bv.get("byteOffset", 0) + a.get("byteOffset", 0))

    for m in gltf["meshes"]:
        for pr in m["primitives"]:
            out.append((acc(pr["attributes"]["POSITION"]).reshape(-1, 3), acc(pr["indices"]).reshape(-1, 3)))
    return gltf, out


# ── всё вместе ────────────────────────────────────────────────────────────────
def _rot(axis: str, deg: float) -> np.ndarray:
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return {"x": np.array([[1, 0, 0], [0, c, -s], [0, s, c]]), "y": np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]]),
            "z": np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])}[axis]


def mesh_to_glb(src: str | Path, dst: str | Path, *, rot_x: float = 0.0, rot_y: float = 0.0, rot_z: float = 0.0,
                scale: float = 0.001, color: str | list | None = None, rough: float = 0.6, metal: float = 0.0,
                max_tris: int = 20000, parts: list[int] | None = None) -> dict:
    """3MF/STL → GLB. Поворот (градусы, сначала X, потом Y, потом Z), масштаб (мм → м), начало — в углу габарита.
    color — один цвет или список по частям; parts — какие части взять (номера по порядку сборки). Возвращает
    {"size": [x, y, z] м, "tris": [по частям], "parts": [имена]}: size идёт в geom/габарит сущности."""
    got = read_mesh(src)
    if parts is not None:
        got = [got[i] for i in parts]
    r = _rot("z", rot_z) @ _rot("y", rot_y) @ _rot("x", rot_x)
    verts = [(p.vertices @ r.T) * scale for p in got]
    lo = np.min([v.min(0) for v in verts], axis=0)
    hi = np.max([v.max(0) for v in verts], axis=0)
    budget = max(200, max_tris // len(got))
    colors = color if isinstance(color, list) and color and not isinstance(color[0], (int, float)) else [color] * len(got)
    out, tris = [], []
    for i, (p, v) in enumerate(zip(got, verts)):
        sv, st = simplify(v - lo, p.triangles, budget)
        out.append({"name": p.name, "vertices": sv, "triangles": st, "color": colors[i % len(colors)],
                    "rough": rough, "metal": metal})
        tris.append(int(len(st)))
    write_glb(dst, out)
    return {"size": [round(float(x), 4) for x in hi - lo], "tris": tris, "parts": [p.name for p in got]}


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="3MF/STL → GLB для Cherry BiM")
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--rot-x", type=float, default=0.0)
    ap.add_argument("--rot-y", type=float, default=0.0)
    ap.add_argument("--rot-z", type=float, default=0.0)
    ap.add_argument("--scale", type=float, default=0.001, help="единицы исходника → метры (мм — 0.001)")
    ap.add_argument("--color", default=None)
    ap.add_argument("--max-tris", type=int, default=20000)
    a = ap.parse_args(argv)
    info = mesh_to_glb(a.src, a.dst, rot_x=a.rot_x, rot_y=a.rot_y, rot_z=a.rot_z, scale=a.scale, color=a.color,
                       max_tris=a.max_tris)
    print(json.dumps(info, ensure_ascii=False))


if __name__ == "__main__":
    main()
