import json
import math
import uuid

import pytest

from cherrybim import Kind, Package, Privacy, ifc_guid, make_id
from cherrybim.export import to_geojson
from cherrybim.geo import footprint
from cherrybim.kinds import as_json, lookup


def test_make_id_is_stable_and_namespaced():
    assert make_id("a", "x") == make_id("a", "x")
    assert make_id("a", "x") != make_id("b", "x")
    uuid.UUID(make_id("a", "x"))


def test_ifc_guid_edges():
    assert ifc_guid(str(uuid.UUID(int=0))) == "0" * 22
    assert ifc_guid(str(uuid.UUID(int=(1 << 128) - 1))) == "3" + "$" * 21


def test_package_roundtrip(demo):
    for pkg in demo:
        data = json.loads(pkg.model_dump_json(by_alias=True))
        assert Package.model_validate(data) == pkg


def test_privacy_inheritance_and_audience(twin):
    assert twin.privacy("kv12.bedroom.wardrobe.dr2") == Privacy.household     # от пакета квартиры
    assert twin.privacy("b1.s1.f3.panel") == Privacy.residents
    public = {e.key for e in twin.visible_to(Privacy.public)}
    assert "b1.s1.f3" in public and "kv12" not in public and "b1.s1.f3.panel" not in public
    residents = {e.key for e in twin.visible_to(Privacy.residents)}
    assert "b1.s1.f3.panel" in residents and "kv12.bedroom" not in residents


def test_path_crosses_packages(twin):
    assert twin.path("kv12.bedroom.wardrobe.dr2.drill") == (
        "Демо-квартал → Дом 1 → Подъезд 1 → Этаж 3 → Квартира 12 → Спальня → Шкаф → Секция с ящиками → Ящик 2 → Дрель-шуруповёрт")


def test_to_site_matches_matrix(twin):
    key = "kv12.bedroom.wardrobe.dr3"
    p = twin.to_site(key, [(0.1, 0.2, 0.3)])[0]
    m = twin.matrix(key)
    q = [sum(m[i][k] * v for k, v in enumerate((0.1, 0.2, 0.3, 1.0))) for i in range(3)]
    assert all(math.isclose(a, b, abs_tol=1e-9) for a, b in zip(p, q))
    assert math.isclose(p[2], 2 * 2.8 + 0.1 + 2 * 0.3 + 0.3, abs_tol=1e-9)   # этаж 3, цоколь, ящик 3


def test_search_finds_item_with_case_endings(twin):
    hits = twin.search("дрели", Privacy.household)
    assert hits and hits[0][0].key == "kv12.bedroom.wardrobe.dr2.drill"
    assert not twin.search("дрель", Privacy.public)                       # публике квартира не видна


def test_search_single_digit_is_exact(twin):
    hits = twin.search("ящик 3", Privacy.household)
    assert hits[0][0].key == "kv12.bedroom.wardrobe.dr3"


def test_search_single_letter_label_is_optional(twin):
    assert twin.search("дрель в спальне", Privacy.household)[0][0].key == "kv12.bedroom.wardrobe.dr2.drill"
    assert twin.search("ящик 2 б", Privacy.household)[0][0].key == "kv12.bedroom.wardrobe.dr2"


def test_search_uses_parent_names(twin):
    hits = twin.search("дрель в спальне", Privacy.household)
    assert hits[0][0].key == "kv12.bedroom.wardrobe.dr2.drill"
    ranked = twin.rank("ящик", Privacy.household)
    assert ranked[0][0] == ranked[1][0]                     # «ящик» — неоднозначно, ящиков четыре
    assert all(e.kind != Kind.space for _, e in twin.rank("ящик", Privacy.household))   # комнаты не всплывают


def test_geojson_respects_audience(twin):
    pub = to_geojson(twin, Privacy.public)
    keys = {f["properties"]["key"] for f in pub["features"]}
    assert "b1" in keys and not any(k.startswith("kv12") for k in keys)
    home = to_geojson(twin, Privacy.household)
    assert any(f["properties"]["key"] == "kv12.heat_route" and f["geometry"]["type"] == "LineString"
               for f in home["features"])


def test_kinds_table():
    assert lookup(Kind.mep, "radiator")[1] == "IfcSpaceHeater"
    assert lookup(Kind.storage, "unknown-type")[1] == "IfcFurniture"
    assert as_json()["section"]["*"]["ifc"] == "IfcBuilding"


def test_ifc_export(tmp_path, twin):
    pytest.importorskip("ifcopenshell")
    import ifcopenshell
    import ifcopenshell.validate
    from cherrybim.export_ifc import to_ifc

    out = tmp_path / "demo.ifc"
    stats = to_ifc(twin, Privacy.household, str(out))
    assert stats["IfcSpace"] >= 4 and stats["IfcDistributionSystem"] == 1
    log = ifcopenshell.validate.json_logger()
    ifcopenshell.validate.validate(ifcopenshell.open(str(out)), log)
    assert log.statements == []


def test_footprint_closes_doorways_and_keeps_corners():
    a = [(0, 0), (4, 0), (4, 3), (0, 3)]
    b = [(4.16, 0), (8, 0), (8, 3), (4.16, 3)]           # дверной проём 16 см между комнатами
    c = [(0, 3), (2, 3), (2, 6), (0, 6)]
    assert sorted(footprint([a, b])) == [(0, 0), (0, 3), (8, 0), (8, 3)]
    fp = footprint([a, b, c])
    assert len(fp) == 6 and (2.0, 3.0) in fp
    area = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(fp, fp[1:] + fp[:1])) / 2
    assert math.isclose(area, 8 * 3 + 2 * 3, abs_tol=1e-6)  # против часовой: площадь положительная


def test_plan_label_point_stays_inside_l_shape():
    from cherrybim.plan import _center, _edge_dist, _in_poly
    rect = [(0, 0), (10, 0), (10, 4), (0, 4)]
    assert _center(rect) == (5, 2)
    ell = [(0, 0), (10, 0), (10, 2), (2, 2), (2, 10), (0, 10)]   # центр рамки (5, 5) снаружи
    c = _center(ell)
    assert _in_poly(c, ell) and _edge_dist(c, ell) >= 0.9
    assert _center([(3, 4)]) == (3, 4)
