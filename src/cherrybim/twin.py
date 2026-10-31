# -*- coding: utf-8 -*-
"""Работа с загруженным двойником: дерево, приватность, координаты, поиск."""
from __future__ import annotations

import json
import math
import re
from pathlib import Path

from .model import PRIVACY_RANK, Entity, Package, Privacy


class Twin:
    """Несколько пакетов как один двойник. Пакеты ссылаются друг на друга по id."""

    def __init__(self, packages: list[Package]):
        self.packages = packages
        self.by_id: dict[str, Entity] = {}
        self.pkg_of: dict[str, Package] = {}
        for pkg in packages:
            for e in pkg.entities:
                if e.id in self.by_id:
                    raise ValueError(f"id {e.id} встречается дважды ({e.name})")
                self.by_id[e.id] = e
                self.pkg_of[e.id] = pkg
        self.by_key = {e.key: e for e in self.by_id.values() if e.key}
        for e in self.by_id.values():                       # цикл в parent повесил бы ancestors и privacy
            seen, p = {e.id}, e.parent
            while p in self.by_id:
                if p in seen:
                    raise ValueError(f"цикл во вложенности: {e.name} ({e.id})")
                seen.add(p)
                p = self.by_id[p].parent
        self.kids: dict[str, list[Entity]] = {}
        for e in self.by_id.values():
            if e.parent:
                self.kids.setdefault(e.parent, []).append(e)
        self.georef = next((p.georef for p in packages if p.georef), None)

    @classmethod
    def load(cls, *paths: str | Path) -> "Twin":
        return cls([Package.model_validate(json.loads(Path(p).read_text(encoding="utf-8"))) for p in paths])

    # ── дерево ───────────────────────────────────────────────────────────────
    def get(self, ref: str) -> Entity:
        return self.by_id.get(ref) or self.by_key[ref]

    def children(self, ref: str) -> list[Entity]:
        return self.kids.get(self.get(ref).id, [])

    def ancestors(self, ref: str) -> list[Entity]:
        """Родители от ближайшего к корню; обрывается на родителе из незагруженного пакета."""
        out, e = [], self.get(ref)
        while e.parent and e.parent in self.by_id:
            e = self.by_id[e.parent]
            out.append(e)
        return out

    def path(self, ref: str) -> str:
        chain = [self.get(ref)] + self.ancestors(ref)
        return " → ".join(e.name for e in reversed(chain))

    # ── приватность ──────────────────────────────────────────────────────────
    def privacy(self, ref: str) -> Privacy:
        """Своя приватность, иначе ближайшего родителя из того же пакета, иначе пакета."""
        e = self.get(ref)
        pkg = self.pkg_of[e.id]
        while True:
            if e.privacy is not None:
                return e.privacy
            if not e.parent or e.parent not in self.by_id or self.pkg_of[e.parent] is not pkg:
                return pkg.privacy
            e = self.by_id[e.parent]

    def visible_to(self, audience: Privacy) -> list[Entity]:
        """Что можно показать аудитории: сама сущность и вся цепочка родителей не строже аудитории."""
        lim = PRIVACY_RANK[audience]
        ok = {}

        def vis(e: Entity) -> bool:
            if e.id not in ok:
                own = PRIVACY_RANK[self.privacy(e.id)] <= lim
                ok[e.id] = own and (not e.parent or e.parent not in self.by_id or vis(self.by_id[e.parent]))
            return ok[e.id]

        return [e for e in self.by_id.values() if vis(e)]

    # ── координаты ───────────────────────────────────────────────────────────
    def to_site(self, ref: str, pts: list[tuple[float, ...]]) -> list[tuple[float, float, float]]:
        """Точки из системы сущности в систему участка (ENU, метры)."""
        chain = [self.get(ref)] + self.ancestors(ref)
        out = []
        for p in pts:
            x, y, z = (list(p) + [0.0, 0.0])[:3]
            for e in chain:
                if e.placement:
                    a = math.radians(e.placement.yaw)
                    c, s = math.cos(a), math.sin(a)
                    px, py, pz = e.placement.pos
                    x, y, z = c * x - s * y + px, s * x + c * y + py, z + pz
            out.append((x, y, z))
        return out

    def matrix(self, ref: str) -> list[list[float]]:
        """Матрица 4×4 системы сущности в системе участка (для IFC, glTF, three.js)."""
        m = [[1.0, 0, 0, 0], [0, 1.0, 0, 0], [0, 0, 1.0, 0], [0, 0, 0, 1.0]]
        for e in reversed([self.get(ref)] + self.ancestors(ref)):     # от корня к сущности
            if e.placement:
                a = math.radians(e.placement.yaw)
                c, s = math.cos(a), math.sin(a)
                px, py, pz = e.placement.pos
                t = [[c, -s, 0, px], [s, c, 0, py], [0, 0, 1.0, pz], [0, 0, 0, 1.0]]
                m = [[sum(m[i][k] * t[k][j] for k in range(4)) for j in range(4)] for i in range(4)]
        return m

    # ── поиск ────────────────────────────────────────────────────────────────
    def rank(self, query: str, audience: Privacy = Privacy.owner, complete: bool = False) -> list[tuple[int, Entity]]:
        """Сущности с очками, лучшие первыми. Слово запроса ищется в названии и синонимах (3 очка),
        в названиях родителей и того, на что ссылается сущность (2: «ящик 2 в спальне», «обои в спальне»),
        в тегах и свойствах (1). Найдены все слова — ещё 10, все в названии — ещё 5. complete — только те,
        где нашлись все слова. Падежи отрезаются грубым стеммингом. Однобуквенные слова необязательны:
        «в», «и» — предлоги, а «секция б» — метка, и тогда она добавляет очки."""
        words = _norm(query).split()
        toks = [_stem(t) for t in words if len(t) > 1 or t.isdigit()]   # «автомат 6»
        opt = [t for t in words if len(t) == 1 and not t.isdigit()]
        if not toks:
            return []
        scored = []
        for e in self.visible_to(audience):
            chain = self.ancestors(e.id)
            title = _norm(" ".join([e.name] + e.aliases)).split()
            ctx = _norm(" ".join([a.name for a in chain] + [self.by_id[r.to].name for r in e.refs
                                                             if r.to in self.by_id])).split()
            body = _norm(" ".join(e.tags + [str(v) for v in e.props.values() if isinstance(v, str)])).split()
            sc = own = in_title = miss = 0
            for t in toks:
                match = (lambda w: w == t) if t.isdigit() else (lambda w: w.startswith(t))   # «6» не равно «16»
                if any(match(w) for w in title):
                    sc, own, in_title = sc + 3, own + 1, in_title + 1
                elif any(match(w) for w in ctx):
                    sc += 2
                elif any(match(w) for w in body):
                    sc, own = sc + 1, own + 1
                else:
                    miss += 1
            sc += sum(3 if t in title else 1 if t in ctx else 0 for t in opt)
            if own and not (complete and miss):   # одни родители не в счёт: «спальня» вернула бы всё внутри
                scored.append((sc + (10 if not miss else 0) + (5 if in_title == len(toks) else 0), len(chain), e))
        scored.sort(key=lambda x: (-x[0], x[1]))
        return [(s, e) for s, _, e in scored]

    def search(self, query: str, audience: Privacy = Privacy.owner, limit: int = 10) -> list[tuple[Entity, str]]:
        """Лучшие совпадения с путями от корня (см. rank)."""
        return [(e, self.path(e.id)) for _, e in self.rank(query, audience)[:limit]]


def _norm(s: str) -> str:
    return re.sub(r"[^a-zа-я0-9 ]+", " ", s.lower().replace("ё", "е"))


def _stem(w: str) -> str:
    return re.sub(r"(ами|ями|ого|ему|ому|ыми|ими|ах|ях|ов|ев|ей|ой|ий|ый|ая|яя|ое|ее|ые|ие|ую|юю|ом|ем|ам|ям|а|я|о|е|ы|и|у|ю|ь)$", "", w) if len(w) > 4 else w
