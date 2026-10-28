# -*- coding: utf-8 -*-
"""Документы у сущностей: инструкции, чертежи, чеки, гарантии, копии страниц сайтов.

Документ — сущность вида `document`. Родитель — то, к чему он относится (холодильник, кухня, шкаф); ещё вещи —
связями `documents` из самого документа (проект кухни описывает все её модули). Свойства:

- `url` — где документ в сети (страница магазина, PDF производителя);
- `file` — локальная копия: путь от корня папки документов (`2026/3f2a1c-instruktsiya.pdf`);
- `mime`, `size` (байты), `pages`, `sha256`, `saved_at` (дата копии), `note`.

Есть копия — документ откроется, даже если сайт пропадёт. Файлы лежат отдельно от пакета, пакет хранит только
путь. Закрытые номера вещи (IMEI, серийный, MAC) — словарь `props.ids` самой вещи: в поиск и голосовому
ассистенту он не попадает.

Командная строка (сборка пакетов на ПК):

    python -m cherrybim.docs fetch URL ФАЙЛ        скачать как есть (PDF, картинка, страница)
    python -m cherrybim.docs snapshot URL ФАЙЛ.pdf  страница сайта → PDF через Chrome без окна
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
from pathlib import Path

# type документа → русское название (для карточки и голоса)
DOC_TYPES: dict[str, str] = {
    "project": "проект, чертежи",
    "assembly": "инструкция по сборке",
    "manual": "инструкция",
    "datasheet": "характеристики, паспорт",
    "receipt": "чек, заказ",
    "warranty": "гарантия",
    "contract": "договор",
    "page": "страница сайта",
    "photo": "фото",
    "note": "заметка",
}
# что видно и у частей: проект кухни нужен и у её ящика, а чек на розетку кухни — только у розетки
INHERITED = {"project", "assembly", "contract"}
MAX_BYTES = 50 * 2 ** 20
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36"
EXT = {"application/pdf": ".pdf", "text/html": ".html", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
       "text/plain": ".txt", "application/zip": ".zip"}
MIME = {v: k for k, v in EXT.items()} | {".jpeg": "image/jpeg", ".htm": "text/html", ".gif": "image/gif",
                                        ".svg": "image/svg+xml", ".docx": "application/vnd.openxmlformats-officedocument."
                                        "wordprocessingml.document", ".xlsx": "application/vnd.openxmlformats-"
                                        "officedocument.spreadsheetml.sheet", ".dwg": "image/vnd.dwg"}
EXT_OF = {v: k for k, v in MIME.items()} | EXT             # тип → расширение, у каждого известного типа своё
# сигнатуры в начале файла: тип по содержимому, а не по имени или заголовку сайта
MAGIC = ((b"%PDF-", "application/pdf"), (b"\x89PNG\r\n\x1a\n", "image/png"), (b"\xff\xd8\xff", "image/jpeg"),
         (b"GIF87a", "image/gif"), (b"GIF89a", "image/gif"))
_TR = dict(zip("абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
               ["a", "b", "v", "g", "d", "e", "e", "zh", "z", "i", "i", "k", "l", "m", "n", "o", "p", "r", "s", "t",
                "u", "f", "kh", "ts", "ch", "sh", "shch", "", "y", "", "e", "iu", "ia"]))


class DocError(ValueError):
    """Понятная ошибка: не скачалось, слишком большой файл, не та ссылка."""


def safe_name(name: str, fallback: str = "dokument") -> str:
    """Имя файла латиницей без пробелов и опасных символов: «Инструкция Bosch.pdf» → «instruktsiia-bosch.pdf»."""
    name = "".join(_TR.get(c, c) for c in (name or "").lower())
    stem, ext = os.path.splitext(name)
    stem = re.sub(r"[^a-z0-9]+", "-", stem).strip("-")[:60] or fallback
    ext = re.sub(r"[^a-z0-9.]", "", ext)[:8]
    return stem + ext


def mime_of(path: str | Path) -> str:
    return MIME.get(Path(path).suffix.lower(), "application/octet-stream")


def sniff(data: bytes, declared: str | None = None) -> str | None:
    """Тип файла по первым байтам; не узнали — заявленный (браузером или сайтом), если такой тип нам известен."""
    for sig, kind in MAGIC:
        if data.startswith(sig):
            return kind
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return declared if declared in EXT_OF else None


def store_file(root: str | Path, data: bytes, name: str, kind: str | None = None) -> dict:
    """Положить файл в папку документов: ГГГГ/хеш-имя. Возвращает свойства для документа (file, mime, size, sha256).
    Расширение — по содержимому: PDF со страницы download.php ляжет как .pdf, а не как файл для скачивания."""
    if not data:
        raise DocError("пустой файл")
    if len(data) > MAX_BYTES:
        raise DocError(f"файл больше {MAX_BYTES // 2 ** 20} МБ")
    digest = hashlib.sha256(data).hexdigest()
    stem, ext = os.path.splitext(safe_name(name))
    t = sniff(data, kind)
    if t and MIME.get(ext) != t:
        ext = EXT_OF[t]
    rel = f"{time.strftime('%Y')}/{digest[:8]}-{stem}{ext}"
    path = Path(root) / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():                                 # тот же файл второй раз не копируется
        tmp = path.with_name(path.name + f".{uuid.uuid4().hex[:6]}.tmp")
        tmp.write_bytes(data)
        os.replace(tmp, path)
    return {"file": rel, "mime": mime_of(rel), "size": len(data), "sha256": digest, "saved_at": time.strftime("%Y-%m-%d")}


def resolve_file(root: str | Path, rel: str) -> Path:
    """Путь к копии документа строго внутри папки документов (никаких ../)."""
    base = Path(root).resolve()
    path = (base / rel).resolve()
    if base not in path.parents or not path.is_file():
        raise DocError("копии документа нет")
    return path


def fetch(url: str, timeout: float = 30.0, max_bytes: int = MAX_BYTES) -> tuple[bytes, str, str]:
    """Скачать по ссылке: (данные, тип, адрес после переадресаций). Только http(s); прокси — из окружения.
    Страница HTML приходит в UTF-8, в какой бы кодировке её ни отдал сайт."""
    if not re.match(r"^https?://", url or "", re.I):
        raise DocError("нужна ссылка http:// или https://")
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ru,en;q=0.8"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read(max_bytes + 1)
            kind = (r.headers.get_content_type() or "application/octet-stream").lower()
            charset = r.headers.get_content_charset()
            final = r.geturl()
    except OSError as e:
        raise DocError(f"не скачалось: {e}") from e
    if len(data) > max_bytes:
        raise DocError(f"по ссылке больше {max_bytes // 2 ** 20} МБ")
    if sniff(data, kind) == "text/html":
        data = html_utf8(data, charset)
    return data, kind, final


_META_CHARSET = re.compile(r"""(<meta[^>]{0,200}?charset\s*=\s*["']?\s*)([\w.:-]+)""", re.I)


def html_utf8(data: bytes, charset: str | None = None) -> bytes:
    """Страница в UTF-8 по её настоящей кодировке (заголовок сайта, потом <meta charset>); объявление в самой
    странице тоже становится utf-8, иначе копия, открытая с диска, покажет кракозябры."""
    m = _META_CHARSET.search(data[:4096].decode("latin-1"))
    for enc in (charset, m and m.group(2), "utf-8", "cp1251"):
        try:
            if enc:
                text = data.decode(enc)
                break
        except (LookupError, UnicodeDecodeError):
            continue
    else:
        text = data.decode("utf-8", errors="replace")
    head = _META_CHARSET.sub(lambda x: x.group(1) + "utf-8", text[:4096], count=1)
    return (head + text[4096:]).encode("utf-8")


def html_copy(data: bytes, url: str) -> bytes:
    """Страница как есть + <base href>: относительные ссылки и картинки ведут на сайт, текст — в копии.
    Ищется без регулярных выражений: на странице из одних «<head» поиск с откатом занял бы минуты."""
    text = data.decode("utf-8", errors="replace")
    base = f'<meta charset="utf-8"><base href="{url}">'
    m = re.search(r"<head", text, re.I)
    end = text.find(">", m.end()) + 1 if m else 0
    text = text[:end] + base + text[end:] if end else base + text
    return text.encode("utf-8")


def title_of(data: bytes, kind: str) -> str | None:
    """Заголовок страницы для названия документа (поиск — простыми find, по той же причине, что в html_copy)."""
    if kind != "text/html":
        return None
    low = data.lower()
    i = low.find(b"<title")
    j = low.find(b">", i) if i >= 0 else -1
    k = low.find(b"</title>", j) if j >= 0 else -1
    if k < 0:
        return None
    import html
    t = re.sub(r"\s+", " ", html.unescape(data[j + 1:min(k, j + 2000)].decode("utf-8", errors="replace"))).strip()
    # без хвоста магазина: «Холодильник … купить с доставкой», «… | shop.example», «… — Bosch»
    t = re.split(r"\s+(?:купить|заказать|цена|отзывы)\b|\s+[|—]\s+", t, maxsplit=1, flags=re.I)[0].strip(" -–—|,.")
    return t[:200] or None


def pdf_pages(data: bytes) -> int | None:
    """Число страниц PDF без внешних библиотек (по объектам /Type /Page)."""
    if not data.startswith(b"%PDF"):
        return None
    n = len(re.findall(rb"/Type\s*/Page(?!s)", data))
    return n or None


def find_chrome() -> str | None:
    for c in (os.environ.get("CHROME"), r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
              shutil.which("google-chrome"), shutil.which("chromium"), shutil.which("chromium-browser")):
        if c and Path(c).exists():
            return c
    return None


# Перед печатью страницы: убрать всплывающие окна и затемнение, вернуть прокрутку. Магазины прячут всё в печатной
# вёрстке и закрывают страницу окном «скачайте приложение», поэтому печатаем экранную вёрстку без них.
_CLEAN = """(() => {
  for (const el of [...document.querySelectorAll('body *')]) {
    const st = getComputedStyle(el);
    const big = el.offsetWidth * el.offsetHeight > innerWidth * innerHeight * 0.25;
    if ((st.position === 'fixed' || st.position === 'sticky') && (big || +st.zIndex > 100)) el.remove();
    else if (/(^|[-_ ])(popup|modal|overlay|cookie|consent|banner)([-_ ]|$)/i.test(el.className || '') && st.position !== 'static') el.remove();
  }
  for (const el of [document.documentElement, document.body]) { el.style.overflow = 'visible'; el.style.height = 'auto'; }
  return document.title;
})()"""


def snapshot(url: str, out: str | Path, timeout: float = 90.0, chrome: str | None = None, wait: float = 5.0,
             profile: str | Path | None = None) -> Path:
    """Страница сайта → PDF с текстом через Chrome без окна (протокол отладки): экранная вёрстка, без всплывающих
    окон. Копия откроется, когда сайта уже не будет. Нужен пакет websockets (экстра server).

    profile (или CHERRYBIM_CHROME_PROFILE) — постоянная папка профиля Chrome. На Windows свежий профиль при первом
    запуске проверяет, не пустой ли пароль учётки, — это неудачный вход в журнале безопасности, и пачка копий во
    временных профилях может заблокировать учётку. Без profile профиль временный (в контейнере аддона так и надо)."""
    import base64
    import json
    from websockets.sync.client import connect

    chrome = chrome or find_chrome()
    if not chrome:
        raise DocError("нет Chrome для копии страницы")
    out = Path(out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    profile = profile or os.environ.get("CHERRYBIM_CHROME_PROFILE") or None
    local = urllib.request.build_opener(urllib.request.ProxyHandler({}))   # к самому Chrome — мимо прокси
    with tempfile.TemporaryDirectory() as tmp:
        prof = Path(profile) if profile else Path(tmp)
        prof.mkdir(parents=True, exist_ok=True)
        port_file = prof / "DevToolsActivePort"
        port_file.unlink(missing_ok=True)                   # от прошлого запуска на том же профиле
        proc = subprocess.Popen([chrome, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
                                 f"--user-data-dir={prof}", "--remote-debugging-port=0", "--window-size=1280,900",
                                 "--hide-scrollbars", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            t0 = time.time()
            while not port_file.exists() and time.time() - t0 < 20:
                time.sleep(0.2)
            port = port_file.read_text().split()[0]
            pages = json.loads(local.open(f"http://127.0.0.1:{port}/json/list", timeout=10).read())
            ws_url = next(p["webSocketDebuggerUrl"] for p in pages if p.get("type") == "page")
            with connect(ws_url, max_size=None, proxy=None, open_timeout=10) as ws:
                n = [0]

                def call(method, params=None, until=None):
                    n[0] += 1
                    ws.send(json.dumps({"id": n[0], "method": method, "params": params or {}}))
                    end = time.time() + timeout
                    while time.time() < end:
                        msg = json.loads(ws.recv(timeout=max(1.0, end - time.time())))
                        if until and msg.get("method") == until:
                            return msg
                        if not until and msg.get("id") == n[0]:
                            if "error" in msg:
                                raise DocError(f"Chrome: {msg['error'].get('message')}")
                            return msg.get("result", {})
                    raise DocError("Chrome не успел")
                call("Page.enable")
                call("Emulation.setEmulatedMedia", {"media": "screen"})
                n[0] += 1
                ws.send(json.dumps({"id": n[0], "method": "Page.navigate", "params": {"url": url}}))
                call("", until="Page.loadEventFired")
                time.sleep(wait)                              # одностраничные сайты дорисовывают после load
                call("Runtime.evaluate", {"expression": _CLEAN, "returnByValue": True})
                res = call("Page.printToPDF", {"printBackground": True, "paperWidth": 8.27, "paperHeight": 11.69,
                                               "marginTop": 0.3, "marginBottom": 0.3, "marginLeft": 0.3, "marginRight": 0.3,
                                               "scale": 0.8})
                out.write_bytes(base64.b64decode(res["data"]))
        except (OSError, StopIteration, ValueError, KeyError) as e:
            raise DocError(f"Chrome не сохранил страницу: {e}") from e
        finally:
            try:                                          # закрыть, а не убить: иначе профиль может не сохраниться
                browser = json.loads(local.open(f"http://127.0.0.1:{port}/json/version", timeout=5).read())
                with connect(browser["webSocketDebuggerUrl"], proxy=None, open_timeout=5) as ws:
                    ws.send(json.dumps({"id": 1, "method": "Browser.close"}))
                proc.wait(timeout=10)
            except Exception:                             # noqa: BLE001 — Chrome не ответил: остаётся kill
                pass
            if proc.poll() is None:
                proc.kill()
                proc.wait(timeout=10)
    if not out.exists() or out.stat().st_size < 5000:
        raise DocError("Chrome сохранил пустую страницу")
    return out


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(prog="cherrybim.docs", description="копии документов для пакетов Cherry BiM")
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch", help="скачать как есть")
    f.add_argument("url")
    f.add_argument("out")
    s = sub.add_parser("snapshot", help="страница → PDF через Chrome")
    s.add_argument("url")
    s.add_argument("out")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "fetch":
            data, kind, _ = fetch(a.url)
            Path(a.out).write_bytes(data)
            print(a.out, kind, len(data))
        else:
            print(snapshot(a.url, a.out))
    except DocError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
