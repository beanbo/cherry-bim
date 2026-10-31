import asyncio
import json

import pytest

pytest.importorskip("mcp")
from starlette.testclient import TestClient  # noqa: E402

from cherrybim import Entity, Kind, Package, Point, make_id  # noqa: E402
from cherrybim.server.app import Server  # noqa: E402
from cherrybim.server.ha import HA  # noqa: E402
from cherrybim.server.store import ITEMS_FILE, TRASH_FILE, Store, StoreError  # noqa: E402


@pytest.fixture()
def store(tmp_path, demo):
    pk = tmp_path / "packages"
    pk.mkdir()
    for p in demo:
        (pk / f"{p.name}.twin.json").write_text(p.model_dump_json(by_alias=True), encoding="utf-8")
    return Store(pk, tmp_path / "data")


@pytest.fixture()
def client(store):
    srv = Server(store, HA(url="", token=""))
    with TestClient(srv.app(), client=("127.0.0.1", 50000)) as c:
        yield c


def test_items_add_move_remove_persist(store, tmp_path):
    e = store.add_item("Отвёртка", "ящик 3", qty=2, by="Аня")
    assert store.short_path(e.id) == "Спальня → Шкаф → Секция с ящиками → Ящик 3 → Отвёртка"
    again = Store(store.packages_dir, store.data_dir)                     # перечитали с диска
    assert again.resolve("отвертку").props["qty"] == 2
    store.move_item("отвёртка", "ящик 1")
    assert store.resolve("отвёртка").parent == store.resolve("ящик 1").id
    assert store.remove_item("отвёртка") == "Отвёртка"
    with pytest.raises(StoreError):
        store.resolve("отвёртка", {Kind.item})
    row = json.loads((tmp_path / "data" / TRASH_FILE).read_text(encoding="utf-8").splitlines()[0])
    assert row["entity"]["name"] == "Отвёртка"


def test_moved_item_forgets_old_place(store):
    from cherrybim import Box, Placement
    e = store.add_item("Чемодан", "ящик 3")
    e.type, e.placement, e.geom = "suitcase", Placement(pos=(0.1, 0.1, 0.0)), Box(size=(0.45, 0.29, 0.72))
    store.move_item("чемодан", "ящик 3")                                   # то же место — габариты и место остаются
    assert store.resolve("чемодан").placement is not None
    store.move_item("чемодан", "ящик 1")                                   # координаты прежнего ящика тут ничего не значат
    moved = Store(store.packages_dir, store.data_dir).resolve("чемодан")
    assert moved.placement is None and moved.geom is None and moved.props["size_m"] == [0.45, 0.29, 0.72]


def test_ambiguous_place_asks_which(store):
    with pytest.raises(StoreError, match="уточни"):
        store.add_item("Скотч", "ящик")
    with pytest.raises(StoreError, match="не нашёл «ящик 9»; похожие"):
        store.add_item("Скотч", "ящик 9")
    with pytest.raises(StoreError, match="только для чтения"):
        store.move_item("дрель", "ящик 1")                                 # дрель из пакета квартиры


def test_items_file_edited_by_hand_is_reread(store):
    store.add_item("Фонарик", "ящик 3")
    f = store.data_dir / ITEMS_FILE
    data = json.loads(f.read_text(encoding="utf-8"))
    data["entities"][0]["name"] = "Фонарь налобный"
    f.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    import os
    os.utime(f, (1, 1))                                                     # другой mtime наверняка
    assert store.search("налобный")[0]["name"] == "Фонарь налобный"


def test_http_api(client):
    snap = client.get("/api/twin").json()
    assert any(e["key"] == "kv12.bedroom.wardrobe.dr2.drill" and len(e["m"]) == 4 for e in snap["entities"])
    r = client.post("/api/items", json={"name": "Изолента", "place": "ящик 2"})
    assert r.status_code == 200, r.text
    iid = r.json()["id"]
    hits = client.get("/api/search", params={"q": "изоленту"}).json()
    assert hits[0]["id"] == iid and hits[0]["short"].endswith("Ящик 2 → Изолента")
    assert client.patch(f"/api/items/{iid}", json={"place": "ящик 3", "qty": 3}).json()["props"]["qty"] == 3
    place = client.get("/api/place/ящик 3").json()
    assert [i["name"] for i in place["items"]] == ["Изолента"]
    assert client.delete(f"/api/items/{iid}").json() == {"removed": "Изолента"}
    assert client.post("/api/items", json={"name": "Скотч", "place": "ящик"}).status_code == 400
    assert client.post("/api/call", json={"entity_id": "lock.front_door"}).status_code == 403


