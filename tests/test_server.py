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
