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
                col = th["door"] if e.type == "entrance_door" else th["window"]
                d.polygon(px(p), fill=col)

    f_room = _font(int(26 * SS * min(1.0, s / (60 * SS) + 0.5)))
    for e, p in rooms:                   # подписи комнат — по центру их прямоугольника
        q = px(p)
        cx, cy = (min(x for x, _ in q) + max(x for x, _ in q)) / 2, (min(y for _, y in q) + max(y for _, y in q)) / 2
        name = f"кв. {e.props['number']}" if e.kind == Kind.unit and e.props.get("number") else e.name
        _text(d, (cx, cy), name, f_room, th["muted"], anchor="mm")

    if target is not None:
        poly_of = {e.id: p for e, p in shapes}
        carrier = next((a for a in [target] + twin.ancestors(target.id) if a.id in poly_of), None)
        over = Image.new("RGBA", img.size, (0, 0, 0, 0))
        od = ImageDraw.Draw(over)
        acc = th["accent"]
        if carrier is not None:
            p = px(poly_of[carrier.id])
            cx = sum(x for x, _ in p) / len(p)
            cy = sum(y for _, y in p) / len(p)
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
