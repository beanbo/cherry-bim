# -*- coding: utf-8 -*-
"""Хранилище сервера: пакеты двойника только для чтения + пакет вещей, который правится.

Пакеты (*.twin.json) лежат в packages_dir и меняются только пересборкой. Вещи (kind item) и документы,
добавленные из просмотрщика (kind document), живут в data_dir/items.twin.json: их добавляют, переносят и
удаляют через API, MCP и голос. Файлы документов — в docs_dir (по умолчанию data_dir/docs), пакет хранит путь.
Идеи (*.idea.json, ideas.py) — в ideas_dir (по умолчанию data_dir/ideas): их кладут файлами, сервер только читает и
собирает вариант «как будет»; статус и заметки хозяев — в ideas_dir/state.json.
Готовые 3D-модели (geom mesh, GLB из cherrybim.io_mesh) — в assets_dir (по умолчанию data_dir/assets): пакет хранит
путь внутри неё, сервер отдаёт файл только видимой сущности.
Запись атомарная (временный файл + замена), каждая правка поднимает version.
"""
from __future__ import annotations

import json
import os
import threading
import time
import uuid
from pathlib import Path

from ..docs import DOC_TYPES, INHERITED, DocError, mime_of, pdf_pages, resolve_file, store_file
from ..ideas import STATUSES, Idea, IdeaError, Variant
from ..ideas import apply as apply_idea
from ..kinds import lookup
from ..model import PRIVACY_RANK, Entity, Kind, Package, Privacy, Ref, Source
from ..twin import Twin

ITEMS_FILE = "items.twin.json"
TRASH_FILE = "trash.jsonl"
IDEA_GLOB = "*.idea.json"
IDEA_STATE = "state.json"
PLACE_KINDS = {Kind.storage, Kind.furniture, Kind.space, Kind.unit, Kind.item}   # куда можно положить вещь


class StoreError(ValueError):
    """Понятная пользователю ошибка: не найдено место, неоднозначно, нельзя менять."""


