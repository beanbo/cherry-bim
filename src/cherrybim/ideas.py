# -*- coding: utf-8 -*-
"""Идеи: что можно добавить, переставить или убрать в доме — слой поверх двойника, который смотрят, не меняя пакетов.

Идея — файл *.idea.json (по умолчанию в DATA/ideas). В ней:
- add — новые сущности (стеллаж, полка, перфопанель с местами хранения);
- change — правки существующих: другое место или родитель, размеры, свойства, подсказки отрисовки;
- remove — что уберут (вместе со всем, что внутри, кроме переложенного правкой в другое место).

Пакеты двойника идея не трогает: вариант «как будет» собирается на лету (`apply`), просмотрщик показывает его рядом с
«как есть». Ссылки — по id или key, в том числе на новые сущности той же идеи. Новым сущностям id можно не писать: он
выводится из ключа идеи и key сущности (uuid5), поэтому пересборка идеи даёт те же id. Когда идею воплотили, её
сущности переносят в пакеты двойника, а идею помечают «сделано».
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, model_validator

from .model import SCHEMA_VERSION, Entity, Geometry, Package, Placement, Privacy, Vec3, make_id
from .twin import Twin

STATUSES = {"idea": "идея", "liked": "нравится", "planned": "в планах", "done": "сделано", "rejected": "не надо"}


class IdeaError(ValueError):
    """Идею нельзя собрать: новой сущности некуда встать, id занят."""


class View(BaseModel):
    """Ракурс в системе сущности about: где глаз и куда смотреть; cut — со срезом стен (true) или без; fov — угол
    зрения по вертикали (по умолчанию как у просмотрщика): широкий — для вида изнутри маленькой комнаты; fit — сколько
    метров по ширине должно войти в кадр: на узком экране камера отходит назад по тому же лучу, а с fov — шире угол."""
    model_config = ConfigDict(extra="forbid")
    name: str | None = None
    eye: Vec3
    at: Vec3
    cut: bool | None = None
    fov: float | None = None
    fit: float | None = None


class Change(BaseModel):
    """Правка существующей сущности. Не заданные поля остаются как есть; props сливаются, null убирает ключ."""
    model_config = ConfigDict(extra="forbid")
    ref: str                       # id или key
    name: str | None = None
    parent: str | None = None      # id или key; перенос — вместе с новым placement в системе нового родителя
    placement: Placement | None = None
    geom: Geometry | None = None
    props: dict[str, Any] = {}
    note: str | None = None        # что и зачем — для карточки идеи


class Idea(BaseModel):
    model_config = ConfigDict(extra="forbid")
    format: Literal["cherrybim-idea"] = "cherrybim-idea"
    schema_version: str = SCHEMA_VERSION
    key: str                       # уникален в папке идей; из него выводятся id новых сущностей
    title: str
    summary: str | None = None     # одна-две фразы для списка
    text: list[str] = []           # абзацы; «- » в начале — пункт списка, «## » — подзаголовок
    about: str | None = None       # к чему идея (комната, стена): туда смотрит камера
    views: list[View] = []         # ракурсы; первый — при открытии
    tags: list[str] = []
    author: str | None = None
    created: str | None = None     # дата, ISO
    privacy: Privacy = Privacy.household
    add: list[Entity] = []
    change: list[Change] = []
    remove: list[str] = []         # id или key

    @model_validator(mode="before")
    @classmethod
    def _fill_ids(cls, data):
        if isinstance(data, dict) and data.get("add"):
            ns = "idea:" + str(data.get("key", ""))
            data = {**data, "add": [{**e, "id": make_id(ns, e.get("key") or f"#{i}")}
                                    if isinstance(e, dict) and not e.get("id") else e
                                    for i, e in enumerate(data["add"])]}
        return data


@dataclass
class Variant:
    """Двойник «как будет»: пакеты с правками и пакет новых сущностей; marks — id → add / change / remove."""
    twin: Twin
    marks: dict[str, str]
    warnings: list[str] = field(default_factory=list)
    about: str | None = None
    notes: dict[str, str] = field(default_factory=dict)   # id → зачем правка (Change.note)


def apply(packages: list[Package], idea: Idea) -> Variant:
    """Собрать вариант. Новой сущности без родителя или с занятым id — IdeaError; правка или удаление того, чего уже
    нет (вещь вычеркнули), — предупреждение: остальная идея всё равно смотрится."""
    base = Twin(packages)
    new = {e.id: e.model_copy(deep=True) for e in idea.add}
    new_keys = {e.key: e.id for e in new.values() if e.key}
    for eid in new:
        if eid in base.by_id:
            raise IdeaError(f"id {eid} новой сущности «{new[eid].name}» уже есть в двойнике")

    def rid(ref: str | None) -> str | None:
        if ref is None:
            return None
        if ref in base.by_id or ref in new:
            return ref
        if ref in new_keys:
            return new_keys[ref]
        e = base.by_key.get(ref)
        return e.id if e else None

    marks, warnings, notes = {}, [], {}
    for e in new.values():
        if e.parent is not None:
            p = rid(e.parent)
            if p is None:
                raise IdeaError(f"«{e.name}»: нет родителя «{e.parent}»")
            e.parent = p
        for r in e.refs:
            r.to = rid(r.to) or r.to
        marks[e.id] = "add"

    changed: dict[str, Entity] = {}
    for c in idea.change:
        eid = rid(c.ref)
        if eid is None:
            warnings.append(f"правка: нет «{c.ref}»")
            continue
        e = new.get(eid) or changed.get(eid) or base.by_id[eid].model_copy(deep=True)
        if c.parent is not None:
            p = rid(c.parent)
            if p is None:
                warnings.append(f"правка «{e.name}»: нет родителя «{c.parent}»")
                continue
            e.parent = p
        for k in ("name", "placement", "geom"):
            if getattr(c, k) is not None:
                setattr(e, k, getattr(c, k))
        for k, v in c.props.items():
            if v is None:
                e.props.pop(k, None)
            else:
                e.props[k] = v
        if eid not in new:
            changed[eid] = e
            marks[eid] = "change"
        if c.note:
            notes[eid] = c.note

    # что внутри чего — уже с правками: вещь, которую идея переложила из убранного стеллажа в новый, не уходит с ним
    moved = {eid: e.parent for eid, e in changed.items() if e.parent != base.by_id[eid].parent}

    def inside(i: str) -> list[str]:
        out = [k.id for k in base.kids.get(i, []) if k.id not in moved]
        return out + [eid for eid, p in moved.items() if p == i] + [k.id for k in new.values() if k.parent == i]

    for ref in idea.remove:
        eid = rid(ref)
        if eid is None:
            warnings.append(f"убрать: нет «{ref}»")
            continue
        stack = [eid]
        while stack:                                       # вместе со всем, что внутри
            i = stack.pop()
            marks[i] = "remove"
            stack += inside(i)

    pkgs = [p.model_copy(update={"entities": [changed.get(e.id, e) for e in p.entities]}) if
            any(e.id in changed for e in p.entities) else p for p in packages]
    about = rid(idea.about)
    if new:
        pkgs.append(Package(id=make_id("idea", idea.key), name=f"Идея: {idea.title}", root=about or next(iter(new)),
                            privacy=idea.privacy, requires=[p.id for p in packages], entities=list(new.values())))
    if idea.about and about is None:
        warnings.append(f"about: нет «{idea.about}»")
    return Variant(twin=Twin(pkgs), marks=marks, warnings=warnings, about=about, notes=notes)
