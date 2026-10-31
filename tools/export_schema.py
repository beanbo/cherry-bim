# -*- coding: utf-8 -*-
"""Пересобирает schema/: JSON Schema пакета и словарь типов. Запуск: python tools/export_schema.py"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from cherrybim import SCHEMA_VERSION, Package  # noqa: E402
from cherrybim.ideas import Idea  # noqa: E402
from cherrybim.kinds import as_json  # noqa: E402

major_minor = ".".join(SCHEMA_VERSION.split(".")[:2])
(ROOT / f"schema/cherrybim-{major_minor}.schema.json").write_text(
    json.dumps(Package.model_json_schema(by_alias=True), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
(ROOT / f"schema/cherrybim-idea-{major_minor}.schema.json").write_text(
    json.dumps(Idea.model_json_schema(by_alias=True), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
(ROOT / "schema/kinds.json").write_text(json.dumps(as_json(), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print("schema/ обновлена, версия", SCHEMA_VERSION)
