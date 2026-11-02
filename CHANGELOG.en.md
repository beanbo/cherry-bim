[Русский](CHANGELOG.md) | **English**

# Changelog

## 0.6.0 — 2026-11-01

- **Ideas** (`cherrybim.ideas`): what could be added, rearranged or removed, as an `*.idea.json` file layered over the twin. `add`: new entities (the id is derived from the idea key); `change`: edits to existing ones (move, dimensions, properties); `remove`: what will be removed. The twin's packages do not change: `apply` assembles the "as it will be" variant, where every entity carries an `add`, `change` or `remove` mark. Schema: `schema/cherrybim-idea-0.1.schema.json`.
- Server: ideas folder `--ideas` (`DATA/ideas` by default); `GET /api/ideas`, `GET /api/twin?idea=<ключ>` (variant snapshot and idea description), `POST /api/ideas/<ключ>`: owners' status and notes in `state.json`. A malformed idea file appears in the list with an error; an idea stricter than the audience is not visible.
- Viewer: the Ideas («Идеи») button, a Before / After («Было / Стало») preview bar, idea viewpoints (`views`: eye, target, cutaway, `fov`, `fit`; on a narrow screen the angle widens or the camera moves back), New («Новое»): highlighting of new and moved things, removed things as a red ghost. Idea card: description, links to the new things, status, notes. The `#i=<ключ>` link opens an idea directly.
- Pegboard `furniture.pegboard` (like Multiboard): a 25 mm grid with octagonal holes, the wall showing through them. Furniture types `rack` (shelving unit) and `wall_shelf`.
- From above, over the ceiling, ceiling light shades are not drawn (just like the ceiling): they covered the room in the view without the cutaway. With the camera below the ceiling, room labels are hidden.
- **Ready-made models** (`mesh` geometry): the viewer draws GLB (`static/mesh.js`, its own parser without GLTFLoader); the server serves it from the models folder `--assets` (`DATA/assets` by default) at `GET /api/mesh/<id>`, only for a visible entity, and with `?idea=` from an idea variant. `cherrybim.io_mesh` (the `mesh` extra) converts 3MF and STL for 3D printing into such a GLB: metres, rotation, origin at the bounding-box corner, simplification by vertex merging, colour as a material. The page is ready when the models have loaded (8 s at most).
- An idea removes furniture and moves the things on it with an edit: the things "will change" rather than go together with the furniture. Removed things are not drawn in After; they show as a red ghost only with New.
- Per-type models: wire shelving `furniture.wire_shelf`; items `plastic_box`, `stick_vacuum`, `garment_steamer`, `mop`, `dustpan`, `bucket`, `basin` (`hang`: flat on the wall), `duster`, `hair_styler` (`style: "dyson"`, on the wall `"dyson_wall"`); on a sewing machine, `cover`: in a cover. The part builder gets a rotation about the horizontal axis, `Kit.tiltX`. A box item without its own model takes its colour from `colors.body`.

## 0.5.4 — 2026-10-28

- PC tower: the `render.inside` hint shows open internals behind the glass instead of a solid case. PSU shroud, motherboard deep inside, graphics card from the rear (`gpu_len`), an AIO liquid-cooling pump with a lit cap and hoses to a radiator at the front, RGB memory, fans per `fan_slots` (`front`, `top`, `rear`). `gpu_support`: a GPU support stand; `lcd`: an 8.8″ bar screen on a stand on the PSU shroud. Colours `fans` and `fan_light`.

## 0.5.3 — 2026-10-28

- MCP `find`: for a found entity, properties containing words from the query («водянка», "liquid cooling"; «блок питания», "power supply") come first, and a property line can be up to 300 characters (was 160). Previously the response included the first 8 short properties in order, and for an item with fifteen or so properties the one asked about could be left out.

## 0.5.2 — 2026-10-28

