"""Геометрия и расчёты на маленьких фикстурах с заранее известным ответом."""
import math

import pytest

from cherrybim import Entity, Kind, Package, Privacy, make_id
from cherrybim.export import to_geojson
from cherrybim.geo import bearing_to_yaw, enu_to_lonlat, footprint, lonlat_to_enu, m_per_deg_lat, m_per_deg_lon
from cherrybim.io_bazis import _area, loops_2d
from cherrybim.model import Box, Extrusion, Georef, Placement, Polyline
from cherrybim.twin import Twin


def _area_of(pts):
    return abs(sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
                   for i in range(len(pts)))) / 2


def _ent(key, kind, parent=None, **kw):
    return Entity(id=make_id("t", key), key=key, kind=kind, name=key, parent=parent and make_id("t", parent), **kw)


def _twin(*ents, georef=None):
    return Twin([Package(id=make_id("t", "pkg"), name="t", root=ents[0].id, georef=georef, entities=list(ents))])


# ── WGS84 ↔ участок ──────────────────────────────────────────────────────────
def test_degree_lengths_known_values():
    # формулы длины градуса эллипсоида WGS84: экватор и полюс
    assert m_per_deg_lat(0) == pytest.approx(110574.27, abs=0.01)
    assert m_per_deg_lat(90) == pytest.approx(111693.92, abs=0.01)
    assert m_per_deg_lon(0) == pytest.approx(111319.46, abs=0.01)
    assert m_per_deg_lon(90) == pytest.approx(0.0, abs=1e-6)
    assert m_per_deg_lon(60) == pytest.approx(55799.98, abs=0.5)        # ≈ половина экваториальной


def test_enu_lonlat_roundtrip():
    g = Georef(lat=53.9, lon=27.56)
    for e, n in [(0, 0), (100, 0), (0, 100), (-1234.5, 678.9)]:
        lon, lat = enu_to_lonlat(g, e, n)
        assert lonlat_to_enu(g, lon, lat) == pytest.approx((e, n), abs=1e-9)
    lon, lat = enu_to_lonlat(g, 0, m_per_deg_lat(53.9))                   # ровно градус к северу
    assert (lon, lat) == pytest.approx((27.56, 54.9))


@pytest.mark.parametrize("bearing, yaw", [(0, 90), (90, 0), (180, -90), (270, -180), (45, 45), (360, 90), (-90, 180 - 360)])
def test_bearing_to_yaw(bearing, yaw):
    assert bearing_to_yaw(bearing) == pytest.approx(yaw)


# ── дерево и системы координат ───────────────────────────────────────────────
def test_to_site_composes_nested_placements():
    site = _ent("site", Kind.site)
    b = _ent("b", Kind.building, "site", placement=Placement(pos=(10, 0, 0), yaw=90))
    room = _ent("room", Kind.space, "b", placement=Placement(pos=(2, 0, 3), yaw=90))
    t = _twin(site, b, room)
    # точка (1, 0) комнаты: поворот 90° → (0, 1) + (2, 0, 3) → (2, 1, 3) в доме; ещё 90° → (−1, 2) + (10, 0) → (9, 2, 3)
    assert t.to_site("room", [(1, 0)]) == [pytest.approx((9, 2, 3))]
    m = t.matrix("room")
    assert [m[i][3] for i in range(3)] == pytest.approx([10, 2, 3])
    assert m[0][0] == pytest.approx(-1) and m[1][1] == pytest.approx(-1)  # 90° + 90° = 180°
    assert m[3] == [0, 0, 0, 1.0]


def test_parent_cycle_is_rejected():
    a = _ent("a", Kind.storage, "b")
    b = _ent("b", Kind.storage, "a")
    with pytest.raises(ValueError, match="цикл"):
        _twin(a, b)


def test_self_parent_is_rejected():
    with pytest.raises(ValueError, match="цикл"):
        _twin(_ent("a", Kind.storage, "a"))


def test_privacy_rank_order():
    assert [p.value for p in Privacy] == ["public", "residents", "household", "owner", "secret"]


