# -*- coding: utf-8 -*-
"""Связь с Home Assistant: кэш состояний привязанных сущностей, события, вызов служб.

В аддоне HA адрес и токен даёт Supervisor (SUPERVISOR_TOKEN, http://supervisor/core).
Вне аддона — переменные HA_URL и HA_TOKEN. Без них сервер работает и без HA.

Токен, на который HA ответил 401 или auth_invalid, второй раз не отправляется:
несколько неудачных входов подряд банят адрес (ip_ban_enabled).
"""
from __future__ import annotations

import asyncio
import inspect
import json
import logging
import os

import httpx
import websockets

log = logging.getLogger("cherrybim.ha")


class HAError(RuntimeError):
    pass


class HA:
    def __init__(self, url: str | None = None, token: str | None = None):
        sup = os.environ.get("SUPERVISOR_TOKEN")
        self.url = (url or os.environ.get("HA_URL") or ("http://supervisor/core" if sup else "")).rstrip("/")
        self.token = token or os.environ.get("HA_TOKEN") or sup
        if self.url.endswith("/core"):                       # Supervisor: /core/api и /core/websocket
            self.ws_url = self.url.replace("http", "ws", 1) + "/websocket"
        else:
            self.ws_url = self.url.replace("http", "ws", 1) + "/api/websocket"
        self.watch: set[str] = set()
        self.states: dict[str, dict] = {}
        self.listeners: list = []          # async (entity_id, state | None)
        self.connected = False
        self.rejected = False
        self._http: httpx.AsyncClient | None = None
        self._task: asyncio.Task | None = None

    @property
    def enabled(self) -> bool:
        return bool(self.url and self.token) and not self.rejected

    # ── REST ─────────────────────────────────────────────────────────────────
    def _client(self) -> httpx.AsyncClient:
        if self._http is None:
            # trust_env=False: HA в локальной сети, системный прокси ему не нужен
            self._http = httpx.AsyncClient(base_url=self.url, timeout=20, trust_env=False,
                                           headers={"Authorization": f"Bearer {self.token}"})
        return self._http

    async def rest(self, method: str, path: str, payload=None, timeout: float = 20):
        if not self.enabled:
            raise HAError("нет связи с Home Assistant" + (" (токен отклонён)" if self.rejected else ""))
        r = await self._client().request(method, "/api" + path, json=payload, timeout=timeout)
        if r.status_code == 401:
            self.rejected = True
            log.error("HA отклонил токен; больше его не шлю")
            raise HAError("токен отклонён")
        if r.status_code >= 400:
            raise HAError(f"HA {r.status_code}: {r.text[:200]}")
        return r.json() if r.content else None

    async def call(self, domain: str, service: str, data: dict | None = None, response: bool = False,
                   timeout: float = 20):
        path = f"/services/{domain}/{service}" + ("?return_response" if response else "")
        res = await self.rest("POST", path, data or {}, timeout=timeout)
        return res.get("service_response") if response and isinstance(res, dict) else res

    async def refresh(self) -> None:
        for s in await self.rest("GET", "/states"):
            if s["entity_id"] in self.watch:
                self.states[s["entity_id"]] = _slim(s)

    # ── WebSocket: state_changed ─────────────────────────────────────────────
    def start(self, watch: set[str]) -> None:
        self.watch = set(watch)
        if self.enabled and self._task is None:
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            self._task = None
        if self._http:
            await self._http.aclose()
            self._http = None

    async def _run(self) -> None:
        delay = 5
        while self.enabled:
            try:
                await self._session()
                delay = 5
            except asyncio.CancelledError:
                raise
            except Exception as e:                     # сеть, перезапуск HA
                log.warning("HA websocket: %s", e)
            self.connected = False
            if not self.enabled:
                break
            await asyncio.sleep(delay)
            delay = min(delay * 2, 60)

    async def _session(self) -> None:
        kw = {"max_size": 16 * 2 ** 20, "open_timeout": 15}
        if "proxy" in inspect.signature(websockets.connect).parameters:
            kw["proxy"] = None                         # websockets ≥15 иначе берёт прокси из окружения
        async with websockets.connect(self.ws_url, **kw) as ws:
            hello = json.loads(await ws.recv())
            if hello.get("type") == "auth_required":
                await ws.send(json.dumps({"type": "auth", "access_token": self.token}))
                res = json.loads(await ws.recv())
                if res.get("type") != "auth_ok":
                    self.rejected = True
                    log.error("HA websocket: %s; больше токен не шлю", res.get("type"))
                    return
            await ws.send(json.dumps({"id": 1, "type": "subscribe_events", "event_type": "state_changed"}))
            await self.refresh()
            self.connected = True
            log.info("HA: на связи, слежу за %d сущностями", len(self.watch))
            await self._emit(None, None)               # «всё обновилось»
            async for raw in ws:
                msg = json.loads(raw)
                if msg.get("type") != "event":
                    continue
                d = msg["event"]["data"]
                eid = d.get("entity_id")
                if eid not in self.watch:
                    continue
                new = d.get("new_state")
                if new is None:
                    self.states.pop(eid, None)
                else:
                    self.states[eid] = _slim(new)
                await self._emit(eid, self.states.get(eid))

    async def _emit(self, eid, state) -> None:
        for cb in list(self.listeners):
            try:
                await cb(eid, state)
            except Exception as e:
                log.debug("слушатель: %s", e)


_KEEP = {"friendly_name", "brightness", "current_temperature", "temperature", "hvac_action", "fan_mode",
         "media_title", "media_artist", "app_name", "battery_level", "status", "vacuum_position",
         "charger_position", "unit_of_measurement", "device_class", "icon", "current_position", "fan_speed"}


def _slim(s: dict) -> dict:
    """Только то, что нужно просмотрщику: огромные атрибуты карты пылесоса не гоняем."""
    a = s.get("attributes", {})
    return {"state": s.get("state"), "changed": s.get("last_changed"),
            "attributes": {k: v for k, v in a.items() if k in _KEEP}}
