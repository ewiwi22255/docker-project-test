"""進銷存：商品、庫存、智慧補貨、出入庫、條碼、倉庫。規則與舊版 frontend/page_inventory.py 相同。"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta

from api.db import one, rows, transaction
from api.errors import ConflictError, DomainError, NotFoundError

SALES_WINDOW_DAYS = 30
LEAD_TIME_DAYS = 7
BUFFER_DAYS = 3


# ── 商品 ────────────────────────────────────────────────────────────
def list_products() -> list[dict]:
    return rows(
        "SELECT product_id, name, barcode, stock, price, cost, reorder_point, baseline_reorder_point, "
        "daily_sales, warehouse_id FROM inventory ORDER BY product_id"
    )


def create_product(data: dict) -> dict:
    try:
        with transaction() as conn:
            conn.execute(
                """INSERT INTO inventory (product_id, name, stock, price, cost, reorder_point,
                       baseline_reorder_point, daily_sales, barcode, warehouse_id)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (
                    data["product_id"], data["name"], data["stock"], data["price"], data["cost"] or 0,
                    data["reorder_point"], data["reorder_point"], data["daily_sales"],
                    data.get("barcode") or None, data.get("warehouse_id") or "WH01",
                ),
            )
    except sqlite3.IntegrityError as exc:
        raise ConflictError("產品編號已存在") from exc
    return one("SELECT * FROM inventory WHERE product_id=?", (data["product_id"],))


# ── 庫存數量 ────────────────────────────────────────────────────────
def stock_overview() -> list[dict]:
    return rows(
        """SELECT product_id, name, stock, reorder_point, baseline_reorder_point, warehouse_id,
                  CASE
                    WHEN stock <= reorder_point THEN 'restock'
                    WHEN reorder_point > baseline_reorder_point THEN 'ai_adjusted'
                    ELSE 'normal'
                  END AS status
           FROM inventory ORDER BY product_id"""
    )


def restock_suggestions(now: datetime | None = None) -> list[dict]:
    """近 30 天實際銷量 → 日均銷量 → 建議安全庫存（前置 7 天＋緩衝 3 天）與建議進貨量（多補一週）。"""
    since = ((now or datetime.now()) - timedelta(days=SALES_WINDOW_DAYS)).strftime("%Y-%m-%d %H:%M:%S")
    sold = {
        r["product_id"]: r["total_qty"] or 0
        for r in rows(
            "SELECT product_id, SUM(quantity) AS total_qty FROM orders "
            "WHERE status != '已取消' AND order_date >= ? GROUP BY product_id",
            (since,),
        )
    }
    result = []
    for p in rows("SELECT product_id, name, stock, reorder_point, price FROM inventory ORDER BY product_id"):
        total = sold.get(p["product_id"], 0)
        daily = round(total / SALES_WINDOW_DAYS, 1) if total > 0 else 0.1
        suggested_rop = max(int(daily * (LEAD_TIME_DAYS + BUFFER_DAYS)), 1)
        stock = p["stock"] or 0
        buy = max(suggested_rop - stock + int(daily * 7), 1) if stock <= suggested_rop else 0
        result.append({
            "product_id": p["product_id"], "name": p["name"], "stock": stock,
            "reorder_point": p["reorder_point"], "price": p["price"],
            "daily_sales": daily, "suggested_reorder_point": suggested_rop, "suggested_order_qty": buy,
        })
    return result


def apply_restock_suggestions() -> int:
    suggestions = restock_suggestions()
    with transaction() as conn:
        for s in suggestions:
            conn.execute(
                "UPDATE inventory SET reorder_point=?, baseline_reorder_point=?, daily_sales=? WHERE product_id=?",
                (s["suggested_reorder_point"], s["suggested_reorder_point"], s["daily_sales"], s["product_id"]),
            )
    return len(suggestions)


