"""
api/routers.py
所有 HTTP 端點。每個端點先過「模組權限」依賴（與舊版選單相同），再呼叫 api/services。
"""

from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend import check_login
from backend.access_control import AccessContext, load_principal

from api import schemas
from api.errors import NotFoundError
from api.navigation import ROLE_NAMES, effective_product_levels, legacy_modules, module_access, require_module
from api.security import current_principal, issue_token
from api.services import dashboard, inventory, procurement, sales

router = APIRouter(prefix="/api")


def _profile(principal: AccessContext) -> dict:
    return {
        "username": principal.username,
        "name": principal.name,
        "role": principal.role,
        "role_name": ROLE_NAMES.get(principal.role, principal.role),
        "product_levels": list(effective_product_levels(principal)),
        "modules": module_access(principal),
        "legacy_modules": legacy_modules(principal),
    }


# ── 身分 ────────────────────────────────────────────────────────────
@router.post("/auth/login")
def login(body: schemas.LoginIn):
    if not check_login(body.username, body.password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "帳號或密碼錯誤")
    principal = load_principal(body.username)
    if principal is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "帳號未加入任何組織，無法登入")
    token, expires = issue_token(principal.username)
    return {"token": token, "expires_at": expires, "user": _profile(principal)}


@router.get("/me")
def me(principal: AccessContext = Depends(current_principal)):
    return _profile(principal)


@router.get("/health")
def health():
    return {"status": "ok", "time": datetime.now().isoformat(timespec="seconds")}


# ── 營運分析看板 ────────────────────────────────────────────────────
@router.get("/dashboard")
def get_dashboard(principal: AccessContext = Depends(require_module("dashboard"))):
    return dashboard.summary(module_access(principal))


# ── 進銷存 ──────────────────────────────────────────────────────────
@router.get("/inventory/products")
def get_products(_: AccessContext = Depends(require_module("inventory", "商品管理"))):
    return inventory.list_products()


@router.post("/inventory/products", status_code=201)
def post_product(body: schemas.ProductIn, _: AccessContext = Depends(require_module("inventory", "商品管理"))):
    return inventory.create_product(body.model_dump())


@router.get("/inventory/product-options")
def get_product_options(_: AccessContext = Depends(require_module("inventory"))):
    """表單下拉用的精簡商品清單（入庫／出庫等頁面）。"""
    return sales.lookups()["products"]


@router.get("/inventory/stock")
def get_stock(_: AccessContext = Depends(require_module("inventory", "庫存數量"))):
    return inventory.stock_overview()


@router.get("/inventory/restock-suggestions")
def get_restock(_: AccessContext = Depends(require_module("inventory", "庫存數量"))):
    return inventory.restock_suggestions()


@router.post("/inventory/restock-suggestions/apply")
def apply_restock(_: AccessContext = Depends(require_module("inventory", "庫存數量"))):
    return {"updated": inventory.apply_restock_suggestions()}


@router.post("/inventory/restock-suggestions/purchase-order")
def restock_po(_: AccessContext = Depends(require_module("inventory", "庫存數量"))):
    created = inventory.create_suggested_po()
    return {"created": created is not None, "purchase_order": created}


@router.get("/inventory/moves")
def get_moves(_: AccessContext = Depends(require_module("inventory", "入庫/出庫"))):
    return inventory.recent_moves()


@router.post("/inventory/moves", status_code=201)
def post_move(body: schemas.StockMoveIn, _: AccessContext = Depends(require_module("inventory", "入庫/出庫"))):
    return inventory.stock_move(body.product_id, body.move_type, body.qty, body.ref_no or "", body.note or "")


@router.get("/inventory/barcode/{code}")
def get_barcode(code: str, _: AccessContext = Depends(require_module("inventory", "條碼掃描"))):
    found = inventory.lookup_barcode(code)
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "找不到此條碼對應的商品")
    return found


@router.get("/inventory/warehouses")
def get_warehouses(principal: AccessContext = Depends(current_principal)):
    # 倉庫清單也是「新增商品」表單的下拉選項，所以有商品管理或倉庫管理任一權限即可讀
    subs = module_access(principal).get("inventory", [])
    if "倉庫管理" not in subs and "商品管理" not in subs:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "此帳號沒有這項功能的權限")
    return inventory.list_warehouses()


@router.post("/inventory/warehouses", status_code=201)
def post_warehouse(body: schemas.WarehouseIn, _: AccessContext = Depends(require_module("inventory", "倉庫管理"))):
    return inventory.create_warehouse(body.warehouse_id, body.name, body.address or "")


# ── 採購管理 ────────────────────────────────────────────────────────
@router.get("/procurement/purchase-orders")
def get_pos(_: AccessContext = Depends(require_module("procurement", "採購單"))):
    return procurement.list_purchase_orders()