def test_foreign_address_is_refused(store):
    srv = Server(store, HA(url="", token=""))
    with TestClient(srv.app(), client=("8.8.8.8", 1)) as c:
        assert c.get("/api/twin").status_code == 403


def test_mcp_over_http(client):
    hdr = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
    init = {"jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}}
    assert client.post("/mcp", json=init, headers=hdr).status_code == 200
    tools = client.post("/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, headers=hdr).json()
    names = {t["name"] for t in tools["result"]["tools"]}
    assert {"find", "contents", "add_item", "move_item", "remove_item"} <= names
    call = {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "find", "arguments": {"query": "дрель"}}}
    text = client.post("/mcp", json=call, headers=hdr).json()["result"]["content"][0]["text"]
    assert text.startswith("Дрель-шуруповёрт (вещь) — Спальня → Шкаф → Секция с ящиками → Ящик 2")


def test_mcp_tools_voice_flow(store):
    srv = Server(store, HA(url="", token=""))

    def call(tool, **args):
        res = asyncio.run(srv.mcp.call_tool(tool, args))
        blocks = res[0] if isinstance(res, tuple) else res
        return blocks[0].text

    assert call("add_item", name="Паспорт на холодильник", place="ящик 1", by="Сергей").startswith("Записал")
    assert "Паспорт на холодильник" in call("contents", place="шкаф")
    assert "теперь Спальня → Шкаф → Секция с ящиками → Ящик 3" in call("move_item", item="паспорт", place="ящик 3")
    assert call("remove_item", item="паспорт") == "Вычеркнул: Паспорт на холодильник."
    assert call("find", query="зонтик").startswith("Ничего не нашёл")


def test_find_puts_asked_props_first(store):
    srv = Server(store, HA(url="", token=""))
    pc = store.add_item("Компьютер", "ящик 1")
    pc.props.update({f"p{i}": f"деталь {i}" for i in range(10)})
    pc.props["cooling"] = "водянка Zalman Reserator5 Z36, " + "подробно " * 20   # длиннее 160 символов
    res = asyncio.run(srv.mcp.call_tool("find", {"query": "какая у компьютера водянка"}))
    text = (res[0] if isinstance(res, tuple) else res)[0].text
    assert "Zalman" in text and "p9:" not in text                  # спросили про водянку — она в первых 8


def test_vacuum_robot_and_site_roundtrip(store, demo):
    unit = store.twin.by_key["kv12"]
    vac = Entity(id=make_id("test", "vac"), key="kv12.vac", kind=Kind.device, type="vacuum", name="Пылесос",
                 parent=unit.id, geom=Point(),
                 bind={"ha.entity": ["vacuum.robot"], "dreame.camera": "camera.robot_map",
                       "dreame.affine": {"frame": "kv12", "X": [0, -1000, 4272.8], "Y": [1000, 0, -11030.5]}})
    extra = Package(id=make_id("test", "pkg"), name="vac", root=unit.id, privacy="household", entities=[vac])
    (store.packages_dir / "vac.twin.json").write_text(extra.model_dump_json(by_alias=True), encoding="utf-8")
    store.reload()
    srv = Server(store, HA(url="", token=""))
    sx, sy, sz, yaw = srv._robot_to_site(-3254, -7565, 181)
    assert srv._site_to_robot(sx, sy) == (-3254, -7565)
    fx, fy, _ = store.twin.to_site("kv12", [((-7565 + 11030.5) / 1000, (4272.8 + 3254) / 1000, 0)])[0]
    assert abs(fx - sx) < 1e-3 and abs(fy - sy) < 1e-3
    state = srv._decorate("camera.robot_map", {"state": "x", "attributes": {"vacuum_position": {"x": 0, "y": 0, "a": 0}}})
    assert len(state["pose"]) == 4


def test_plan_png(store):
    from cherrybim.plan import render_plan
    png = render_plan(store.twin, store.twin.by_key["kv12.bedroom.wardrobe.dr2"].id, size=(800, 450))
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    from PIL import Image
    import io
    assert Image.open(io.BytesIO(png)).size == (800, 450)


def test_http_plan_and_show_not_configured(client):
    r = client.get("/api/plan.png", params={"e": "ящик 2", "w": 640, "h": 360, "label": 1})
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert client.post("/api/show", json={"ref": "ящик 2"}).json() == {"ok": False, "error": "показ на экране не настроен"}


def test_show_calls_ha_script(store, tmp_path):
    srv = Server(store, HA(url="http://ha.invalid", token="t"), media_dir=str(tmp_path / "cherrybim"),
                 show_script="script.na_tv")
    calls = []

    async def fake_call(domain, service, data=None, response=False, timeout=20):
        calls.append((domain, service, data))
        return {"ok": True, "status": "shown"}
    srv.ha.call = fake_call
    res = asyncio.run(srv.show("ящик 2"))
    assert res["ok"] and res["what"].endswith("Ящик 2")
    (domain, service, data), = calls
    assert (domain, service) == ("script", "na_tv") and data["put"].startswith("cherrybim/show/")
    assert (tmp_path / data["put"]).read_bytes()[:4] == b"\x89PNG"
    text = asyncio.run(srv.mcp.call_tool("show", {"what": "дрель"}))
    blocks = text[0] if isinstance(text, tuple) else text
    assert blocks[0].text.startswith("Показал на телевизоре план: Спальня")


def test_show_does_not_wait_past_mcp_limit(store, tmp_path, monkeypatch):
    import cherrybim.server.app as app_mod
    monkeypatch.setattr(app_mod, "SHOW_WAIT", 0.05)
    srv = Server(store, HA(url="http://ha.invalid", token="t"), media_dir=str(tmp_path / "cherrybim"),
                 show_script="script.na_tv")

    async def slow_call(*a, **k):
        await asyncio.sleep(1)
        return {"ok": True}
    srv.ha.call = slow_call
    res = asyncio.run(srv.show("ящик 2"))
    assert res["ok"] and res["status"] == "sent"


def test_viewer_static_modules(client):
    # просмотрщик: модели по типам, детали, материалы и модули three.js для света, теней и затенения углов
    for path in ("app.js", "families.js", "kit.js", "materials.js", "vendor/jsm/postprocessing/GTAOPass.js",
                 "vendor/jsm/environments/RoomEnvironment.js", "vendor/jsm/geometries/RoundedBoxGeometry.js"):
        r = client.get(f"/static/{path}")
        assert r.status_code == 200 and "javascript" in r.headers["content-type"], path


def test_plan_png_draws_doors(store):
    # двери с петлями рисуются полотном и дугой; картинка строится и для двери в фокусе
    from cherrybim.plan import _swing, render_plan
    door = store.twin.by_key["kv12.bedroom.door"]
    lines = _swing(door, lambda q: q)
    assert [w for _, w in lines] == [2, 1] and len(lines[1][0]) == 17
    hinge, tip = lines[0][0]
    assert abs(hinge[0] - (0.9 - 0.04)) < 1e-9 and tip[1] < 0          # петли справа, открывается в сторону −Y
    assert render_plan(store.twin, door.id, size=(640, 360))[:8] == b"\x89PNG\r\n\x1a\n"


def test_docs_file_link_and_copy(client, store, monkeypatch):
    pdf = b"%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n2 0 obj << /Type /Page >> endobj\n%%EOF"
    r = client.post("/api/docs", params={"to": "шкаф", "title": "Проект шкафа", "type": "project",
                                         "filename": "Проект шкафа.pdf"}, content=pdf,
                    headers={"Content-Type": "application/pdf"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["copy"] and d["pages"] == 2 and d["ru"] == "проект, чертежи" and d["editable"]
    f = client.get(f"/api/doc/{d['id']}")
    assert f.status_code == 200 and f.content == pdf and f.headers["content-type"] == "application/pdf"
    # ящик внутри шкафа видит документы шкафа как «у родителя»
    up = client.get("/api/docs/ящик 2").json()
    assert up["docs"] == [] and up["parent"]["name"] == "Шкаф" and up["parent"]["docs"][0]["name"] == "Проект шкафа"
    # ссылка с копией: страница сохраняется HTML с <base>, открывается в песочнице
    page = b"<html><head><title>Fridge manual</title></head><body>hello</body></html>"
    monkeypatch.setattr("cherrybim.server.app.fetch", lambda url: (page, "text/html", url))
    r = client.post("/api/docs", json={"to": "ящик 2", "url": "https://example.com/manual", "copy": True})
    assert r.status_code == 200, r.text
    link = r.json()
    assert link["name"] == "Fridge manual" and link["type"] == "page" and link["copy"]
    g = client.get(f"/api/doc/{link['id']}")
    assert b'<base href="https://example.com/manual">' in g.content and g.headers["content-security-policy"] == "sandbox"
    assert client.post("/api/docs", json={"to": "шкаф", "url": "file:///etc/passwd"}).status_code == 400
    # копия не выходит за папку документов
    doc = store.resolve(link["id"])
    doc.props["file"] = "../items.twin.json"
    assert client.get(f"/api/doc/{link['id']}").status_code == 404
    assert client.delete(f"/api/docs/{d['id']}").json() == {"removed": "Проект шкафа"}
    assert client.get(f"/api/doc/{d['id']}").status_code == 404


def test_item_ids_hidden_from_search_and_voice(store):
    e = store.add_item("Телефон Ани", "спальня")
    store.update_item(e.id, ids={"IMEI": "356938035643809", "Серийный номер": "R58N"})
    assert store.resolve("телефон").props["ids"]["IMEI"] == "356938035643809"
    assert store.search("356938035643809") == []
    srv = Server(store, HA(url="", token=""))
    res = asyncio.run(srv.mcp.call_tool("find", {"query": "телефон"}))
    text = (res[0] if isinstance(res, tuple) else res)[0].text
    assert "Телефон Ани" in text and "356938035643809" not in text
    store.add_doc("телефон", "Гарантия на телефон", type="warranty", url="https://example.com/w")
    res = asyncio.run(srv.mcp.call_tool("documents", {"what": "телефон"}))
    text = (res[0] if isinstance(res, tuple) else res)[0].text
    assert "«Гарантия на телефон» (гарантия, ссылка https://example.com/w)" in text and "356938035643809" not in text
    store.update_item(e.id, ids={})
    assert "ids" not in store.resolve(e.id).props


def _tool(srv, name, args):
    res = asyncio.run(srv.mcp.call_tool(name, args))
    return (res[0] if isinstance(res, tuple) else res)[0].text


def test_docs_resolve_and_inheritance(store):
    d = store.add_doc("шкаф", "Проект шкафа", type="project", url="https://example.com/p")
    assert store.resolve("шкаф").name == "Шкаф"                  # документ не отнимает название у самого шкафа
    # спросили о самом документе — он и есть ответ
    r = store.docs_of(d.id)
    assert r["of"]["name"] == "Шкаф" and [x["name"] for x in r["docs"]] == ["Проект шкафа"]
    # проект, связанный с ящиком, — в своих документах ящика и не повторяется «у шкафа»
    store.link_doc(d.id, "ящик 2")
    r = store.docs_of("ящик 2")
    assert [x["name"] for x in r["docs"]] == ["Проект шкафа"] and r["parent"] is None
    # вещь в ящике — не часть шкафа: проекта шкафа у неё нет
    store.add_item("Молоток", "ящик 2")
    assert store.docs_of("молоток")["docs"] == [] and store.docs_of("молоток")["parent"] is None


def test_remove_item_takes_its_documents(store):
    e = store.add_item("Телефон Ани", "ящик 2")
    store.add_doc(e.id, "Гарантия на телефон", type="warranty", url="https://example.com/w")
    store.remove_item(e.id)
    assert store.docs_of("ящик 2")["docs"] == []                  # гарантия не переехала к ящику
    row = json.loads((store.data_dir / TRASH_FILE).read_text(encoding="utf-8").splitlines()[-1])
    assert row["entity"]["name"] == "Телефон Ани" and row["docs"][0]["name"] == "Гарантия на телефон"


def test_hidden_documents_stay_hidden(store):
    from cherrybim.model import Privacy
    d = store.add_doc("шкаф", "Чек на шкаф", type="receipt", url="https://example.com/r")
    d.privacy = Privacy.secret
    store._save()
    srv = Server(store, HA(url="", token=""))
    assert "Документов" not in _tool(srv, "find", {"query": "шкаф"})
    assert store.docs_of("шкаф")["docs"] == []
    with pytest.raises(StoreError):                               # и по id закрытое не находится
        store.resolve(d.id)
    assert "Чек" not in _tool(srv, "documents", {"what": d.id})


def test_update_item_checks_before_changing(store):
    e = store.add_item("Телефон", "спальня")
    with pytest.raises(StoreError):
        store.update_item(e.id, name="Новый", tags="техника")       # строка вместо списка сломала бы поиск
    assert store.resolve(e.id).name == "Телефон" and store.search("телефон")
    with pytest.raises(StoreError):
        store.update_item(e.id, ids={"x" * 41: "1"})
    store.update_item(e.id, ids={"IMEI": " 356938035643809 ", "MAC": None, "PIN": False})
    assert store.resolve(e.id).props["ids"] == {"IMEI": "356938035643809"}


def test_doc_copies_typed_by_content(client, store, monkeypatch):
    pdf = b"%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%%EOF"
    monkeypatch.setattr("cherrybim.server.app.fetch", lambda url: (pdf, "application/octet-stream", url))
    r = client.post("/api/docs", json={"to": "шкаф", "url": "https://example.com/download.php?id=1", "copy": True,
                                       "type": "manual"})
    d = r.json()
    assert r.status_code == 200 and d["mime"] == "application/pdf" and d["type"] == "manual", r.text
    g = client.get(f"/api/doc/{d['id']}")
    assert g.headers["content-type"] == "application/pdf" and g.headers["content-disposition"].startswith("inline")
    assert "content-security-policy" not in g.headers
    snap = client.get("/api/twin").json()
    assert next(e for e in snap["entities"] if e["id"] == d["id"])["copy"] is True
    # .json из панели — файл, а не запрос к API; XML (может нести скрипт XHTML) — только скачать, в песочнице
    j = client.post("/api/docs", params={"to": "шкаф", "title": "Настройки роутера", "filename": "router.json"},
                    content=b'{"a": 1}', headers={"Content-Type": "application/json"})
    assert j.status_code == 200, j.text
    x = client.post("/api/docs", params={"to": "шкаф", "title": "Схема", "filename": "x.xml"}, headers={"Content-Type": "text/xml"},
                    content=b'<x:html xmlns:x="http://www.w3.org/1999/xhtml"><x:script>alert(1)</x:script></x:html>')
    g = client.get(f"/api/doc/{x.json()['id']}")
    assert g.headers["content-disposition"].startswith("attachment") and g.headers["content-security-policy"] == "sandbox"
    # пустой файл — ошибка, а не документ без копии и без ссылки
    assert client.post("/api/docs", params={"to": "шкаф", "title": "Пусто", "filename": "a.pdf"}, content=b"").status_code == 400
    assert client.post("/api/docs", content=b"[1, 2]", headers={"Content-Type": "application/json"}).status_code == 400


def test_page_copies_utf8_and_fast():
    import time
    from cherrybim.docs import html_copy, html_utf8, title_of
    raw = ('<html><head><meta charset="windows-1251"><title>Холодильник Atlant купить с доставкой</title></head>'
           '<body>текст</body></html>').encode("cp1251")
    page = html_utf8(raw)
    assert title_of(page, "text/html") == "Холодильник Atlant" and "текст".encode() in page
    assert b'charset="utf-8"' in page and b"windows-1251" not in page
    t = time.time()                                               # раньше: минуты на такой странице
    assert title_of(b"<title>" * 200_000, "text/html") is None
    assert html_copy(b"<head" * 200_000, "https://example.com/").startswith(b'<meta charset="utf-8">')
    assert time.time() - t < 2


def _idea(store, key="polka", **extra):
    store.ideas_dir.mkdir(parents=True, exist_ok=True)
    raw = {"key": key, "title": "Полка над столом", "summary": "Кратко", "about": "kv12.bedroom",
           "views": [{"name": "сверху", "eye": [0, 0, 3], "at": [1, 1, 1], "fit": 2}],
           "add": [{"key": "idea.polka", "kind": "furniture", "type": "wall_shelf", "name": "Полка", "parent": "kv12.bedroom",
                    "placement": {"pos": [1, 1, 1.5]}, "geom": {"type": "box", "size": [1, 0.3, 0.02]}}],
           "change": [{"ref": "kv12.bedroom.wardrobe", "placement": {"pos": [0.5, 0.5, 0]}, "note": "к окну"}],
           "remove": ["kv12.bedroom.wardrobe.dr2"], **extra}
    (store.ideas_dir / f"{key}.idea.json").write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")


def test_ideas_list_preview_and_feedback(client, store):
    _idea(store)
    (store.ideas_dir / "bad.idea.json").write_text("{", encoding="utf-8")       # кривой файл виден с ошибкой
    _idea(store, "secret", privacy="owner")                                      # строже аудитории — не виден
    r = client.get("/api/ideas").json()
    by = {i["key"]: i for i in r["ideas"]}
    assert set(by) == {"polka", "bad"} and "error" in by["bad"] and r["statuses"]["planned"] == "в планах"
    assert by["polka"]["counts"] == {"add": 1, "change": 1, "remove": 1} and by["polka"]["status"] == "idea"
    assert client.get("/api/twin").json()["features"]["ideas"] == 2
    snap = client.get("/api/twin", params={"idea": "polka"}).json()
    marks = {e["key"]: e["idea"] for e in snap["entities"] if "idea" in e}
    assert marks == {"idea.polka": "add", "kv12.bedroom.wardrobe": "change", "kv12.bedroom.wardrobe.dr2": "remove",
                     "kv12.bedroom.wardrobe.dr2.drill": "remove"}
    assert not any(e["editable"] for e in snap["entities"])                     # вариант смотрят, а не правят
    info = snap["idea"]
    assert [a["name"] for a in info["added"]] == ["Полка"] and info["changed"][0]["note"] == "к окну"
    assert len(info["views"]) == 1 and info["views"][0]["fit"] == 2 and len(info["views"][0]["eye"]) == 3
    assert client.get("/api/twin", params={"idea": "нет"}).status_code == 404
    assert client.get("/api/twin", params={"idea": "bad"}).status_code == 400
    assert client.get("/api/twin", params={"idea": "secret"}).status_code == 404
    # статус и заметка — в state.json, файл идеи не трогается
    before = (store.ideas_dir / "polka.idea.json").read_text(encoding="utf-8")
    r = client.post("/api/ideas/polka", json={"status": "planned", "note": "Шире на 10 см"}).json()
    assert r["status"] == "planned" and r["notes"][0]["text"] == "Шире на 10 см"
    assert client.post("/api/ideas/polka", json={"status": "кое-как"}).status_code == 400
    assert (store.ideas_dir / "polka.idea.json").read_text(encoding="utf-8") == before
    state = json.loads((store.ideas_dir / "state.json").read_text(encoding="utf-8"))
    assert state["polka"]["status"] == "planned" and len(state["polka"]["notes"]) == 1
    # обычный снимок без пометок; файл идеи поправили — список перечитан
    assert not any("idea" in e for e in client.get("/api/twin").json()["entities"])
    _idea(store, title="Полка пошире")
    import os
    f = store.ideas_dir / "polka.idea.json"
    os.utime(f, (f.stat().st_atime, f.stat().st_mtime + 5))
    assert next(i for i in client.get("/api/ideas").json()["ideas"] if i["key"] == "polka")["title"] == "Полка пошире"


def test_mesh_served_for_visible_entities(client, store):
    # готовая модель: GLB из папки моделей — только видимой сущности с geom mesh, в том числе из варианта идеи
    pytest.importorskip("numpy")
    from cherrybim.io_mesh import write_glb
    store.assets_dir.mkdir(parents=True, exist_ok=True)
    write_glb(store.assets_dir / "holder.glb", [{"vertices": [[0, 0, 0], [0.1, 0, 0], [0, 0.1, 0]], "triangles": [[0, 1, 2]]}])
    _idea(store, "derzhatel", add=[{"key": "idea.holder", "kind": "furniture", "type": "holder", "name": "Держатель",
                                    "parent": "kv12.bedroom", "placement": {"pos": [1, 1, 1.2]},
                                    "geom": {"type": "mesh", "asset": "holder.glb"}},
                                   {"key": "idea.lost", "kind": "furniture", "name": "Без файла", "parent": "kv12.bedroom",
                                    "geom": {"type": "mesh", "asset": "../packages/x.glb"}}])
    snap = client.get("/api/twin", params={"idea": "derzhatel"}).json()
    holder = next(e for e in snap["entities"] if e.get("key") == "idea.holder")
    assert holder["geom"] == {"type": "mesh", "asset": "holder.glb"}
    r = client.get(f"/api/mesh/{holder['id']}", params={"idea": "derzhatel"})
    assert r.status_code == 200 and r.headers["content-type"] == "model/gltf-binary" and r.content[:4] == b"glTF"
    assert client.get(f"/api/mesh/{holder['id']}").status_code == 404          # в двойнике его нет — только в идее
    lost = next(e for e in snap["entities"] if e.get("key") == "idea.lost")
    assert client.get(f"/api/mesh/{lost['id']}", params={"idea": "derzhatel"}).status_code == 404   # вне папки моделей
    assert client.get("/api/mesh/kv12.bedroom").status_code == 404              # не модель
    assert client.get("/static/mesh.js").status_code == 200

