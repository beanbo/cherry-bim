# -*- coding: utf-8 -*-
"""Словарь подтипов: что значит kind/type, как называется по-русски и каким классом IFC выгружается.

Выгружается в schema/kinds.json, чтобы TypeScript, бот и просмотрщик пользовались тем же словарём.
(kind, None) — умолчание для вида; PredefinedType USERDEFINED дополняется ObjectType = type.
"""
from __future__ import annotations

from .model import Kind

# (kind, type) → (русское название, класс IFC4, PredefinedType)
KINDS: dict[tuple[Kind, str | None], tuple[str, str, str | None]] = {
    (Kind.site, None): ("участок, квартал", "IfcSite", None),
    (Kind.building, None): ("здание", "IfcBuilding", None),
    (Kind.section, None): ("подъезд, секция", "IfcBuilding", None),            # CompositionType PARTIAL
    (Kind.storey, None): ("этаж", "IfcBuildingStorey", None),
    (Kind.unit, None): ("квартира, помещение", "IfcSpace", "INTERNAL"),       # CompositionType COMPLEX
    (Kind.space, None): ("комната", "IfcSpace", "INTERNAL"),
    (Kind.space, "loggia"): ("лоджия", "IfcSpace", "INTERNAL"),
    (Kind.zone, None): ("зона", "IfcZone", None),
    (Kind.wall, "exterior"): ("наружная стена", "IfcWall", "SOLIDWALL"),
    (Kind.wall, None): ("стена, перегородка", "IfcWall", "PARTITIONING"),
    (Kind.slab, None): ("плита", "IfcSlab", "FLOOR"),
    (Kind.opening, "window"): ("окно", "IfcWindow", "WINDOW"),
    (Kind.opening, None): ("дверь, балконный блок", "IfcDoor", "DOOR"),
    (Kind.furniture, "bed"): ("кровать", "IfcFurniture", "BED"),
    (Kind.furniture, "sofa"): ("диван", "IfcFurniture", "SOFA"),
    (Kind.furniture, "desk"): ("стол", "IfcFurniture", "DESK"),
    (Kind.furniture, "dining_table"): ("обеденный стол", "IfcFurniture", "TABLE"),
    (Kind.furniture, "bookshelf"): ("стеллаж, книжная полка", "IfcFurniture", "SHELF"),
    (Kind.furniture, "wardrobe"): ("шкаф", "IfcFurniture", "USERDEFINED"),
    (Kind.furniture, None): ("мебель", "IfcFurniture", "USERDEFINED"),
    (Kind.storage, "section"): ("секция шкафа", "IfcFurniture", "USERDEFINED"),
    (Kind.storage, "drawer"): ("ящик", "IfcFurniture", "USERDEFINED"),
    (Kind.storage, "compartment"): ("отделение, полка", "IfcFurniture", "USERDEFINED"),
    (Kind.storage, "hanging"): ("место под штангой", "IfcFurniture", "USERDEFINED"),
    (Kind.storage, "box"): ("коробка", "IfcFurniture", "USERDEFINED"),
    (Kind.storage, None): ("место хранения", "IfcFurniture", "USERDEFINED"),
    (Kind.item, None): ("вещь", "IfcBuildingElementProxy", "USERDEFINED"),   # в IFC по умолчанию не выгружаем
    (Kind.mep, "heating_manifold"): ("коллектор отопления", "IfcPipeFitting", "JUNCTION"),
    (Kind.mep, "water_riser"): ("стояк воды", "IfcPipeSegment", "RIGIDSEGMENT"),
    (Kind.mep, "pipe_pair"): ("трубы подачи и обратки", "IfcPipeSegment", "FLEXIBLESEGMENT"),
    (Kind.mep, "vent_shaft"): ("вентблок", "IfcDuctSegment", "RIGIDSEGMENT"),
    (Kind.mep, "power_outlet"): ("розетка", "IfcOutlet", "POWEROUTLET"),
    (Kind.mep, "switch"): ("выключатель", "IfcSwitchingDevice", "TOGGLESWITCH"),
    (Kind.mep, "junction_box"): ("распаечная коробка, вывод кабеля", "IfcJunctionBox", "POWER"),
    (Kind.mep, "radiator"): ("радиатор, конвектор", "IfcSpaceHeater", "CONVECTOR"),
    (Kind.mep, "valve"): ("кран", "IfcValve", "ISOLATING"),
    (Kind.mep, "water_meter"): ("счётчик воды", "IfcFlowMeter", "WATERMETER"),
    (Kind.mep, "distribution_board"): ("щиток", "IfcElectricDistributionBoard", "DISTRIBUTIONBOARD"),
    (Kind.mep, "breaker"): ("автомат, АВДТ", "IfcProtectiveDevice", "CIRCUITBREAKER"),
    (Kind.mep, "cable"): ("кабель", "IfcCableSegment", "CABLESEGMENT"),
    (Kind.mep, "grille"): ("вентрешётка", "IfcAirTerminal", "GRILLE"),
    (Kind.device, "light"): ("свет", "IfcLightFixture", "POINTSOURCE"),
    (Kind.device, "lamp"): ("лампа", "IfcLightFixture", "POINTSOURCE"),
    (Kind.device, "thermostat"): ("термостат", "IfcUnitaryControlElement", "THERMOSTAT"),
    (Kind.device, "ac"): ("кондиционер", "IfcUnitaryEquipment", "SPLITSYSTEM"),
    (Kind.device, "breezer"): ("бризер", "IfcUnitaryEquipment", "USERDEFINED"),
    (Kind.device, "tv"): ("телевизор", "IfcAudioVisualAppliance", "TV"),
    (Kind.device, "speaker"): ("колонка", "IfcAudioVisualAppliance", "SPEAKER"),
    (Kind.device, "sensor"): ("датчик", "IfcSensor", "USERDEFINED"),
    (Kind.device, "vacuum"): ("робот-пылесос", "IfcElectricAppliance", "USERDEFINED"),
    (Kind.device, None): ("устройство", "IfcElectricAppliance", "USERDEFINED"),
    (Kind.system, "heating"): ("система отопления", "IfcDistributionSystem", "HEATING"),
    (Kind.system, "electrical"): ("электрогруппа", "IfcDistributionSystem", "ELECTRICAL"),
    (Kind.system, "cold_water"): ("холодная вода", "IfcDistributionSystem", "DOMESTICCOLDWATER"),
    (Kind.system, "hot_water"): ("горячая вода", "IfcDistributionSystem", "DOMESTICHOTWATER"),
    (Kind.system, None): ("система", "IfcDistributionSystem", "USERDEFINED"),
    (Kind.feature, "parking"): ("парковка", "IfcSpace", "PARKING"),
    (Kind.feature, "parking_spot"): ("машино-место", "IfcSpace", "PARKING"),
    (Kind.feature, "playground"): ("детская площадка", "IfcSpace", "EXTERNAL"),
    (Kind.feature, "pitch"): ("спортплощадка", "IfcSpace", "EXTERNAL"),
    (Kind.feature, "gazebo"): ("беседка", "IfcBuildingElementProxy", "USERDEFINED"),
    (Kind.feature, None): ("объект на участке", "IfcBuildingElementProxy", "USERDEFINED"),
    (Kind.finish, None): ("отделка", "IfcCovering", "CLADDING"),
    (Kind.document, None): ("документ", "IfcDocumentReference", None),
}


def lookup(kind: Kind, typ: str | None) -> tuple[str, str, str | None]:
    return KINDS.get((kind, typ)) or KINDS.get((kind, None)) or ("объект", "IfcBuildingElementProxy", "USERDEFINED")


def as_json() -> dict:
    out: dict = {}
    for (k, t), (ru, cls, pre) in KINDS.items():
        out.setdefault(k.value, {})[t or "*"] = {"ru": ru, "ifc": cls, "ifc_type": pre}
    return out
