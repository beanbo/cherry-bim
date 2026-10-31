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
    assert lookup(Kind.mep, "water_filter")[1:] == ("IfcFilter", "WATERFILTER")
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


def test_idea_variant_add_change_remove(demo):
    # идея — слой поверх пакетов: новое с выведенным id, правка копией, убранное вместе с содержимым; пакеты не меняются
    from cherrybim.ideas import Idea, IdeaError, apply
    raw = {"key": "polka", "title": "Полка", "about": "kv12.bedroom",
           "add": [{"key": "idea.polka", "kind": "furniture", "type": "wall_shelf", "name": "Полка", "parent": "kv12.bedroom",
                    "placement": {"pos": [1, 1, 1.5]}, "geom": {"type": "box", "size": [1, 0.3, 0.02]}},
                   {"key": "idea.polka.c1", "kind": "storage", "name": "На полке", "parent": "idea.polka"}],
           "change": [{"ref": "kv12.bedroom.wardrobe", "placement": {"pos": [0.5, 0.5, 0]}, "props": {"note": "к окну"},
                       "note": "ближе к окну"}],
           "remove": ["kv12.bedroom.wardrobe.dr2", "нет-такого"]}
    idea = Idea.model_validate(raw)
    assert idea.add[0].id == make_id("idea:polka", "idea.polka") == Idea.model_validate(raw).add[0].id
    v = apply(list(demo), idea)
    t = v.twin
    shelf, place = t.by_key["idea.polka"], t.by_key["idea.polka.c1"]
    assert place.parent == shelf.id and v.marks[shelf.id] == v.marks[place.id] == "add"
    wardrobe = t.by_key["kv12.bedroom.wardrobe"]
    assert v.marks[wardrobe.id] == "change" and wardrobe.placement.pos == (0.5, 0.5, 0) and v.notes[wardrobe.id] == "ближе к окну"
    drill = t.by_key["kv12.bedroom.wardrobe.dr2.drill"]
    assert v.marks[drill.id] == v.marks[t.by_key["kv12.bedroom.wardrobe.dr2"].id] == "remove"
    assert v.warnings == ["убрать: нет «нет-такого»"] and v.about == t.by_key["kv12.bedroom"].id
    base = next(e for p in demo for e in p.entities if e.key == "kv12.bedroom.wardrobe")
    assert base.placement.pos != (0.5, 0.5, 0) and "note" not in base.props          # исходный пакет не тронут
    with pytest.raises(IdeaError):                                               # новому некуда встать
        apply(list(demo), Idea.model_validate({**raw, "add": [{**raw["add"][0], "parent": "нет-такого"}]}))


def test_idea_remove_keeps_what_it_moves_out(demo):
    # стеллаж уходит, а вещь с него идея переложила на новую полку: вещь — «изменится», а не «уберут»
    from cherrybim.ideas import Idea, apply
    idea = Idea.model_validate({
        "key": "pereezd", "title": "Новая полка вместо ящика",
        "add": [{"key": "idea.polka", "kind": "furniture", "type": "wall_shelf", "name": "Полка", "parent": "kv12.bedroom",
                 "placement": {"pos": [1, 1, 1.5]}, "geom": {"type": "box", "size": [1, 0.3, 0.02]}}],
        "change": [{"ref": "kv12.bedroom.wardrobe.dr2.drill", "parent": "idea.polka", "placement": {"pos": [0.1, 0.05, 0.02]}}],
        "remove": ["kv12.bedroom.wardrobe.dr2"]})
    v = apply(list(demo), idea)
    t = v.twin
    drill, box = t.by_key["kv12.bedroom.wardrobe.dr2.drill"], t.by_key["kv12.bedroom.wardrobe.dr2"]
    assert v.marks[box.id] == "remove" and v.marks[drill.id] == "change" and drill.parent == t.by_key["idea.polka"].id


def test_mesh_3mf_to_glb_roundtrip(tmp_path):
    # модель для печати (мм, компонент со сдвигом, повёрнута на столе) → GLB в метрах от угла габарита, упрощённая
    pytest.importorskip("numpy")
    import zipfile
    from cherrybim.io_mesh import cluster, mesh_to_glb, read_glb, read_3mf, read_stl
    cube = "".join(f'<vertex x="{x}" y="{y}" z="{z}"/>' for x in (0, 20) for y in (0, 10) for z in (0, 5))
    faces = [(0, 1, 3), (0, 3, 2), (4, 6, 7), (4, 7, 5), (0, 4, 5), (0, 5, 1), (2, 3, 7), (2, 7, 6), (0, 2, 6), (0, 6, 4),
             (1, 5, 7), (1, 7, 3)]
    tris = "".join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in faces)
    core = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
    prod = "http://schemas.microsoft.com/3dmanufacturing/production/2015/06"
    part = (f'<model xmlns="{core}" unit="millimeter"><resources><object id="1" type="model"><mesh><vertices>{cube}'
            f'</vertices><triangles>{tris}</triangles></mesh></object></resources><build/></model>')
    main = (f'<model xmlns="{core}" xmlns:p="{prod}" unit="millimeter"><resources><object id="2" type="model"><components>'
            f'<component p:path="/3D/Objects/part.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 100 50 0"/>'
            f'</components></object></resources><build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 10 10 0"/></build></model>')
    src = tmp_path / "holder.3mf"
    with zipfile.ZipFile(src, "w") as z:
        z.writestr("3D/3dmodel.model", main)
        z.writestr("3D/Objects/part.model", part)
    parts = read_3mf(src)
    assert len(parts) == 1 and parts[0].vertices.min(0).tolist() == [110, 60, 0] and len(parts[0].triangles) == 12
    info = mesh_to_glb(src, tmp_path / "holder.glb", rot_z=90, color="#202020")
    assert info["size"] == [0.01, 0.02, 0.005] and info["tris"] == [12]     # повёрнут: 20 мм легли вдоль Y
    gltf, prims = read_glb(tmp_path / "holder.glb")
    (v, t), = prims
    assert v.min(0).tolist() == [0, 0, 0] and abs(float(v.max(0)[1]) - 0.02) < 1e-6 and len(t) == 12
    assert gltf["accessors"][0]["max"][2] == pytest.approx(0.005) and gltf["materials"][0]["pbrMetallicRoughness"]["baseColorFactor"][0] < 0.02
    # слияние вершин: мелкая сетка не трогает куб, крупная схлопывает его в точку — треугольников не остаётся
    import numpy as np
    vv, tt = cluster(parts[0].vertices, parts[0].triangles, 1.0)
    assert len(vv) == 8 and len(tt) == 12
    assert len(cluster(parts[0].vertices, parts[0].triangles, 100.0)[1]) == 0
    # STL текстом — тот же путь
    stl = tmp_path / "tri.stl"
    stl.write_text("\n".join(["solid t", "facet normal 0 0 1", "outer loop", "vertex 0 0 0", "vertex 1 0 0", "vertex 0 1 0",
                              "endloop", "endfacet", "endsolid t", ""]))
    (p0,) = read_stl(stl)
    assert len(p0.vertices) == 3 and np.array_equal(p0.vertices[p0.triangles[0]], [[0, 0, 0], [1, 0, 0], [0, 1, 0]])
