"""採購管理：採購單（經交易閘道送審）、供應商、進貨成本、採購歷史。規則與舊版 frontend/page_procurement.py 相同。"""

from __future__ import annotations

import sqlite3
from datetime import datetime

from backend.access_control import AccessContext
from backend.agent_logger import get_pending_approval_by_id
from backend.tool_gateway import gateway

from api.db import rows, transaction
from api.errors import ConflictError, DomainError, NotFoundError

REGION_HIGH_SCORE = 70
REGION_MEDIUM_SCORE = 40


def list_purchase_orders() -> list[dict]:
    return rows(
        """SELECT p.po_id, p.supplier_id, s.name AS supplier_name, p.order_date, p.status, p.total_amount, p.note
           FROM purchase_orders p LEFT JOIN suppliers s ON p.supplier_id = s.supplier_id
           ORDER BY p.order_date DESC, p.po_id DESC"""
    )


def create_purchase_order(principal: AccessContext, data: dict, operation_id: str) -> dict:
    """不直接寫資料表：交給交易閘道，閘道會建立審批單，核准後才真正建立採購單。"""
    result = gateway.call(
        "create_purchase_order",
        {
            "po_id": data["po_id"].strip(),
            "supplier_id": data["supplier_id"],
            "product_id": data["product_id"],
            "qty": int(data["qty"]),
            "unit_price": float(data["unit_price"]),
            "order_date": datetime.now().strftime("%Y-%m-%d"),
            "status": "待入庫",
            "note": data.get("note") or "",
        },
        role=principal.role,
        actor=principal.username,
        agent_name="procurement_agent",
        operation_id=operation_id,
    )
    return {"status": result.status, "approval_id": result.approval_id, "message": result.message}


def approval_status(principal: AccessContext, approval_id: str) -> dict | None:
    """只回傳自己送出的採購審批單狀態（管理員可看全部）。"""
    approval = get_pending_approval_by_id(approval_id)
    if not approval or approval.get("tool_name") != "create_purchase_order":
        return None
    if principal.role != "admin" and approval.get("requester_username") != principal.username:
        return None
    return {"approval_id": approval_id, "status": approval.get("status"), "reason": approval.get("reason") or ""}


# ── 供應商 ──────────────────────────────────────────────────────────
def list_suppliers() -> list[dict]:
    return rows(
        """SELECT supplier_id, name, contact, phone, email, country, region, risk_level, is_official
           FROM suppliers ORDER BY is_official DESC, supplier_id ASC"""
    )


def official_suppliers() -> list[dict]:
    return rows("SELECT supplier_id, name FROM suppliers WHERE is_official = 1 ORDER BY supplier_id")


def region_risk_factors() -> list[dict]:
    """「風險係數管理」中的地區係數，附建議風險等級（加權分 ≥70 高、40–69 中、<40 低）。"""
    try:
        found = rows("SELECT risk_key, risk_score, weight FROM esg_risk_factors WHERE risk_type = 'region' ORDER BY risk_key")
    except sqlite3.OperationalError:
        return []
    for r in found:
        score = (r["risk_score"] or 0) * (r["weight"] or 0)
        r["weighted_score"] = score
        r["suggested_level"] = "高" if score >= REGION_HIGH_SCORE else "中" if score >= REGION_MEDIUM_SCORE else "低"
    return found


def create_supplier(data: dict) -> dict:
    try:
        with transaction() as conn:
            conn.execute(
                """INSERT INTO suppliers (supplier_id, name, contact, phone, email, country, region, latitude, longitude, risk_level)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (
                    data["supplier_id"], data["name"], data.get("contact") or "", data.get("phone") or "",
                    data.get("email") or "", data.get("country") or None, data.get("region") or None,
                    None, None, data.get("risk_level") or None,
                ),
            )
    except sqlite3.IntegrityError as exc:
        raise ConflictError("供應商代號已存在") from exc
    return {"supplier_id": data["supplier_id"], "name": data["name"]}


# ── 進貨成本／採購歷史 ──────────────────────────────────────────────
def product_costs() -> list[dict]:
    return rows("SELECT product_id, name, cost, price FROM inventory ORDER BY product_id")


def purchase_history(limit: int = 100) -> list[dict]:
    return rows(
        """SELECT poi.po_id, p.order_date, s.name AS supplier_name, inv.name AS product_name,
                  poi.qty, poi.unit_price, (poi.qty * poi.unit_price) AS subtotal
           FROM purchase_order_items poi JOIN purchase_orders p ON poi.po_id = p.po_id
           LEFT JOIN suppliers s ON p.supplier_id = s.supplier_id
           LEFT JOIN inventory inv ON poi.product_id = inv.product_id
           ORDER BY p.order_date DESC LIMIT ?""",
        (limit,),
    )
