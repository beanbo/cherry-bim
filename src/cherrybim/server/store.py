# -*- coding: utf-8 -*-
"""Хранилище сервера: пакеты двойника только для чтения + пакет вещей, который правится.

Пакеты (*.twin.json) лежат в packages_dir и меняются только пересборкой. Вещи (kind item)
живут в data_dir/items.twin.json: их добавляют, переносят и удаляют через API, MCP и голос.
Запись атомарная (временный файл + замена), каждая правка поднимает version.
"""
from __future__ import annotations

import json
import os
import threading
import time
import uuid
from pathlib import Path

from ..kinds import lookup
from ..model import Entity, Kind, Package, Privacy, Source
from ..twin import Twin

ITEMS_FILE = "items.twin.json"
TRASH_FILE = "trash.jsonl"
PLACE_KINDS = {Kind.storage, Kind.furniture, Kind.space, Kind.unit, Kind.item}   # куда можно положить вещь


class StoreError(ValueError):
    """Понятная пользователю ошибка: не найдено место, неоднозначно, нельзя менять."""


class Store:
    def __init__(self, packages_dir: str | Path, data_dir: str | Path, audience: Privacy = Privacy.household):
        self.packages_dir = Path(packages_dir)
        self.data_dir = Path(data_dir)
        self.audience = audience
        self.lock = threading.RLock()
        self.version = 0
        self.listeners: list = []        # функции без аргументов: зовутся после каждой правки
        self.reload()

    # ── загрузка ─────────────────────────────────────────────────────────────
    def reload(self) -> None:
        with self.lock:
            files = self._package_files()
            self.base = [Package.model_validate(json.loads(p.read_text(encoding="utf-8"))) for p in files]
            self.packages_stamp = self._stamp(files)
            self.items = self._load_items()
            self._rebuild()

    def _package_files(self) -> list[Path]:
        items = (self.data_dir / ITEMS_FILE).resolve()
        return [p for p in sorted(self.packages_dir.glob("*.twin.json")) if p.resolve() != items]

    @staticmethod
    def _stamp(files) -> tuple:
        return tuple((p.name, p.stat().st_mtime) for p in files)

    def _mtime(self) -> float | None:
        try:
            return (self.data_dir / ITEMS_FILE).stat().st_mtime
        except OSError:
            return None

    def _check_items_file(self) -> None:
        """Файлы поменяли снаружи: пакеты пересобрали, вещи поправили руками (Samba, git) — перечитать,
        а не затереть своей копией."""
        try:
            fresh = self._stamp(self._package_files()) != self.packages_stamp
        except OSError:
            fresh = False
        if fresh:
            self.reload()
            self._notify()
        elif self._mtime() != self.items_mtime:
            self.items = self._load_items()
            self._rebuild()
            self._notify()

    def _load_items(self) -> Package:
        f = self.data_dir / ITEMS_FILE
        self.items_mtime = self._mtime()
        if f.exists():
            return Package.model_validate(json.loads(f.read_text(encoding="utf-8")))
        private = [p for p in self.base if p.privacy != Privacy.public] or self.base
        root = private[-1].root if private else ""
        return Package(id=str(uuid.uuid4()), name="Вещи", root=root, privacy=Privacy.household,
                       requires=[p.id for p in self.base], entities=[])

    def _rebuild(self) -> None:
        self.twin = Twin(self.base + [self.items])
        self.version += 1

    def _save(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        f = self.data_dir / ITEMS_FILE
        tmp = f.with_suffix(".tmp")
        tmp.write_text(self.items.model_dump_json(by_alias=True, exclude_none=True, indent=1), encoding="utf-8")
        os.replace(tmp, f)
        self.items_mtime = self._mtime()
        self._rebuild()
        self._notify()

    def _notify(self) -> None:
        for cb in list(self.listeners):
            try:
                cb()
            except Exception:       # слушатель не должен ломать запись
                pass

    # ── чтение ───────────────────────────────────────────────────────────────
    def snapshot(self) -> dict:
        """Всё, что видит аудитория, с готовыми матрицами и путями — для просмотрщика."""
        with self.lock:
            self._check_items_file()
            t = self.twin
            ents = []
            for e in t.visible_to(self.audience):
                d = e.model_dump(mode="json", by_alias=True, exclude_none=True)
                d["m"] = t.matrix(e.id)
                d["path"] = t.path(e.id)
                d["editable"] = e.kind == Kind.item and t.pkg_of[e.id] is self.items
                d["ru"] = lookup(e.kind, e.type)[0]
                ents.append(d)
            return {"version": self.version, "georef": t.georef.model_dump() if t.georef else None,
                    "packages": [{"id": p.id, "name": p.name, "root": p.root} for p in self.base],
                    "entities": ents}

    def bound_entities(self) -> set[str]:
        """entity_id HA, к которым привязан двойник (для живых состояний)."""
        out = set()
        with self.lock:
            for e in self.twin.visible_to(self.audience):
                for k, v in e.bind.items():
                    if k in ("ha.entity", "dreame.camera"):
                        out.update(v if isinstance(v, list) else [v])
        return out

    def short_path(self, ref: str) -> str:
        """Путь для голоса: внутри квартиры — от комнаты, снаружи — без квартала."""
        chain = [self.twin.get(ref)] + self.twin.ancestors(ref)
        unit = next((i for i, a in enumerate(chain) if a.kind == Kind.unit), None)
        if unit is not None and unit > 0:
            chain = chain[:unit]
        elif len(chain) > 1 and chain[-1].kind == Kind.site:
            chain = chain[:-1]
        return " → ".join(a.name for a in reversed(chain))

    def search(self, query: str, kinds: set[Kind] | None = None, limit: int = 8) -> list[dict]:
        with self.lock:
            self._check_items_file()
            out = []
            ranked = self.twin.rank(query, self.audience, complete=True)     # нашлись все слова запроса
            for sc, e in ranked or self.twin.rank(query, self.audience):     # иначе — что нашлось частично
                if kinds and e.kind not in kinds:
                    continue
                out.append({"id": e.id, "key": e.key, "kind": e.kind.value, "type": e.type, "name": e.name,
                            "path": self.twin.path(e.id), "short": self.short_path(e.id), "score": sc})
                if len(out) >= limit:
                    break
            return out

    def resolve(self, ref: str, kinds: set[Kind] | None = None) -> Entity:
        """id, key или слова → одна сущность; иначе StoreError (не нашёл / какой из них)."""
        with self.lock:
            self._check_items_file()
            e = self.twin.by_id.get(ref) or self.twin.by_key.get(ref)
            if e is not None and (not kinds or e.kind in kinds):
                return e
            ranked = [(s, e) for s, e in self.twin.rank(ref, self.audience, complete=True)
                      if not kinds or e.kind in kinds]
            if not ranked:
                near = [e.name for s, e in self.twin.rank(ref, self.audience) if not kinds or e.kind in kinds][:3]
                raise StoreError(f"не нашёл «{ref}»" + (f"; похожие: {', '.join(near)}" if near else ""))
            ties = [e for s, e in ranked if s == ranked[0][0]]
            if len(ties) > 1:
                raise StoreError("уточни, какой именно: " + "; ".join(self.short_path(e.id) for e in ties[:5]))
            return ranked[0][1]

    def contents(self, ref: str) -> dict:
        """Что внутри места: дочерние места хранения и вещи (вещи — со вложенными)."""
        with self.lock:
            place = self.resolve(ref)
            kids = self.twin.children(place.id)

            def items_under(pid: str, depth: int = 0) -> list[dict]:
                res = []
                for k in self.twin.children(pid):
                    if k.kind == Kind.item:
                        res.append({"id": k.id, "name": k.name, "props": k.props, "short": self.short_path(k.id)})
                    if depth < 6 and k.kind in (Kind.storage, Kind.furniture, Kind.item):
                        res += items_under(k.id, depth + 1)
                return res
            return {"place": {"id": place.id, "name": place.name, "path": self.twin.path(place.id),
                              "short": self.short_path(place.id)},
                    "places": [{"id": k.id, "name": k.name, "kind": k.kind.value} for k in kids
                               if k.kind in (Kind.storage, Kind.furniture)],
                    "items": items_under(place.id)}

    # ── правка вещей ─────────────────────────────────────────────────────────
    def _own_item(self, ref: str) -> Entity:
        e = self.resolve(ref, {Kind.item})
        if self.twin.pkg_of[e.id] is not self.items:
            raise StoreError(f"«{e.name}» лежит в пакете только для чтения")
        return e

    def add_item(self, name: str, place: str, qty: float | None = None, note: str | None = None,
                 tags: list[str] | None = None, aliases: list[str] | None = None, by: str | None = None,
                 origin: str = "manual") -> Entity:
        name = (name or "").strip()
        if not name:
            raise StoreError("пустое название")
        with self.lock:
            parent = self.resolve(place, PLACE_KINDS)
            props = {k: v for k, v in (("qty", qty), ("note", note), ("by", by),
                                       ("added_at", time.strftime("%Y-%m-%d %H:%M"))) if v not in (None, "")}
            e = Entity(id=str(uuid.uuid4()), kind=Kind.item, type="thing", name=name, parent=parent.id,
                       props=props, tags=tags or [], aliases=aliases or [],
                       src=Source(origin=origin, at=time.strftime("%Y-%m-%d")))
            self.items.entities.append(e)
            self._save()
            return e

    def move_item(self, item: str, place: str, by: str | None = None) -> Entity:
        with self.lock:
            e = self._own_item(item)
            parent = self.resolve(place, PLACE_KINDS)
            if parent.id == e.id or e.id in [a.id for a in self.twin.ancestors(parent.id)]:
                raise StoreError("нельзя положить вещь саму в себя")
            e.parent = parent.id
            e.props.update({"moved_at": time.strftime("%Y-%m-%d %H:%M"), **({"by": by} if by else {})})
            self._save()
            return e

    def update_item(self, item: str, **fields) -> Entity:
        with self.lock:
            e = self._own_item(item)
            for k in ("name", "tags", "aliases"):
                if fields.get(k) is not None:
                    setattr(e, k, fields[k])
            for k in ("qty", "note"):
                if k in fields:
                    if fields[k] in (None, ""):
                        e.props.pop(k, None)
                    else:
                        e.props[k] = fields[k]
            self._save()
            return e

    def remove_item(self, item: str, by: str | None = None) -> str:
        """Вычеркнуть вещь. Запись не пропадает: строка уходит в trash.jsonl, её можно вернуть."""
        with self.lock:
            e = self._own_item(item)
            inside = [k for k in self.items.entities if k.parent == e.id]
            for k in inside:                      # содержимое коробки остаётся там, где стояла коробка
                k.parent = e.parent
            self.data_dir.mkdir(parents=True, exist_ok=True)
            row = {"removed_at": time.strftime("%Y-%m-%d %H:%M"), "by": by, "path": self.twin.path(e.id),
                   "entity": e.model_dump(mode="json", by_alias=True, exclude_none=True)}
            with open(self.data_dir / TRASH_FILE, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
            self.items.entities = [k for k in self.items.entities if k.id != e.id]
            self._save()
            return e.name
