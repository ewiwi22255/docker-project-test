"""
tests/test_api_core_erp.py
前後端分離 API（api/）：登入權杖、模組權限、核心 ERP 讀寫行為與舊版一致。
"""

from __future__ import annotations

import sqlite3
import time

import pytest
from fastapi.testclient import TestClient

from backend import database
from api import security
from api.main import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    db_path = tmp_path / "api.db"
    monkeypatch.setattr(database, "DB_FILE", str(db_path))
    monkeypatch.setenv("ERP_API_SECRET", "test-secret")
    monkeypatch.delenv("ERP_ENABLE_DEMO_SEED", raising=False)
    database.init_db()
    return TestClient(create_app(initialize_database=False))


def _login(client, user):
    res = client.post("/api/auth/login", json={"username": user, "password": user})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['token']}"}


def _db(sql, params=()):
    with sqlite3.connect(database.DB_FILE) as conn:
        return conn.execute(sql, params).fetchall()


# ── 身分與權杖 ──────────────────────────────────────────────────────
def test_login_rejects_bad_password_and_unknown_user(client):
    assert client.post("/api/auth/login", json={"username": "admin", "password": "wrong"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": "nobody", "password": "x"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": "", "password": ""}).status_code == 422


def test_me_requires_valid_token(client):
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me", headers={"Authorization": "Bearer nonsense"}).status_code == 401
    headers = _login(client, "wh1")
    token = headers["Authorization"].split()[1]
    body, sig = token.split(".")
    tampered = {"Authorization": f"Bearer {body}.{sig[:-2]}xx"}
    assert client.get("/api/me", headers=tampered).status_code == 401
    me = client.get("/api/me", headers=headers).json()
    assert me["username"] == "wh1" and me["role"] == "warehouse" and me["role_name"] == "倉管部"


