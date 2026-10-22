# -*- coding: utf-8 -*-
"""Выгрузки двойника. GeoJSON (WGS84) — для карт в боте и в браузере.

Каждая выгрузка получает аудиторию и отдаёт только то, что ей видно: карта квартала
для бота строится с audience=public и физически не содержит квартир.
"""
from __future__ import annotations

from .geo import enu_to_lonlat
from .model import Box, Extrusion, Kind, Point, Polyline, Privacy
from .twin import Twin

PROPS_OUT = ("levels", "number", "area_brti", "area_dev", "height", "brti_room", "rating", "note")


def to_geojson(twin: Twin, audience: Privacy, kinds: set[Kind] | None = None) -> dict:
    if not twin.georef:
        raise ValueError("нет georef: двойник не привязан к Земле")
    g = twin.georef
    feats = []
    for e in twin.visible_to(audience):
        if kinds and e.kind not in kinds:
            continue
        geom = None
        if isinstance(e.geom, Extrusion) and len(e.geom.outline) >= 3:
            ring = [enu_to_lonlat(g, x, y) for x, y, _ in twin.to_site(e.id, e.geom.outline)]
            geom = {"type": "Polygon", "coordinates": [[list(p) for p in ring + ring[:1]]]}
        elif isinstance(e.geom, Box):
            sx, sy, _ = e.geom.size
            ring = [enu_to_lonlat(g, x, y) for x, y, _ in twin.to_site(e.id, [(0, 0), (sx, 0), (sx, sy), (0, sy)])]
            geom = {"type": "Polygon", "coordinates": [[list(p) for p in ring + ring[:1]]]}
        elif isinstance(e.geom, Polyline):
            geom = {"type": "LineString",
                    "coordinates": [list(enu_to_lonlat(g, x, y)) for x, y, _ in twin.to_site(e.id, e.geom.points)]}
        elif e.placement and (e.geom is None or isinstance(e.geom, Point)) and e.kind in (Kind.mep, Kind.device, Kind.feature):
            x, y, _ = twin.to_site(e.id, [(0, 0, 0)])[0]
            geom = {"type": "Point", "coordinates": list(enu_to_lonlat(g, x, y))}
        if not geom:
            continue
        z = twin.to_site(e.id, [(0, 0, 0)])[0][2]
        props = {"key": e.key, "kind": e.kind.value, "type": e.type, "name": e.name,
                 "privacy": twin.privacy(e.id).value, "z": round(z, 2), "path": twin.path(e.id)}
        props.update({k: v for k, v in e.props.items() if k in PROPS_OUT})
        feats.append({"type": "Feature", "id": e.id, "geometry": geom, "properties": props})
    return {"type": "FeatureCollection", "features": feats}
