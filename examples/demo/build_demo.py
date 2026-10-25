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


def wall_box(x0, y0, x1, y1, z, h, front):
    """Коробка по прямоугольнику плана и стороне, куда смотрит фасад ('-y', '+y', '+x', '-x'): X коробки — вдоль
    фасада, фасад — её сторона −Y. Так задаются мебель у стен, сантехника, двери и окна."""
    a, b = round(x1 - x0, 3), round(y1 - y0, 3)
    pos, yaw, size = {"-y": ((x0, y0), 0, (a, b)), "+y": ((x1, y1), 180, (a, b)),
                      "+x": ((x1, y0), 90, (b, a)), "-x": ((x0, y1), -90, (b, a))}[front]
    return dict(placement=Placement(pos=(pos[0], pos[1], z), yaw=yaw), geom=Box(size=size + (h,)))


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
                 **wall_box(5.75, 0.03, 6.75, 0.13, 0.1, 0.5, "+y"), props={"render": {"style": "panel"}},
                 aliases=["батарея"], src=demo))
    # стены: наружные 0,3 м, перегородки 0,1 м; в проёмах — окна и двери (петли — если смотреть с той стороны,
    # куда дверь открывается), цвета — в props.render
    walls = [((-0.3, -0.3, 5.5, 0.0), True), ((7.0, -0.3, 9.3, 0.0), True), ((-0.3, 0.0, 0.0, 2.0), True),
             ((-0.3, 3.5, 0.0, 9.3), True), ((9.0, 0.0, 9.3, 9.3), True), ((-0.3, 9.0, 1.2, 9.3), True),
             ((2.1, 9.0, 9.0, 9.3), True), ((0.0, 5.95, 1.0, 6.05), False), ((1.9, 5.95, 3.95, 6.05), False),
             ((3.95, 0.0, 4.05, 7.0), False), ((3.95, 7.9, 4.05, 9.0), False)]
    for i, ((x0, y0, x1, y1), ext) in enumerate(walls):
        F.append(ent(f"kv12.wall{i}", Kind.wall, "Стена", "kv12", type="exterior" if ext else "interior",
                     geom=Extrusion(outline=[(x0, y0), (x1, y0), (x1, y1), (x0, y1)], height=2.6), src=demo))
    F += [ent("kv12.bedroom.window", Kind.opening, "Окно спальни", "kv12.bedroom", type="window",
              **wall_box(5.5, -0.3, 7.0, 0.0, 0.85, 1.4, "+y"), src=demo),
          ent("kv12.kitchen.window", Kind.opening, "Окно кухни", "kv12.kitchen", type="window",
              **wall_box(-0.3, 2.0, 0.0, 3.5, 0.85, 1.4, "+x"), src=demo),
          ent("kv12.kitchen.door", Kind.opening, "Дверь в кухню", "kv12.kitchen", type="door",
              **wall_box(1.0, 5.95, 1.9, 6.05, 0.0, 2.07, "-y"), props={"render": {"hinge": "left", "open": 90}}, src=demo),
          ent("kv12.bedroom.door", Kind.opening, "Дверь в спальню", "kv12.bedroom", type="door",
              **wall_box(3.95, 7.0, 4.05, 7.9, 0.0, 2.07, "+x"), props={"render": {"hinge": "right", "open": 90}}, src=demo),
          ent("kv12.hall.entrance", Kind.opening, "Входная дверь", "kv12.hall", type="entrance_door",
              **wall_box(1.2, 9.0, 2.1, 9.3, 0.0, 2.07, "-y"),
              props={"render": {"hinge": "left", "colors": {"outside": "#4a4f57", "inside": "#f4f3ef"}}}, src=demo)]
    # обстановка: кровать изголовьем к стене, кухня с мойкой и варочной; фасады кухни — места хранения
    F.append(ent("kv12.bedroom.bed", Kind.furniture, "Кровать", "kv12.bedroom", type="bed",
                 **wall_box(7.0, 3.0, 9.0, 4.6, 0.0, 0.5, "-x"), props={"render": {"colors": {"body": "#8e9aa6"}}}, src=demo))
    F.append(ent("kv12.kitchen.base", Kind.furniture, "Кухонный гарнитур", "kv12.kitchen", type="kitchen_unit",
                 **wall_box(0.2, 0.0, 2.6, 0.6, 0.0, 0.9, "+y"), props={"render": {"handles": "bar"}}, src=demo))
    for key, name, typ, pos, size in [
            ("cutlery", "Выдвижной для приборов", "drawer", (0.02, 0.02, 0.62), (0.56, 0.5, 0.18)),
            ("pans", "Выдвижной для кастрюль", "drawer", (0.02, 0.02, 0.1), (0.56, 0.5, 0.5)),
            ("sink", "Отделение под мойкой", "compartment", (0.6, 0.02, 0.1), (0.8, 0.5, 0.7)),
            ("dishes", "Отделение для посуды", "compartment", (1.4, 0.02, 0.1), (1.0, 0.5, 0.7))]:
        F.append(ent(f"kv12.kitchen.base.{key}", Kind.storage, name, "kv12.kitchen.base", type=typ,
                     placement=Placement(pos=pos), geom=Box(size=size), src=demo))
    F += [ent("kv12.kitchen.sink", Kind.mep, "Мойка", "kv12.kitchen", type="sink",
              **wall_box(1.35, 0.05, 1.85, 0.5, 0.7, 0.2, "+y"), src=demo),
          ent("kv12.kitchen.hob", Kind.device, "Варочная панель", "kv12.kitchen", type="hob",
              **wall_box(0.4, 0.04, 0.99, 0.56, 0.9, 0.006, "+y"), src=demo)]
    F.append(ent("kv12.finish.floor", Kind.finish, "Ламинат", "kv12", type="floor",
                 props={"render": {"on": ["floor"], "colors": {"*": "#d9c8ad"}}},
                 refs=[Ref(rel="finishes", to=eid(f"kv12.{r}")) for r in ("hall", "bedroom")], src=demo))
    F.append(ent("kv12.finish.skirting", Kind.finish, "Плинтус", "kv12", type="skirting",
                 refs=[Ref(rel="finishes", to=eid(f"kv12.{r}")) for r in ("hall", "bedroom", "kitchen")], src=demo))
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
