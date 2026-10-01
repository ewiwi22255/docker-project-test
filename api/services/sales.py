"""銷售管理：報價單、銷售單、客戶消費視覺化、客戶個人消費分析、收款。規則與舊版 frontend/page_sales.py 相同。"""

from __future__ import annotations

import sqlite3
from collections import defaultdict
from datetime import date, datetime

from api.db import one, rows, transaction
from api.errors import ConflictError, DomainError, NotFoundError

ORDER_STATUSES = ("處理中", "已出貨", "已取消")
OVERDUE_DAYS = 3


def _ym(value) -> str | None:
    text = str(value or "")
    return text[:7] if len(text) >= 7 and text[4] == "-" else None


def _parse_dt(value) -> datetime | None:
    text = str(value or "").strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(text[: len(datetime.now().strftime(fmt))], fmt)
        except ValueError:
            continue
    return None


def lookups() -> dict:
    return {
        "customers": rows("SELECT customer_id, name FROM customers ORDER BY name"),
        "products": rows("SELECT product_id, name, price, stock FROM inventory ORDER BY product_id"),
    }


# ── 報價單 ──────────────────────────────────────────────────────────
def list_quotations() -> list[dict]:
    return rows(
        """SELECT q.quote_id, q.customer_id, c.name AS customer_name, q.quote_date, q.status, q.total_amount, q.valid_until
           FROM quotations q LEFT JOIN customers c ON q.customer_id = c.customer_id
           ORDER BY q.quote_date DESC, q.quote_id DESC"""
    )


def create_quotation(data: dict) -> dict:
    total = data["qty"] * data["unit_price"]
    try:
        with transaction() as conn:
            conn.execute(
                "INSERT INTO quotations (quote_id, customer_id, quote_date, status, total_amount, valid_until) VALUES (?,?,?,?,?,?)",
                (data["quote_id"], data["customer_id"], datetime.now().strftime("%Y-%m-%d"), "有效", total, data["valid_until"]),
            )
            conn.execute(
                "INSERT INTO quotation_items (quote_id, product_id, qty, unit_price) VALUES (?,?,?,?)",
                (data["quote_id"], data["product_id"], data["qty"], float(data["unit_price"])),
            )
    except sqlite3.IntegrityError as exc:
        raise ConflictError("報價單號已存在") from exc
    return {"quote_id": data["quote_id"], "total_amount": total}


# ── 銷售單 ──────────────────────────────────────────────────────────
def create_order(data: dict) -> dict:
    status = data["status"]
    if status not in ORDER_STATUSES:
        raise DomainError("訂單狀態不正確")
    with transaction(immediate=True) as conn:
        found = conn.execute("SELECT stock, name, price FROM inventory WHERE product_id=?", (data["product_id"],)).fetchone()
        if not found:
            raise NotFoundError("找不到產品")
        stock, _name, unit_price = found
        qty = data["quantity"]
        total = qty * (unit_price or 0)
        if status != "已取消" and (stock or 0) < qty:
            raise DomainError(f"庫存不足，目前 {stock} 件")
        try:
            conn.execute(
                "INSERT INTO orders (order_id, customer_id, product_id, quantity, status, order_date, total_amount) VALUES (?,?,?,?,?,?,?)",
                (data["order_id"], data["customer_id"], data["product_id"], qty, status, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), total),
            )
        except sqlite3.IntegrityError as exc:
            raise ConflictError("訂單編號已存在") from exc
        if status != "已取消":
            conn.execute("UPDATE inventory SET stock=? WHERE product_id=?", ((stock or 0) - qty, data["product_id"]))
    return {"order_id": data["order_id"], "total_amount": total}


def recent_orders(limit: int = 100) -> list[dict]:
    return rows("SELECT order_id, status FROM orders ORDER BY order_date DESC LIMIT ?", (limit,))