def create_suggested_po(now: datetime | None = None) -> dict | None:
    """為建議進貨量 > 0 的品項建立一張「草稿」採購單（與舊版相同：預設第一家供應商、成本以售價七折估）。"""
    to_buy = [s for s in restock_suggestions(now) if s["suggested_order_qty"] > 0]
    if not to_buy:
        return None
    stamp = now or datetime.now()
    po_id = f"PO-AI-{stamp.strftime('%Y%m%d%H%M')}"
    with transaction() as conn:
        sup = conn.execute("SELECT supplier_id FROM suppliers LIMIT 1").fetchone()
        supplier_id = sup[0] if sup else "SUP_UNKNOWN"
        total = 0.0
        for s in to_buy:
            unit_price = (s["price"] or 0) * 0.7
            total += unit_price * s["suggested_order_qty"]
            conn.execute(
                "INSERT INTO purchase_order_items (po_id, product_id, qty, unit_price) VALUES (?,?,?,?)",
                (po_id, s["product_id"], s["suggested_order_qty"], unit_price),
            )
        try:
            conn.execute(
                "INSERT INTO purchase_orders (po_id, supplier_id, order_date, status, total_amount, note) VALUES (?,?,?,?,?,?)",
                (po_id, supplier_id, stamp.strftime("%Y-%m-%d"), "草稿", total, "AI 智慧自動生成補貨單"),
            )
        except sqlite3.IntegrityError as exc:
            raise ConflictError(f"採購單 {po_id} 已存在，請稍後一分鐘再產生") from exc
    return {"po_id": po_id, "items": len(to_buy), "total_amount": total, "supplier_id": supplier_id}


# ── 入庫／出庫 ──────────────────────────────────────────────────────
def stock_move(product_id: str, move_type: str, qty: int, ref_no: str = "", note: str = "") -> dict:
    if move_type not in {"入庫", "出庫"}:
        raise DomainError("類型必須是入庫或出庫")
    delta = qty if move_type == "入庫" else -qty
    with transaction(immediate=True) as conn:
        found = conn.execute("SELECT stock, name, warehouse_id FROM inventory WHERE product_id=?", (product_id,)).fetchone()
        if not found:
            raise NotFoundError("找不到商品")
        current, name, warehouse_id = found
        if (current or 0) + delta < 0:
            raise DomainError(f"庫存不足，目前 {current} 件")
        conn.execute("UPDATE inventory SET stock=? WHERE product_id=?", ((current or 0) + delta, product_id))
        conn.execute(
            "INSERT INTO stock_moves (product_id, warehouse_id, qty, move_type, ref_no, move_date, note) VALUES (?,?,?,?,?,?,?)",
            (product_id, warehouse_id, delta, move_type, ref_no or None, datetime.now().strftime("%Y-%m-%d %H:%M"), note or None),
        )
    return {"product_id": product_id, "name": name, "stock": (current or 0) + delta}


def recent_moves(limit: int = 30) -> list[dict]:
    return rows(
        "SELECT move_id, product_id, qty, move_type, ref_no, move_date, note FROM stock_moves ORDER BY move_id DESC LIMIT ?",
        (limit,),
    )


def lookup_barcode(code: str) -> dict | None:
    code = (code or "").strip()
    if not code:
        return None
    return one("SELECT product_id, name, stock, price FROM inventory WHERE barcode=? OR product_id=?", (code, code))


# ── 倉庫 ────────────────────────────────────────────────────────────
def list_warehouses() -> list[dict]:
    return rows("SELECT warehouse_id, name, address FROM warehouses ORDER BY warehouse_id")


def create_warehouse(warehouse_id: str, name: str, address: str = "") -> dict:
    try:
        with transaction() as conn:
            conn.execute("INSERT INTO warehouses (warehouse_id, name, address) VALUES (?,?,?)", (warehouse_id, name, address or ""))
    except sqlite3.IntegrityError as exc:
        raise ConflictError("倉庫代號已存在") from exc
    return {"warehouse_id": warehouse_id, "name": name, "address": address or ""}