- Inventory items with dimensions are drawn with per-type models (`static/things.js`): `item.kettle` (electric kettle with a glass body), `item.frying_pan`, `item.suitcase` (`render.ribs`: `diagonal` or `horizontal`, `rib_count`, `wheels`), `item.humidifier` (a column with a grille on top), `item.stepladder` (a folded stepladder: `steps`, `platform`), `item.sewing_machine`, `item.hammer_drill` (in a case; `case: false` for the tool alone). An item without its own model is still a box.
- Moving an item to another location (`move_item`) forgets its coordinates: they were given in the previous parent's coordinate system. Dimensions remain in `props.size_m`.
- Building services: types `water_outlet` (capped water outlet), `drain_outlet` (sewer outlet), `pipe_box` (pipe boxing); on a socket, `render.lid`: hinged covers (wet rooms).
- Smart lock: on an entrance door, `render.lock: "push_pull"`: 77 × 406 mm panels on both sides of the leaf, paddle handles, a face recognition window and touch keypad on the outside, and the door's second lock above (like the Aqara D200i); colours `lock_frame`, `lock_body`, `lock_handle`. New device type `smart_lock`: the lock is drawn by the door, the device has a volume for selection.
- `docs.snapshot` uses a persistent Chrome profile from `profile` or `CHERRYBIM_CHROME_PROFILE` and closes Chrome with a command instead of killing it. On Windows a fresh profile checks the account password on launch (a failed sign-in), and a batch of snapshots in temporary profiles could lock the account.

## 0.5.1 — 2026-10-27

- New `props.render` hints:
  - on a thermostat, `head: "side"`: the head parallel to the floor, along the heater;
  - on a speaker, `shape: "duo"`: a speaker with a landscape screen on a hinge above it;
  - on a range hood, `style: "box"` and `buttons`: fully built-in, only the panel with filters, lamps and buttons is visible from below;
  - on a window, `lower`: glazing down to the floor: fixed panes below the window instead of wall;
  - on a router, `style: "tower"`: a Mesh node as a tower without antennas; `style: "wedge"`: a long wedge-shaped body with a skirt of ribs and blade antennas (like the Xiaomi BE7000);
  - on a cable, pipe or other line, `exposed`: laid in the open: visible even without the Building services («Инженерия») mode, and `color` sets the sheath colour.
- New device type `filament_dryer`.
- Skirting board:
  - corner pieces in inside and outside corners, end caps at doors;
  - where a wall ends without a door, the skirting wraps onto its end.
- Vacuum: the robot is no longer shown twice. While the live robot is docked (`docked`/`charging` or closer than 0.4 m), the base's robot is shown; once it has left, only the live one.
- Show director (`static/director.js`): the camera guides the viewer on its own: an orbit of the apartment, a flight into a room, a flight along the system's routes at eye level (heating: supply and return as running dashes), an approach to an item with highlighting, a tour of the rooms. Transitions arc around the target on a minimum-jerk curve, framing is computed for perspective, furniture in the way becomes transparent, and titles, labels and a mini-plan are drawn over the frame. Described in `docs/DESIGN.md`, "Show director".
- Screen mode `?tv=1` and the frame stream `static/capture.js` (WebCodecs H.264 over WebSocket): this is how the apartment is shown on a TV.
- Director: a camera without jerks or lurches (per-frame trajectory measurements: speed, acceleration, gaze rotation, roll, with no threshold exceeded on the orbit, rooms, items, the heating flight, the tour and the remote buttons).
  - The transition between shots is an optimal "pan + zoom" flight (van Wijk, Nuij): on a long flight the camera itself pulls back and rises above the apartment, and the image moves at constant speed. The duration is fitted by a dry run of the transition: apparent speed no more than 0.5 of the target distance per second, acceleration 0.45, gaze rotation 30°/s, lens zoom 7°/s; long transitions use a smooth trapezoid with a constant middle. Previously the duration was fixed, and on a flight across the apartment the camera rushed at 3 m/s at eye level.
  - Flight along a route: the path after the arcs is smoothed (curvature at the entry to a turn builds up gradually), speed within a profile step is continuous, starting and stopping have limited jerk; where the gaze turns quickly (a pipe hairpin, turning towards a device), the camera slows down. The gaze is at the average of several points ahead, and turns towards nearby devices with smooth weights: previously the "nearest device" switched abruptly and the gaze jumped 30° in one frame. Roll is smoothed along the path (at the entry to an arc it switched on abruptly), and the flight starts towards the end of the transition.
  - A scene rebuild (an item added, a package updated) does not restart the show: the shots continue, and highlight and selection come back.