# ── GeoJSON ──────────────────────────────────────────────────────────────────
def test_geojson_box_corners_and_closed_ring():
    g = Georef(lat=53.9, lon=27.56)
    site = _ent("site", Kind.site, privacy=Privacy.public)
    shed = _ent("shed", Kind.feature, "site", placement=Placement(pos=(10, 20, 0)), geom=Box(size=(4, 2, 3)))
    gj = to_geojson(_twin(site, shed, georef=g), Privacy.public)
    (f,) = gj["features"]
    ring = f["geometry"]["coordinates"][0]
    assert ring[0] == ring[-1] and len(ring) == 5
    corners = [lonlat_to_enu(g, lon, lat) for lon, lat in ring[:4]]
    assert corners == [pytest.approx(c, abs=1e-6) for c in [(10, 20), (14, 20), (14, 22), (10, 22)]]


def test_geojson_polyline_and_hidden():
    g = Georef(lat=0, lon=0)
    site = _ent("site", Kind.site, privacy=Privacy.public)
    pipe = _ent("pipe", Kind.mep, "site", geom=Polyline(points=[(0, 0, 0), (100, 0, 0)]), privacy=Privacy.household)
    t = _twin(site, pipe, georef=g)
    assert to_geojson(t, Privacy.public)["features"] == []
    (f,) = to_geojson(t, Privacy.owner)["features"]
    (lon0, lat0), (lon1, lat1) = f["geometry"]["coordinates"]
    assert lon1 - lon0 == pytest.approx(100 / m_per_deg_lon(0)) and lat1 == lat0 == 0


def test_geojson_needs_georef():
    with pytest.raises(ValueError):
        to_geojson(_twin(_ent("site", Kind.site)), Privacy.owner)


# ── контур квартиры ──────────────────────────────────────────────────────────
def test_footprint_two_squares_make_one_rectangle():
    out = footprint([[(0, 0), (1, 0), (1, 1), (0, 1)], [(1, 0), (2, 0), (2, 1), (1, 1)]])
    assert len(out) == 4
    assert _area_of(out) == pytest.approx(2.0, abs=0.01)
    assert _area(out) > 0                                                  # против часовой


def test_footprint_closes_narrow_gap_only():
    a, b = [(0, 0), (1, 0), (1, 1), (0, 1)], [(1.2, 0), (2.2, 0), (2.2, 1), (1.2, 1)]
    assert _area_of(footprint([a, b])) == pytest.approx(2.2, abs=0.02)    # щель 0,2 < 2·0,15 заделана
    far = [(3, 0), (4, 0), (4, 1), (3, 1)]
    assert _area_of(footprint([a, far])) == pytest.approx(1.0, abs=0.02)  # дальний — отдельный, берётся больший обход


def test_footprint_degenerate_input():
    assert footprint([]) == []
    assert footprint([[(0, 0), (1, 0), (2, 0)]]) == []                     # все точки на прямой: площади нет


# ── контуры панелей БАЗИСа ───────────────────────────────────────────────────
def test_loops_2d_joins_shuffled_reversed_segments():
    els = [{"l": [[100, 0], [100, 50]]}, {"l": [[0, 0], [100, 0]]}, {"l": [[0, 50], [0, 0]]}, {"l": [[0, 50], [100, 50]]}]
    (loop,) = loops_2d(els)
    assert len(loop) == 4 and abs(_area(loop)) == pytest.approx(5000)


def test_loops_2d_arc_and_circle_hole():
    # прямоугольник 100×50 со скруглённым верхом (полуокружность r = 50) и круглым отверстием r = 10
    els = [{"l": [[0, 0], [100, 0]]}, {"l": [[100, 0], [100, 50]]}, {"l": [[0, 50], [0, 0]]},
           {"a": [[100, 50], [0, 50]], "c": [50, 50], "ccw": True}, {"o": [50, 25], "r": 10}]
    outer, hole = loops_2d(els)
    assert abs(_area(outer)) == pytest.approx(5000 + math.pi * 50 ** 2 / 2, rel=0.01)
    assert max(y for _, y in outer) == pytest.approx(100)
    assert abs(_area(hole)) == pytest.approx(math.pi * 100, rel=0.02)


def test_extrusion_outline_area_fixture():
    room = Extrusion(outline=[(0, 0), (4, 0), (4, 3), (0, 3)], height=2.7)
    assert _area(room.outline) == pytest.approx(12.0)
