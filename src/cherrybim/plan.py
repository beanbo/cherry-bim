# -*- coding: utf-8 -*-
"""2D-план картинкой: квартира, этаж или квартал сверху, нужное место подсвечено.

Для телевизора, уведомлений и печати. Нужен Pillow (экстра server). Рисуется с запасом 2× и
уменьшается, поэтому края ровные; шрифт с кириллицей ищется в системе (DejaVu Sans, Segoe UI, Arial).
"""
from __future__ import annotations

import io
import os

from .model import Entity, Kind, Privacy
from .twin import Twin

THEMES = {
    "dark": {"bg": (11, 13, 20), "slab": (32, 36, 46), "wall": (226, 229, 236), "text": (244, 246, 251),
             "muted": (150, 160, 172), "furniture": (98, 86, 72), "edge": (60, 66, 78), "window": (96, 160, 205),
             "door": (190, 64, 54), "accent": (255, 122, 24), "unit": (52, 58, 72),
             "rooms": [(64, 58, 48), (50, 64, 54), (46, 58, 72), (68, 52, 58), (60, 54, 74), (66, 64, 46),
                       (46, 66, 68), (70, 60, 48), (56, 64, 48), (62, 54, 70)]},
    "light": {"bg": (246, 247, 249), "slab": (214, 208, 198), "wall": (70, 74, 82), "text": (31, 41, 51),
              "muted": (102, 114, 127), "furniture": (200, 173, 134), "edge": (150, 140, 128), "window": (110, 180, 225),
              "door": (179, 54, 47), "accent": (228, 87, 46), "unit": (226, 220, 210),
              "rooms": [(243, 230, 211), (224, 236, 220), (220, 231, 242), (242, 223, 227), (232, 225, 242),
                        (239, 236, 207), (217, 236, 236), (240, 226, 208), (226, 233, 212), (230, 220, 239)]},
}
FONTS = [os.environ.get("CHERRYBIM_FONT"), "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
         "/usr/share/fonts/TTF/DejaVuSans.ttf", "C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf"]
BOLD = [os.environ.get("CHERRYBIM_FONT_BOLD"), "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf", "C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf"]
SS = 2                                   # рисуем вдвое крупнее и уменьшаем: сглаживание без антиалиасинга Pillow