- No more flickering of coincident faces (`static/coplanar.js`): faces of different items in one plane are found after the scene is built, and the smaller one, a part on a base (a threshold on the floor, a manifold cabinet in the wall, a door in a carcass), gets a depth rank: when drawn, its points are pulled towards the camera by 10⁻⁵ of the distance per rank (a view-space scale centred on the camera, so nothing moves on screen). The near clipping plane is at 0.04 of the distance to the target: in a 25 m orbit the depth buffer step was over a millimetre, and fronts with a backing a millimetre behind them flickered; the director keeps it from clipping an item close to the camera. Flickering pixels in reference frames are down 66-fold.
- `?tv=1&ss=2`: the frame is rendered at double size and downscaled into the stream (16 samples per pixel): thin edges and highlights do not flicker from a distance, with 5–11 times less flicker in motion. The stream does not skip frames with a lag of up to 1.2 s and waits for a busy encoder instead of dropping a frame (a skip is a camera jump).

## 0.5.0 — 2026-10-27

- Furniture from BAZIS-Mebelshchik (`cherrybim.io_bazis`, export script `tools/bazis/cherrybim-export.js`). Panels with cutouts in their exact positions, carcass / front / back panel roles, doors with their hinge side, drawers from Blum runners, handles from their holes, storage locations per carcass cell (guillotine split by through uprights and shelves). Described in `docs/DESIGN.md`, "Furniture from BAZIS-Mebelshchik".
- Viewer: furniture with `props.render.parts` is drawn part by part: boxes, outlines with cutouts along the thickness axis, cylindrical supports; bar handles from `handles_at`. Storage locations inside it draw no fronts or shelves, only a hanging rail (`rod_drop`).

## 0.4.1 — 2026-10-26

- Photo comparison: round 9 (the last one) and fine-tuning of what remained after it. New `props.render` hints:
  - on a window, `fixed` (indices of fixed panes: glass directly in the frame), `frame_top` (height of the top rail) and `railing_color`. The railing of a "French" window is white by default and glows slightly in its own colour: against the light through tulle it no longer reads as dark posts;
  - on a storage location, `abut` (edges that panels butt against: the gap shows a backing, as between fronts); on an internal cabinet drawer, `inset` (the front is narrower than the section); on a flap door, `knob_top` (knob measured from the top);
  - on a hallway unit, `leg_inset`, `leg_y` (rows of legs measured from the front, shared by all parts) and `leg_splay`; on a coat-rack frame, `stile`: a number or a pair `[at start, at end]`;
  - on a bench, `splay_corner`: per-corner splay;
  - on a table, `apron_flush` (the apron under the top is flush with its ends); on a shelving unit, `handle_x` (handles measured from the middle seam);
  - on a sofa, `arm_bulge` (plump armrests: wider outwards, top edge in place) and `arm_flare` (armrests flare towards the back);
  - on an air purifier/ventilator, `radius` and `back_round` (the top edge at the wall is rounded with an elliptical arc);
  - on a panel, `skirting` (skirting along the front) and `nosing` (a profile along the top edge): this is how the balcony door unit's threshold is drawn.