class Store:
    def __init__(self, packages_dir: str | Path, data_dir: str | Path, audience: Privacy = Privacy.household,
                 docs_dir: str | Path | None = None, ideas_dir: str | Path | None = None,
                 assets_dir: str | Path | None = None):
        self.packages_dir = Path(packages_dir)
        self.data_dir = Path(data_dir)
        self.docs_dir = Path(docs_dir) if docs_dir else self.data_dir / "docs"
        self.ideas_dir = Path(ideas_dir) if ideas_dir else self.data_dir / "ideas"
        self.assets_dir = Path(assets_dir) if assets_dir else self.data_dir / "assets"
        self.audience = audience
        self.lock = threading.RLock()
        self.version = 0
        self.visible: set[str] = set()   # id всего, что видит аудитория; пересчитывается в _rebuild
        self.listeners: list = []        # функции без аргументов: зовутся после каждой правки
        self.ideas: dict[str, dict] = {}     # ключ → {file, idea} или {file, error}
        self.ideas_stamp: tuple | None = None
        self.variants: dict[str, tuple[int, Variant]] = {}   # ключ → (version двойника, вариант)
        self.reload()

    # ── загрузка ─────────────────────────────────────────────────────────────
    def reload(self) -> None:
        with self.lock:
            files = self._package_files()
            self.base = [Package.model_validate(json.loads(p.read_text(encoding="utf-8"))) for p in files]
            self.packages_stamp = self._stamp(files)
            self.items = self._load_items()
            self._rebuild()

    def _package_files(self) -> list[Path]:
        items = (self.data_dir / ITEMS_FILE).resolve()
        return [p for p in sorted(self.packages_dir.glob("*.twin.json")) if p.resolve() != items]

    @staticmethod
    def _stamp(files) -> tuple:
        return tuple((p.name, p.stat().st_mtime) for p in files)

    def _mtime(self) -> float | None:
        try:
            return (self.data_dir / ITEMS_FILE).stat().st_mtime
        except OSError:
            return None

    def _check_items_file(self) -> None:
        """Файлы поменяли снаружи: пакеты пересобрали, вещи поправили руками (Samba, git) — перечитать,
        а не затереть своей копией."""
        try:
            fresh = self._stamp(self._package_files()) != self.packages_stamp
        except OSError:
            fresh = False
        if fresh:
            self.reload()
            self._notify()
        elif self._mtime() != self.items_mtime:
            self.items = self._load_items()
            self._rebuild()
            self._notify()

    def _load_items(self) -> Package:
        f = self.data_dir / ITEMS_FILE
        self.items_mtime = self._mtime()
        if f.exists():
            return Package.model_validate(json.loads(f.read_text(encoding="utf-8")))
        private = [p for p in self.base if p.privacy != Privacy.public] or self.base
        root = private[-1].root if private else ""
        return Package(id=str(uuid.uuid4()), name="Вещи", root=root, privacy=Privacy.household,
                       requires=[p.id for p in self.base], entities=[])

    def _rebuild(self) -> None:
        self.twin = Twin(self.base + [self.items])
        vis = self.twin.visible_to(self.audience)
        self.visible = {e.id for e in vis}
        # id сущности → документы: дети вида document и связи documents. Только видимые аудитории: иначе find
        # сказал бы голосом «документов: 1» про закрытый чек, которого documents не покажет
        self.docs_by: dict[str, list[Entity]] = {}
        for d in vis:
            if d.kind != Kind.document:
                continue
            for t in {d.parent, *(r.to for r in d.refs if r.rel == "documents")} - {None}:
                self.docs_by.setdefault(t, []).append(d)
        self.version += 1

    def _save(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        f = self.data_dir / ITEMS_FILE
        tmp = f.with_suffix(".tmp")
        tmp.write_text(self.items.model_dump_json(by_alias=True, exclude_none=True, indent=1), encoding="utf-8")
        os.replace(tmp, f)
        self.items_mtime = self._mtime()
        self._rebuild()
        self._notify()

    def _notify(self) -> None:
        for cb in list(self.listeners):
            try:
                cb()
            except Exception:       # слушатель не должен ломать запись
                pass

    # ── чтение ───────────────────────────────────────────────────────────────
    def snapshot(self) -> dict:
        """Всё, что видит аудитория, с готовыми матрицами и путями — для просмотрщика."""
        with self.lock:
            self._check_items_file()
            return self._snapshot(self.twin)

    def _snapshot(self, t: Twin, marks: dict[str, str] | None = None) -> dict:
        """Снимок двойника t. marks — вариант идеи: у сущностей пометка idea (add, change, remove), правка вещей
        из просмотра варианта не идёт (он показывает «как будет», а не учёт)."""
        ents = []
        for e in t.visible_to(self.audience):
            d = e.model_dump(mode="json", by_alias=True, exclude_none=True)
            d["m"] = t.matrix(e.id)
            d["path"] = t.path(e.id)
            d["editable"] = marks is None and e.kind in (Kind.item, Kind.document) and t.pkg_of[e.id] is self.items
            d["ru"] = lookup(e.kind, e.type)[0]
            if e.kind == Kind.document:          # копия правда лежит в папке документов (пакет могли выложить раньше)
                d["copy"] = bool(e.props.get("file")) and self._copy_exists(e.props["file"])
            if marks and e.id in marks:
                d["idea"] = marks[e.id]
            ents.append(d)
        return {"version": self.version, "georef": t.georef.model_dump() if t.georef else None,
                "packages": [{"id": p.id, "name": p.name, "root": p.root} for p in self.base],
                "entities": ents}

    def bound_entities(self) -> set[str]:
        """entity_id HA, к которым привязан двойник (для живых состояний); sun.sun — небо за окнами по времени суток."""
        out = {"sun.sun"}
        with self.lock:
            for e in self.twin.visible_to(self.audience):
                for k, v in e.bind.items():
                    if k in ("ha.entity", "dreame.camera"):
                        out.update(v if isinstance(v, list) else [v])
        return out

    def short_path(self, ref: str) -> str:
        """Путь для голоса: внутри квартиры — от комнаты, снаружи — без квартала."""
        chain = [self.twin.get(ref)] + self.twin.ancestors(ref)
        unit = next((i for i, a in enumerate(chain) if a.kind == Kind.unit), None)
        if unit is not None and unit > 0:
            chain = chain[:unit]
        elif len(chain) > 1 and chain[-1].kind == Kind.site:
            chain = chain[:-1]
        return " → ".join(a.name for a in reversed(chain))

    def search(self, query: str, kinds: set[Kind] | None = None, limit: int = 8) -> list[dict]:
        with self.lock:
            self._check_items_file()
            out = []
            ranked = self.twin.rank(query, self.audience, complete=True)     # нашлись все слова запроса
            for sc, e in ranked or self.twin.rank(query, self.audience):     # иначе — что нашлось частично
                if kinds and e.kind not in kinds:
                    continue
                out.append({"id": e.id, "key": e.key, "kind": e.kind.value, "type": e.type, "name": e.name,
                            "path": self.twin.path(e.id), "short": self.short_path(e.id), "score": sc})
                if len(out) >= limit:
                    break
            return out

    def resolve(self, ref: str, kinds: set[Kind] | None = None) -> Entity:
        """id, key или слова → одна сущность; иначе StoreError (не нашёл / какой из них)."""
        with self.lock:
            self._check_items_file()
            e = self.twin.by_id.get(ref) or self.twin.by_key.get(ref)
            if e is not None and e.id in self.visible and (not kinds or e.kind in kinds):   # закрытое и по id не найти
                return e
            ranked = [(s, e) for s, e in self.twin.rank(ref, self.audience, complete=True)
                      if not kinds or e.kind in kinds]
            if not ranked:
                near = [e.name for s, e in self.twin.rank(ref, self.audience) if not kinds or e.kind in kinds][:3]
                raise StoreError(f"не нашёл «{ref}»" + (f"; похожие: {', '.join(near)}" if near else ""))
            ties = [e for s, e in ranked if s == ranked[0][0]]
            if not kinds and len(ties) > 1:      # «шкаф» — сам шкаф, а не «Проект шкафа»
                ties = [e for e in ties if e.kind != Kind.document] or ties
            if len(ties) > 1:
                raise StoreError("уточни, какой именно: " + "; ".join(self.short_path(e.id) for e in ties[:5]))
            return ties[0]

    def contents(self, ref: str) -> dict:
        """Что внутри места: дочерние места хранения и вещи (вещи — со вложенными). Только видимое аудитории."""
        with self.lock:
            place = self.resolve(ref)
            kids = [k for k in self.twin.children(place.id) if k.id in self.visible]

            def items_under(pid: str, depth: int = 0) -> list[dict]:
                res = []
                for k in self.twin.children(pid):
                    if k.id not in self.visible:
                        continue
                    if k.kind == Kind.item:
                        res.append({"id": k.id, "name": k.name, "props": k.props, "short": self.short_path(k.id)})
                    if depth < 6 and k.kind in (Kind.storage, Kind.furniture, Kind.item):
                        res += items_under(k.id, depth + 1)
                return res
            return {"place": {"id": place.id, "name": place.name, "path": self.twin.path(place.id),
                              "short": self.short_path(place.id)},
                    "places": [{"id": k.id, "name": k.name, "kind": k.kind.value} for k in kids
                               if k.kind in (Kind.storage, Kind.furniture)],
                    "items": items_under(place.id)}

    # ── идеи ─────────────────────────────────────────────────────────────────
    def _check_ideas(self) -> None:
        """Идеи кладут и правят файлами (Claude, git, Samba): папка поменялась — перечитать. Кривой файл не прячется,
        а показывается в списке с ошибкой: иначе автор идеи не узнал бы, почему её нет."""
        try:
            files = sorted(self.ideas_dir.glob(IDEA_GLOB)) if self.ideas_dir.is_dir() else []
            stamp = self._stamp(files)
        except OSError:
            return
        if stamp == self.ideas_stamp:
            return
        self.ideas_stamp, self.ideas, self.variants = stamp, {}, {}
        for f in files:
            key = f.name[:-len(".idea.json")]
            try:
                idea = Idea.model_validate(json.loads(f.read_text(encoding="utf-8")))
            except (OSError, ValueError) as err:          # битый JSON, не та схема
                self.ideas[key] = {"file": f.name, "error": str(err).split("\n")[0][:300]}
                continue
            if idea.key in self.ideas:
                self.ideas[f"{idea.key}@{f.name}"] = {"file": f.name, "error": f"ключ «{idea.key}» уже занят"}
            elif PRIVACY_RANK[idea.privacy] <= PRIVACY_RANK[self.audience]:   # строже аудитории — её как нет
                self.ideas[idea.key] = {"file": f.name, "idea": idea}

    def _variant(self, key: str) -> Variant:
        rec = self.ideas.get(key)
        if rec is None:
            raise StoreError(f"нет идеи «{key}»")
        if "error" in rec:
            raise StoreError(f"идея «{key}» не читается: {rec['error']}")
        cached = self.variants.get(key)
        if cached and cached[0] == self.version:
            return cached[1]
        try:
            v = apply_idea(self.base + [self.items], rec["idea"])
        except (IdeaError, ValueError) as err:
            raise StoreError(f"идея «{key}» не собирается: {err}") from err
        self.variants[key] = (self.version, v)
        return v

    def _idea_state(self) -> dict:
        try:
            return json.loads((self.ideas_dir / IDEA_STATE).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def _idea_info(self, key: str, detail: bool = False) -> dict:
        rec, row = self.ideas[key], self._idea_state().get(key, {})
        status = row.get("status", "idea")
        info = {"key": key, "file": rec["file"], "status": status, "status_ru": STATUSES.get(status, status),
                "notes": row.get("notes", [])}
        if "error" in rec:
            return {**info, "title": key, "error": rec["error"]}
        idea = rec["idea"]
        info.update(title=idea.title, summary=idea.summary, tags=idea.tags, author=idea.author, created=idea.created)
        try:
            v = self._variant(key)
        except StoreError as err:
            return {**info, "error": str(err)}
        t, vis = v.twin, {e.id for e in v.twin.visible_to(self.audience)}

        def top(mark: str) -> list[Entity]:              # без того, что внутри: стеллаж, а не каждая его полка
            return [t.by_id[i] for i, m in v.marks.items() if m == mark and i in vis and v.marks.get(t.by_id[i].parent) != mark]
        added, removed = top("add"), top("remove")
        changed = [t.by_id[i] for i, m in v.marks.items() if m == "change" and i in vis]
        info.update(counts={"add": len(added), "change": len(changed), "remove": len(removed)}, warnings=v.warnings)
        if v.about and v.about in vis:
            info["about"] = {"id": v.about, "name": t.by_id[v.about].name, "short": self._short(t, v.about)}
        if detail:
            row_of = lambda e: {"id": e.id, "name": e.name, "ru": lookup(e.kind, e.type)[0],   # noqa: E731
                                **({"size": list(e.geom.size)} if getattr(e.geom, "size", None) else {}),
                                **({"note": v.notes[e.id]} if e.id in v.notes else {})}
            info.update(text=idea.text, added=[row_of(e) for e in added], changed=[row_of(e) for e in changed],
                        removed=[row_of(e) for e in removed])
            info["views"] = []
            for w in idea.views:                          # глаз и цель — из системы about в систему участка
                eye, at = t.to_site(v.about, [w.eye, w.at]) if v.about else [w.eye, w.at]
                info["views"].append({**w.model_dump(exclude_none=True), "eye": list(eye), "at": list(at)})
        return info

    @staticmethod
    def _short(t: Twin, ref: str) -> str:
        chain = [t.get(ref)] + t.ancestors(ref)
        unit = next((i for i, a in enumerate(chain) if a.kind == Kind.unit), None)
        return " → ".join(a.name for a in reversed(chain[:unit] if unit else chain))

    def ideas_list(self) -> list[dict]:
        with self.lock:
            self._check_items_file()
            self._check_ideas()
            return [self._idea_info(k) for k in self.ideas]

    def ideas_count(self) -> int:
        with self.lock:
            self._check_ideas()
            return len(self.ideas)

    def idea_snapshot(self, key: str) -> dict:
        """Снимок варианта «как будет» и подробности идеи (что добавится, изменится, уйдёт; точка обзора)."""
        with self.lock:
            self._check_items_file()
            self._check_ideas()
            v = self._variant(key)
            snap = self._snapshot(v.twin, v.marks)
            snap["idea"] = self._idea_info(key, detail=True)
            return snap

    def set_idea(self, key: str, status: str | None = None, note: str | None = None, by: str | None = None) -> dict:
        """Статус идеи и заметка хозяев. Сам файл идеи не меняется: его пишет автор, а это — ответ на него."""
        with self.lock:
            self._check_ideas()
            if key not in self.ideas:
                raise StoreError(f"нет идеи «{key}»")
            if status is not None and status not in STATUSES:
                raise StoreError("статус: " + ", ".join(STATUSES))
            note = note.strip() if isinstance(note, str) else ""
            if len(note) > 2000:
                raise StoreError("заметка — до 2000 знаков")
            st = self._idea_state()
            row, now = st.setdefault(key, {}), time.strftime("%Y-%m-%d %H:%M")
            if status is not None and status != row.get("status", "idea"):
                row.update(status=status, status_at=now, **({"status_by": by} if by else {}))
            if note:
                row.setdefault("notes", []).append({"at": now, "text": note, **({"by": by} if by else {})})
            self.ideas_dir.mkdir(parents=True, exist_ok=True)
            f = self.ideas_dir / IDEA_STATE
            tmp = f.with_suffix(".tmp")
            tmp.write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding="utf-8")
            os.replace(tmp, f)
            return self._idea_info(key)

    # ── документы ────────────────────────────────────────────────────────────
    def doc_info(self, d: Entity) -> dict:
        p = d.props
        return {"id": d.id, "name": d.name, "type": d.type, "ru": DOC_TYPES.get(d.type or "", "документ"),
                "url": p.get("url"), "copy": bool(p.get("file")) and self._copy_exists(p["file"]),
                "mime": p.get("mime"), "size": p.get("size"), "pages": p.get("pages"), "saved_at": p.get("saved_at"),
                "note": p.get("note"), "editable": self.twin.pkg_of[d.id] is self.items}

    def _copy_exists(self, rel: str) -> bool:
        try:
            resolve_file(self.docs_dir, rel)
            return True
        except DocError:
            return False

    def docs_of(self, ref: str) -> dict:
        """Документы сущности и ближайшего родителя с документами на всё целое (у ящика кухни — проект кухни;
        чеки и страницы покупок родителя — только у него самого). Вещь, которая лежит в шкафу, — не часть шкафа:
        проект шкафа у неё не показывается. Спросили о самом документе — он и есть ответ."""
        with self.lock:
            try:                                 # «телефон» — сам телефон, а не «Гарантия на телефон»
                e = self.resolve(ref, set(Kind) - {Kind.document})
            except StoreError:
                e = self.resolve(ref)
            if e.kind == Kind.document:          # «гарантия на телефон», id из find
                of = self.twin.by_id.get(e.parent) or e
                return {"of": {"id": of.id, "name": of.name, "short": self.short_path(of.id)},
                        "docs": [self.doc_info(e)], "parent": None}

            def mine(eid: str) -> list[Entity]:
                return [d for d in self.docs_by.get(eid, []) if d.id != eid]
            own = mine(e.id)
            seen = {d.id for d in own}           # проект кухни, связанный с ящиком, — один раз, а не ещё и «у кухни»
            whole = lambda eid: [d for d in mine(eid) if d.type in INHERITED and d.id not in seen]  # noqa: E731
            up = None if e.kind == Kind.item else next(
                ({"id": a.id, "name": a.name, "docs": [self.doc_info(d) for d in whole(a.id)]}
                 for a in self.twin.ancestors(e.id) if whole(a.id)), None)
            return {"of": {"id": e.id, "name": e.name, "short": self.short_path(e.id)},
                    "docs": [self.doc_info(d) for d in own], "parent": up}

    def doc_file(self, ref: str) -> tuple[Path, str, str]:
        """Локальная копия документа: (путь, тип по расширению, имя для скачивания). Только видимое аудитории."""
        with self.lock:
            self._check_items_file()
            d = self.twin.by_id.get(ref) or self.twin.by_key.get(ref)
            if d is None or d.kind != Kind.document or d.id not in self.visible:
                raise StoreError("нет такого документа")
            rel = d.props.get("file")
            if not rel:
                raise StoreError(f"у «{d.name}» нет локальной копии")
            try:
                path = resolve_file(self.docs_dir, rel)
            except DocError as err:
                raise StoreError(f"копии «{d.name}» нет в папке документов") from err
            return path, mime_of(path), Path(rel).name

    def mesh_file(self, ref: str, idea: str | None = None) -> Path:
        """Файл готовой модели (geom mesh) сущности, видимой аудитории, — в двойнике или в варианте идеи."""
        with self.lock:
            self._check_items_file()
            if idea:
                self._check_ideas()
                t = self._variant(idea).twin
                e = t.by_id.get(ref) or t.by_key.get(ref)
                seen = e is not None and any(x.id == e.id for x in t.visible_to(self.audience))
            else:
                e = self.twin.by_id.get(ref) or self.twin.by_key.get(ref)
                seen = e is not None and e.id in self.visible
            if not seen or getattr(e.geom, "type", None) != "mesh":
                raise StoreError("нет такой модели")
            try:
                path = resolve_file(self.assets_dir, e.geom.asset)
            except DocError as err:
                raise StoreError(f"файла модели «{e.name}» нет в папке моделей") from err
            return path

    def add_doc(self, to: str, title: str, type: str = "note", url: str | None = None, data: bytes | None = None,
                filename: str | None = None, note: str | None = None, by: str | None = None,
                origin: str = "manual", extra: dict | None = None, mime: str | None = None) -> Entity:
        """Документ к сущности из любого пакета: ссылка, файл или оба. Запись — в пакет вещей.
        mime — тип, который заявил браузер или сайт; верится, только если содержимое его не опровергает."""
        title = (title or "").strip() or (filename or "").strip() or (url or "").strip()
        if not title:
            raise StoreError("нужно название, файл или ссылка")
        if type not in DOC_TYPES:
            raise StoreError("тип документа: " + ", ".join(DOC_TYPES))
        if url and not url.lower().startswith(("http://", "https://")):
            raise StoreError("ссылка должна начинаться с http:// или https://")
        with self.lock:
            target = self.resolve(to)
            props = {k: v for k, v in (("url", url), ("note", note), ("by", by),
                                       ("added_at", time.strftime("%Y-%m-%d %H:%M"))) if v not in (None, "")}
            if data is not None:
                try:
                    props.update(store_file(self.docs_dir, data, filename or title, kind=mime))
                except DocError as err:
                    raise StoreError(str(err)) from err
                if pdf_pages(data):
                    props["pages"] = pdf_pages(data)
            props.update(extra or {})
            e = Entity(id=str(uuid.uuid4()), kind=Kind.document, type=type, name=title[:200], parent=target.id,
                       props=props, src=Source(origin=origin, at=time.strftime("%Y-%m-%d")))
            self.items.entities.append(e)
            self._save()
            return e

    def link_doc(self, doc: str, to: str) -> Entity:
        """Документ относится ещё и к другой сущности (связь documents)."""
        with self.lock:
            d = self._own_doc(doc)
            t = self.resolve(to)
            if t.id != d.parent and not any(r.rel == "documents" and r.to == t.id for r in d.refs):
                d.refs.append(Ref(rel="documents", to=t.id))
                self._save()
            return d

    def _own_doc(self, ref: str) -> Entity:
        e = self.resolve(ref, {Kind.document})
        if self.twin.pkg_of[e.id] is not self.items:
            raise StoreError(f"«{e.name}» записан в пакете только для чтения")
        return e

    def remove_doc(self, ref: str, by: str | None = None) -> str:
        """Убрать документ из учёта: строка уходит в trash.jsonl, файл копии остаётся в папке документов."""
        with self.lock:
            d = self._own_doc(ref)
            self.data_dir.mkdir(parents=True, exist_ok=True)
            row = {"removed_at": time.strftime("%Y-%m-%d %H:%M"), "by": by, "path": self.twin.path(d.id),
                   "entity": d.model_dump(mode="json", by_alias=True, exclude_none=True)}
            with open(self.data_dir / TRASH_FILE, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
            self.items.entities = [k for k in self.items.entities if k.id != d.id]
            self._save()
            return d.name

    # ── правка вещей ─────────────────────────────────────────────────────────
    def _own_item(self, ref: str) -> Entity:
        e = self.resolve(ref, {Kind.item})
        if self.twin.pkg_of[e.id] is not self.items:
            raise StoreError(f"«{e.name}» лежит в пакете только для чтения")
        return e

    def add_item(self, name: str, place: str, qty: float | None = None, note: str | None = None,
                 tags: list[str] | None = None, aliases: list[str] | None = None, by: str | None = None,
                 origin: str = "manual") -> Entity:
        name = name.strip() if isinstance(name, str) else ""
        if not name:
            raise StoreError("пустое название")
        for k, v in (("tags", tags), ("aliases", aliases)):
            if v is not None and (not isinstance(v, list) or not all(isinstance(x, str) for x in v)):
                raise StoreError(f"{k} — список строк")
        if qty is not None and (isinstance(qty, bool) or not isinstance(qty, (int, float))):
            raise StoreError("qty — число")
        if note is not None and not isinstance(note, str):
            raise StoreError("note — строка")
        if not isinstance(place, str):
            raise StoreError("place — строка: id или слова")
        if not isinstance(origin, str) or not origin:
            origin = "manual"
        with self.lock:
            parent = self.resolve(place, PLACE_KINDS)
            props = {k: v for k, v in (("qty", qty), ("note", note), ("by", by),
                                       ("added_at", time.strftime("%Y-%m-%d %H:%M"))) if v not in (None, "")}
            e = Entity(id=str(uuid.uuid4()), kind=Kind.item, type="thing", name=name, parent=parent.id,
                       props=props, tags=tags or [], aliases=aliases or [],
                       src=Source(origin=origin, at=time.strftime("%Y-%m-%d")))
            self.items.entities.append(e)
            self._save()
            return e

    def move_item(self, item: str, place: str, by: str | None = None) -> Entity:
        with self.lock:
            e = self._own_item(item)
            parent = self.resolve(place, PLACE_KINDS)
            if parent.id == e.id or e.id in [a.id for a in self.twin.ancestors(parent.id)]:
                raise StoreError("нельзя положить вещь саму в себя")
            if parent.id != e.parent and e.placement is not None:
                # место задано в системе прежнего родителя: в новом оно ничего не значит, а нарисованная там вещь
                # висела бы в чужой комнате; габариты остаются в свойствах
                if e.geom is not None and getattr(e.geom, "size", None):
                    e.props["size_m"] = [round(v, 3) for v in e.geom.size]
                e.placement, e.geom = None, None
            e.parent = parent.id
            e.props.update({"moved_at": time.strftime("%Y-%m-%d %H:%M"), **({"by": by} if by else {})})
            self._save()
            return e

    def update_item(self, item: str, **fields) -> Entity:
        """Поправить вещь. Сначала проверяется всё, потом меняется: кривой запрос не оставит полуправку в памяти
        (а строка вместо списка в tags сломала бы поиск и чтение items.twin.json)."""
        with self.lock:
            e = self._own_item(item)
            new = {}
            if fields.get("name") is not None:
                if not isinstance(fields["name"], str) or not fields["name"].strip():
                    raise StoreError("название — непустая строка")
                new["name"] = fields["name"].strip()
            for k in ("tags", "aliases"):
                if fields.get(k) is not None:
                    if not isinstance(fields[k], list) or not all(isinstance(x, str) for x in fields[k]):
                        raise StoreError(f"{k} — список строк")
                    new[k] = fields[k]
            ids = None
            if "ids" in fields:                  # закрытые номера: IMEI, серийный, MAC — не в поиск и не голосом
                if not isinstance(fields["ids"] or {}, dict):
                    raise StoreError("номера — словарь «название: номер»")
                ids = {}
                for k, v in (fields["ids"] or {}).items():
                    k, v = str(k).strip(), (v.strip() if isinstance(v, str) else "")   # null, false — стереть
                    if not k or not v:
                        continue
                    if len(k) > 40 or len(v) > 120:
                        raise StoreError(f"номер «{k[:40]}»: название до 40 знаков, номер до 120")
                    ids[k] = v
            for k, v in new.items():
                setattr(e, k, v)
            if fields.get("qty") not in (None, "") and (isinstance(fields["qty"], bool)
                                                         or not isinstance(fields["qty"], (int, float))):
                raise StoreError("qty — число")
            if fields.get("note") is not None and not isinstance(fields["note"], str):
                raise StoreError("note — строка")
            for k in ("qty", "note"):
                if k in fields:
                    if fields[k] in (None, ""):
                        e.props.pop(k, None)
                    else:
                        e.props[k] = fields[k]
            if ids:
                e.props["ids"] = ids
            elif ids is not None:
                e.props.pop("ids", None)
            self._save()
            return e

    def remove_item(self, item: str, by: str | None = None) -> str:
        """Вычеркнуть вещь. Запись не пропадает: строка уходит в trash.jsonl, её можно вернуть. Вещи из неё
        остаются на месте вещи; её документы (гарантия, чек) уходят в ту же строку корзины, а не к шкафу —
        кроме тех, что относятся ещё к чему-то: те переезжают туда."""
        with self.lock:
            e = self._own_item(item)
            docs = []
            for k in self.items.entities:
                if k.parent != e.id:
                    continue
                if k.kind != Kind.document:      # содержимое коробки остаётся там, где стояла коробка
                    k.parent = e.parent
                    continue
                also = [r for r in k.refs if r.rel == "documents" and r.to != e.id and r.to in self.twin.by_id]
                if also:
                    k.parent = also[0].to
                    k.refs.remove(also[0])
                else:
                    docs.append(k)
            self.data_dir.mkdir(parents=True, exist_ok=True)
            dump = lambda x: x.model_dump(mode="json", by_alias=True, exclude_none=True)  # noqa: E731
            row = {"removed_at": time.strftime("%Y-%m-%d %H:%M"), "by": by, "path": self.twin.path(e.id),
                   "entity": dump(e), **({"docs": [dump(d) for d in docs]} if docs else {})}
            with open(self.data_dir / TRASH_FILE, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
            gone = {e.id, *(d.id for d in docs)}
            self.items.entities = [k for k in self.items.entities if k.id not in gone]
            self._save()
            return e.name
