# Cherry BiM

Открытое ядро цифрового двойника жилья: от квартала до полки в шкафу.

*Open-source core for residential digital twins, from a city block down to a drawer. A compact JSON model aligned with IFC 4.3, GeoJSON/IMDF, CityJSON and Brick. Python (pydantic) is the source of truth, JSON Schema serves other languages, and IFC4 export goes through IfcOpenShell. Docs are in Russian.*

> Статус: v0.3, ранняя версия. Формат может меняться до 1.0.

## Зачем

Один формат для всего, что связано с домом:

- 3D-план квартиры в Home Assistant;
- учёт вещей («где лежит дрель»);
- инженерия в стенах и полу;
- карта квартала в Telegram-боте жильцов;
- голосовой помощник через MCP.

Масштаб:

```
квартал → дом → подъезд → этаж → квартира → комната → шкаф → секция → ящик → вещь
```

## Что умеет

- **Модель.**
  - Сущности с вложенностью, своими системами координат (метры, Z вверх) и геометрией: контур с высотой, параллелепипед, трасса, точка, glTF.
  - Связи `feeds`, `controls`, `has_member`, привязки к внешним системам (`ha.entity`, `osm.way`…), источник и точность каждого объекта.
- **Приватность.**
  - Уровни public → residents → household → owner → secret, наследуются от родителя.
  - Каждая выгрузка получает аудиторию.
  - Пакеты раздельные: квартира ссылается на этаж из пакета квартала, но бот квартала её не получает.
- **Двойник в памяти** (`Twin`): дерево, путь «квартал → … → ящик», перевод в координаты участка и матрицы 4×4, поиск по названиям, синонимам и тегам с грубым русским стеммингом.
- **Выгрузки.**
  - GeoJSON (WGS84) для карт.
  - IFC4 через IfcOpenShell: квартал → дом → подъезд (`IfcBuilding`, PARTIAL) → этаж → квартира (`IfcSpace`, COMPLEX) → комнаты, мебель, ящики, отопление (`IfcDistributionSystem`).
  - JSON Schema и словарь типов (`schema/kinds.json`: подтип → русское название → класс IFC).
- **Импорт мебели** из OpenFurnitureMaker (конструктор корпусной мебели): каждый ящик и отделение шкафа становятся местом хранения. Пакет `ofm` нужен на `sys.path`.

## Быстрый старт

```
pip install -e .[dev]
python examples/demo/build_demo.py      # выдуманный квартал и квартира → examples/demo/*.json, *.geojson
pytest
```

```python
from cherrybim import Privacy, Twin
from cherrybim.export import to_geojson

twin = Twin.load("examples/demo/demo-kvartal.twin.json", "examples/demo/demo-kvartira.twin.json")
for entity, path in twin.search("дрель"):
    print(path)          # Демо-квартал → Дом 1 → Подъезд 1 → Этаж 3 → Квартира 12 → Спальня → Шкаф → …
public_map = to_geojson(twin, Privacy.public)    # квартиры в публичной карте нет
```

### Сервер, 3D и голос

```
pip install -e .[server]
python examples/demo/build_demo.py
python -m cherrybim.server --packages examples/demo --data ./data --port 8099 --allow 127.0.0.1/32
```

Откройте http://127.0.0.1:8099/: 3D-план (виды «Квартира», «Дом», «Квартал»), поиск, карточки, учёт вещей. По адресу `/mcp` тот же процесс отдаёт MCP-инструменты `find`, `contents`, `add_item`, `move_item`, `remove_item` и `show` — их можно подключить к голосовому ассистенту. `GET /api/plan.png?e=<место>` отдаёт 2D-план с подсвеченным местом. С `--show-script` план выводится на экран скриптом Home Assistant: поля `put` (путь в медиа), `zagolovok`, `podpis`. С переменными `HA_URL` и `HA_TOKEN` (или внутри аддона Home Assistant) на плане видны живые состояния привязанных сущностей. Устройство сервера — в [docs/DESIGN.md](docs/DESIGN.md#сервер-02).

### Аддон Home Assistant

`ha-addon/cherrybim` — локальный аддон: панель в боковом меню (ingress), состояния HA через Supervisor, MCP для голосового ассистента по адресу `http://local-cherrybim:8099/mcp`. Установка и опции — [ha-addon/cherrybim/DOCS.md](ha-addon/cherrybim/DOCS.md).

IFC: `pip install -e .[ifc]`, затем `from cherrybim.export_ifc import to_ifc`. IfcOpenShell не ставится на Alpine (нет колёс musllinux), поэтому для выгрузки в контейнере нужен Debian.

## Структура

```
src/cherrybim/    model (pydantic), twin, geo, kinds, export (GeoJSON), export_ifc, io_ofm
  server/         сервер: store (вещи), ha (Home Assistant), app (API, MCP), static/ (просмотрщик)
schema/           JSON Schema и словарь типов — генерируются tools/export_schema.py
examples/demo/    выдуманный пример без реальных адресов
ha-addon/         аддон Home Assistant (Supervisor, ingress)
docs/DESIGN.md    архитектура, решения и соответствие стандартам
tests/            pytest
```

## Принципы

Подробно — в [docs/DESIGN.md](docs/DESIGN.md). Коротко:

- метры, ось Z вверх, у каждого уровня своя система координат;
- стабильные UUID, из них выводится IFC GlobalId;
- приватность и происхождение есть у каждой сущности;
- код отдельно от данных;
- со стандартами выравниваемся, но свой формат держим компактным.

## Лицензия

MIT, см. [LICENSE](LICENSE). В `src/cherrybim/server/static/vendor/` лежит three.js 0.170.0 (MIT, © three.js authors).

Если импортируете данные OpenStreetMap, на них действует ODbL: подпись «© OpenStreetMap contributors», а производная база распространяется на тех же условиях.
