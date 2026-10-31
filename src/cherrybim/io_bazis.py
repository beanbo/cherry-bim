# -*- coding: utf-8 -*-
"""БАЗИС-Мебельщик → мебель по деталям и места хранения.

Модель выгружает скрипт `tools/bazis/cherrybim-export.js` (меню «Скрипты» БАЗИС-Мебельщика): панели с контурами,
фурнитура, отверстия. Здесь из выгрузки получаются:

- `parts` — панели в системе мебели: метры, X вдоль фасада слева направо, Y от фасада вглубь, Z вверх (фасад —
  сторона −Y, как у всей мебели Cherry BiM). Прямоугольная панель — коробка `{"b": [x0, y0, z0, x1, y1, z1]}`,
  с вырезами — контур `{"p": [[u, v], …], "ax": ось толщины, "d": [от, до]}`: при ax "x" точки (y, z), "y" — (x, z),
  "z" — (x, y). Роль `m`: "body" — корпус, "front" — фасад (лицевая панель в плоскости фасада), "back" — задняя
  стенка из ХДФ/ДВП. У дверей `hinge` ("left", "right", "top", "bottom") — по петлям, у ящиков `drawer`.
- `handles` — ручки по отверстиям под них на фасадах.
- места хранения — ячейки корпуса (внутренний объём, разбитый сквозными полками и стойками) и ящики по направляющим.

Оси БАЗИСа: X — ширина, Y — высота, Z — глубина, фасад смотрит в +Z; единицы — мм.
"""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path

from .model import Box, Entity, Kind, Placement, Source, make_id

BACK = re.compile(r"ХДФ|ДВП|HDF|LDF", re.I)
FRONT_TOL = 3.0            # лицевая панель стоит в плоскости фасада, если её лицо не дальше 3 мм от переднего края
HOLE = re.compile(r"^\d+(\.\d+)?$")   # отверстие под ручку в БАЗИСе называется своим диаметром: «4»


def load(path) -> dict:
    """Выгрузка скрипта: JSON в UTF-8 или в cp1251 (так пишет БАЗИС)."""
    raw = Path(path).read_bytes()
    try:
        return json.loads(raw.decode("utf-8"))
    except UnicodeDecodeError:
        return json.loads(raw.decode("cp1251"))


@dataclass
class Panel:
    name: str
    mat: str
    th: float                  # толщина, мм
    axis: int                  # ось толщины в системе БАЗИСа: 0 — x, 1 — y, 2 — z
    lo: float                  # протяжённость по оси толщины, мм
    hi: float
    loops: list                # контуры в плоскости панели: [[(a, b), …]] по двум другим осям, мм; первый — внешний
    bmin: tuple
    bmax: tuple
    path: str = ""
    art: str = ""
    role: str = "body"
    hinge: str | None = None
    drawer: bool = False
    box_of: int | None = None  # деталь короба ящика (номер направляющей)


@dataclass
class Hw:                      # фурнитура: петля, направляющая, навеска, отверстие
    kind: str
    name: str
    bmin: tuple
    bmax: tuple

    @property
    def c(self):
        return tuple((a + b) / 2 for a, b in zip(self.bmin, self.bmax))


def _arc(e, step=math.pi / 16):
    (x0, y0), (x1, y1), (cx, cy) = e["a"][0], e["a"][1], e["c"]
    a0, a1, r = math.atan2(y0 - cy, x0 - cx), math.atan2(y1 - cy, x1 - cx), math.hypot(x0 - cx, y0 - cy)
    sweep = a1 - a0
    if e.get("ccw"):
        sweep += 2 * math.pi if sweep <= 0 else 0
    else:
        sweep -= 2 * math.pi if sweep >= 0 else 0
    n = max(2, math.ceil(abs(sweep) / step))
    return [(cx + r * math.cos(a0 + sweep * i / n), cy + r * math.sin(a0 + sweep * i / n)) for i in range(n + 1)]


def _runs(r: "Hw", p: "Panel") -> bool:
    """Фасад p стоит перед направляющей r: перекрывает её по ширине на 70 % и низ направляющей — в его высоте."""
    over = min(r.bmax[0], p.bmax[0]) - max(r.bmin[0], p.bmin[0])
    return over >= 0.7 * (r.bmax[0] - r.bmin[0]) and p.bmin[1] - 30 <= r.bmin[1] <= p.bmax[1]


def _area(pts):
    return sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts))) / 2


