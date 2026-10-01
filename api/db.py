"""
api/db.py
API 層的資料庫小工具：查詢一律回傳 dict 清單（JSON 友善），寫入用 backend.database.transaction。
每次都讀 backend.database.DB_FILE，測試可直接換資料庫路徑。
"""

from __future__ import annotations

import math
import sqlite3
from typing import Any, Iterable

from backend import database


def _clean(value: Any) -> Any:
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return value


def rows(sql: str, params: Iterable[Any] = ()) -> list[dict]:
    conn = sqlite3.connect(database.DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        return [{k: _clean(r[k]) for k in r.keys()} for r in conn.execute(sql, tuple(params)).fetchall()]
    finally:
        conn.close()


def one(sql: str, params: Iterable[Any] = ()) -> dict | None:
    found = rows(sql, params)
    return found[0] if found else None


def scalar(sql: str, params: Iterable[Any] = (), default: Any = 0) -> Any:
    found = one(sql, params)
    if not found:
        return default
    value = next(iter(found.values()))
    return default if value is None else value


transaction = database.transaction
