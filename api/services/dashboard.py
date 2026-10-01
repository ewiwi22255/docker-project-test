"""營運總覽看板。

指標與舊版 frontend/page_dashboard.py 相同，另外補上新版介面需要的：
上月比較、近 24 個月走勢、待處理事項、產品庫存明細。全部來自資料庫實際資料，不做推估。

月份以伺服器當地時間判斷（容器設 Asia/Taipei）。舊版用 SQLite 的 'now'（UTC），
台灣凌晨 0–8 點會算成前一個月，這裡改由 Python 決定月份。
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from api.db import rows, scalar

OVERDUE_DAYS = 3  # 處理中超過 3 天視為逾期，與銷售單頁一致
NEAR_LOW_RATIO = 1.2  # 庫存在安全量 1.2 倍內：接近安全量


def _month(d: date) -> str:
    return d.strftime("%Y-%m")


def _shift_month(d: date, months: int) -> date:
    y, m = divmod(d.year * 12 + d.month - 1 + months, 12)
    return date(y, m + 1, 1)


def _stock_status(stock: int | None, reorder: int | None) -> str:
    if not reorder or reorder <= 0:
        return "normal"
    if (stock or 0) <= reorder:
        return "low"
    if (stock or 0) <= reorder * NEAR_LOW_RATIO:
        return "near"
    return "normal"


def summary(access: dict[str, list[str]] | None = None, now: datetime | None = None) -> dict:
    """access：這個人可用的模組；待處理事項只列他有權限處理的項目。"""
    access = access if access is not None else {"inventory": [], "procurement": [], "sales": []}
    now = now or datetime.now()
    today = now.date()
    this_month = _month(today)
    last_month = _month(_shift_month(today, -1))

    # ── 月度走勢（近 24 個月，補齊沒有訂單的月份）──
    first = _shift_month(today, -23)
    by_month = {
        r["month"]: r
        for r in rows(
            """SELECT substr(order_date, 1, 7) AS month, SUM(total_amount) AS revenue, COUNT(*) AS orders
               FROM orders WHERE status != '已取消' AND order_date >= ?
               GROUP BY substr(order_date, 1, 7)""",
            (first.isoformat(),),
        )
    }
    monthly = []
    for i in range(24):
        key = _month(_shift_month(first, i))
        r = by_month.get(key) or {}
        monthly.append({"month": key, "revenue": r.get("revenue") or 0, "orders": r.get("orders") or 0})
    current = {m["month"]: m for m in monthly}

    # ── 產品庫存明細 ──
    since = (today - timedelta(days=30)).isoformat()
    products = rows(
        """SELECT i.product_id, i.name, i.stock, i.reorder_point, i.price, i.cost,
                  COALESCE(s.qty, 0) AS sales_30d
           FROM inventory i
           LEFT JOIN (SELECT product_id, SUM(quantity) AS qty FROM orders
                      WHERE status != '已取消' AND order_date >= ? GROUP BY product_id) s
             ON s.product_id = i.product_id
           ORDER BY i.product_id""",
        (since,),
    )
    for p in products:
        p["status"] = _stock_status(p["stock"], p["reorder_point"])
    low_stock = [p for p in products if p["status"] == "low"]

    # ── 待處理事項（依權限）──
    attention: list[dict] = []
    if "inventory" in access:
        for p in low_stock:
            attention.append({
                "kind": "low_stock", "priority": "high", "count": 1,
                "title": f"{p['product_id']} {p['name']} 庫存低於安全量",
                "detail": f"目前 {p['stock']} 件，安全量 {p['reorder_point']} 件",
                "path": "/inventory/stock",
            })
    if "sales" in access:
        cutoff = (today - timedelta(days=OVERDUE_DAYS)).isoformat()
        overdue = rows(
            "SELECT order_id, order_date, total_amount FROM orders "
            "WHERE status = '處理中' AND substr(order_date, 1, 10) <= ? ORDER BY order_date",
            (cutoff,),
        )
        if overdue:
            attention.append({
                "kind": "overdue_order", "priority": "high", "count": len(overdue),
                "title": f"{len(overdue)} 張訂單處理中超過 {OVERDUE_DAYS} 天",
                "detail": f"最早一張 {overdue[0]['order_id']}（{str(overdue[0]['order_date'])[:10]}）",
                "path": "/sales/orders",
            })
    if "procurement" in access:
        pending_po = rows(
            "SELECT po_id, total_amount FROM purchase_orders WHERE status IN ('待入庫', '草稿') ORDER BY order_date DESC"
        )
        if pending_po:
            attention.append({
                "kind": "pending_po", "priority": "normal", "count": len(pending_po),
                "title": f"{len(pending_po)} 張採購單待入庫或草稿",
                "detail": f"最新一張 {pending_po[0]['po_id']}",
                "path": "/procurement/orders",
            })
        approvals = scalar(
            "SELECT COUNT(*) FROM pending_approvals WHERE status = 'pending' AND tool_name = 'create_purchase_order'"
        )
        if approvals:
            attention.append({
                "kind": "pending_approval", "priority": "normal", "count": int(approvals),
                "title": f"{approvals} 筆採購審批等待核准",
                "detail": "核准後才會建立採購單",
                "path": "/procurement/orders",
            })

    return {
        "as_of": now.isoformat(timespec="seconds"),
        "month": this_month,
        "kpis": {
            "revenue_this_month": current[this_month]["revenue"],
            "revenue_last_month": current[last_month]["revenue"],
            "orders_this_month": current[this_month]["orders"],
            "orders_last_month": current[last_month]["orders"],
            "inventory_value": scalar("SELECT SUM(stock * COALESCE(cost, 0)) FROM inventory"),
            "low_stock_count": len(low_stock),
            "pending_count": len(attention),
            "pending_high_priority": sum(1 for a in attention if a["priority"] == "high"),
        },
        "low_stock": [{k: p[k] for k in ("product_id", "name", "stock", "reorder_point")} for p in low_stock],
        "inventory_levels": [{k: p[k] for k in ("product_id", "name", "stock", "reorder_point")} for p in products],
        "order_status": rows("SELECT status, COUNT(*) AS count FROM orders GROUP BY status ORDER BY count DESC"),
        "top_products_this_month": rows(
            """SELECT COALESCE(i.name, o.product_id) AS name, SUM(o.quantity) AS quantity, SUM(o.total_amount) AS amount
               FROM orders o LEFT JOIN inventory i ON o.product_id = i.product_id
               WHERE o.status != '已取消' AND substr(o.order_date, 1, 7) = ?
               GROUP BY o.product_id, i.name ORDER BY quantity DESC LIMIT 10""",
            (this_month,),
        ),
        "monthly": monthly,
        "products": products,
        "attention": attention,
    }