def loops_2d(elems, tol=0.05) -> list:
    """Элементы контура (отрезки, дуги, окружности — в любом порядке) → замкнутые контуры, внешний первым."""
    segs, out = [], []

    def flat(es):
        for e in es:
            if "l" in e:
                segs.append([tuple(e["l"][0]), tuple(e["l"][1])])
            elif "a" in e:
                segs.append(_arc(e))
            elif "o" in e:
                (cx, cy), r = e["o"], e["r"]
                out.append([(cx + r * math.cos(2 * math.pi * i / 24), cy + r * math.sin(2 * math.pi * i / 24)) for i in range(24)])
            elif "list" in e:
                flat(e["list"])
    flat(elems)
    near = lambda p, q: abs(p[0] - q[0]) <= tol and abs(p[1] - q[1]) <= tol  # noqa: E731
    while segs:
        cur = list(segs.pop(0))
        while not (len(cur) > 2 and near(cur[0], cur[-1])):
            for i, s in enumerate(segs):
                if near(s[0], cur[-1]):
                    cur += s[1:]
                elif near(s[-1], cur[-1]):
                    cur += s[::-1][1:]
                else:
                    continue
                segs.pop(i)
                break
            else:
                break                                      # контур не замкнулся — берём как есть
        if near(cur[0], cur[-1]):
            cur.pop()
        if len(cur) >= 3:
            out.append(cur)
    out.sort(key=lambda p: -abs(_area(p)))
    return out