- Air conditioner: a side profile extruded across the width: a flat front, a rounding at the bottom front with the mesh grille wrapping under the body along it, end caps slightly smaller than the panel (a seam shows along the edge), louvres flush at the bottom. Previously two rollers stuck out under the body (the slot and the flap). New hints: `radius` (rounding of the top edge), grille colour `colors.grille`.
- Air purifier/ventilator: also a profile: a body with sharp bottom edges, a front panel with corners rounded in its plane.
- Cell-based cabinet furniture: with `colors.inside`, an open niche is dark throughout: liners on the bottom and sides, with only the front 1.5 cm of the edges staying light.
- Kitchen: between two fronts with a gola profile, the middle profile is 2 cm, not 3; a wall-hung module with `underside` starts above the bottom panel, and there is no more "saw" along the lower edge of the top cabinets.
- The narrow gap between table drawers is covered by a backing (the apron no longer shows in it); the backing in the openings of a slatted coat rack is lighter: panel colour ×0.8.
- Convector: the grille covers the whole top (the white margins at the edges under the tulle broke into dashes). Grid light fixture on a suspension: the body is a frame at the ceiling, without a stem. A passage lintel stands 0.5 mm in front of the wall planes: with a recessed one, the end of the neighbouring wall showed through the gap.
- `docs/DESIGN.md` now describes the hints that went into 0.4.0 undocumented (photo comparison rounds 6–8 and earlier): `hidden` (`true`: do not draw; `"full"`: only in the cutaway), `socle_inset` and `sides_to_floor` on cabinet furniture, `colors.inside`, `handle_posts`, `doors_below` and `doors_from`, `legs_dx` and `leg_r`, `back_drop`, `adf_x`, `dispenser_dx`, `faucet`, `sill_depth`, `seam`, `leaf_overlap`, `handle_backset`, `headboard`, `frame_x`, `recline`, `stagger` and others. It also covers the gap backing in the front colour ×0.6 (since 0.4.0) and the fact that the viewer reads the pixel density once, on load.

- Lighting in the apartment under the ceiling (view without the cutaway): no sun, diffuse light, with the sky and environment brighter (`INSIDE_LIGHT` in `app.js`, tuned with `?lt=солнце,небо,окружение`, i.e. sun, sky, environment). A sun from above in a room with a ceiling blew out the floor and cast slanting shadows on the walls, while the owners' photos were taken in the evening under lamps. Across 15 photos, lighting non-uniformity against the photo (mean |ln| of the brightness ratio of flat areas, without overall exposure) went from 0.194 to 0.182; the white hallway furniture and the wall next to it now lighten equally, as in the photo. The cutaway and outside views keep the previous lighting.
- The thermostatic head is drawn at the heater end given by the heater's `render.valve`: `"left"` is the left one as seen from the room (the default is the right).

- View from the windows: in the apartment under the ceiling (without the cutaway), the surroundings and the ground are visible: neighbouring buildings and the yard from the block package (buildings of kind `building` with type `context`: surroundings from the map, without labels on the block plan); the apartment's own building is hidden, since the apartment is inside it. The camera's far plane in the apartment view is 800 m.

- The sky outside the apartment windows (view under the ceiling) follows the time of day: sun elevation from HA's `sun.sun` (day, dusk, night); the server always watches `sun.sun`; `?sky=day|dusk|night` sets it manually. In other views the background is the page colour.

## 0.4.0 — 2026-10-26

- Documents on entities (`cherrybim.docs`): manuals, design project and drawings, receipts, warranties, contracts, shop pages: entities of kind `document` attached to an item, furniture, appliance or room, with a link (`props.url`) and a local copy (`props.file` in the documents folder `--docs`, `DATA/docs` by default). The card has a Documents («Документы») section: the entity's own plus the parent's project or assembly diagram; the document card lets you open the copy, download it, or go to the site. Documents can be added as a file or a link, and the server downloads the copy itself (`POST /api/docs`, `GET /api/doc/{id}`, `DELETE /api/docs/{id}`; an HTML copy opens in a sandbox). Page snapshots when building packages: `python -m cherrybim.docs snapshot URL файл.pdf` (headless Chrome, screen layout without pop-ups, PDF with text). An item's private numbers (`props.ids`: IMEI, serial number) are masked in the card and kept out of search and assistant responses. MCP tool `documents`.

