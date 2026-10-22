# -*- coding: utf-8 -*-
"""Cherry BiM — модель данных цифрового двойника (v0.1).

Один формат на все масштабы: квартал → дом → подъезд → этаж → квартира → комната →
шкаф → полка → вещь. Источник правды — эти pydantic-модели; JSON Schema для других
языков генерируется из них (tools/export_schema.py), типы TypeScript — из JSON Schema.

Соглашения, которые дорого менять потом:
- единицы — метры, градусы; ось Z вверх, система правая (как IFC и ГИС);
- геометрия сущности задана в её собственной системе = система родителя + placement;
- id — UUID; для сгенерированных из источника — uuid5(пространство, key), поэтому
  повторная сборка даёт те же id, а пакеты могут ссылаться друг на друга без поиска;
- приватность наследуется от родителя, если не задана явно.
"""
from __future__ import annotations

import uuid
from enum import Enum
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = "0.1.0"
Vec2 = tuple[float, float]
Vec3 = tuple[float, float, float]


class Privacy(str, Enum):
    """Кому видна сущность; каждый следующий уровень уже предыдущего."""
    public = "public"          # всем, кому отдан пакет (карта квартала в боте)
    residents = "residents"    # жителям дома или квартала
    household = "household"    # семье
    owner = "owner"            # только владельцу
    secret = "secret"          # не покидает устройство и не звучит голосом


PRIVACY_RANK = {p: i for i, p in enumerate(Privacy)}


class Kind(str, Enum):
    # пространственная структура
    site = "site"              # участок, квартал, район
    building = "building"
    section = "section"        # подъезд / секция
    storey = "storey"
    unit = "unit"              # квартира, помещение ТС, кладовка в подвале
    space = "space"            # комната, лоджия, место на парковке
    zone = "zone"              # функциональная зона поверх комнат
    # конструкции
    wall = "wall"
    slab = "slab"
    opening = "opening"        # окно, дверь, проём
    # обстановка и учёт
    furniture = "furniture"
    storage = "storage"        # отделение, полка, ящик, коробка
    item = "item"              # вещь
    # инженерия и умный дом
    mep = "mep"                # розетка, труба, кабель, коллектор, стояк, щиток…
    device = "device"          # устройство, связанное с внешней системой (HA)
    system = "system"          # контур отопления, электрическая группа
    # прочее
    feature = "feature"        # объект на участке: площадка, гриль, урна
    finish = "finish"          # отделка поверхности
    document = "document"


class Placement(BaseModel):
    """Положение системы сущности в системе родителя."""
    model_config = ConfigDict(extra="forbid")
    pos: Vec3 = (0.0, 0.0, 0.0)
    yaw: float = 0.0           # градусы, против часовой вокруг Z


class Extrusion(BaseModel):
    """Контур, поднятый на высоту: стены, комнаты, плиты, здания (LOD1)."""
    model_config = ConfigDict(extra="forbid")
    type: Literal["extrusion"] = "extrusion"
    outline: list[Vec2]        # против часовой, без повторения первой точки
    holes: list[list[Vec2]] = []
    z0: float = 0.0
    height: float = 0.0


class Box(BaseModel):
    """Параллелепипед от начала своей системы вдоль +X, +Y, +Z."""
    model_config = ConfigDict(extra="forbid")
    type: Literal["box"] = "box"
    size: Vec3


class Polyline(BaseModel):
    """Трасса: труба, кабель, воздуховод."""
    model_config = ConfigDict(extra="forbid")
    type: Literal["polyline"] = "polyline"
    points: list[Vec3]
    diameter: float | None = None


class Point(BaseModel):
    """Точечный объект: розетка, кран, датчик. Положение — в placement."""
    model_config = ConfigDict(extra="forbid")
    type: Literal["point"] = "point"


class Mesh(BaseModel):
    """Готовая 3D-модель (glTF) внутри пакета — для красоты, не для расчётов."""
    model_config = ConfigDict(extra="forbid")
    type: Literal["mesh"] = "mesh"
    asset: str


Geometry = Annotated[Union[Extrusion, Box, Polyline, Point, Mesh], Field(discriminator="type")]


class Source(BaseModel):
    """Откуда взялись данные и насколько им верить."""
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    origin: str = Field(alias="from")   # brti, project:OV-10a, dreame, osm, ofm, measured, photo, manual
    acc: float | None = None            # точность положения, м
    at: str | None = None               # дата, ISO
    note: str | None = None


class Ref(BaseModel):
    """Связь вне дерева вложенности."""
    model_config = ConfigDict(extra="forbid")
    rel: str                   # feeds, controls, serves, adjacent, stacked_above, documented_by, finishes
    to: str                    # id сущности, в том числе из другого пакета


class Entity(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    key: str | None = None     # человекочитаемый ключ, уникален в пакете: b1.s1.f3.kv12.kitchen
    kind: Kind
    type: str | None = None    # подтип из kinds.json: apartment, window, drawer, socket…
    name: str
    parent: str | None = None  # пространственное вложение (id)
    placement: Placement | None = None
    geom: Geometry | None = None
    props: dict[str, Any] = {}
    bind: dict[str, Any] = {}  # внешние системы: "ha.area", "ha.entity", "dreame.segment", "osm.way", "brti.room"…
    refs: list[Ref] = []
    privacy: Privacy | None = None
    src: Source | None = None
    tags: list[str] = []
    aliases: list[str] = []    # синонимы для поиска и голоса


class Georef(BaseModel):
    """Привязка системы участка к Земле: начало локальной системы ENU (X — восток, Y — север)."""
    model_config = ConfigDict(extra="forbid")
    lat: float
    lon: float
    h: float = 0.0             # абсолютная отметка начала, м


class Package(BaseModel):
    """Пакет двойника: файл, который можно положить в git, отдать боту или другому дому."""
    model_config = ConfigDict(extra="forbid")
    format: Literal["cherrybim"] = "cherrybim"
    schema_version: str = SCHEMA_VERSION
    id: str
    name: str
    description: str | None = None
    root: str                  # id корневой сущности пакета
    georef: Georef | None = None
    privacy: Privacy = Privacy.owner   # умолчание для сущностей без своей приватности
    requires: list[str] = []   # id пакетов, на чьи сущности ссылается этот (федерация)
    attribution: list[str] = []
    entities: list[Entity]


def make_id(namespace: str, key: str) -> str:
    """Стабильный id для сущности, полученной из источника: тот же key — тот же id."""
    return str(uuid.uuid5(uuid.uuid5(uuid.NAMESPACE_URL, "cherrybim:" + namespace), key))


_IFC_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$"


def ifc_guid(entity_id: str) -> str:
    """IFC GlobalId (22 символа) из UUID: 2 бита + 21 группа по 6 бит."""
    n = uuid.UUID(entity_id).int
    out = []
    for i in range(22):
        out.append(_IFC_CHARS[n & 63])
        n >>= 6
    return "".join(reversed(out))