class Model:
    """Выгрузка одной мебели. pick(bmin, bmax) — оставить только часть модели (в файле два изделия); lift — мебель
    стоит на опорах такой высоты (м): низ корпуса поднят, высота мебели — с опорами."""

    def __init__(self, doc: dict, pick=None, lift: float = 0.0):
        self.panels: list[Panel] = []
        self.hw: list[Hw] = []
        self._walk(doc["root"], "", pick)
        if not self.panels:
            raise ValueError("в модели нет панелей")
        self.x0 = min(p.bmin[0] for p in self.panels)
        self.y0 = min(p.bmin[1] for p in self.panels) - lift * 1000
        self.z0 = min(p.bmin[2] for p in self.panels)
        self.x1 = max(p.bmax[0] for p in self.panels)
        self.y1 = max(p.bmax[1] for p in self.panels)
        self.z1 = max(p.bmax[2] for p in self.panels)
        self._classify()

    # ── чтение ──────────────────────────────────────────────────────────────
    def _walk(self, o, path, pick):
        t, furn = o.get("t"), o.get("furn") or ""
        if t == "list" and not furn:                       # сборка: решаем по её деталям
            for k in o.get("kids", []):
                self._walk(k, f"{path}/{o['n']}", pick)
            return
        if pick and not pick(tuple(o["min"]), tuple(o["max"])):
            return
        if t == "panel":
            self._panel(o, path)
        elif t == "list":
            kind = ("hinge" if furn.startswith("Петля") else "runner" if furn.startswith("Направляющая")
                    else "hanger" if furn.startswith("Навеска") else furn)
            self.hw.append(Hw(kind, o["n"], tuple(o["min"]), tuple(o["max"])))
        elif t == "other" and HOLE.match(o["n"].strip()):
            self.hw.append(Hw("hole", o["n"].strip(), tuple(o["min"]), tuple(o["max"])))

    def _panel(self, o, path):
        o0, ex, ey, ez = (o[k] for k in ("o", "ex", "ey", "ez"))
        axis = max(range(3), key=lambda i: abs(ez[i]))
        if abs(abs(ez[axis]) - 1) > 1e-3:
            raise ValueError(f"панель «{o['n']}» стоит не по осям — такие не поддержаны")
        plane = [i for i in range(3) if i != axis]
        g = lambda u, v: [o0[i] + u * ex[i] + v * ey[i] for i in range(3)]  # noqa: E731
        loops = []
        for lp in loops_2d(o["c"]):
            pts = [g(u, v) for u, v in lp]
            loops.append([(round(p[plane[0]], 2), round(p[plane[1]], 2)) for p in pts])
        a, b = o0[axis], o0[axis] + o["th"] * ez[axis]
        if not loops:                                      # контура нет — по габариту
            mn, mx = o["min"], o["max"]
            loops = [[(mn[plane[0]], mn[plane[1]]), (mx[plane[0]], mn[plane[1]]), (mx[plane[0]], mx[plane[1]]), (mn[plane[0]], mx[plane[1]])]]
        self.panels.append(Panel(o["n"], o.get("mat", "").split("\r")[0].strip(), o["th"], axis, min(a, b), max(a, b), loops,
                                 tuple(o["min"]), tuple(o["max"]), path, o.get("art", "")))

    # ── роли деталей ────────────────────────────────────────────────────────
    def _classify(self):
        for p in self.panels:
            if BACK.search(p.mat):
                p.role = "back"
            elif p.axis == 2 and p.hi >= self.z1 - FRONT_TOL:
                p.role = "front"
        hinges = [h for h in self.hw if h.kind == "hinge"]
        runners = [h for h in self.hw if h.kind == "runner"]
        for p in self.panels:
            if p.role != "front":
                continue
            mine = [h for h in hinges if p.bmin[0] - 10 <= h.c[0] <= p.bmax[0] + 10 and p.bmin[1] - 10 <= h.c[1] <= p.bmax[1] + 10]
            if mine:
                cx, cy = (p.bmin[0] + p.bmax[0]) / 2, (p.bmin[1] + p.bmax[1]) / 2
                dx = sum(h.c[0] - cx for h in mine) / len(mine)
                dy = sum(h.c[1] - cy for h in mine) / len(mine)
                p.hinge = ("right" if dx > 0 else "left") if abs(dx) >= abs(dy) else ("top" if dy > 0 else "bottom")
        # ящики: короб — панели над направляющей между её концами; фасад ящика — лицевая панель перед коробом
        for i, r in enumerate(runners):
            box = [p for p in self.panels if p.role != "back" and not p.hinge
                   and r.bmin[0] - 2 <= p.bmin[0] and p.bmax[0] <= r.bmax[0] + 2
                   and r.bmin[1] - 2 <= p.bmin[1] <= r.bmin[1] + 60 and p.bmax[1] - p.bmin[1] < 400
                   and p.bmin[2] >= r.bmin[2] - 30]
            for p in box:
                if p.role == "front" or (p.axis == 2 and p.bmin[2] >= max(q.bmin[2] for q in box) - 1 and p.bmin[1] <= r.bmin[1] + 10):
                    p.drawer = True                        # фасад: снаружи или внутренний за дверью
                else:
                    p.box_of = i
        for p in self.panels:                              # фасад перед направляющей (бывает шире корпуса) — ящик
            if p.role == "front" and not p.hinge and any(_runs(r, p) for r in runners):
                p.drawer = True

    # ── в системе мебели ────────────────────────────────────────────────────
    @property
    def size(self):
        return (round((self.x1 - self.x0) / 1000, 4), round((self.z1 - self.z0) / 1000, 4), round((self.y1 - self.y0) / 1000, 4))

    def X(self, x):
        return round((x - self.x0) / 1000, 4)

    def Y(self, z):
        return round((self.z1 - z) / 1000, 4)

    def Z(self, y):
        return round((y - self.y0) / 1000, 4)

    def local_box(self, bmin, bmax):
        return [self.X(bmin[0]), self.Y(bmax[2]), self.Z(bmin[1]), self.X(bmax[0]), self.Y(bmin[2]), self.Z(bmax[1])]

    def part(self, p: Panel, role=None) -> dict:
        out = {"m": role or p.role}
        if p.hinge:
            out["hinge"] = p.hinge
        if p.drawer:
            out["drawer"] = True
        outline, holes = p.loops[0], p.loops[1:]
        rect = len(outline) == 4 and not holes and all(
            abs(outline[i][0] - outline[(i + 1) % 4][0]) < 0.01 or abs(outline[i][1] - outline[(i + 1) % 4][1]) < 0.01 for i in range(4))
        if rect:
            out["b"] = self.local_box(p.bmin, p.bmax)
            return out
        # контур в плоскости панели → координаты мебели; ось толщины БАЗИСа → ось мебели
        if p.axis == 0:                                    # стойка: (y, z) БАЗИСа → (Y, Z) мебели
            conv = lambda a, b: [self.Y(b), self.Z(a)]  # noqa: E731
            out.update(ax="x", d=[self.X(p.lo), self.X(p.hi)])
        elif p.axis == 1:                                  # полка: (x, z) → (X, Y)
            conv = lambda a, b: [self.X(a), self.Y(b)]  # noqa: E731
            out.update(ax="z", d=[self.Z(p.lo), self.Z(p.hi)])
        else:                                              # фронтальная: (x, y) → (X, Z)
            conv = lambda a, b: [self.X(a), self.Z(b)]  # noqa: E731
            out.update(ax="y", d=[self.Y(p.hi), self.Y(p.lo)])
        out["p"] = [conv(a, b) for a, b in outline]
        if holes:
            out["h"] = [[conv(a, b) for a, b in lp] for lp in holes]
        return out

    def parts(self, role=None) -> list[dict]:
        """Все панели в системе мебели. role(panel) → своя роль ("body", "front", "back", другое — ключ цвета)."""
        return [self.part(p, role(p) if role else None) for p in self.panels]

    def handles(self, kinds=None) -> list[dict]:
        """Ручки по отверстиям на фасадах: {"x": [x0, x1], "z": [z0, z1] — концы ручки, "y" — лицо фасада, "posts" —
        точки крепления [[x, z]], "w" — ширина, "d" — вылет}. kinds: {межосевое мм: (длина, ширина, вылет) м}; иначе
        длина — межосевое + 28 мм."""
        kinds = kinds or {}
        out = []
        for p in self.panels:
            if p.role != "front" or p.axis != 2:
                continue
            holes = {(round(h.c[0]), round(h.c[1])) for h in self.hw if h.kind == "hole"
                     and p.bmin[0] <= h.c[0] <= p.bmax[0] and p.bmin[1] <= h.c[1] <= p.bmax[1]
                     and h.bmin[2] < p.hi + 0.5 and h.bmax[2] > p.lo - 0.5}
            if len(holes) < 2:
                continue
            hs = sorted(holes)
            dx = max(h[0] for h in hs) - min(h[0] for h in hs)
            dy = max(h[1] for h in hs) - min(h[1] for h in hs)
            along = "z" if dy >= dx else "x"
            key = round(max(dx, dy))
            ln, w, d = kinds.get(key, ((key + 28) / 1000, 0.008, 0.028))
            if along == "z":
                x = sum(h[0] for h in hs) / len(hs)
                c = (min(h[1] for h in hs) + max(h[1] for h in hs)) / 2
                ends = {"x": [self.X(x)] * 2, "z": [round(self.Z(c) - ln / 2, 4), round(self.Z(c) + ln / 2, 4)]}
            else:
                z = sum(h[1] for h in hs) / len(hs)
                c = (min(h[0] for h in hs) + max(h[0] for h in hs)) / 2
                ends = {"x": [round(self.X(c) - ln / 2, 4), round(self.X(c) + ln / 2, 4)], "z": [self.Z(z)] * 2}
            out.append({**ends, "y": self.Y(p.hi), "posts": [[self.X(a), self.Z(b)] for a, b in hs], "w": w, "d": d})
        return out

    # ── ячейки корпуса и ящики ──────────────────────────────────────────────
    def structure(self, min_depth=0.5):
        """Сквозные стойки и полки корпуса (без фасадов, задних стенок и коробов ящиков) в координатах мебели:
        [(ось толщины "x"|"z", x0, z0, x1, z1)] — проекция на фасад, метры."""
        D = self.z1 - self.z0
        out = []
        for p in self.panels:
            if p.role != "body" or p.box_of is not None or p.drawer or p.axis == 2:
                continue
            if p.bmax[2] - p.bmin[2] < min_depth * D:
                continue
            out.append(("x" if p.axis == 0 else "z", self.X(p.bmin[0]), self.Z(p.bmin[1]), self.X(p.bmax[0]), self.Z(p.bmax[1])))
        return out

    def cells(self, min_size=0.06) -> list[dict]:
        """Внутренний объём корпуса, разбитый сквозными стойками и полками (гильотиной): листья —
        {"x": [x0, x1], "z": [z0, z1], "y": [y0, y1], "path": "…", "drawers": [...]}; path — как резали: "x1.z0" —
        вторая колонка, нижняя ячейка в ней."""
        st = self.structure()
        vert = [s for s in st if s[0] == "x"]
        hor = [s for s in st if s[0] == "z"]
        if not vert or not hor:
            return []
        x0 = min(v[3] for v in vert if v[1] <= min(q[1] for q in vert) + 0.001)
        x1 = max(v[1] for v in vert if v[3] >= max(q[3] for q in vert) - 0.001)
        z0 = min(h[4] for h in hor if h[2] <= min(q[2] for q in hor) + 0.001)
        z1 = max(h[2] for h in hor if h[4] >= max(q[4] for q in hor) - 0.001)
        leaves = []

        def split(rx0, rz0, rx1, rz1, path):
            tol = 0.004
            inside = lambda s: s[1] > rx0 - tol and s[3] < rx1 + tol and s[2] > rz0 - tol and s[4] < rz1 + tol  # noqa: E731
            for s in sorted((v for v in vert if inside(v) and v[2] <= rz0 + tol and v[4] >= rz1 - tol
                             and v[1] > rx0 + tol and v[3] < rx1 - tol), key=lambda s: s[1]):
                split(rx0, rz0, s[1], rz1, path + ".x0")
                split(s[3], rz0, rx1, rz1, path + ".x1")
                return
            for s in sorted((h for h in hor if h[1] <= rx0 + tol and h[3] >= rx1 - tol and rz0 + tol < h[2] and h[4] < rz1 - tol),
                            key=lambda s: s[2]):
                split(rx0, rz0, rx1, s[2], path + ".z0")
                split(rx0, s[4], rx1, rz1, path + ".z1")
                return
            if rx1 - rx0 >= min_size and rz1 - rz0 >= min_size:
                leaves.append({"x": [round(rx0, 4), round(rx1, 4)], "z": [round(rz0, 4), round(rz1, 4)], "path": path.lstrip(".")})
        split(x0, z0, x1, z1, "")
        # глубина ячейки: от передних кромок стоек и полок вокруг неё до ближайшей задней стенки (панель или ХДФ)
        def touches(p, c):
            if p.axis == 0:
                return ((abs(self.X(p.bmax[0]) - c["x"][0]) < 0.005 or abs(self.X(p.bmin[0]) - c["x"][1]) < 0.005)
                        and self.Z(p.bmin[1]) < c["z"][1] and self.Z(p.bmax[1]) > c["z"][0])
            return ((abs(self.Z(p.bmax[1]) - c["z"][0]) < 0.005 or abs(self.Z(p.bmin[1]) - c["z"][1]) < 0.005)
                    and self.X(p.bmin[0]) < c["x"][1] and self.X(p.bmax[0]) > c["x"][0])

        for c in leaves:
            cx, cz = (c["x"][0] + c["x"][1]) / 2, (c["z"][0] + c["z"][1]) / 2
            front = min((self.Y(p.bmax[2]) for p in self.panels if p.role == "body" and p.axis != 2 and p.box_of is None
                         and not p.drawer and touches(p, c)), default=0.0)
            backs = [self.Y(p.hi) for p in self.panels if p.axis == 2 and p.role != "front" and not p.drawer and p.box_of is None
                     and self.X(p.bmin[0]) <= cx <= self.X(p.bmax[0]) and self.Z(p.bmin[1]) <= cz <= self.Z(p.bmax[1])
                     and self.Y(p.hi) > front + 0.05]
            c["y"] = [round(front, 4), round(min(backs) if backs else self.size[1], 4)]
            c["drawers"] = [d for d in self.drawer_boxes() if c["x"][0] - 0.01 <= d["x"][0] and d["x"][1] <= c["x"][1] + 0.01
                            and c["z"][0] - 0.03 <= d["z"][0] < c["z"][1]]
        return leaves

    def drawer_boxes(self) -> list[dict]:
        """Ящики по направляющим: внутренний объём короба {"x", "y", "z": [от, до]}, снизу вверх."""
        out = []
        runners = [h for h in self.hw if h.kind == "runner"]
        for i, r in enumerate(runners):
            box = [p for p in self.panels if p.box_of == i]
            sides = [p for p in box if p.axis == 0]
            bottoms = [p for p in box if p.axis == 1]
            ends = [p for p in box if p.axis == 2]
            if len(sides) >= 2 and bottoms:
                xa = min(p.bmax[0] for p in sides if p.bmin[0] <= min(q.bmin[0] for q in sides) + 1)
                xb = max(p.bmin[0] for p in sides if p.bmax[0] >= max(q.bmax[0] for q in sides) - 1)
                za = max(p.bmax[1] for p in bottoms)
                zb = max(p.bmax[1] for p in sides)
                zs = sorted(p.bmin[2] for p in ends) if len(ends) >= 2 else None
                ya, yb = (zs[-1], max(p.bmax[2] for p in ends if p.bmin[2] < zs[-1])) if zs else (min(p.bmin[2] for p in sides), max(p.bmax[2] for p in sides))
                out.append({"x": [self.X(xa), self.X(xb)], "y": [self.Y(ya), self.Y(yb)], "z": [self.Z(za), self.Z(zb)]})
            else:                                          # короба нет — по направляющей и фасаду
                f = [p for p in self.panels if p.drawer and r.bmin[0] - 30 <= p.bmin[0] and p.bmax[0] <= r.bmax[0] + 30
                     and p.bmin[1] - 30 <= r.bmin[1] <= p.bmax[1]]
                top = max((p.bmax[1] for p in f), default=r.bmax[1] + 100)
                out.append({"x": [self.X(r.bmin[0] + 13), self.X(r.bmax[0] - 13)], "y": [self.Y(r.bmax[2]), self.Y(r.bmin[2])],
                            "z": [self.Z(r.bmin[1] + 15), self.Z(top - 20)]})
        return sorted(out, key=lambda d: (d["z"][0], d["x"][0]))


