# -*- coding: utf-8 -*-
"""Сервер Cherry BiM: 3D-просмотрщик, API вещей и состояний, MCP для голосового ассистента.

    python -m cherrybim.server --packages DIR --data DIR [--port 8099]

Один процесс отдаёт:
- /            просмотрщик (static/), относительные адреса — работает и под ingress HA;
- /api/...     двойник, поиск, вещи, документы (ссылки и локальные копии), живые состояния HA, свет и пылесос,
               фото → вещи, идеи (вариант «как будет», статус и заметки);
- /mcp         MCP (streamable HTTP, без сессий): найти, что внутри, положить, переложить, вычеркнуть, документы.
Вход только с адресов из --allow: под ingress это Supervisor и ядро HA.
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import ipaddress
import logging
import math
import os
import time
import uuid
import warnings
from pathlib import Path
from urllib.parse import quote

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from starlette.routing import Mount, Route, WebSocketRoute
from starlette.staticfiles import StaticFiles
from starlette.websockets import WebSocket, WebSocketDisconnect

from ..docs import DOC_TYPES, INHERITED, DocError, fetch, html_copy, sniff, title_of
from ..ideas import STATUSES
from ..kinds import lookup
from ..model import Kind, Privacy
from ..plan import render_plan
from ..twin import _norm, _stem
from .ha import HA, HAError
from .store import PLACE_KINDS, Store, StoreError

log = logging.getLogger("cherrybim.server")
STATIC = Path(__file__).parent / "static"
TOGGLE_DOMAINS = {"light", "switch", "fan"}          # что можно щёлкать из просмотрщика; замков тут нет
DEFAULT_ALLOW = "127.0.0.1/32,::1/128,172.30.32.1/32,172.30.32.2/32"   # аддон HA: ядро и Supervisor (ingress)
MAX_PHOTO = 12 * 2 ** 20
MAX_DOC = 50 * 2 ** 20
# копии, которые открываются во вкладке; остальное отдаётся только на скачивание (XML, офисные файлы, неизвестное)
DOC_INLINE = {"application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain", "text/html",
              "image/svg+xml"}
SHOW_WAIT = 3.0       # MCP-клиент HA обрывает вызов раньше 5 с (проверено 23.10.2026: 5,1 с — ошибка)
REL_RU = {"finishes": "где", "serves": "обслуживает", "feeds": "питает", "controls": "управляет", "supplied_by": "от"}

PHOTO_PROMPT = (
    "На фото — содержимое места хранения ({place}). Перечисли вещи, которые видны и которые потом будут искать. "
    "Называй так, как спросят вслух: «косметичка», «ватные палочки», «шампунь», «дрель-шуруповёрт», а не "
    "«мешок фиолетовый» или «флакон синий». Именительный падеж, по-русски, с главным признаком, если он виден "
    "(марка, размер, цвет): «Дрель-шуруповёрт Bosch», «Батарейки AA». Похожие мелочи объединяй и пиши количество: "
    "«Кабели USB-C (3 шт.)». Вещь видна частично — тоже назови. Не выдумывай того, чего не видно. "
    "Если вещей нет или фото не про хранение, верни пустой список.")


class _Static(StaticFiles):
    """Статика с проверкой свежести на каждый запрос (ETag → 304): после обновления аддона
    браузер не держит старый app.js."""

    def file_response(self, *args, **kwargs):
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = "no-cache"
        return resp


# ── сборка приложения ────────────────────────────────────────────────────────
class Server:
    def __init__(self, store: Store, ha: HA, media_dir: str | None = None, ai_task: str | None = None,
                 mcp_name: str = "cherrybim", allow: str = DEFAULT_ALLOW, show_script: str | None = None):
        self.store, self.ha = store, ha
        self.media_dir = Path(media_dir) if media_dir else None
        self.ai_task = ai_task
        self.show_script = show_script     # скрипт HA, который выводит картинку из медиа на экран (ТВ)
        self.allow = [ipaddress.ip_network(n.strip(), strict=False) for n in allow.split(",") if n.strip()]
        self.clients: set[asyncio.Queue] = set()
        self.loop: asyncio.AbstractEventLoop | None = None
        self.vacuum = None                    # (entity, camera_id, frame_id, affine) или None
        self.mcp = self._build_mcp(mcp_name)
        store.listeners.append(self._twin_changed)
        ha.listeners.append(self._state_changed)
        self._find_vacuum()

    # ── живые события в браузеры ────────────────────────────────────────────
    def _push(self, msg: dict) -> None:
        if not self.loop:
            return
        for q in list(self.clients):
            self.loop.call_soon_threadsafe(q.put_nowait, msg)

    def _twin_changed(self) -> None:
        self._find_vacuum()
        watch = self.store.bound_entities()
        if watch != self.ha.watch:                        # пакет пересобрали с новыми привязками
            self.ha.watch = watch
            if self.loop and self.ha.connected:
                self.loop.call_soon_threadsafe(lambda: asyncio.ensure_future(self._rewatch()))
        self._push({"type": "twin", "version": self.store.version})

    async def _rewatch(self) -> None:
        try:
            await self.ha.refresh()
        except HAError as e:
            log.warning("HA: %s", e)
        self._push({"type": "states", "states": self.states(), "ha": self.ha_status()})

    async def _state_changed(self, eid, state) -> None:
        if eid is None:
            self._push({"type": "states", "states": self.states(), "ha": self.ha_status()})
        else:
            self._push({"type": "state", "id": eid, "s": self._decorate(eid, state)})

    def ha_status(self) -> dict:
        return {"enabled": bool(self.ha.url and self.ha.token), "connected": self.ha.connected,
                "rejected": self.ha.rejected}

    def states(self) -> dict:
        return {k: self._decorate(k, v) for k, v in self.ha.states.items()}

    # ── пылесос: координаты робота ↔ участок ────────────────────────────────
    def _find_vacuum(self) -> None:
        self.vacuum = None
        t = self.store.twin
        for e in t.visible_to(self.store.audience):
            aff = e.bind.get("dreame.affine")
            if e.kind == Kind.device and aff and e.bind.get("dreame.camera"):
                frame = t.by_id.get(aff["frame"]) or t.by_key.get(aff["frame"])
                if frame:
                    self.vacuum = (e, e.bind["dreame.camera"], frame.id, aff)
                    return

    def _robot_to_site(self, x: float, y: float, a: float | None) -> list[float]:
        e, _, frame, aff = self.vacuum
        (a0, a1, a2), (b0, b1, b2) = aff["X"], aff["Y"]
        det = a0 * b1 - a1 * b0
        if not det:
            raise ValueError("вырожденная привязка карты робота (dreame.affine)")
        fx = (b1 * (x - a2) - a1 * (y - b2)) / det       # обратная к X = a0·x + a1·y + a2, Y = b0·x + b1·y + b2
        fy = (a0 * (y - b2) - b0 * (x - a2)) / det
        sx, sy, sz = self.store.twin.to_site(frame, [(fx, fy, 0.0)])[0]
        yaw = None
        if a is not None:
            dx, dy = math.cos(math.radians(a)), math.sin(math.radians(a))
            ux, uy = (b1 * dx - a1 * dy) / det, (a0 * dy - b0 * dx) / det
            m = self.store.twin.matrix(frame)
            yaw = math.degrees(math.atan2(uy, ux) + math.atan2(m[1][0], m[0][0]))
        return [round(sx, 3), round(sy, 3), round(sz, 3), None if yaw is None else round(yaw, 1)]

    def _site_to_robot(self, sx: float, sy: float) -> tuple[int, int]:
        _, _, frame, aff = self.vacuum
        m = self.store.twin.matrix(frame)
        dx, dy = sx - m[0][3], sy - m[1][3]
        fx, fy = m[0][0] * dx + m[1][0] * dy, m[0][1] * dx + m[1][1] * dy   # поворот обратно (транспонированная)
        (a0, a1, a2), (b0, b1, b2) = aff["X"], aff["Y"]
        return round(a0 * fx + a1 * fy + a2), round(b0 * fx + b1 * fy + b2)

    def _decorate(self, eid: str, state: dict | None) -> dict | None:
        if state and self.vacuum and eid == self.vacuum[1]:
            pos = state.get("attributes", {}).get("vacuum_position")
            if pos:
                try:
                    state = dict(state, pose=self._robot_to_site(pos["x"], pos["y"], pos.get("a")))
                except (KeyError, TypeError, ValueError) as e:      # кривая привязка не должна ронять /api/twin
                    log.debug("пылесос: %s", e)
        return state

    # ── HTTP ─────────────────────────────────────────────────────────────────
    async def index(self, request: Request):
        return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})

    async def api_twin(self, request: Request):
        idea = request.query_params.get("idea")             # вариант «как будет» по идее
        try:
            snap = self.store.idea_snapshot(idea) if idea else self.store.snapshot()
        except StoreError as e:
            return JSONResponse({"error": str(e)}, status_code=404 if str(e).startswith("нет идеи") else 400)
        snap["ha"] = self.ha_status()
        snap["features"] = {"photos": bool(self.media_dir and self.ai_task and self.ha.enabled),
                            "vacuum": bool(self.vacuum and self.ha.enabled), "toggle": self.ha.enabled,
                            "show": self.can_show, "docs": True, "ideas": self.store.ideas_count()}
        snap["doc_types"] = DOC_TYPES
        snap["doc_inherited"] = sorted(INHERITED)
        snap["states"] = self.states()
        return JSONResponse(snap)

    async def api_search(self, request: Request):
        q = request.query_params.get("q", "")
        kinds = {Kind(k) for k in request.query_params.get("kinds", "").split(",") if k in Kind.__members__}
        try:
            limit = max(1, min(int(request.query_params.get("limit", 12)), 200))
        except ValueError:
            return JSONResponse({"error": "limit — целое число"}, status_code=400)
        return JSONResponse(self.store.search(q, kinds or None, limit=limit))

    async def api_place(self, request: Request):
        return self._guard(lambda: self.store.contents(request.path_params["ref"]))

    async def api_items(self, request: Request):
        body = await _json_body(request)
        if body is None:
            return _bad_json()
        by = _user(request)
        if request.method == "POST":
            return self._guard(lambda: _item(self.store.add_item(body.get("name", ""), body.get("place", ""),
                                                                  qty=body.get("qty"), note=body.get("note"),
                                                                  tags=body.get("tags"), by=by,
                                                                  origin=body.get("origin", "manual"))))
        ref = request.path_params["ref"]

        def patch():
            e = self.store.update_item(ref, **{k: body[k] for k in ("name", "qty", "note", "tags", "aliases", "ids")
                                               if k in body})
            if body.get("place"):
                e = self.store.move_item(e.id, body["place"], by=by)
            return _item(e)
        return self._guard(patch)

    async def api_item_delete(self, request: Request):
        return self._guard(lambda: {"removed": self.store.remove_item(request.path_params["ref"], by=_user(request))})

    async def api_ideas(self, request: Request):
        return JSONResponse({"ideas": self.store.ideas_list(), "statuses": STATUSES})

    async def api_idea_set(self, request: Request):
        body = await request.json()
        return self._guard(lambda: self.store.set_idea(request.path_params["key"], status=body.get("status"),
                                                       note=body.get("note"), by=_user(request)))

    async def api_states(self, request: Request):
        return JSONResponse({"ha": self.ha_status(), "states": self.states()})

    async def api_call(self, request: Request):
        body = await _json_body(request)
        if body is None:
            return _bad_json()
        eid, service = body.get("entity_id", ""), body.get("service", "toggle")
        if not isinstance(eid, str) or eid.split(".")[0] not in TOGGLE_DOMAINS or eid not in self.store.bound_entities() \
                or service not in ("toggle", "turn_on", "turn_off"):
            return JSONResponse({"error": "эту сущность отсюда переключать нельзя"}, status_code=403)
        try:
            await self.ha.call(eid.split(".")[0], service, {"entity_id": eid})
        except HAError as e:
            return JSONResponse({"error": str(e)}, status_code=502)
        return JSONResponse({"ok": True})

    async def api_vacuum(self, request: Request):
        if not self.vacuum:
            return JSONResponse({"error": "пылесос не привязан"}, status_code=404)
        body = await _json_body(request)
        if body is None:
            return _bad_json()
        vac = self.vacuum[0].bind["ha.entity"]
        vac = vac[0] if isinstance(vac, list) else vac
        do = body.get("do")
        try:
            if do == "clean":
                space = self.store.resolve(body.get("space", ""), {Kind.space})
                seg = space.bind.get("dreame.segment")
                if not seg:
                    return JSONResponse({"error": f"у «{space.name}» нет комнаты на карте робота"}, status_code=400)
                await self.ha.call("dreame_vacuum", "vacuum_clean_segment", {"entity_id": vac, "segments": seg})
            elif do in ("goto", "spot"):
                try:
                    at = [float(v) for v in body["at"][:2]]
                    if len(at) != 2 or not all(math.isfinite(v) for v in at):
                        raise ValueError
                except (KeyError, TypeError, ValueError):
                    return JSONResponse({"error": "at: [x, y] в метрах участка"}, status_code=400)
                x, y = self._site_to_robot(*at)
                if do == "goto":
                    await self.ha.call("dreame_vacuum", "vacuum_goto", {"entity_id": vac, "x": x, "y": y})
                else:
                    await self.ha.call("dreame_vacuum", "vacuum_clean_spot", {"entity_id": vac, "points": [[x, y]]})
            elif do == "home":
                await self.ha.call("vacuum", "return_to_base", {"entity_id": vac})
            else:
                return JSONResponse({"error": "do: clean | goto | spot | home"}, status_code=400)
        except StoreError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        except HAError as e:
            return JSONResponse({"error": str(e)}, status_code=502)
        return JSONResponse({"ok": True})

    # ── документы ────────────────────────────────────────────────────────────
    async def api_doc_file(self, request: Request):
        """Локальная копия документа. Под ingress она открывается с адреса самого HA, поэтому ничто из копии не
        должно выполняться: страница и SVG — в песочнице (скрипты не запускаются, чужой источник), PDF, картинки
        и текст — как есть, всё остальное — только скачать."""
        try:
            path, mime, name = self.store.doc_file(request.path_params["ref"])
        except StoreError as e:
            return JSONResponse({"error": str(e)}, status_code=404)
        inline = mime in DOC_INLINE and not request.query_params.get("dl")
        headers = {"Content-Disposition": f"{'inline' if inline else 'attachment'}; filename*=UTF-8''{quote(name)}",
                   "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600"}
        if mime != "application/pdf":                    # встроенный просмотрщик PDF в песочнице не открывается
            headers["Content-Security-Policy"] = "sandbox"
        return FileResponse(path, media_type=mime, headers=headers)

    async def api_mesh(self, request: Request):
        """Готовая модель сущности (GLB). ?idea= — сущность из варианта идеи."""
        try:
            path = self.store.mesh_file(request.path_params["ref"], request.query_params.get("idea") or None)
        except StoreError as e:
            return JSONResponse({"error": str(e)}, status_code=404)
        return FileResponse(path, media_type="model/gltf-binary",
                            headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"})

    async def api_docs_of(self, request: Request):
        return self._guard(lambda: self.store.docs_of(request.path_params["ref"]))

    async def api_doc_add(self, request: Request):
        """Добавить документ: тело — файл (тип в Content-Type, имя в ?filename=) или JSON {to, title, type, url,
        note, copy}. copy — скачать копию по ссылке (PDF и картинки как есть, страницу — HTML-копией)."""
        q = request.query_params
        ctype = request.headers.get("content-type", "").split(";")[0].strip().lower()
        if ctype == "application/json" and "filename" not in q:     # файл .json из панели — это файл, а не запрос
            try:
                body = await request.json()
            except ValueError:
                body = None
            if not isinstance(body, dict):
                return JSONResponse({"error": "нужен JSON-объект {to, title, type, url, copy}"}, status_code=400)
            data, filename, mime = None, None, None
        else:
            data = await _read_body(request, MAX_DOC)
            if data is None:
                return JSONResponse({"error": f"файл больше {MAX_DOC // 2 ** 20} МБ"}, status_code=400)
            body, filename, mime = dict(q), q.get("filename") or None, ctype or None
            if filename and not data:
                return JSONResponse({"error": "пустой файл"}, status_code=400)
            data = data or None                                       # ссылка параметрами, без тела
        to, url = body.get("to", ""), (str(body.get("url") or "")).strip() or None
        title, extra = str(body.get("title") or "").strip(), {}
        if not data and url and str(body.get("copy", "")).lower() in ("1", "true", "yes", "on"):
            try:
                got, kind, final = await asyncio.to_thread(fetch, url)
            except DocError as e:
                return JSONResponse({"error": str(e)}, status_code=502)
            kind = sniff(got, kind) or kind                           # PDF, который сайт отдал как text/html
            if kind == "text/html":
                title = title or title_of(got, kind) or ""
                got = html_copy(got, final)
            data, filename, mime = got, filename or _name_from(final), kind
            extra["copy_of"] = final
        return self._guard(lambda: self.store.doc_info(self.store.add_doc(
            to, title, type=body.get("type") or ("page" if url else "note"), url=url, data=data,
            filename=filename, note=body.get("note"), by=_user(request), extra=extra, mime=mime)))

    async def api_doc_delete(self, request: Request):
        return self._guard(lambda: {"removed": self.store.remove_doc(request.path_params["ref"], by=_user(request))})

    async def api_photo(self, request: Request):
        """Фото места хранения → список вещей от ai_task (сохранять их будет пользователь)."""
        if not (self.media_dir and self.ai_task):
            return JSONResponse({"error": "распознавание фото не настроено"}, status_code=404)
        try:
            place = self.store.resolve(request.query_params.get("place", ""), PLACE_KINDS)
        except StoreError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        data = await _read_body(request, MAX_PHOTO)
        if not data:
            return JSONResponse({"error": "нужна картинка до 12 МБ"}, status_code=400)
        ext = {"image/png": "png", "image/webp": "webp"}.get(request.headers.get("content-type", ""), "jpg")
        name = f"{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}.{ext}"
        folder = self.media_dir / "photos"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / name).write_bytes(data)
        media_id = f"media-source://media_source/local/{self.media_dir.name}/photos/{name}"
        try:
            res = await self.ha.call("ai_task", "generate_data", {
                "task_name": "cherrybim photo", "entity_id": self.ai_task,
                "instructions": PHOTO_PROMPT.format(place=self.store.short_path(place.id)),
                "structure": {"items": {"description": "вещи на фото", "required": True,
                                        "selector": {"text": {"multiple": True}}}},
                "attachments": [{"media_content_id": media_id,
                                 "media_content_type": "image/" + ("jpeg" if ext == "jpg" else ext)}],
            }, response=True, timeout=120)
        except HAError as e:
            return JSONResponse({"error": str(e), "photo": media_id}, status_code=502)
        items = ((res or {}).get("data") or {}).get("items") or []
        if isinstance(items, str):
            items = [s.strip(" -•") for s in items.splitlines() if s.strip(" -•")]
        return JSONResponse({"place": place.id, "photo": media_id, "items": [str(i)[:120] for i in items][:60]})

    # ── план картинкой и показ на экране ────────────────────────────────────
    @property
    def can_show(self) -> bool:
        return bool(self.show_script and self.media_dir and self.ha.enabled)

    async def api_plan(self, request: Request):
        q = request.query_params
        try:
            ref = q.get("e")
            focus = self.store.resolve(ref).id if ref else None
            w = max(320, min(int(q.get("w", 1920)), 4096))
            h = max(240, min(int(q.get("h", 1080)), 4096))
            label = self.store.short_path(focus) if focus and q.get("label") else None
            png = render_plan(self.store.twin, focus, self.store.audience, size=(w, h),
                              theme=q.get("theme", "dark"), label=label)
        except (StoreError, ValueError) as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        return Response(png, media_type="image/png", headers={"Cache-Control": "no-cache"})

    async def show(self, ref: str) -> dict:
        """План с подсвеченным местом → медиа HA → скрипт показа (например, экран «Claude» на ТВ)."""
        if not self.can_show:
            return {"ok": False, "error": "показ на экране не настроен"}
        e = self.store.resolve(ref)
        png = render_plan(self.store.twin, e.id, self.store.audience, theme="dark")
        folder = self.media_dir / "show"
        folder.mkdir(parents=True, exist_ok=True)
        for old in sorted(folder.glob("*.png"))[:-20]:  # хватит последних двадцати
            old.unlink(missing_ok=True)
        name = f"{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}.png"
        (folder / name).write_bytes(png)
        script = self.show_script.split(".", 1)[-1]
        call = self.ha.call("script", script, {"put": f"{self.media_dir.name}/show/{name}", "zagolovok": e.name,
                                               "podpis": self.store.short_path(e.id)}, response=True, timeout=30)
        try:
            # дольше SHOW_WAIT подтверждения не ждём: скрипт в HA доработает сам, план уже в очереди
            res = await asyncio.wait_for(call, timeout=SHOW_WAIT)
        except asyncio.TimeoutError:
            return {"ok": True, "status": "sent", "what": self.store.short_path(e.id)}
        except HAError as err:
            return {"ok": False, "error": str(err)}
        res = res if isinstance(res, dict) else {}
        return {**res, "ok": bool(res.get("ok")), "what": self.store.short_path(e.id)}

    async def api_show(self, request: Request):
        body = await _json_body(request)
        if body is None:
            return _bad_json()
        try:
            return JSONResponse(await self.show(body.get("ref", "")))
        except (StoreError, ValueError) as e:
            return JSONResponse({"ok": False, "error": str(e)}, status_code=400)

    async def live(self, ws: WebSocket):
        if not self._allowed(ws.scope):
            await ws.close(code=1008)
            return
        await ws.accept()
        q: asyncio.Queue = asyncio.Queue(maxsize=500)
        self.clients.add(q)
        try:
            await ws.send_json({"type": "hello", "version": self.store.version, "ha": self.ha_status(),
                                "states": self.states()})
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=25)
                except asyncio.TimeoutError:
                    msg = {"type": "ping"}
                await ws.send_json(msg)
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            self.clients.discard(q)

    def _guard(self, fn):
        try:
            return JSONResponse(fn())
        except StoreError as e:
            return JSONResponse({"error": str(e)}, status_code=400)

    # ── MCP ──────────────────────────────────────────────────────────────────
    def _build_mcp(self, name: str) -> FastMCP:
        mcp = FastMCP(name, stateless_http=True, json_response=True,
                      transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
                      instructions="Учёт квартиры: где что лежит и стоит, отделка, инженерия. "
                                   "Сначала find, потом при необходимости contents.")
        st = self.store

        @mcp.tool()
        def find(query: str) -> str:
            """Где лежит или находится что-то в квартире и доме: вещь, место хранения (шкаф, ящик, полка,
            коробка), мебель, техника, отделка (обои, пол, плитка), розетки, автоматы и электрогруппы,
            трубы, краны, счётчики, узлы. Для «где лежит …», «где …», «какие обои …», «на каком автомате …».
            query — что ищем, можно с местом: «дрель», «ящик 2 в спальне», «узел отопления»."""
            hits = st.search(query, limit=6)
            if not hits:
                return f"Ничего не нашёл по «{query}». Можно записать вещь через add_item."
            return "\n".join(_describe(st, h, query) for h in hits)

        @mcp.tool()
        def contents(place: str) -> str:
            """Что лежит в месте хранения или комнате: шкаф, секция, ящик, полка, коробка, комната.
            place — словами («шкаф в спальне», «ящик 2») или id из find."""
            try:
                c = st.contents(place)
            except StoreError as e:
                return str(e)
            lines = [f"{c['place']['short']}:"]
            if c["places"]:
                lines.append("места внутри: " + ", ".join(p["name"] for p in c["places"]))
            lines.append("вещи: " + ("; ".join(f"{i['name']} ({i['short']})" for i in c["items"])
                                     if c["items"] else "не записано ни одной"))
            return "\n".join(lines)

        @mcp.tool()
        def add_item(name: str, place: str, qty: float | None = None, note: str | None = None,
                     by: str | None = None) -> str:
            """Записать, что вещь лежит в месте: «положил дрель во второй ящик шкафа в спальне».
            name — вещь в именительном падеже; place — место словами или id из find; qty — сколько штук;
            note — пояснение; by — кто положил, если известно."""
            try:
                e = st.add_item(name, place, qty=qty, note=note, by=by, origin="voice")
            except StoreError as err:
                return str(err)
            return f"Записал: {e.name} — {st.short_path(e.parent)}."

        @mcp.tool()
        def move_item(item: str, place: str, by: str | None = None) -> str:
            """Переложить уже записанную вещь в другое место. item — вещь словами или id; place — новое место."""
            try:
                e = st.move_item(item, place, by=by)
            except StoreError as err:
                return str(err)
            return f"Переложил: {e.name} — теперь {st.short_path(e.parent)}."

        @mcp.tool()
        async def show(what: str) -> str:
            """Показать на телевизоре план квартиры с подсвеченным местом: где лежит вещь, где шкаф или ящик,
            розетка, щиток, узел отопления. Для «покажи на телевизоре, где …», «покажи на экране …».
            what — что показать, словами или id из find."""
            try:
                r = await self.show(what)
            except (StoreError, ValueError) as err:
                return str(err)
            if r.get("ok") and r.get("status") == "sent":
                return f"Отправил на телевизор план: {r['what']}. Подтверждения от телевизора пока нет."
            if r.get("ok"):
                return f"Показал на телевизоре план: {r['what']}."
            if r.get("tv_no_answer"):
                return ("План отправлен на телевизор, но там не открыто приложение UmediaPlus, поэтому его не видно. "
                        "Это не ошибка, повторять вызов не нужно: скажи, что план появится, когда откроют UmediaPlus, "
                        "и назови место словами.")
            return "Не получилось показать: " + str(r.get("error") or "нет ответа")

        @mcp.tool()
        def documents(what: str) -> str:
            """Какие документы есть у вещи, мебели, техники или комнаты: инструкции, проект и чертежи, чеки,
            гарантии, договоры, страницы магазина. Для «где инструкция к посудомойке», «есть ли чертежи кухни»,
            «гарантия на холодильник». what — словами или id из find. Закрытые номера (IMEI, серийные) не выдаются."""
            try:
                r = st.docs_of(what)
            except StoreError as err:
                return str(err)

            def line(d: dict) -> str:
                meta = [d["ru"]] + ([f"{d['pages']} стр."] if d.get("pages") else []) + \
                       (["есть копия"] if d["copy"] else []) + ([f"ссылка {d['url']}"] if d.get("url") else [])
                return f"«{d['name']}» ({', '.join(meta)})"
            out = []
            if r["docs"]:
                out.append(f"Документы «{r['of']['name']}»: " + "; ".join(line(d) for d in r["docs"]))
            if r["parent"]:
                out.append(f"У «{r['parent']['name']}»: " + "; ".join(line(d) for d in r["parent"]["docs"]))
            return "\n".join(out) or f"У «{r['of']['name']}» документов не записано. Их добавляют в карточке на плане."

        @mcp.tool()
        def remove_item(item: str, by: str | None = None) -> str:
            """Вычеркнуть вещь из учёта: выбросили, отдали, закончилась. Запись можно вернуть из корзины."""
            try:
                return f"Вычеркнул: {st.remove_item(item, by=by)}."
            except StoreError as err:
                return str(err)

        return mcp

    # ── доступ по адресу ─────────────────────────────────────────────────────
    def _allowed(self, scope) -> bool:
        client = scope.get("client")
        if not client:
            return True                                  # тестовый клиент без адреса
        try:
            ip = ipaddress.ip_address(client[0])
        except ValueError:
            return False
        return any(ip in n for n in self.allow)

    def app(self) -> Starlette:
        mcp_app = self.mcp.streamable_http_app()
        routes = [
            Route("/", self.index),
            Route("/api/twin", self.api_twin),
            Route("/api/search", self.api_search),
            Route("/api/place/{ref:path}", self.api_place),
            Route("/api/items", self.api_items, methods=["POST"]),
            Route("/api/items/{ref}", self.api_items, methods=["PATCH"]),
            Route("/api/items/{ref}", self.api_item_delete, methods=["DELETE"]),
            Route("/api/ideas", self.api_ideas),
            Route("/api/ideas/{key}", self.api_idea_set, methods=["POST"]),
            Route("/api/states", self.api_states),
            Route("/api/call", self.api_call, methods=["POST"]),
            Route("/api/vacuum", self.api_vacuum, methods=["POST"]),
            Route("/api/photo", self.api_photo, methods=["POST"]),
            Route("/api/docs", self.api_doc_add, methods=["POST"]),
            Route("/api/docs/{ref}", self.api_doc_delete, methods=["DELETE"]),
            Route("/api/docs/{ref}", self.api_docs_of),
            Route("/api/doc/{ref}", self.api_doc_file),
            Route("/api/mesh/{ref}", self.api_mesh),
            Route("/api/plan.png", self.api_plan),
            Route("/api/show", self.api_show, methods=["POST"]),
            WebSocketRoute("/api/live", self.live),
            *mcp_app.routes,
            Mount("/static", _Static(directory=STATIC), name="static"),
        ]

        @contextlib.asynccontextmanager
        async def lifespan(app):
            self.loop = asyncio.get_running_loop()
            self.ha.start(self.store.bound_entities() | ({self.vacuum[1]} if self.vacuum else set()))
            async with self.mcp.session_manager.run():
                yield
            await self.ha.stop()

        inner = Starlette(routes=routes, lifespan=lifespan)
        server = self

        async def guard(scope, receive, send):           # ASGI: чужие адреса не доходят ни до чего
            if scope["type"] in ("http", "websocket") and not server._allowed(scope):
                if scope["type"] == "http":
                    await PlainTextResponse("forbidden", status_code=403)(scope, receive, send)
                else:
                    await send({"type": "websocket.close", "code": 1008})
                return
            await inner(scope, receive, send)
        return guard


def _bad_json() -> JSONResponse:
    return JSONResponse({"error": "нужен JSON-объект"}, status_code=400)


async def _json_body(request: Request) -> dict | None:
    """Тело запроса как JSON-объект; кривой JSON или не объект — None (ответ 400, а не 500)."""
    try:
        body = await request.json()
    except ValueError:
        return None
    return body if isinstance(body, dict) else None


async def _read_body(request: Request, limit: int) -> bytes | None:
    """Тело запроса не больше limit байт; больше — None, не дочитывая всё в память."""
    size = request.headers.get("content-length", "")
    if size.isdigit() and int(size) > limit:
        return None
    buf = bytearray()
    async for chunk in request.stream():
        buf += chunk
        if len(buf) > limit:
            return None
    return bytes(buf)


def _user(request: Request) -> str | None:
    """Кто правит: под ingress HA передаёт имя пользователя в заголовке."""
    name = request.headers.get("x-remote-user-display-name") or request.headers.get("x-remote-user-name")
    if name:
        try:
            return name.encode("latin-1").decode("utf-8")   # заголовки приходят байтами UTF-8
        except (UnicodeDecodeError, UnicodeEncodeError):
            return name
    return None


def _item(e) -> dict:
    return {"id": e.id, "name": e.name, "parent": e.parent, "props": e.props}


def _name_from(url: str) -> str:
    """Имя файла копии по адресу: последняя часть пути (не имя сайта) или «stranitsa». Расширение поправит
    store_file по содержимому: PDF с download.php ляжет как .pdf."""
    path = url.split("#")[0].split("?")[0].split("//", 1)[-1].partition("/")[2]
    return path.rstrip("/").rsplit("/", 1)[-1] or "stranitsa"


def _describe(st: Store, h: dict, query: str = "") -> str:
    e = st.twin.by_id[h["id"]]
    ru = lookup(e.kind, e.type)[0]
    props = [(k, v) for k, v in e.props.items() if isinstance(v, (str, int, float)) and not isinstance(v, bool)
             and len(str(v)) < 300 and k not in ("file", "sha256", "mime", "size")]
    # у ПК полтора десятка свойств: про что спросили («водянка», «блок питания»), то и попадает в первые 8
    toks = [_stem(t) for t in _norm(query).split() if len(t) > 2]
    hit = lambda k, v: any(w.startswith(t) for w in _norm(f"{k} {v}").split() for t in toks)  # noqa: E731
    props = [f"{k}: {v}" for k, v in sorted(props, key=lambda kv: not hit(*kv))][:8]
    line = f"{e.name} ({ru}) — {h['short']}"
    rel = {}
    for r in e.refs:                                     # «обои — где: Офис, Спальня», «Гр.3 — обслуживает: Кухня»
        if r.rel in REL_RU and r.to in st.visible:       # закрытое не называется даже связью
            rel.setdefault(REL_RU[r.rel], []).append(st.twin.by_id[r.to].name)
    if rel:
        line += ". " + "; ".join(f"{k}: {', '.join(v)}" for k, v in rel.items())
    if props:
        line += ". " + "; ".join(props)
    if e.kind in (Kind.storage, Kind.furniture):
        n = sum(1 for k in st.twin.children(e.id) if k.kind == Kind.item and k.id in st.visible)
        if n:
            line += f". Внутри записано вещей: {n}"
    docs = sum(1 for d in st.docs_by.get(e.id, []) if d.id != e.id)   # docs_by — только видимые
    if docs:
        line += f". Документов: {docs} (инструмент documents)"
    return line + f" [id {e.id}]"


# ── запуск ───────────────────────────────────────────────────────────────────
def main(argv=None) -> None:
    ap = argparse.ArgumentParser(prog="cherrybim.server", description=__doc__.split("\n")[0])
    env = os.environ.get
    ap.add_argument("--packages", default=env("CHERRYBIM_PACKAGES", "packages"), help="папка с *.twin.json")
    ap.add_argument("--data", default=env("CHERRYBIM_DATA", "data"), help="папка для вещей (items.twin.json)")
    ap.add_argument("--media", default=env("CHERRYBIM_MEDIA"), help="папка медиа HA для фото (/media/cherrybim)")
    ap.add_argument("--docs", default=env("CHERRYBIM_DOCS"), help="папка копий документов (по умолчанию DATA/docs)")
    ap.add_argument("--ideas", default=env("CHERRYBIM_IDEAS"), help="папка идей *.idea.json (по умолчанию DATA/ideas)")
    ap.add_argument("--assets", default=env("CHERRYBIM_ASSETS"),
                    help="папка готовых 3D-моделей *.glb (по умолчанию DATA/assets)")
    ap.add_argument("--ai-task", default=env("CHERRYBIM_AI_TASK"), help="сущность ai_task для фото → вещи")
    ap.add_argument("--audience", default=env("CHERRYBIM_AUDIENCE", "household"), choices=[p.value for p in Privacy])
    ap.add_argument("--host", default=env("CHERRYBIM_HOST", "0.0.0.0"))
    ap.add_argument("--port", type=int, default=int(env("CHERRYBIM_PORT", "8099")))
    ap.add_argument("--allow", default=env("CHERRYBIM_ALLOW", DEFAULT_ALLOW), help="разрешённые сети через запятую")
    ap.add_argument("--mcp-name", default=env("CHERRYBIM_MCP_NAME", "cherrybim"))
    ap.add_argument("--show-script", default=env("CHERRYBIM_SHOW_SCRIPT"),
                    help="скрипт HA для показа картинки на экране: поля put (путь в медиа), zagolovok, podpis")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    warnings.filterwarnings("ignore", message=".*incomplete definition.*")    # шум pydantic-settings из mcp
    store = Store(a.packages, a.data, Privacy(a.audience), docs_dir=a.docs, ideas_dir=a.ideas, assets_dir=a.assets)
    srv = Server(store, HA(), media_dir=a.media, ai_task=a.ai_task, mcp_name=a.mcp_name, allow=a.allow,
                 show_script=a.show_script)
    log.info("пакетов %d, сущностей %d, вещей %d", len(store.base), len(store.twin.by_id), len(store.items.entities))
    import uvicorn
    uvicorn.run(srv.app(), host=a.host, port=a.port, log_config=None, access_log=False, timeout_graceful_shutdown=3,
                ws="websockets-sansio" if _has_sansio() else "auto")


def _has_sansio() -> bool:
    try:
        import uvicorn.protocols.websockets.websockets_sansio_impl  # noqa: F401
        return True
    except ImportError:
        return False


if __name__ == "__main__":
    main()
