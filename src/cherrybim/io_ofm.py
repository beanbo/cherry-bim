# -*- coding: utf-8 -*-
"""OpenFurnitureMaker → места хранения.

Проект шкафа из OFM (зоны → колонки → полки, ящики, штанги) собирается штатным
`ofm.builder.build`, а из готовых деталей получаются места хранения: каждый ящик,
отделение между полками и место под штангой. Координаты OFM: X — ширина, Y — глубина
(фасад при Y=0), Z — от пола, мм; у нас — метры в системе шкафа с тем же смыслом осей.
"""
from __future__ import annotations

import re
import sys

from .model import Box, Entity, Kind, Placement, Source, make_id

MIN_GAP_MM = 120          # отделение ниже этого не считаем местом хранения


def storage_from_ofm(project: dict, ofm_path: str, parent: Entity, ns: str) -> list[Entity]:
    if ofm_path not in sys.path:
        sys.path.insert(0, ofm_path)
    from ofm import builder, model  # noqa: E402  (необязательная зависимость)

    p, _notes = model.normalize(project)
    b = builder.build(p)
    if b.fails:
        raise ValueError("OFM не собрал проект: " + "; ".join(b.fails))
    T = p["cab"]["T"]
    depth = b.dims["part_depth"]
    src = Source(origin="ofm", acc=0.005, note=p.get("name"))
    out: list[Entity] = []

    def add(key, name, typ, x0, y0, z0, sx, sy, sz, parent_id, **props):
        e = Entity(id=make_id(ns, key), key=key, kind=Kind.storage, type=typ, name=name, parent=parent_id,
                   placement=Placement(pos=(x0 / 1000, y0 / 1000, z0 / 1000)),
                   geom=Box(size=(sx / 1000, sy / 1000, sz / 1000)), props=props, src=src)
        out.append(e)
        return e

    # ящики: детали одного короба сгруппированы по номеру «Ящик 1.2.3: …»
    boxes: dict[str, list[dict]] = {}
    for part in b.parts:
        m = re.match(r"Ящик ([\d.]+):", part["name"])
        if part["kind"] == "drawer" and m:
            boxes.setdefault(m.group(1), []).append(part)

    for si, sec in enumerate(b.sections):
        zone, col = sec["zi"], sec["ci"]
        sec_name = ("Антресоль" if zone > 0 else "Секция " + "АБВГД"[col]) + (f" {zone + 1}" if zone > 1 else "")
        skey = f"{parent.key}.sec{sec['id']}"
        sec_e = add(skey, sec_name, "section", sec["x0"], 0, sec["z0"], sec["x1"] - sec["x0"], depth,
                    sec["z1"] - sec["z0"], parent.id)
        # ящики этой секции, снизу вверх и слева направо
        mine = []
        for did, parts in boxes.items():
            x0 = min(q["pos"][0] for q in parts)
            z0 = min(q["pos"][2] for q in parts)
            if sec["x0"] - 1 <= x0 <= sec["x1"] and sec["z0"] - 40 <= z0 <= sec["z1"]:
                x1 = max(q["pos"][0] + q["size"][0] for q in parts)
                y1 = max(q["pos"][1] + q["size"][1] for q in parts)
                z1 = max(q["pos"][2] + q["size"][2] for q in parts)
                mine.append((z0, x0, did, x1, y1, z1))
        mine.sort()
        two_cols = len({round(m[1]) for m in mine}) > 1
        occupied = []
        for n, (z0, x0, did, x1, y1, z1) in enumerate(mine, 1):
            side = (" лев." if x0 < (sec["x0"] + sec["x1"]) / 2 else " прав.") if two_cols else ""
            # дети секции стоят в её системе: начало секции вычитается
            add(f"{skey}.dr{did}", f"{sec_name}: ящик {n}{side}", "drawer", x0 - sec["x0"], 20, z0 - sec["z0"],
                x1 - x0, y1 - 20, z1 - z0, sec_e.id, level=n)
            occupied.append((z0 - 20, z1 + 70))          # короб плюс фасад сверху
        # полки и штанги внутри секции
        rods = []
        for part in b.parts:
            px0, pz0 = part["pos"][0], part["pos"][2]
            inside = sec["x0"] - 1 <= px0 < sec["x1"] - 1 and sec["z0"] - 1 <= pz0 <= sec["z1"]
            if inside and part["kind"] == "panel" and part["name"].startswith("Полка"):
                occupied.append((pz0, pz0 + T))
            if inside and part["kind"] == "rod":
                rods.append(pz0)
        # свободные промежутки по высоте — отделения
        occupied.sort()
        z, gaps = sec["z0"], []
        for a, c in occupied:
            if a - z >= MIN_GAP_MM:
                gaps.append((z, a))
            z = max(z, c)
        if sec["z1"] - z >= MIN_GAP_MM:
            gaps.append((z, sec["z1"]))
        for k, (a, c) in enumerate(gaps, 1):
            rod = [r for r in rods if a <= r <= c]
            typ, name = ("hanging", f"{sec_name}: под штангой") if rod else ("compartment", f"{sec_name}: отделение {k}")
            add(f"{skey}.gap{k}", name, typ, 0, 0, a - sec["z0"], sec["x1"] - sec["x0"], depth, c - a, sec_e.id,
                level=k)
    return out