def update_order_status(order_id: str, status: str) -> dict:
    if status not in ORDER_STATUSES:
        raise DomainError("訂單狀態不正確")
    with transaction() as conn:
        cur = conn.execute("UPDATE orders SET status=? WHERE order_id=?", (status, order_id))
        if cur.rowcount == 0:
            raise NotFoundError("找不到訂單")
    return {"order_id": order_id, "status": status}


def _alert(status: str, order_date, now: datetime) -> str:
    if status in ("已出貨", "已取消"):
        return "done"
    dt = _parse_dt(order_date)
    if dt and (now - dt).days >= OVERDUE_DAYS:
        return "overdue"
    return "pending"


def search_orders(keyword: str = "", start: date | None = None, end: date | None = None,
                  status: str = "全部", now: datetime | None = None) -> dict:
    now = now or datetime.now()
    start = start or date(2023, 1, 1)
    end = end or now.date()
    sql = """
        SELECT o.order_id, o.customer_id, c.name AS customer_name, o.product_id, i.name AS product_name,
               o.quantity, o.status, o.total_amount, o.order_date
        FROM orders o
        LEFT JOIN inventory i ON o.product_id = i.product_id
        LEFT JOIN customers c ON o.customer_id = c.customer_id
        WHERE DATE(o.order_date) >= ? AND DATE(o.order_date) <= ?
    """
    params: list = [start.isoformat(), end.isoformat()]
    if keyword:
        sql += " AND o.order_id LIKE ?"
        params.append(f"%{keyword}%")
    if status and status != "全部":
        sql += " AND o.status = ?"
        params.append(status)
    sql += " ORDER BY o.order_date DESC"
    found = rows(sql, params)
    for r in found:
        r["alert"] = _alert(r["status"], r["order_date"], now)

    total_amount = sum(r["total_amount"] or 0 for r in found)
    status_counts: dict[str, int] = defaultdict(int)
    daily: dict[str, float] = defaultdict(float)
    by_product: dict[str, int] = defaultdict(int)
    for r in found:
        status_counts[r["status"] or "未知"] += 1
        day = str(r["order_date"] or "")[:10]
        if day:
            daily[day] += r["total_amount"] or 0
        by_product[r["product_name"] or r["product_id"] or "未知"] += r["quantity"] or 0
    return {
        "orders": found,
        "analytics": {
            "total_amount": total_amount,
            "order_count": len(found),
            "total_quantity": sum(r["quantity"] or 0 for r in found),
            "average_order_value": total_amount / len(found) if found else 0,
            "status_distribution": [{"status": k, "count": v} for k, v in status_counts.items()],
            "daily_trend": [{"day": k, "amount": v} for k, v in sorted(daily.items())],
            "top_products": [{"product": k, "quantity": v} for k, v in sorted(by_product.items(), key=lambda kv: -kv[1])[:10]],
        },
    }


# ── 客戶消費視覺化 ──────────────────────────────────────────────────
def customer_overview(year: int, customer_id: str | None = None, now: datetime | None = None) -> dict:
    now = now or datetime.now()
    sql = """SELECT o.customer_id, c.name, o.order_date, o.quantity AS qty, o.total_amount AS amt
             FROM orders o LEFT JOIN customers c ON o.customer_id = c.customer_id
             WHERE o.status != '已取消'"""
    params: list = []
    if customer_id:
        sql += " AND o.customer_id = ?"
        params.append(customer_id)
    in_year = [r for r in rows(sql, params) if str(r["order_date"] or "")[:4] == str(year)]
    cur_month = now.strftime("%Y-%m")
    monthly = {f"{year}-{m:02d}": {"qty": 0, "amt": 0.0} for m in range(1, 13)}
    by_customer: dict[tuple, dict] = {}
    for r in in_year:
        ym = _ym(r["order_date"])
        if ym in monthly:
            monthly[ym]["qty"] += r["qty"] or 0
            monthly[ym]["amt"] += r["amt"] or 0
        key = (r["customer_id"], r["name"] or r["customer_id"])
        agg = by_customer.setdefault(key, {"customer_id": key[0], "name": key[1], "qty": 0, "amt": 0.0})
        agg["qty"] += r["qty"] or 0
        agg["amt"] += r["amt"] or 0
    return {
        "year": year,
        "has_data": bool(in_year),
        "metrics": {
            "month_qty": monthly.get(cur_month, {}).get("qty", 0) if str(year) == cur_month[:4] else 0,
            "ytd_qty": sum(r["qty"] or 0 for r in in_year),
            "ytd_amount": sum(r["amt"] or 0 for r in in_year),
        },
        "monthly": [{"month": k, **v} for k, v in monthly.items()],
        "by_customer": sorted(by_customer.values(), key=lambda x: -x["amt"]),
    }


