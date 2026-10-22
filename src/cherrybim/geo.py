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
