"""Импорт БАЗИС-Мебельщика на выдуманной тумбе: дверца сверху, ящик снизу, полка между ними, ХДФ сзади."""
from cherrybim import Entity, Kind, make_id
from cherrybim import io_bazis


def panel(n, axis, lo, rect, mat="ЛДСП Белый", th=18):
    """Панель в формате выгрузки: толщина по оси axis от lo, rect — (a0, b0, a1, b1) по двум другим осям, мм."""
    plane = [i for i in range(3) if i != axis]
    o, ex, ey, ez = [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]
    o[axis], ex[plane[0]], ey[plane[1]], ez[axis] = lo, 1, 1, 1
    a0, b0, a1, b1 = rect
    c = [{"l": [[a0, b0], [a1, b0]]}, {"l": [[a1, b1], [a1, b0]]}, {"l": [[a1, b1], [a0, b1]]}, {"l": [[a0, b1], [a0, b0]]}]
    mn, mx = [0, 0, 0], [0, 0, 0]
    mn[axis], mx[axis] = lo, lo + th
    mn[plane[0]], mx[plane[0]], mn[plane[1]], mx[plane[1]] = a0, a1, b0, b1
    return {"t": "panel", "n": n, "mat": mat, "th": th, "o": o, "ex": ex, "ey": ey, "ez": ez, "c": c, "min": mn, "max": mx}


def hw(n, furn, mn, mx):
    return {"t": "list", "n": n, "furn": furn, "min": mn, "max": mx, "kids": []}


def hole(x, y, z0, z1):
    return {"t": "other", "n": "4", "min": [x - 2, y - 2, z0], "max": [x + 2, y + 2, z1]}


DOC = {"root": {"t": "list", "n": "тумба", "min": [0, 0, -3], "max": [600, 800, 418], "kids": [
    panel("Вертикальная", 0, 0, (0, 0, 800, 400)),
    panel("Вертикальная", 0, 582, (0, 0, 800, 400)),
    panel("Горизонтальная", 1, 0, (18, 0, 582, 400)),
    panel("Горизонтальная", 1, 782, (18, 0, 582, 400)),
    panel("Горизонтальная", 1, 391, (18, 0, 582, 380)),
    panel("Фронтальная", 2, -3, (0, 0, 600, 800), mat="ХДФ, 3 мм, белый", th=3),
    panel("Фронтальная", 2, 400, (2, 411, 598, 798)),                     # дверца
    panel("Фронтальная", 2, 400, (2, 2, 598, 389)),                       # фасад ящика
    {"t": "list", "n": "ящик", "min": [30, 45, 20], "max": [570, 190, 380], "kids": [
        panel("Вертикальная", 0, 30, (45, 20, 190, 380)),
        panel("Вертикальная", 0, 552, (45, 20, 190, 380)),
        panel("Горизонтальная", 1, 56, (48, 20, 552, 380)),
        panel("Фронтальная", 2, 362, (48, 74, 552, 190)),
        panel("Фронтальная", 2, 20, (48, 74, 552, 190)),
    ]},
    hw("Направляющая TANDEM", "Направляющая_TANDEM", [18, 30, 10], [582, 90, 390]),
    hw("Петля CLIP top", "Петля", [5, 700, 340], [40, 750, 415]),
    hole(540, 560, 400, 418), hole(540, 720, 400, 418),
]}}


def test_roles_doors_drawers_handles():
    m = io_bazis.Model(DOC)
    assert m.size == (0.6, 0.421, 0.8)
    fronts = [p for p in m.panels if p.role == "front"]
    assert len(fronts) == 2 and [p.role for p in m.panels].count("back") == 1
    door = next(p for p in fronts if p.hinge)
    assert door.hinge == "left" and not door.drawer
    assert next(p for p in fronts if not p.hinge).drawer
    assert sum(p.box_of is not None for p in m.panels) == 5
    (h,) = m.handles({160: (0.188, 0.0075, 0.025)})
    assert h["x"] == [0.54, 0.54] and abs(h["z"][1] - h["z"][0] - 0.188) < 1e-6 and len(h["posts"]) == 2
    part = m.part(door)
    assert part["b"] == [0.002, 0.0, 0.411, 0.598, 0.018, 0.798] and part["hinge"] == "left"


def test_cells_and_storage():
    m = io_bazis.Model(DOC)
    cells = m.cells()
    assert [(c["z"], len(c["drawers"])) for c in cells] == [([0.018, 0.391], 1), ([0.409, 0.782], 0)]
    assert cells[1]["y"] == [0.018, 0.418]                 # от кромок боковин (полка утоплена) до ХДФ
    cab = Entity(id=make_id("t", "cab"), key="cab", kind=Kind.furniture, name="Тумба")
    st = io_bazis.storage_from_bazis(m, cab, "t", names={"cab.c1": ("За дверцей", ["полка"])})
    assert [(e.key, e.type, e.name) for e in st] == [("cab.d1", "drawer", "Ящик"), ("cab.c1", "compartment", "За дверцей")]
    assert st[0].geom.size == (0.504, 0.324, 0.116)


def test_contour_with_cutout_becomes_profile():
    doc = {"root": {"t": "list", "n": "x", "min": [0, 0, 0], "max": [18, 100, 50], "kids": [
        {**panel("Вертикальная", 0, 0, (0, 0, 100, 50)),
         "c": [{"l": [[0, 0], [100, 0]]}, {"l": [[100, 50], [100, 0]]}, {"l": [[100, 50], [20, 50]]},
               {"l": [[20, 50], [20, 30]]}, {"l": [[0, 30], [20, 30]]}, {"l": [[0, 30], [0, 0]]}]}]}}
    m = io_bazis.Model(doc)
    (p,) = m.parts()
    assert p["ax"] == "x" and p["d"] == [0.0, 0.018] and len(p["p"]) == 6