- Viewer: realistic geometry without textures. Per-type models (`static/families.js`) are built from an entity's dimensions: a bed with a headboard and pillows, sofas with cushions, a table with chairs, a wardrobe with overlay doors and handles, a kitchen with a plinth, worktop, fronts and gola profile, fridge, oven, microwave, hob, washing machine and tumble dryer, bathtub, wall-hung toilet, washbasin, heated towel rail, radiators and convectors, sockets, windows with frames, sashes and a sill, hinged doors, a two-colour entrance door. Storage locations draw their own front (drawer, door, shelf, hooks, hanging rail).
- Lighting and materials: PBR materials (colour, roughness, metalness) without images, a room environment for reflections, a sun with soft shadows, ambient occlusion (GTAO), neutral tone mapping. A frame is drawn only on changes; on a weak device the viewer turns off ambient occlusion and lowers the pixel density by itself (`?ao=0` / `?ao=1` to set it manually).
- Walls cut at 1.15 m: openings have their own cutaway build (frames, leaves and the wall above the opening are clipped, not squashed).
- Building services («Инженерия») as an X-ray: pipes and cables in walls and screed are visible through them; off by default, while plumbing fixtures and devices are always visible.
- The selected cabinet and a cabinet with a selected drawer become semi-transparent, so you can see what is inside.
- Skirting board along the walls of rooms with such a finish; the floor follows the finish (`props.render.on` = `["floor"]`); a light that is on is a warm spot on the room floor.
- Building («Дом») and Block («Квартал») views: buildings have a socle and a parapet, entrances with known storeys have floor bands; a gazebo with posts and a roof; the ground is just shadows on the page background.
- Render hints are `props.render` (colours, door hinges and opening angle, cabinet fronts, what is at the front of a storage location). They do not appear in the card or in assistant responses.
- Furnishings and appliances (`static/furnishings.js`): a chest of drawers and cell-based cabinets (TV stand, mobile pedestal, wall-hung, bedside), office chairs, chairs, a bench, a pouf, a fitness ball, rugs, curtains with tulle on a rod; a TV, air conditioner, air purifier/ventilator, MFP, 3D printer, PC tower, monitors (including curved), a lamp, a router, smart speakers, a UPS, a pet bed, scales. Ceiling light fixtures of various kinds (`render.fixture`): "grid", rays, rings, disc, shade.
- New `props.render` hints: legs (`legs`, and for a table `trestle`, trapezoidal supports), chairs at the ends and pulled out by different amounts (`chair_out: {side, ends}`), cabinet furniture cells (`cells`), kitchen tiers (`strips`), worktop and backsplash not across the full width (`counter`, `backsplash.x`), curtain panels of different widths, shared legs for the parts of one piece (`piece`), hook pitch, the railing of a "French" window (`railing`), cabinet doors without handles (`handle: false`), a fridge without surface-mounted handles.
- A light fixture with a known point (`placement` without a box) hangs at it and is rotated to the room axes; light fixtures cast no shadows.
- Shapes from the photo comparison: an armless sofa with a bolster, an armless office chair with a high back, a "shell" chair with the back sloping down to the armrests, a table on splayed wooden legs and on flat strip legs without an apron, trapezoidal supports without a floor bar, concave curved monitors, a coat-rack frame of stiles, rails and slats, J-shaped hooks, a shelf without brackets, an inset drawer front, a cabinet socle in the plane of the doors, a kitchen module without a plinth, a smart lock with the second lock's thumb turn, a peephole and hinges, a vacuum base with the robot, the fixed part of a balcony door unit as glass in the frame, a curtain rod wider than the panels. The hints are in `docs/DESIGN.md`.
- A TV or station screen that is off is dark, not white. The handle colour of drawers and doors of storage locations comes from the furniture's `colors.handle`.
- Cable trunking (`mep.cable_channel`), under-cabinet lighting (`device.backlight`, lit according to the light's state), an air duct (`mep.duct`, visible in Building services mode).
- Kitchen: the bottom of a wall-hung module in its own colour (`render.underside`), a 10 mm worktop overhang. A light fixture in the cutaway is a ring on the floor, not a ball in the air.
- Doorless passage (`opening.passage`): wall above the opening; on the plan image a passage is not drawn as a window.
- `io_ofm.facade_from_ofm`: cabinet doors with hinges and handles, an astragal and wall filler strips from an OpenFurnitureMaker project.
- Plan image: doors are drawn with the leaf and the swing arc.
- Photo comparison, rounds 4–5: rooms have a ceiling in the view without the cutaway (visible only from below); walls and openings in this view cast no "sun" shadows inwards; wall joints without a light dashed line (internal wall ends are not built, wall pieces in openings are recessed by 0.5 mm); the floor is level with the rooms in door openings and the passage, skirting along the passage reveals and up to the door casing; new `props.render` hints: a quilted back and a single sofa cushion, bolster setback, table drawers placed in position, table side panel setback, strip-leg splay, arch handles and a drawer lock, a drawer handle in the middle, first hook position, a mirror frame and light glass, door frame, casing, handle height, escutcheon plate and round rosette, peephole, tulle draped over a heater below the window and tulle opacity, a pet bed with a bolster or a rim, light fixture grid size, rays and disc, ring tilt; air purifier colours, mesh on the PC tower front, a tinted 3D printer hood, a 2-in-1 faucet.
- Type dictionary: door (`door`), balcony door unit (`balcony_door`), passage (`passage`), cable trunking (`cable_channel`), backlight (`backlight`), air duct (`duct`); furnishings (nightstand, chest of drawers, cabinets, table, chair, armchair, bench, pouf, panel, curtains, rug, pet bed, bowl, fitness ball, scales, hallway unit, vanity unit) and appliances (monitor, computer, printer, router, UPS, 3D printer).

## 0.3.6 — 2026-10-23

- Type dictionary: water filter (`water_filter`, IFC `IfcFilter` / `WATERFILTER`). Previously such an object was simply called "object".

## 0.3.5 — 2026-10-23

- Plan image: space labels and the location marker are placed inside the polygon. For an L-shaped apartment the centre of the bounding box lies outside, and the label landed on the neighbouring space; now the point furthest from the edges is used.
- Type dictionary: tumble dryer (`tumble_dryer`, IFC `TUMBLEDRYER`) and range hood (`range_hood`).

## 0.3.4 — 2026-10-23

- Plan image and 3D: an apartment with no known number is labelled by its layout («2-комн., 60,23 м²», "2-room, 60.23 m²") rather than «кв. ?» ("apt. ?"); the lift shaft has no label.

## 0.3.3 — 2026-10-23

- `show`: we wait no longer than 3 s for confirmation. The Home Assistant MCP client cuts the call off before 5 s, not after 10 s as was thought.

## 0.3.2 — 2026-10-23

- `show`: if the screen did not respond, the tool's response tells the assistant plainly that this is not an error and there is no need to retry.

## 0.3.1 — 2026-10-23

- `show`: we wait no longer than 7 s for confirmation from the screen. The Home Assistant MCP client cuts the tool off at 10 s, and the assistant reported an error even though the plan had already been sent.

## 0.3.0 — 2026-10-23

- `cherrybim.plan.render_plan`: a 2D plan image (PNG, dark and light themes). Draws the apartment, or, if the location is outside the apartment, the storey or the block. The requested location is highlighted and labelled.
- Server: `GET /api/plan.png`, `POST /api/show` and the MCP tool `show`. The plan is put into HA media and displayed by an HA script (`--show-script`), for example on a TV screen.
- Viewer: the Building («Дом») view shows neighbouring apartments and the storey's common areas; buttons To TV («На телевизор») and Plan image («План картинкой»).
- Photo → items («Фото → вещи»): the prompt names items the way people search for them aloud.
- Type dictionary: storey common area, lift shaft.
- Dependency of the `server` extra: Pillow.

## 0.2.0 — 2026-10-23

- Server `cherrybim.server` (the `server` extra): a three.js 3D viewer, an items API, live Home Assistant states, MCP tools `find`, `contents`, `add_item`, `move_item`, `remove_item`.
- Items are stored in a separate package, `items.twin.json`; crossed-out ones in `trash.jsonl`.
- `Twin.rank` search: points for the names of parents and related entities, one-letter labels, an "all words found" flag.
- `geo.footprint`: the apartment's outer outline from walls and rooms, with door openings filled in.
- Dreame vacuum: `bind["dreame.affine"]` converts the apartment coordinate system to the robot's coordinates and back.
- `ha-addon/cherrybim`: a local Home Assistant add-on (ingress, Supervisor, MCP).
- Type dictionary: kitchen cabinets, sink, household appliances.

## 0.1.0 — 2026-10-23

- Model (pydantic), in-memory twin, privacy, GeoJSON, IFC4 via IfcOpenShell, furniture import from OpenFurnitureMaker, JSON Schema and the type dictionary.
