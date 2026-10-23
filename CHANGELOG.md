# Изменения

## 0.2.0 — 2026-10-23

- Сервер `cherrybim.server` (экстра `server`): 3D-просмотрщик на three.js, API вещей, живые состояния Home Assistant, MCP-инструменты `find`, `contents`, `add_item`, `move_item`, `remove_item`.
- Вещи хранятся отдельным пакетом `items.twin.json`; вычеркнутые — в `trash.jsonl`.
- Поиск `Twin.rank`: очки за названия родителей и связанных сущностей, однобуквенные метки, флаг «нашлись все слова».
- `geo.footprint`: внешний контур квартиры по стенам и комнатам с заделкой дверных проёмов.
- Пылесос Dreame: `bind["dreame.affine"]` переводит систему квартиры в координаты робота и обратно.
- `ha-addon/cherrybim`: локальный аддон Home Assistant (ingress, Supervisor, MCP).
- Словарь типов: кухонные шкафы, мойка, бытовая техника.

## 0.1.0 — 2026-10-23

- Модель (pydantic), двойник в памяти, приватность, GeoJSON, IFC4 через IfcOpenShell, импорт мебели из OpenFurnitureMaker, JSON Schema и словарь типов.
