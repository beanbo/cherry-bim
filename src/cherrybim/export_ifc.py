# -*- coding: utf-8 -*-
"""Выгрузка двойника в IFC4 через IfcOpenShell (необязательная зависимость, LGPL).

Пространственная структура: IfcSite → IfcBuilding → подъезд (IfcBuilding, PARTIAL) →
IfcBuildingStorey → квартира (IfcSpace, COMPLEX) → комнаты (IfcSpace). Элементы лежат
в ближайшем пространственном предке, места хранения агрегированы в свой шкаф.
Каждый объект несёт Pset_CherryBiM: ключ, приватность, источник, точность, привязки.
"""
from __future__ import annotations

import json

import numpy as np
import ifcopenshell
import ifcopenshell.api.aggregate
import ifcopenshell.api.context
import ifcopenshell.api.geometry
import ifcopenshell.api.project
import ifcopenshell.api.pset
import ifcopenshell.api.root
import ifcopenshell.api.spatial
import ifcopenshell.api.system
import ifcopenshell.api.unit
from ifcopenshell.util.shape_builder import ShapeBuilder

from .kinds import lookup
from .model import Box, Entity, Extrusion, Kind, Point, Polyline, Privacy, ifc_guid
from .twin import Twin

SPATIAL = {Kind.site, Kind.building, Kind.section, Kind.storey, Kind.unit, Kind.space}
NOT_PRODUCTS = {Kind.system, Kind.zone, Kind.document, Kind.item}   # группы и учёт — не изделия IFC


def ifc_class(e: Entity) -> tuple[str, str | None]:
    _ru, cls, pre = lookup(e.kind, e.type)
    return cls, pre


def _dms(deg: float) -> tuple[int, int, int, int]:
    """Градусы → (градусы, минуты, секунды, миллионные секунды) для IfcCompoundPlaneAngleMeasure.
    Считается в целых миллионных долях секунды: иначе 0,0225° выходило бы как 1′ 20″ и 1 000 000 миллионных."""
    s = -1 if deg < 0 else 1
    micro = round(abs(deg) * 3600 * 10 ** 6)
    sec, micro = divmod(micro, 10 ** 6)
    mins, sec = divmod(sec, 60)
    d, m = divmod(mins, 60)
    return (s * d, s * m, s * sec, s * micro)