def storage_from_bazis(m: Model, parent: Entity, ns: str, sections: list | None = None, names: dict | None = None,
                       hanging=lambda c: False, src: Source | None = None) -> list[Entity]:
    """Места хранения мебели из ячеек корпуса.

    sections — [(ключ, название, x0, x1, z0, z1)] (м, система мебели): ячейки группируются по ним; без секций ячейки
    и ящики кладутся прямо в мебель. names — {ключ места: (название, синонимы) или название} поверх названий по
    умолчанию. hanging(ячейка) — ячейка со штангой. Ключи: <секция>.c<n> — ячейки снизу вверх, <секция>.d<n> — ящики
    сверху вниз (d1 — верхний)."""
    names = names or {}
    src = src or Source(origin="design", acc=0.003, note="проект БАЗИС-Мебельщика")
    D = m.size[1]
    out: list[Entity] = []

    def ent(key, name, typ, pos, size, par, **props):
        nm, al = names.get(key, name), []
        if isinstance(nm, tuple):
            nm, al = nm
        e = Entity(id=make_id(ns, key), key=key, kind=Kind.storage, type=typ, name=nm, parent=par.id, aliases=al,
                   placement=Placement(pos=tuple(round(v, 4) for v in pos)), geom=Box(size=tuple(round(v, 4) for v in size)),
                   props=props, src=src)
        out.append(e)
        return e

    cells = m.cells()
    groups = []
    if sections:
        for skey, sname, sx0, sx1, sz0, sz1 in sections:
            mine = [c for c in cells if sx0 - 0.01 <= (c["x"][0] + c["x"][1]) / 2 <= sx1 + 0.01 and sz0 - 0.01 <= (c["z"][0] + c["z"][1]) / 2 <= sz1 + 0.01]
            groups.append((ent(f"{parent.key}.{skey}", sname, "section", (sx0, 0.0, sz0), (sx1 - sx0, D, sz1 - sz0), parent), mine, (sx0, sz0)))
    else:
        groups.append((parent, cells, (0.0, 0.0)))
    for holder, mine, (ox, oz) in groups:
        prefix = holder.name if holder is not parent else ""
        say = lambda label: f"{prefix}: {label}" if prefix else label[:1].upper() + label[1:]  # noqa: E731
        drawers = sorted((d for c in mine for d in c["drawers"]), key=lambda d: (-d["z"][0], d["x"][0]))
        n = len(drawers)
        for j, d in enumerate(drawers, 1):                 # ящики сверху вниз: d1 — верхний
            label = "ящик" if n == 1 else f"ящик {j}" + (" (верхний)" if j == 1 else " (нижний)" if j == n else "")
            ent(f"{holder.key}.d{j}", say(label), "drawer", (d["x"][0] - ox, d["y"][0], d["z"][0] - oz),
                (d["x"][1] - d["x"][0], d["y"][1] - d["y"][0], d["z"][1] - d["z"][0]), holder, level=j)
        k = 0
        for c in sorted((c for c in mine if not c["drawers"]), key=lambda c: (c["z"][0], c["x"][0])):
            k += 1                                         # отделения снизу вверх: c1 — нижнее
            typ = "hanging" if hanging(c) else "compartment"
            ent(f"{holder.key}.c{k}", say("под штангой" if typ == "hanging" else f"отделение {k}"), typ,
                (c["x"][0] - ox, c["y"][0], c["z"][0] - oz),
                (c["x"][1] - c["x"][0], c["y"][1] - c["y"][0], c["z"][1] - c["z"][0]), holder, level=k)
    return out