def test_expired_token_is_rejected(client):
    token, _ = security.issue_token("admin", now=time.time() - 10 * 24 * 3600)
    assert client.get("/api/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_revoked_user_is_rejected_on_next_request(client):
    headers = _login(client, "sales1")
    assert client.get("/api/me", headers=headers).status_code == 200
    with sqlite3.connect(database.DB_FILE) as conn:
        conn.execute("DELETE FROM user_organizations WHERE username='sales1'")
        conn.commit()
    assert client.get("/api/me", headers=headers).status_code == 401


# ── 模組權限（與舊版選單一致） ──────────────────────────────────────
@pytest.mark.parametrize("user,allowed,denied", [
    ("admin", ["/api/dashboard", "/api/inventory/products", "/api/procurement/purchase-orders", "/api/sales/quotations"], []),
    ("wh1", ["/api/dashboard", "/api/inventory/products", "/api/procurement/purchase-orders"], ["/api/sales/quotations"]),
    ("sales1", ["/api/dashboard", "/api/sales/quotations"], ["/api/inventory/products", "/api/procurement/purchase-orders"]),
    ("hr1", ["/api/dashboard"], ["/api/inventory/products", "/api/procurement/suppliers", "/api/sales/payments"]),
    ("viewer", [], ["/api/dashboard", "/api/inventory/products", "/api/sales/orders"]),
    ("planner", [], ["/api/dashboard", "/api/procurement/purchase-orders"]),
])
def test_module_guard_matches_legacy_menu(client, user, allowed, denied):
    headers = _login(client, user)
    for path in allowed:
        assert client.get(path, headers=headers).status_code == 200, path
    for path in denied:
        assert client.get(path, headers=headers).status_code == 403, path


def test_me_lists_migrated_and_legacy_modules(client):
    me = client.get("/api/me", headers=_login(client, "wh1")).json()
    assert set(me["modules"]) == {"dashboard", "inventory", "procurement"}
    assert "ERP CSV 交換" not in me["modules"]["procurement"]
    assert "🤖 AI 智能助理" in me["legacy_modules"]
    assert "📦 進銷存" not in me["legacy_modules"]


# ── 看板 ────────────────────────────────────────────────────────────
def test_dashboard_summary_shape(client):
    data = client.get("/api/dashboard", headers=_login(client, "admin")).json()
    assert {"revenue_this_month", "orders_this_month", "inventory_value", "low_stock_count",
            "revenue_last_month", "orders_last_month", "pending_count", "pending_high_priority"} == set(data["kpis"])
    assert data["kpis"]["low_stock_count"] == len(data["low_stock"])
    assert data["inventory_levels"] and {"product_id", "name", "stock", "reorder_point"} <= set(data["inventory_levels"][0])
    assert len(data["monthly"]) == 24 and data["monthly"][-1]["month"] == data["month"]
    assert {"status", "sales_30d"} <= set(data["products"][0])
    assert data["kpis"]["pending_count"] == len(data["attention"])


def test_dashboard_uses_local_month_and_scopes_attention(client):
    from datetime import datetime

    from api.services import dashboard

    # 台灣 10/1 凌晨 3 點：本月應是 10 月（舊寫法用 UTC 會算成 9 月）
    _db("INSERT INTO orders VALUES ('T-OCT', 'C001', 'P001', 1, '處理中', '2026-10-01 02:00:00', 100)")
    _db("INSERT INTO orders VALUES ('T-OLD', 'C001', 'P001', 1, '處理中', '2026-09-20 10:00:00', 50)")
    data = dashboard.summary({"sales": []}, now=datetime(2026, 10, 1, 3, 0))
    assert data["month"] == "2026-10" and data["kpis"]["orders_this_month"] >= 1
    assert data["kpis"]["revenue_this_month"] >= 100
    kinds = {a["kind"] for a in data["attention"]}
    assert "overdue_order" in kinds and "low_stock" not in kinds and "pending_po" not in kinds
    # 沒有任何業務模組（例如人資）就不列待處理事項
    assert dashboard.summary({}, now=datetime(2026, 10, 1, 3, 0))["attention"] == []
    hr = client.get("/api/dashboard", headers=_login(client, "hr1")).json()
    assert hr["attention"] == [] and hr["kpis"]["pending_count"] == 0


# ── 進銷存 ──────────────────────────────────────────────────────────
def test_create_product_and_duplicate_is_conflict(client):
    headers = _login(client, "wh1")
    body = {"product_id": "T-001", "name": "測試品", "price": 100, "cost": 60, "stock": 5, "reorder_point": 2, "daily_sales": 1}
    assert client.post("/api/inventory/products", json=body, headers=headers).status_code == 201
    assert client.post("/api/inventory/products", json=body, headers=headers).status_code == 409
    assert _db("SELECT baseline_reorder_point, warehouse_id FROM inventory WHERE product_id='T-001'") == [(2, "WH01")]
    bad = dict(body, product_id="T-002", price=-1)
    assert client.post("/api/inventory/products", json=bad, headers=headers).status_code == 422


def test_stock_move_updates_stock_and_blocks_negative(client):
    headers = _login(client, "wh1")
    pid, stock = _db("SELECT product_id, stock FROM inventory ORDER BY product_id LIMIT 1")[0]
    res = client.post("/api/inventory/moves", json={"product_id": pid, "move_type": "出庫", "qty": 1}, headers=headers)
    assert res.status_code == 201 and res.json()["stock"] == stock - 1
    assert _db("SELECT qty, move_type FROM stock_moves ORDER BY move_id DESC LIMIT 1") == [(-1, "出庫")]
    res = client.post("/api/inventory/moves", json={"product_id": pid, "move_type": "出庫", "qty": 10**6}, headers=headers)
    assert res.status_code == 400 and "庫存不足" in res.json()["detail"]
    assert _db("SELECT stock FROM inventory WHERE product_id=?", (pid,)) == [(stock - 1,)]
    assert client.post("/api/inventory/moves", json={"product_id": "NOPE", "move_type": "入庫", "qty": 1}, headers=headers).status_code == 404


def test_product_options_available_to_warehouse_but_not_sales_only_roles(client):
    # 倉管沒有銷售模組，出入庫頁的商品下拉必須走進銷存自己的端點
    options = client.get("/api/inventory/product-options", headers=_login(client, "wh1"))
    assert options.status_code == 200 and options.json()
    assert {"product_id", "name", "stock"} <= set(options.json()[0])
    assert client.get("/api/sales/lookups", headers=_login(client, "wh1")).status_code == 403
    assert client.get("/api/inventory/product-options", headers=_login(client, "hr1")).status_code == 403


def test_barcode_lookup_and_warehouse_create(client):
    headers = _login(client, "wh1")
    pid = _db("SELECT product_id FROM inventory LIMIT 1")[0][0]
    assert client.get(f"/api/inventory/barcode/{pid}", headers=headers).json()["product_id"] == pid
    assert client.get("/api/inventory/barcode/NOTHING", headers=headers).status_code == 404
    wh = {"warehouse_id": "WH-T", "name": "測試倉"}
    assert client.post("/api/inventory/warehouses", json=wh, headers=headers).status_code == 201
    assert client.post("/api/inventory/warehouses", json=wh, headers=headers).status_code == 409


def test_restock_suggestions_apply_and_draft_po(client):
    headers = _login(client, "wh1")
    suggestions = client.get("/api/inventory/restock-suggestions", headers=headers).json()
    assert suggestions and {"suggested_reorder_point", "suggested_order_qty", "daily_sales"} <= set(suggestions[0])
    assert client.post("/api/inventory/restock-suggestions/apply", headers=headers).json()["updated"] == len(suggestions)
    with sqlite3.connect(database.DB_FILE) as conn:
        conn.execute("UPDATE inventory SET stock = 0")
        conn.commit()
    created = client.post("/api/inventory/restock-suggestions/purchase-order", headers=headers).json()
    assert created["created"] and created["purchase_order"]["po_id"].startswith("PO-AI-")
    assert _db("SELECT status FROM purchase_orders WHERE po_id=?", (created["purchase_order"]["po_id"],)) == [("草稿",)]


# ── 採購 ────────────────────────────────────────────────────────────
def test_purchase_order_goes_through_gateway_approval(client):
    headers = _login(client, "wh1")
    opts = client.get("/api/procurement/form-options", headers=headers).json()
    assert opts["suppliers"] and opts["products"]
    body = {
        "po_id": "PO-API-TEST", "supplier_id": opts["suppliers"][0]["supplier_id"],
        "product_id": opts["products"][0]["product_id"], "qty": 3, "unit_price": 10.5,
        "operation_id": "op-api-test-0001",
    }
    res = client.post("/api/procurement/purchase-orders", json=body, headers=headers)
    assert res.status_code == 202, res.text
    result = res.json()
    assert result["status"] == "pending" and result["approval_id"]
    # 尚未核准：採購單不能被直接寫入
    assert _db("SELECT COUNT(*) FROM purchase_orders WHERE po_id='PO-API-TEST'") == [(0,)]
    approval = client.get(f"/api/procurement/approvals/{result['approval_id']}", headers=headers).json()
    assert approval["status"] == "pending"
    # 別人查不到自己的審批單
    assert client.get(f"/api/procurement/approvals/{result['approval_id']}", headers=_login(client, "sales1")).status_code == 403


def test_supplier_create_and_region_factor_suggestion(client):
    headers = _login(client, "wh1")
    body = {"supplier_id": "S-API", "name": "API 供應商", "country": "台灣", "region": "亞洲", "risk_level": "中"}
    assert client.post("/api/procurement/suppliers", json=body, headers=headers).status_code == 201
    assert client.post("/api/procurement/suppliers", json=body, headers=headers).status_code == 409
    data = client.get("/api/procurement/suppliers", headers=headers).json()
    assert any(s["supplier_id"] == "S-API" for s in data["suppliers"])
    for f in data["region_factors"]:
        assert f["suggested_level"] in {"高", "中", "低"}


# ── 銷售 ────────────────────────────────────────────────────────────
def test_order_create_deducts_stock_and_cancelled_does_not(client):
    headers = _login(client, "sales1")
    lk = client.get("/api/sales/lookups", headers=headers).json()
    cust = lk["customers"][0]["customer_id"]
    product = max(lk["products"], key=lambda p: p["stock"])
    pid, stock = product["product_id"], product["stock"]
    res = client.post("/api/sales/orders", json={"order_id": "ORD-API-1", "customer_id": cust, "product_id": pid, "quantity": 2}, headers=headers)
    assert res.status_code == 201 and res.json()["total_amount"] == 2 * product["price"]
    assert _db("SELECT stock FROM inventory WHERE product_id=?", (pid,)) == [(stock - 2,)]
    res = client.post("/api/sales/orders", json={"order_id": "ORD-API-2", "customer_id": cust, "product_id": pid, "quantity": 1, "status": "已取消"}, headers=headers)
    assert res.status_code == 201
    assert _db("SELECT stock FROM inventory WHERE product_id=?", (pid,)) == [(stock - 2,)]
    too_many = {"order_id": "ORD-API-3", "customer_id": cust, "product_id": pid, "quantity": 10**6}
    assert client.post("/api/sales/orders", json=too_many, headers=headers).status_code == 400
    assert client.post("/api/sales/orders", json={**too_many, "order_id": "ORD-API-1", "quantity": 1}, headers=headers).status_code == 409
    assert client.patch("/api/sales/orders/ORD-API-1", json={"status": "已出貨"}, headers=headers).json()["status"] == "已出貨"
    assert client.patch("/api/sales/orders/NOPE", json={"status": "已出貨"}, headers=headers).status_code == 404


def test_order_search_filters_and_analytics(client):
    headers = _login(client, "sales1")
    data = client.get("/api/sales/orders", params={"start": "2020-01-01", "status": "全部"}, headers=headers).json()
    a = data["analytics"]
    assert a["order_count"] == len(data["orders"])
    assert a["total_amount"] == pytest.approx(sum(o["total_amount"] or 0 for o in data["orders"]))
    assert all(o["alert"] in {"done", "pending", "overdue"} for o in data["orders"])
    shipped = client.get("/api/sales/orders", params={"start": "2020-01-01", "status": "已出貨"}, headers=headers).json()
    assert all(o["status"] == "已出貨" for o in shipped["orders"])


def test_customer_overview_and_detail(client):
    headers = _login(client, "sales1")
    customers = client.get("/api/sales/customers", headers=headers).json()
    cid = customers[0]["customer_id"]
    year = int(_db("SELECT strftime('%Y', MAX(order_date)) FROM orders")[0][0])
    ov = client.get("/api/sales/customer-overview", params={"year": year}, headers=headers).json()
    assert len(ov["monthly"]) == 12 and ov["metrics"]["ytd_amount"] == pytest.approx(sum(m["amt"] for m in ov["monthly"]))
    detail = client.get(f"/api/sales/customers/{cid}", params={"year": year}, headers=headers).json()
    assert detail["profile"]["customer_id"] == cid and len(detail["monthly"]) == 12
    assert client.get("/api/sales/customers/NOPE", params={"year": year}, headers=headers).status_code == 404


def test_customer_ai_analysis_uses_llm_and_hides_errors(client, monkeypatch):
    import backend.llm_client as lc

    headers = _login(client, "sales1")
    cid = client.get("/api/sales/customers", headers=headers).json()[0]["customer_id"]
    seen = {}
    monkeypatch.setattr(lc, "complete_text", lambda prompt, **kw: seen.setdefault("prompt", prompt) and "分析結果")
    res = client.post(f"/api/sales/customers/{cid}/ai-analysis", params={"year": 2026}, headers=headers)
    assert res.json()["text"] == "分析結果" and "客戶個人消費 AI 智慧分析" in seen["prompt"]

    def boom(*a, **kw):
        raise RuntimeError("secret upstream detail")

    monkeypatch.setattr(lc, "complete_text", boom)
    res = client.post(f"/api/sales/customers/{cid}/ai-analysis", params={"year": 2026}, headers=headers)
    assert res.status_code == 502 and "secret" not in res.text


def test_quotation_and_payment_create(client):
    headers = _login(client, "sales1")
    lk = client.get("/api/sales/lookups", headers=headers).json()
    q = {"quote_id": "QT-API", "customer_id": lk["customers"][0]["customer_id"], "product_id": lk["products"][0]["product_id"],
         "qty": 2, "unit_price": 50, "valid_until": "2026-12-31"}
    assert client.post("/api/sales/quotations", json=q, headers=headers).json()["total_amount"] == 100
    assert client.post("/api/sales/quotations", json=q, headers=headers).status_code == 409
    assert _db("SELECT COUNT(*) FROM quotation_items WHERE quote_id='QT-API'") == [(1,)]
    pay = {"ref_id": "ORD-X", "amount": 99.5, "payment_date": "2026-09-30"}
    assert client.post("/api/sales/payments", json=pay, headers=headers).status_code == 201
    assert client.post("/api/sales/payments", json={**pay, "amount": 0}, headers=headers).status_code == 422
    assert client.get("/api/sales/payments", headers=headers).json()[0]["ref_id"] == "ORD-X"


def test_unexpected_errors_do_not_leak_details(client, monkeypatch):
    from api.services import dashboard

    def boom():
        raise RuntimeError("internal path C:/secret")

    monkeypatch.setattr(dashboard, "summary", boom)
    res = TestClient(create_app(initialize_database=False), raise_server_exceptions=False).get(
        "/api/dashboard", headers=_login(client, "admin")
    )
    assert res.status_code == 500 and "secret" not in res.text