@router.get("/procurement/form-options")
def get_po_options(_: AccessContext = Depends(require_module("procurement", "採購單"))):
    return {
        "suppliers": procurement.official_suppliers(),
        "products": sales.lookups()["products"],
    }


@router.post("/procurement/purchase-orders", status_code=202)
def post_po(body: schemas.PurchaseOrderIn, principal: AccessContext = Depends(require_module("procurement", "採購單"))):
    result = procurement.create_purchase_order(principal, body.model_dump(), body.operation_id)
    if result["status"] not in {"pending", "ok"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, result["message"] or "採購單送審失敗")
    return result


@router.get("/procurement/approvals/{approval_id}")
def get_po_approval(approval_id: str, principal: AccessContext = Depends(require_module("procurement", "採購單"))):
    found = procurement.approval_status(principal, approval_id)
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "找不到審批單")
    return found


@router.get("/procurement/suppliers")
def get_suppliers(_: AccessContext = Depends(require_module("procurement", "供應商管理"))):
    return {"suppliers": procurement.list_suppliers(), "region_factors": procurement.region_risk_factors()}


@router.post("/procurement/suppliers", status_code=201)
def post_supplier(body: schemas.SupplierIn, _: AccessContext = Depends(require_module("procurement", "供應商管理"))):
    return procurement.create_supplier(body.model_dump())


@router.get("/procurement/costs")
def get_costs(_: AccessContext = Depends(require_module("procurement", "進貨成本"))):
    return procurement.product_costs()


@router.get("/procurement/history")
def get_history(_: AccessContext = Depends(require_module("procurement", "採購歷史"))):
    return procurement.purchase_history()


# ── 銷售管理 ────────────────────────────────────────────────────────
@router.get("/sales/lookups")
def get_lookups(_: AccessContext = Depends(require_module("sales"))):
    return sales.lookups()


@router.get("/sales/quotations")
def get_quotes(_: AccessContext = Depends(require_module("sales", "報價單"))):
    return sales.list_quotations()


@router.post("/sales/quotations", status_code=201)
def post_quote(body: schemas.QuotationIn, _: AccessContext = Depends(require_module("sales", "報價單"))):
    data = body.model_dump()
    data["valid_until"] = body.valid_until.isoformat()
    return sales.create_quotation(data)


@router.get("/sales/orders")
def get_orders(
    keyword: str = Query(default="", max_length=80),
    start: date | None = None,
    end: date | None = None,
    status_filter: str = Query(default="全部", alias="status"),
    _: AccessContext = Depends(require_module("sales", "銷售單")),
):
    return sales.search_orders(keyword.strip(), start, end, status_filter)


@router.get("/sales/orders/recent")
def get_recent_orders(_: AccessContext = Depends(require_module("sales", "銷售單"))):
    return sales.recent_orders()


@router.post("/sales/orders", status_code=201)
def post_order(body: schemas.OrderIn, _: AccessContext = Depends(require_module("sales", "銷售單"))):
    return sales.create_order(body.model_dump())


@router.patch("/sales/orders/{order_id}")
def patch_order(order_id: str, body: schemas.OrderStatusIn, _: AccessContext = Depends(require_module("sales", "銷售單"))):
    return sales.update_order_status(order_id, body.status)


@router.get("/sales/customer-overview")
def get_customer_overview(
    year: int = Query(ge=2000, le=2100),
    customer_id: str | None = None,
    _: AccessContext = Depends(require_module("sales", "客戶消費視覺化")),
):
    return sales.customer_overview(year, customer_id or None)


@router.get("/sales/customers")
def get_customers(_: AccessContext = Depends(require_module("sales"))):
    return sales.list_customers()


@router.get("/sales/customers/{customer_id}")
def get_customer(
    customer_id: str,
    year: int = Query(ge=2000, le=2100),
    _: AccessContext = Depends(require_module("sales", "客戶個人消費分析")),
):
    found = sales.customer_detail(customer_id, year)
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "找不到客戶")
    return found


@router.post("/sales/customers/{customer_id}/ai-analysis")
def post_customer_ai(
    customer_id: str,
    year: int = Query(ge=2000, le=2100),
    _: AccessContext = Depends(require_module("sales", "客戶個人消費分析")),
):
    try:
        text = sales.customer_ai_analysis(customer_id, year)
    except NotFoundError:
        raise
    except Exception as exc:  # 模型端點錯誤：回 502，不把內部例外細節丟給前端
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "AI 分析暫時無法產生，請確認模型設定後再試") from exc
    return {"text": text}


@router.get("/sales/payments")
def get_payments(_: AccessContext = Depends(require_module("sales", "收款管理"))):
    return sales.list_payments()


@router.post("/sales/payments", status_code=201)
def post_payment(body: schemas.PaymentIn, _: AccessContext = Depends(require_module("sales", "收款管理"))):
    data = body.model_dump()
    data["payment_date"] = body.payment_date.isoformat()
    return sales.create_payment(data)