def render_plan(twin: Twin, focus: str | None = None, audience: Privacy = Privacy.household,
                size: tuple[int, int] = (1920, 1080), theme: str = "dark", label: str | None = None) -> bytes:
    """PNG: вместилище места (квартира, иначе этаж, иначе квартал) сверху; focus подсвечен и подписан."""
    from PIL import Image, ImageDraw

    th = THEMES.get(theme, THEMES["dark"])
    seen = {e.id for e in twin.visible_to(audience)}
    target = twin.get(focus) if focus else None
    if target is not None and target.id not in seen:
        raise ValueError("это место не показывается")
    box = _container(twin, target, seen)
    if box is None:
        raise ValueError("нечего рисовать: нет геометрии")
    inv = _inverse(twin.matrix(box.id))
    members = [e for e in twin.by_id.values() if e.id in seen and e.geom is not None and _inside(twin, e, box)]

    def pts(e: Entity, local) -> list[tuple[float, float]]:
        m = _mul(inv, twin.matrix(e.id))
        return [(m[0][0] * x + m[0][1] * y + m[0][3], m[1][0] * x + m[1][1] * y + m[1][3]) for x, y in local]

    shapes = []                          # (слой, сущность, многоугольник или точка)
    for e in members:
        poly = _footprint(e)
        if poly is not None:
            shapes.append((e, pts(e, poly)))
    if not shapes:
        raise ValueError("нечего рисовать: нет геометрии")
    xs = [x for _, p in shapes for x, _ in p]
    ys = [y for _, p in shapes for _, y in p]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    w, h = size[0] * SS, size[1] * SS
    pad, pad_bottom = 60 * SS, (120 if label or target else 60) * SS
    s = min((w - 2 * pad) / max(x1 - x0, 0.5), (h - pad - pad_bottom) / max(y1 - y0, 0.5))
    ox = (w - (x1 - x0) * s) / 2
    oy = pad + ((h - pad - pad_bottom) - (y1 - y0) * s) / 2

    def px(p):
        return [(ox + (x - x0) * s, oy + (y1 - y) * s) for x, y in p]

    img = Image.new("RGBA", (w, h), th["bg"] + (255,))
    d = ImageDraw.Draw(img)
    order = [Kind.site, Kind.building, Kind.section, Kind.feature, Kind.unit, Kind.space, Kind.slab,
             Kind.furniture, Kind.device, Kind.wall, Kind.opening]
    room_i = 0
    rooms = []
    for kind in order:
        for e, p in shapes:
            if e.kind != kind or len(p) < 3:
                continue
            if kind == Kind.furniture and _under(twin, e, Kind.furniture):
                continue                 # мебель внутри мебели сверху не видна
            if kind in (Kind.site, Kind.building, Kind.section, Kind.feature):
                d.polygon(px(p), fill=th["slab"], outline=th["edge"], width=2 * SS)
            elif kind == Kind.unit:
                d.polygon(px(p), fill=th["unit"] if box.kind != Kind.unit else th["slab"], outline=th["edge"], width=2 * SS)
                if box.kind != Kind.unit and not any(k.kind == Kind.space and k.geom for k in twin.kids.get(e.id, [])):
                    rooms.append((e, p))     # подпись «кв. 21» — только у квартир без своих комнат
            elif kind == Kind.space:
                d.polygon(px(p), fill=th["rooms"][room_i % len(th["rooms"])])
                room_i += 1
                rooms.append((e, p))
            elif kind in (Kind.furniture, Kind.device):            # у техники с объёмом (холодильник) — как мебель
                d.polygon(px(p), fill=th["furniture"], outline=th["edge"], width=SS)
            elif kind == Kind.wall:
                d.polygon(px(p), fill=th["wall"])
            elif kind == Kind.opening:
                if e.type in ("door", "entrance_door") and e.geom.type == "box":
                    if e.type == "entrance_door":
                        d.polygon(px(p), fill=th["door"])
                    for line, lw in _swing(e, lambda q: px(pts(e, q))):   # полотно и дуга открывания, как на планах
                        d.line(line, fill=th["wall"] if lw > 1 else th["muted"], width=lw * SS, joint="curve")
                elif e.type != "passage":                 # проход без двери — пол идёт насквозь
                    d.polygon(px(p), fill=th["window"])

    f_room = _font(int(26 * SS * min(1.0, s / (60 * SS) + 0.5)))
    for e, p in rooms:                   # подписи комнат — внутри многоугольника, у Г-образных тоже
        if e.type == "lift_shaft":
            continue                     # шахту видно и так, подпись только мешает
        _text(d, _center(px(p)), _label(e), f_room, th["muted"], anchor="mm")

    if target is not None:
        poly_of = {e.id: p for e, p in shapes}
        carrier = next((a for a in [target] + twin.ancestors(target.id) if a.id in poly_of), None)
        over = Image.new("RGBA", img.size, (0, 0, 0, 0))
        od = ImageDraw.Draw(over)
        acc = th["accent"]
        if carrier is not None:
            p = px(poly_of[carrier.id])
            cx, cy = _center(p)
            if len(p) >= 3:
                od.polygon(p, fill=acc + (110,), outline=acc + (255,), width=4 * SS)
            r = 34 * SS
            od.ellipse((cx - r, cy - r, cx + r, cy + r), outline=acc + (255,), width=6 * SS)
            od.ellipse((cx - 9 * SS, cy - 9 * SS, cx + 9 * SS, cy + 9 * SS), fill=acc + (255,))
            img = Image.alpha_composite(img, over)
            d = ImageDraw.Draw(img)
            f_big = _font(int(30 * SS), bold=True)
            name = target.name
            tx = cx + r + 14 * SS
            anchor = "lm"
            if tx + d.textlength(name, font=f_big) > w - 20 * SS:
                tx, anchor = cx - r - 14 * SS, "rm"
            _text(d, (tx, cy), name, f_big, th["text"], anchor=anchor, halo=th["bg"])
    if label:
        _text(d, (w / 2, h - pad_bottom / 2), label, _font(int(30 * SS)), th["text"], anchor="mm")

    out = img.convert("RGB").resize(size, Image.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def _center(p: list[tuple[float, float]]) -> tuple[float, float]:
    """Точка для подписи и отметки внутри многоугольника. Центр рамки, если он внутри и не у края;
    иначе (Г-образная квартира) — точка сетки 20×20, дальше всех отстоящая от краёв."""
    if len(p) < 3:
        return p[0]
    xs, ys = [x for x, _ in p], [y for _, y in p]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    c = ((x0 + x1) / 2, (y0 + y1) / 2)
    if _in_poly(c, p) and _edge_dist(c, p) > 0.15 * min(x1 - x0, y1 - y0):
        return c
    best, far = c, -1.0
    for i in range(1, 20):
        for j in range(1, 20):
            q = (x0 + (x1 - x0) * i / 20, y0 + (y1 - y0) * j / 20)
            if _in_poly(q, p):
                dist = _edge_dist(q, p)
                if dist > far:
                    best, far = q, dist
    return best


def _in_poly(q, p) -> bool:
    x, y = q
    inside = False
    for (ax, ay), (bx, by) in zip(p, p[1:] + p[:1]):
        if (ay > y) != (by > y) and x < ax + (y - ay) * (bx - ax) / (by - ay):
            inside = not inside
    return inside


def _edge_dist(q, p) -> float:
    x, y = q
    best = float("inf")
    for (ax, ay), (bx, by) in zip(p, p[1:] + p[:1]):
        dx, dy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy or 1.0)))
        best = min(best, ((x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2) ** 0.5)
    return best


def _label(e: Entity) -> str:
    """«кв. 21»; без известного номера — планировка («2-комн., 60,23 м²»), а не «кв. ?»."""
    num = str(e.props.get("number") or "")
    if e.kind == Kind.unit and num and num != "?":
        return f"кв. {num}"
    if e.kind == Kind.unit and e.props.get("plan"):
        return str(e.props["plan"]).split(" м²")[0] + (" м²" if " м²" in str(e.props["plan"]) else "")
    return e.name


# ── что рисовать ─────────────────────────────────────────────────────────────
def _container(twin: Twin, target: Entity | None, seen: set[str]) -> Entity | None:
    """Квартира места; вне квартиры — этаж; иначе квартал. Без места — квартира с самой подробной геометрией."""
    def geo_count(e):
        return sum(1 for d in _descendants(twin, e.id) if d.geom is not None and d.id in seen)
    if target is not None:
        chain = [target] + twin.ancestors(target.id)
        for kinds in ((Kind.unit,), (Kind.storey,), (Kind.section, Kind.building, Kind.site)):
            for a in chain:
                if a.kind in kinds and a.id in seen and geo_count(a) > 0:
                    return a
        return None
    units = [e for e in twin.by_id.values() if e.kind == Kind.unit and e.id in seen]
    best = max(units, key=geo_count, default=None)
    if best is not None and geo_count(best) > 0:
        return best
    return next((e for e in twin.by_id.values() if e.kind == Kind.site and e.id in seen), None)


def _footprint(e: Entity):
    g = e.geom
    if g is None:
        return None
    if g.type == "extrusion":
        return list(g.outline)
    if g.type == "box":
        sx, sy, _ = g.size
        return [(0, 0), (sx, 0), (sx, sy), (0, sy)]
    if g.type == "point":
        return [(0.0, 0.0)]
    return None


def _swing(e: Entity, to_px):
    """Дверь на плане: открытое полотно и четверть окружности. Система проёма: X вдоль стены, дверь открывается
    в сторону −Y; петли — props.render.hinge ("left"/"right", если смотреть с этой стороны)."""
    import math
    w, _, _ = e.geom.size
    r = e.props.get("render")
    hinge = r.get("hinge", "left") if isinstance(r, dict) else "left"
    leaf = max(w - 0.08, 0.3)
    hx, a0, a1 = (0.04, 0.0, -90.0) if hinge == "left" else (w - 0.04, 180.0, 270.0)
    arc = [(hx + leaf * math.cos(math.radians(a0 + (a1 - a0) * i / 16)), leaf * math.sin(math.radians(a0 + (a1 - a0) * i / 16)))
           for i in range(17)]
    return [(to_px([(hx, 0.0), arc[-1]]), 2), (to_px(arc), 1)]


def _descendants(twin: Twin, rid: str):
    stack = list(twin.kids.get(rid, []))
    while stack:
        e = stack.pop()
        yield e
        stack.extend(twin.kids.get(e.id, []))


def _inside(twin: Twin, e: Entity, box: Entity) -> bool:
    return e.id == box.id or any(a.id == box.id for a in twin.ancestors(e.id))


def _under(twin: Twin, e: Entity, kind: Kind) -> bool:
    p = twin.by_id.get(e.parent) if e.parent else None
    return p is not None and p.kind in (kind, Kind.storage)


# ── матрицы 4×4 (жёсткие: поворот вокруг Z и сдвиг) ─────────────────────────
def _mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def _inverse(m):
    r = [[m[j][i] for j in range(3)] for i in range(3)]           # транспонированный поворот
    t = [-sum(r[i][k] * m[k][3] for k in range(3)) for i in range(3)]
    return [r[0] + [t[0]], r[1] + [t[1]], r[2] + [t[2]], [0.0, 0.0, 0.0, 1.0]]


# ── шрифты и текст ───────────────────────────────────────────────────────────
_FONT_CACHE: dict = {}


def _font(size: int, bold: bool = False):
    from PIL import ImageFont
    key = (size, bold)
    if key not in _FONT_CACHE:
        font = None
        for path in (BOLD if bold else []) + FONTS:
            if path and os.path.exists(path):
                try:
                    font = ImageFont.truetype(path, size)
                    break
                except OSError:
                    continue
        _FONT_CACHE[key] = font or ImageFont.load_default(size=size)
    return _FONT_CACHE[key]


def _text(d, xy, text, font, fill, anchor="mm", halo=None):
    if halo is not None:
        d.text(xy, text, font=font, fill=halo, anchor=anchor, stroke_width=max(2, font.size // 8), stroke_fill=halo)
    d.text(xy, text, font=font, fill=fill, anchor=anchor)


__all__ = ["render_plan", "THEMES"]