# ── 客戶個人消費分析 ────────────────────────────────────────────────
def list_customers() -> list[dict]:
    return rows("SELECT customer_id, name, contact, phone, email FROM customers ORDER BY name")


def customer_detail(customer_id: str, year: int, now: datetime | None = None) -> dict | None:
    now = now or datetime.now()
    profile = one("SELECT customer_id, name, contact, phone, email FROM customers WHERE customer_id=?", (customer_id,))
    if not profile:
        return None
    match = "TRIM(customer_id) = TRIM(?) COLLATE NOCASE"
    valid = rows(f"SELECT order_date, quantity AS qty, total_amount AS amt FROM orders WHERE {match} AND status != '已取消'", (customer_id,))
    monthly = {f"{year}-{m:02d}": {"qty": 0, "amt": 0.0} for m in range(1, 13)}
    for r in valid:
        ym = _ym(r["order_date"])
        if ym in monthly:
            monthly[ym]["qty"] += r["qty"] or 0
            monthly[ym]["amt"] += r["amt"] or 0
    cur = monthly.get(now.strftime("%Y-%m"), {"qty": 0, "amt": 0.0})
    by_year = rows(
        f"""SELECT strftime('%Y', order_date) AS year, SUM(quantity) AS qty, SUM(total_amount) AS amt
            FROM orders WHERE {match} AND status != '已取消' AND order_date IS NOT NULL
            GROUP BY strftime('%Y', order_date) ORDER BY year""",
        (customer_id,),
    )
    if by_year:
        present = {r["year"]: r for r in by_year}
        lo, hi = int(by_year[0]["year"]), int(by_year[-1]["year"])
        by_year = [present.get(str(y), {"year": str(y), "qty": 0, "amt": 0}) for y in range(lo, hi + 1)]
    return {
        "profile": profile,
        "year": year,
        "metrics": {
            "month_qty": cur["qty"], "month_amount": cur["amt"],
            "ytd_qty": sum(v["qty"] for v in monthly.values()),
            "ytd_amount": sum(v["amt"] for v in monthly.values()),
            "lifetime_qty": sum(r["qty"] or 0 for r in valid),
            "lifetime_amount": sum(r["amt"] or 0 for r in valid),
        },
        "monthly": [{"month": k, **v} for k, v in monthly.items()],
        "by_product": rows(
            f"""SELECT COALESCE(i.name, '未命名') AS product_name, SUM(o.quantity) AS qty, SUM(o.total_amount) AS amt
                FROM orders o LEFT JOIN inventory i ON o.product_id = i.product_id
                WHERE TRIM(o.customer_id) = TRIM(?) COLLATE NOCASE AND o.status != '已取消'
                GROUP BY o.product_id, i.name HAVING SUM(o.total_amount) > 0 ORDER BY amt DESC""",
            (customer_id,),
        ),
        "status_distribution": rows(
            f"SELECT status, COUNT(*) AS count, SUM(total_amount) AS amount FROM orders WHERE {match} GROUP BY status",
            (customer_id,),
        ),
        "by_year": by_year,
        "orders": rows(
            """SELECT o.order_date, o.order_id, i.name AS product_name, o.quantity, o.total_amount, o.status
               FROM orders o LEFT JOIN inventory i ON o.product_id = i.product_id
               WHERE TRIM(o.customer_id) = TRIM(?) COLLATE NOCASE ORDER BY o.order_date DESC""",
            (customer_id,),
        ),
    }