def to_ifc(twin: Twin, audience: Privacy, path: str) -> dict:
    f = ifcopenshell.api.project.create_file(version="IFC4")
    root = twin.get(twin.packages[0].root)
    project = ifcopenshell.api.root.create_entity(f, ifc_class="IfcProject", name=root.name)
    # единицы проекта — метры: иначе IfcOpenShell по умолчанию берёт миллиметры, и формы,
    # записанные в метрах, выходят в 1000 раз меньше своих положений
    ifcopenshell.api.unit.assign_unit(f, units=[
        ifcopenshell.api.unit.add_si_unit(f, unit_type="LENGTHUNIT"),
        ifcopenshell.api.unit.add_si_unit(f, unit_type="AREAUNIT"),
        ifcopenshell.api.unit.add_si_unit(f, unit_type="VOLUMEUNIT"),
        ifcopenshell.api.unit.add_si_unit(f, unit_type="PLANEANGLEUNIT")])
    model_ctx = ifcopenshell.api.context.add_context(f, context_type="Model")
    body = ifcopenshell.api.context.add_context(f, context_type="Model", context_identifier="Body",
                                                target_view="MODEL_VIEW", parent=model_ctx)
    sb = ShapeBuilder(f)
    visible = twin.visible_to(audience)
    vis_ids = {e.id for e in visible}
    depth = {e.id: len(twin.ancestors(e.id)) for e in visible}
    made: dict[str, ifcopenshell.entity_instance] = {}
    stats: dict[str, int] = {}

    def rep_for(e: Entity):
        g = e.geom
        if isinstance(g, Extrusion) and len(g.outline) >= 3 and g.height > 0:
            prof = sb.profile(sb.polyline([tuple(p) for p in g.outline], closed=True))
            return sb.get_representation(body, [sb.extrude(prof, magnitude=g.height, position=(0.0, 0.0, g.z0))])
        if isinstance(g, Extrusion) and len(g.outline) >= 3:             # плоская площадка: 2 см толщины
            prof = sb.profile(sb.polyline([tuple(p) for p in g.outline], closed=True))
            return sb.get_representation(body, [sb.extrude(prof, magnitude=0.02)])
        if isinstance(g, Box):
            sx, sy, sz = g.size
            prof = sb.profile(sb.polyline([(0, 0), (sx, 0), (sx, sy), (0, sy)], closed=True))
            return sb.get_representation(body, [sb.extrude(prof, magnitude=sz)])
        if isinstance(g, Polyline) and len(g.points) >= 2:
            curve = sb.polyline([tuple(p) for p in g.points])
            return sb.get_representation(body, [sb.create_swept_disk_solid(curve, (g.diameter or 0.02) / 2)])
        if isinstance(g, Point):
            prof = sb.profile(sb.polyline([(-0.06, -0.06), (0.06, -0.06), (0.06, 0.06), (-0.06, 0.06)], closed=True))
            return sb.get_representation(body, [sb.extrude(prof, magnitude=0.12, position=(0.0, 0.0, -0.06))])
        return None

    for e in sorted(visible, key=lambda x: depth[x.id]):
        if e.kind in NOT_PRODUCTS:
            continue
        cls, pre = ifc_class(e)
        p = ifcopenshell.api.root.create_entity(f, ifc_class=cls, predefined_type=pre, name=e.name)
        p.GlobalId = ifc_guid(e.id)
        if pre == "USERDEFINED" and hasattr(p, "ObjectType"):
            p.ObjectType = e.type or e.kind.value
        if e.kind == Kind.section:
            p.CompositionType = "PARTIAL"
            p.LongName = "Подъезд " + str(e.props.get("number", ""))
        if e.kind == Kind.unit:
            p.CompositionType = "COMPLEX"
            p.ObjectType = "Apartment"
        if e.kind == Kind.storey:
            p.Elevation = float(e.props.get("elevation", 0.0))
        if e.kind == Kind.site and twin.georef:
            p.RefLatitude, p.RefLongitude = _dms(twin.georef.lat), _dms(twin.georef.lon)
            p.RefElevation = twin.georef.h
        made[e.id] = p
        stats[cls] = stats.get(cls, 0) + 1

        parent = made.get(e.parent) if e.parent in vis_ids else None
        if e.kind == Kind.site or parent is None and e.kind in SPATIAL:
            ifcopenshell.api.aggregate.assign_object(f, products=[p], relating_object=project)
        elif e.kind in SPATIAL or (e.kind == Kind.feature and cls == "IfcSpace"):
            ifcopenshell.api.aggregate.assign_object(f, products=[p], relating_object=parent)
        elif e.kind == Kind.storage and parent is not None:
            ifcopenshell.api.aggregate.assign_object(f, products=[p], relating_object=parent)
        else:
            anc = next((a for a in twin.ancestors(e.id) if a.id in made and a.kind in SPATIAL), None)
            if anc is not None:
                ifcopenshell.api.spatial.assign_container(f, products=[p], relating_structure=made[anc.id])

        mat = np.array(twin.matrix(e.id), dtype=float)
        if e.placement is None and e.geom is None and e.kind == Kind.device:
            # у устройства известна только комната: ставим в центр комнаты под потолком
            room = twin.get(e.parent)
            if isinstance(room.geom, Extrusion):
                cx = sum(q[0] for q in room.geom.outline) / len(room.geom.outline)
                cy = sum(q[1] for q in room.geom.outline) / len(room.geom.outline)
                mat = np.array(twin.matrix(room.id), dtype=float) @ np.array(
                    [[1, 0, 0, cx], [0, 1, 0, cy], [0, 0, 1, 2.3 if e.type == "light" else 1.0], [0, 0, 0, 1]], dtype=float)
        ifcopenshell.api.geometry.edit_object_placement(f, product=p, matrix=mat)
        rep = rep_for(e)
        if rep is not None:
            ifcopenshell.api.geometry.assign_representation(f, product=p, representation=rep)

        src = e.src.origin if e.src else ""
        props = {"Key": e.key or "", "Privacy": twin.privacy(e.id).value, "Source": src,
                 "AccuracyM": float(e.src.acc) if e.src and e.src.acc is not None else -1.0,
                 "Bind": json.dumps(e.bind, ensure_ascii=False) if e.bind else ""}
        ps = ifcopenshell.api.pset.add_pset(f, product=p, name="Pset_CherryBiM")
        ifcopenshell.api.pset.edit_pset(f, pset=ps, properties=props)

    for e in visible:                       # системы: отопление и т. п.
        if e.kind != Kind.system:
            continue
        cls, pre = ifc_class(e)
        sysent = ifcopenshell.api.system.add_system(f, ifc_class=cls)
        sysent.Name, sysent.GlobalId = e.name, ifc_guid(e.id)
        if hasattr(sysent, "PredefinedType"):
            sysent.PredefinedType = pre
        members = [made[r.to] for r in e.refs if r.rel == "has_member" and r.to in made]
        if members:
            ifcopenshell.api.system.assign_system(f, products=members, system=sysent)
        stats[cls] = stats.get(cls, 0) + 1
    f.write(path)
    return stats
