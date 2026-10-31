# -*- coding: utf-8 -*-
"""Система участка (ENU, метры) ↔ WGS84.

Касательная плоскость в начале участка с длинами градусов эллипсоида WGS84 на этой
широте: на квартале ошибка — миллиметры, на районе в несколько километров — сантиметры.
Для города целиком нужен pyproj и проекция (для Минска UTM 35N, EPSG:32635);
интерфейс при этом не меняется.
"""
from __future__ import annotations

import math

from .model import Georef


def m_per_deg_lat(lat: float) -> float:
    f = math.radians(lat)
    return 111132.92 - 559.82 * math.cos(2 * f) + 1.175 * math.cos(4 * f) - 0.0023 * math.cos(6 * f)


def m_per_deg_lon(lat: float) -> float:
    f = math.radians(lat)
    return 111412.84 * math.cos(f) - 93.5 * math.cos(3 * f) + 0.118 * math.cos(5 * f)


def enu_to_lonlat(g: Georef, e: float, n: float) -> tuple[float, float]:
    return g.lon + e / m_per_deg_lon(g.lat), g.lat + n / m_per_deg_lat(g.lat)


def lonlat_to_enu(g: Georef, lon: float, lat: float) -> tuple[float, float]:
    return (lon - g.lon) * m_per_deg_lon(g.lat), (lat - g.lat) * m_per_deg_lat(g.lat)


def bearing_to_yaw(bearing_deg: float) -> float:
    """Азимут оси X сущности (от севера по часовой) → yaw в ENU (от востока против часовой)."""
    return (90.0 - bearing_deg + 180.0) % 360.0 - 180.0


def footprint(polys: list[list[tuple[float, float]]], res: float = 0.05, close: float = 0.15) -> list[tuple[float, float]]:
    """Внешний контур объединения многоугольников — например, стен и комнат квартиры.

    Щели уже 2·close (дверные проёмы между комнатами) заделываются. Считается по растру с шагом res,
    поэтому контур точен до res; на выходе многоугольник против часовой без вершин на прямых.
    """
    if not polys:
        return []
    pad = int(math.ceil(close / res)) + 1
    x0 = min(x for p in polys for x, _ in p)
    y0 = min(y for p in polys for _, y in p)
    w = int(math.ceil((max(x for p in polys for x, _ in p) - x0) / res)) + 2 * pad
    h = int(math.ceil((max(y for p in polys for _, y in p) - y0) / res)) + 2 * pad
    grid = [[False] * w for _ in range(h)]
    for p in polys:                                       # клетка занята, если её центр внутри многоугольника
        px0, px1 = min(x for x, _ in p), max(x for x, _ in p)
        py0, py1 = min(y for _, y in p), max(y for _, y in p)
        for j in range(max(0, int((py0 - y0) / res) + pad - 1), min(h, int((py1 - y0) / res) + pad + 2)):
            cy = y0 + (j - pad + 0.5) * res
            for i in range(max(0, int((px0 - x0) / res) + pad - 1), min(w, int((px1 - x0) / res) + pad + 2)):
                if _inside(p, x0 + (i - pad + 0.5) * res, cy):
                    grid[j][i] = True
    r = pad - 1
    grid = _morph(_morph(grid, r, True), r, False)        # замыкание: расширить и сжать обратно

    edges = {}                                            # направленные рёбра: занятое слева
    for j in range(h):
        for i in range(w):
            if not grid[j][i]:
                continue
            if j == 0 or not grid[j - 1][i]:
                edges[(i, j)] = (i + 1, j)
            if i == w - 1 or not grid[j][i + 1]:
                edges[(i + 1, j)] = (i + 1, j + 1)
            if j == h - 1 or not grid[j + 1][i]:
                edges[(i + 1, j + 1)] = (i, j + 1)
            if i == 0 or not grid[j][i - 1]:
                edges[(i, j + 1)] = (i, j)
    loops = []
    while edges:                                          # самый длинный обход — внешний контур
        start, nxt = edges.popitem()
        loop = [start]
        while nxt != start and nxt in edges:
            loop.append(nxt)
            nxt = edges.pop(nxt)
        loops.append(loop)
    if not loops:                                         # многоугольники без площади (все точки на прямой)
        return []
    loop = max(loops, key=len)
    pts = [loop[k] for k in range(len(loop))
           if (loop[k - 1][0] - loop[k][0]) * (loop[(k + 1) % len(loop)][1] - loop[k][1])
           != (loop[k - 1][1] - loop[k][1]) * (loop[(k + 1) % len(loop)][0] - loop[k][0])]
    return [(round(x0 + (i - pad) * res, 4), round(y0 + (j - pad) * res, 4)) for i, j in pts]


def _inside(poly, x: float, y: float) -> bool:
    c = False
    for k in range(len(poly)):
        (ax, ay), (bx, by) = poly[k - 1], poly[k]
        if (ay > y) != (by > y) and x < ax + (y - ay) * (bx - ax) / (by - ay):
            c = not c
    return c


def _morph(grid, r: int, grow: bool):
    """Квадратное расширение (grow) или сжатие на r клеток: сначала по строкам, потом по столбцам."""
    h, w = len(grid), len(grid[0])
    agg = any if grow else all
    rows = [[agg(row[max(0, i - r):i + r + 1]) for i in range(w)] for row in grid]
    cols = [[agg(rows[k][i] for k in range(max(0, j - r), min(h, j + r + 1))) for i in range(w)] for j in range(h)]
    return cols
