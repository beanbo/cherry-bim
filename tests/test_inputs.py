"""Кривые, чужие и большие входные данные: файлы, имена, тела запросов."""
import json

import pytest

from cherrybim.docs import DocError, html_copy, html_utf8, pdf_pages, resolve_file, safe_name, sniff, store_file
from cherrybim.io_bazis import Model
from cherrybim.model import Package


# ── IFC: широта и долгота градусами, минутами, секундами ─────────────────────
@pytest.mark.parametrize("deg, dms", [
    (0.0, (0, 0, 0, 0)),
    (0.0225, (0, 1, 21, 0)),                 # 81″ ровно: раньше выходило 1′ 20″ и 1 000 000 миллионных
    (53.9, (53, 54, 0, 0)),
    (-27.5, (-27, -30, 0, 0)),
    (27.561234, (27, 33, 40, 442400)),
    (179.9999999999, (180, 0, 0, 0)),
])
def test_dms_known_values(deg, dms):
    _dms = pytest.importorskip("cherrybim.export_ifc")._dms
    assert _dms(deg) == dms


def test_dms_parts_always_in_range():
    _dms = pytest.importorskip("cherrybim.export_ifc")._dms
    for i in range(0, 1_800_000, 7):
        d, m, s, us = _dms(i / 10000)
        assert 0 <= m < 60 and 0 <= s < 60 and 0 <= us < 10 ** 6
        assert d + m / 60 + (s + us / 1e6) / 3600 == pytest.approx(i / 10000, abs=1e-9)


# ── пакеты ───────────────────────────────────────────────────────────────────
def test_package_rejects_unknown_fields_and_bad_geometry(demo):
    raw = json.loads(demo[0].model_dump_json(by_alias=True))
    Package.model_validate(raw)
    with pytest.raises(ValueError):
        Package.model_validate({**raw, "lol": 1})
    bad = json.loads(json.dumps(raw))
    bad["entities"][0]["geom"] = {"type": "sphere", "r": 1}
    with pytest.raises(ValueError):
        Package.model_validate(bad)
    with pytest.raises(ValueError):
        Package.model_validate({**raw, "format": "ifc"})


def test_duplicate_ids_across_packages_rejected(demo):
    from cherrybim import Twin
    with pytest.raises(ValueError, match="дважды"):
        Twin([demo[0], demo[0]])


# ── файлы документов ─────────────────────────────────────────────────────────
@pytest.mark.parametrize("name, out", [
    ("Инструкция Bosch.pdf", "instruktsiia-bosch.pdf"),
    ("../../etc/passwd", "etc-passwd"),
    ("..\\..\\boot.ini", "boot.ini"),
    ("", "dokument"),
    ("файл.PDF;rm -rf", "fail.pdfrmrf"),
])
def test_safe_name(name, out):
    assert safe_name(name) == out
    assert "/" not in safe_name(name) and "\\" not in safe_name(name)


def test_resolve_file_stays_inside(tmp_path):
    (tmp_path / "docs" / "2026").mkdir(parents=True)
    (tmp_path / "docs" / "2026" / "a.pdf").write_bytes(b"%PDF-1")
    (tmp_path / "secret.txt").write_text("x")
    assert resolve_file(tmp_path / "docs", "2026/a.pdf").name == "a.pdf"
    for rel in ("../secret.txt", str(tmp_path / "secret.txt"), "2026/../../secret.txt", "2026", ""):
        with pytest.raises(DocError):
            resolve_file(tmp_path / "docs", rel)


def test_store_file_limits_and_type_by_content(tmp_path):
    with pytest.raises(DocError):
        store_file(tmp_path, b"", "x.pdf")
    info = store_file(tmp_path, b"%PDF-1.7 ...", "download.php", kind="text/html")
    assert info["file"].endswith("-download.pdf") and info["mime"] == "application/pdf"
    again = store_file(tmp_path, b"%PDF-1.7 ...", "download.php")
    assert again["file"] == info["file"]                                      # тот же файл второй раз не копируется
    import cherrybim.docs as docs
    old, docs.MAX_BYTES = docs.MAX_BYTES, 10
    try:
        with pytest.raises(DocError, match="больше"):
            store_file(tmp_path, b"x" * 11, "big.bin")
    finally:
        docs.MAX_BYTES = old


def test_sniff_and_pdf_pages():
    assert sniff(b"\x89PNG\r\n\x1a\n....") == "image/png"
    assert sniff(b"RIFF\0\0\0\0WEBPVP8 ") == "image/webp"
    assert sniff(b"hello", "text/plain") == "text/plain"
    assert sniff(b"hello", "application/x-evil") is None
    assert pdf_pages(b"%PDF-1.4 /Type /Pages /Type /Page /Type/Page") == 2
    assert pdf_pages(b"not a pdf /Type /Page") is None


def test_html_copy_escapes_base_url():
    out = html_copy(b"<html><head></head><body>x</body></html>", 'https://e.example/a"><script>alert(1)</script>').decode()
    assert "<script>" not in out and "&quot;&gt;&lt;script&gt;" in out
    assert out.startswith('<html><head><meta charset="utf-8"><base href="https://e.example/a')


def test_html_utf8_from_cp1251():
    page = '<html><head><meta charset="windows-1251"><title>Дрель</title></head></html>'.encode("cp1251")
    out = html_utf8(page).decode("utf-8")
    assert "Дрель" in out and 'charset="utf-8"' in out


# ── выгрузка БАЗИСа ──────────────────────────────────────────────────────────
def test_bazis_model_without_panels():
    with pytest.raises(ValueError, match="нет панелей"):
        Model({"root": {"t": "list", "n": "пусто", "kids": []}})


def test_bazis_tilted_panel_rejected():
    panel = {"t": "panel", "n": "косая", "o": [0, 0, 0], "ex": [1, 0, 0], "ey": [0, 0.7071, 0.7071],
             "ez": [0, -0.7071, 0.7071], "th": 16, "c": [], "min": [0, 0, 0], "max": [100, 100, 100]}
    with pytest.raises(ValueError, match="не по осям"):
        Model({"root": {"t": "list", "n": "м", "kids": [panel]}})
