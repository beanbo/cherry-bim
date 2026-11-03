[Русский](README.md) | **English**

# Cherry BiM

An open core for residential digital twins: from a city block down to a shelf in a cabinet.

*Open-source core for residential digital twins, from a city block down to a drawer. A compact JSON model aligned with IFC 4.3, GeoJSON/IMDF, CityJSON and Brick. Python (pydantic) is the source of truth, JSON Schema serves other languages, and IFC4 export goes through IfcOpenShell. Docs are in Russian.*

> Status: v0.7, early version. The format may change before 1.0.

## Why

One format for everything related to the home:

- a 3D apartment plan in Home Assistant;
- item inventory ("where is the drill");
- building services inside walls and floors;
- a map of the block in the residents' Telegram bot;
- a voice assistant via MCP.

Scale:

```
квартал → дом → подъезд → этаж → квартира → комната → шкаф → секция → ящик → вещь
```

## Features

- **Model.**
  - Nested entities, each with its own coordinate system (metres, Z up) and geometry: an extruded outline with height, a box, a polyline, a point, glTF.
  - Relations `feeds`, `controls`, `has_member`, bindings to external systems (`ha.entity`, `osm.way`…), and the provenance and accuracy of every object.
- **Privacy.**
  - Levels public → residents → household → owner → secret, inherited from the parent.
  - Every export is made for an audience.
  - Packages are separate: an apartment references a storey from the block package, but the block bot does not receive it.
- **In-memory twin** (`Twin`): the tree, the "block → … → drawer" path, conversion to site coordinates and 4×4 matrices, search by names, aliases and tags with rough Russian stemming.
- **Exports.**
  - GeoJSON (WGS84) for maps.
  - IFC4 via IfcOpenShell: block → building → entrance (`IfcBuilding`, PARTIAL) → storey → apartment (`IfcSpace`, COMPLEX) → rooms, furniture, drawers, heating (`IfcDistributionSystem`).
  - JSON Schema and the type dictionary (`schema/kinds.json`: subtype → Russian name → IFC class).
- **Documents attached to items**: manuals, design project and drawings, receipts, warranties, shop pages, each with a link and a local copy (PDF, file, page snapshot); an item's private numbers (IMEI, serial number) are kept out of search and voice.
- **Furniture import** from OpenFurnitureMaker (a cabinet furniture designer): every drawer and compartment of a cabinet becomes a storage location. The `ofm` package must be on `sys.path`.
- **Ideas** (`ideas`): what could be added, rearranged or removed, as an `*.idea.json` file layered over the twin. The viewer shows "Before / After" from preset viewpoints; the owners set a status and leave notes for the author. An idea does not change the twin's packages.
- **Ready-made models**: an item with its own 3D model (a printed holder, a small pegboard bin) is drawn with that model, a GLB from the server's models folder. `io_mesh` converts 3D-printing models (3MF, STL) into such a GLB.
- **Storage preview**: when you select furniture, a drawer or a shelf with its own model and places inside (a stack of drawers with partitions), a small window opens at the side: the model close up, compartments labelled, a click on a compartment selects it; the selected drawer slides out of its carcass.
- **Furniture from BAZIS-Mebelshchik**: the script `tools/bazis/cherrybim-export.js` exports a `.b3d` model (panels with cutouts, hinges, drawer runners, handle holes), and `io_bazis` builds from it part-by-part furniture, hinged doors, drawers, handles and storage locations per carcass cell.

## Quick start

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

### Server, 3D and voice

```
pip install -e .[server]
python examples/demo/build_demo.py
python -m cherrybim.server --packages examples/demo --data ./data --port 8099 --allow 127.0.0.1/32
```

Open http://127.0.0.1:8099/: a 3D plan (views Apartment («Квартира»), Building («Дом») and Block («Квартал»)), search, cards, item inventory. The geometry is realistic but untextured: a recognisable object is built from an entity's dimensions and type, such as a bed with a headboard, a window with frames and a sill, a hinged door, a kitchen with fronts and a worktop, a toilet, a radiator. Lighting, soft shadows and ambient occlusion give the image depth without a single texture image. At `/mcp` the same process serves the MCP tools `find`, `contents`, `add_item`, `move_item`, `remove_item` and `show`, which can be connected to a voice assistant. `GET /api/plan.png?e=<место>` returns a 2D plan with the location highlighted. With `--show-script` the plan is put on a screen by a Home Assistant script: fields `put` (media path), `zagolovok` (title), `podpis` (caption). With the `HA_URL` and `HA_TOKEN` variables (or inside the Home Assistant add-on), the plan shows live states of bound entities. How the server works is described in [docs/DESIGN.en.md](docs/DESIGN.en.md#server-02).

### Home Assistant add-on

`ha-addon/cherrybim` is a local add-on: a sidebar panel (ingress), HA states via the Supervisor, and MCP for the voice assistant at `http://local-cherrybim:8099/mcp`. Installation and options: [ha-addon/cherrybim/DOCS.en.md](ha-addon/cherrybim/DOCS.en.md).

IFC: `pip install -e .[ifc]`, then `from cherrybim.export_ifc import to_ifc`. IfcOpenShell does not install on Alpine (there are no musllinux wheels), so exporting inside a container needs Debian.

## Structure

```
src/cherrybim/    model (pydantic), twin, geo, kinds, ideas, io_mesh, export (GeoJSON), export_ifc, io_ofm
  server/         сервер: store (вещи), ha (Home Assistant), app (API, MCP), static/ (просмотрщик:
                  app.js — сцена и интерфейс, families.js — модели по типам, kit.js — детали, materials.js)
schema/           JSON Schema и словарь типов — генерируются tools/export_schema.py
examples/demo/    выдуманный пример без реальных адресов
ha-addon/         аддон Home Assistant (Supervisor, ingress)
docs/DESIGN.md    архитектура, решения и соответствие стандартам
tests/            pytest
```

## Principles

Details are in [docs/DESIGN.en.md](docs/DESIGN.en.md). In short:

- metres, Z axis up, each level has its own coordinate system;
- stable UUIDs, from which the IFC GlobalId is derived;
- every entity has privacy and provenance;
- code is kept separate from data;
- we align with standards but keep our own format compact.

## License

MIT, see [LICENSE](LICENSE). `src/cherrybim/server/static/vendor/` contains three.js 0.170.0 (MIT, © three.js authors) and its modules from `examples/jsm`: post-processing (GTAO), room environment, rounded boxes, geometry merging.

If you import OpenStreetMap data, it is covered by the ODbL: attribution "© OpenStreetMap contributors", and a derived database must be distributed under the same terms.