def _lines(items, fmt, empty="無") -> str:
    text = "\n".join(fmt(i, x) for i, x in enumerate(items))
    return text or empty


def customer_ai_prompt(detail: dict) -> str:
    p, m, y = detail["profile"], detail["metrics"], detail["year"]
    return f"""
你是一位企業 CRM 與銷售分析顧問，請根據以下客戶資料，用繁體中文撰寫「客戶個人消費 AI 智慧分析」。

【客戶基本資料】
- 客戶名稱：{p['name']}
- 客戶代號：{p['customer_id']}
- 聯絡人：{p.get('contact') or '—'}
- 電話：{p.get('phone') or '—'}
- Email：{p.get('email') or '—'}
- 分析年度：{y}

【核心指標】
- 本月累積消費量：{m['month_qty']:,.0f} 件
- 本月消費金額：{m['month_amount']:,.0f} NTD
- 當年度累積消費量：{m['ytd_qty']:,.0f} 件
- 當年度總消費金額：{m['ytd_amount']:,.0f} NTD
- 歷年總消費量：{m['lifetime_qty']:,.0f} 件
- 歷年總消費金額：{m['lifetime_amount']:,.0f} NTD

【年度每月消費趨勢】
{_lines(detail['monthly'], lambda i, r: f"- {r['month']}：數量 {float(r['qty']):,.0f}，金額 {float(r['amt']):,.0f} NTD")}

【歷年消費趨勢】
{_lines(detail['by_year'], lambda i, r: f"- {r['year']}：數量 {float(r['qty'] or 0):,.0f}，金額 {float(r['amt'] or 0):,.0f} NTD")}

【主要產品消費】
{_lines(detail['by_product'][:5], lambda i, r: f"{i + 1}. {r['product_name']}：數量 {float(r['qty'] or 0):,.0f}，金額 {float(r['amt'] or 0):,.0f} NTD")}

【訂單狀態分布】
{_lines(detail['status_distribution'], lambda i, r: f"- {r['status']}：{int(r['count'])} 筆，金額 {float(r['amount'] or 0):,.0f} NTD")}

【最近 5 筆訂單】
{_lines(detail['orders'][:5], lambda i, r: f"- {r['order_date']}｜{r['order_id']}｜{r['product_name']}｜數量 {r['quantity']}｜金額 {float(r['total_amount'] or 0):,.0f}｜狀態 {r['status']}")}

請輸出：
1. 客戶消費輪廓摘要
2. 本年度消費趨勢判讀
3. 客戶偏好產品與可能需求
4. 風險提醒
5. 可執行的銷售建議（至少 3 點）
6. 客戶價值分級（高 / 中 / 低）與理由

請用繁體中文、條列、精簡、可直接呈現在 ERP 畫面上。
"""


def customer_ai_analysis(customer_id: str, year: int) -> str:
    from backend.llm_client import complete_text

    detail = customer_detail(customer_id, year)
    if detail is None:
        raise NotFoundError("找不到客戶")
    return (complete_text(customer_ai_prompt(detail), temperature=0.3, tag="analysis:crm_customer") or "").strip()


# ── 收款 ────────────────────────────────────────────────────────────
def list_payments(limit: int = 50) -> list[dict]:
    return rows(
        "SELECT payment_id, ref_type, ref_id, amount, payment_date, note FROM payments ORDER BY payment_id DESC LIMIT ?",
        (limit,),
    )


def create_payment(data: dict) -> dict:
    with transaction() as conn:
        cur = conn.execute(
            "INSERT INTO payments (ref_type, ref_id, amount, payment_date, note) VALUES (?,?,?,?,?)",
            (data["ref_type"], data["ref_id"], data["amount"], data["payment_date"], data.get("note") or None),
        )
        payment_id = cur.lastrowid
    return {"payment_id": payment_id}
