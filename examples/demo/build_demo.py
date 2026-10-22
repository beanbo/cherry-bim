# -*- coding: utf-8 -*-
"""Выдуманный пример: квартал с одним домом, двумя подъездами и квартирой со шкафом.

Координаты условные, реального адреса нет. Запуск из корня репозитория:
    python examples/demo/build_demo.py
Пишет demo-kvartal.twin.json (публичный), demo-kvartira.twin.json (семья) и demo-public.geojson.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "src"))

from cherrybim import (Box, Entity, Extrusion, Georef, Kind, Package, Placement, Point,  # noqa: E402
                       Polyline, Privacy, Ref, Source, make_id)

NS = "demo"
STOREY_H = 2.8


def eid(key: str) -> str:
    return make_id(NS, key)


def ent(key, kind, name, parent=None, **kw) -> Entity:
    return Entity(id=eid(key), key=key, kind=kind, name=name, parent=eid(parent) if parent else None, **kw)


def build() -> tuple[Package, Package]:
    demo = Source(origin="demo")
    K = [ent("kvartal", Kind.site, "Демо-квартал", type="quarter", src=demo),
         ent("b1", Kind.building, "Дом 1", "kvartal", type="residential",
             placement=Placement(pos=(-20.0, -8.0, 0.0), yaw=30.0),
             geom=Extrusion(outline=[(0, 0), (15, 0), (15, 40), (0, 40)], height=9 * STOREY_H),
             props={"levels": 9}, aliases=["первый дом"], src=demo),
         ent("playground", Kind.feature, "Детская площадка", "kvartal", type="playground",
             geom=Extrusion(outline=[(5, 5), (25, 5), (25, 20), (5, 20)]), src=demo),
         ent("parking", Kind.feature, "Парковка", "kvartal", type="parking",
             geom=Extrusion(outline=[(-40, 20), (-10, 20), (-10, 28), (-40, 28)]), props={"spaces": 12}, src=demo)]
    for n, y0 in (("1", 0.0), ("2", 20.0)):
        K.append(ent(f"b1.s{n}", Kind.section, f"Подъезд {n}", "b1", type="entrance",
                     placement=Placement(pos=(0.0, y0, 0.0)),
                     geom=Extrusion(outline=[(0, 0), (15, 0), (15, 20), (0, 20)], height=9 * STOREY_H),
                     props={"number": n}, src=demo))
        for f in range(1, 10):
            K.append(ent(f"b1.s{n}.f{f}", Kind.storey, f"Этаж {f}", f"b1.s{n}", type="residential",
                         placement=Placement(pos=(0.0, 0.0, (f - 1) * STOREY_H)), props={"number": f}))
    K.append(ent("b1.s1.f3.panel", Kind.mep, "Этажный щиток", "b1.s1.f3", type="distribution_board",
                 placement=Placement(pos=(7.5, 12.0, 1.5)), geom=Point(), privacy=Privacy.residents,
                 aliases=["автоматы", "щиток"], src=demo))
    kvartal = Package(id=eid("pkg.kvartal"), name="Демо-квартал", root=eid("kvartal"),
                      georef=Georef(lat=53.9, lon=27.5667, h=220.0), privacy=Privacy.public, entities=K)

    F = [ent("kv12", Kind.unit, "Квартира 12", "b1.s1.f3", type="apartment", props={"number": "12"}, src=demo)]
    rooms = {"hall": ("Прихожая", [(0, 6), (4, 6), (4, 9), (0, 9)]),
             "kitchen": ("Кухня", [(0, 0), (4, 0), (4, 6), (0, 6)]),
             "bedroom": ("Спальня", [(4, 0), (9, 0), (9, 9), (4, 9)])}
    for k, (name, outline) in rooms.items():
        F.append(ent(f"kv12.{k}", Kind.space, name, "kv12", type="room",
                     geom=Extrusion(outline=outline, height=2.6), bind={"ha.area": k}, src=demo))
    F.append(ent("kv12.bedroom.wardrobe", Kind.furniture, "Шкаф", "kv12.bedroom", type="wardrobe",
                 placement=Placement(pos=(4.2, 8.4, 0.0)), geom=Box(size=(1.6, 0.6, 2.4)), src=demo))
    F.append(ent("kv12.bedroom.wardrobe.drawers", Kind.storage, "Секция с ящиками", "kv12.bedroom.wardrobe",
                 type="section", placement=Placement(pos=(0.8, 0.0, 0.1)), geom=Box(size=(0.8, 0.55, 1.0)), src=demo))
    for i in range(3):
        F.append(ent(f"kv12.bedroom.wardrobe.dr{i + 1}", Kind.storage, f"Ящик {i + 1}", "kv12.bedroom.wardrobe.drawers",
                     type="drawer", placement=Placement(pos=(0.02, 0.02, i * 0.3)), geom=Box(size=(0.76, 0.5, 0.25)),
                     props={"level": i + 1}, src=demo))
    F.append(ent("kv12.bedroom.wardrobe.dr2.drill", Kind.item, "Дрель-шуруповёрт", "kv12.bedroom.wardrobe.dr2",
                 type="tool", aliases=["шуруповёрт", "дрель"], tags=["инструмент"], src=demo))
    F.append(ent("kv12.hall.manifold", Kind.mep, "Коллектор отопления", "kv12.hall", type="heating_manifold",
                 placement=Placement(pos=(3.8, 8.8, 0.3)), geom=Point(), aliases=["гребёнка"], src=demo))
    F.append(ent("kv12.bedroom.radiator", Kind.mep, "Радиатор", "kv12.bedroom", type="radiator",
                 placement=Placement(pos=(6.5, 0.15, 0.1)), geom=Point(), aliases=["батарея"], src=demo))
    F.append(ent("kv12.heat_route", Kind.mep, "Трубы отопления в стяжке", "kv12", type="pipe_pair",
                 geom=Polyline(points=[(3.8, 8.8, -0.04), (4.3, 8.8, -0.04), (4.3, 0.3, -0.04), (6.5, 0.3, -0.04)],
                               diameter=0.016), src=Source(origin="demo", acc=0.5)))
    F.append(ent("kv12.heating", Kind.system, "Отопление квартиры", "kv12", type="heating",
                 refs=[Ref(rel="has_member", to=eid(k)) for k in ("kv12.hall.manifold", "kv12.bedroom.radiator", "kv12.heat_route")]))
    F.append(ent("kv12.bedroom.light", Kind.device, "Свет спальни", "kv12.bedroom", type="light",
                 bind={"ha.entity": ["light.bedroom"]}, src=demo))
    flat = Package(id=eid("pkg.kvartira"), name="Квартира 12", root=eid("kv12"), privacy=Privacy.household,
                   requires=[kvartal.id], entities=F)
    return kvartal, flat


def dump(pkg: Package) -> str:
    def compact(v):
        if isinstance(v, dict):
            return {k: compact(x) for k, x in v.items() if x not in (None, [], {})}
        if isinstance(v, list):
            return [compact(x) for x in v]
        return v
    return json.dumps(compact(pkg.model_dump(mode="json", by_alias=True)), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    from cherrybim import Twin
    from cherrybim.export import to_geojson

    kvartal, flat = build()
    for pkg, fn in ((kvartal, "demo-kvartal.twin.json"), (flat, "demo-kvartira.twin.json")):
        (HERE / fn).write_text(dump(pkg), encoding="utf-8")
    twin = Twin([kvartal, flat])
    (HERE / "demo-public.geojson").write_text(json.dumps(to_geojson(twin, Privacy.public), ensure_ascii=False),
                                              encoding="utf-8")
    for e, path in twin.search("дрель"):
        print(path)
