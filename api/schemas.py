"""API 輸入格式（Pydantic）。欄位限制與舊版表單相同：數量 ≥ 1、金額 ≥ 0、必填欄位不可空白。"""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator


def _strip(value):
    return value.strip() if isinstance(value, str) else value


class _Model(BaseModel):
    @field_validator("*", mode="before")
    @classmethod
    def _strip_strings(cls, value):
        return _strip(value)


class LoginIn(_Model):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=200)


class ProductIn(_Model):
    product_id: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=200)
    barcode: str | None = Field(default=None, max_length=100)
    price: int = Field(ge=0)
    cost: float = Field(ge=0, default=0)
    stock: int = Field(ge=0, default=0)
    reorder_point: int = Field(ge=0, default=0)
    daily_sales: int = Field(ge=0, default=0)
    warehouse_id: str | None = Field(default=None, max_length=50)


class StockMoveIn(_Model):
    product_id: str = Field(min_length=1)
    move_type: Literal["入庫", "出庫"]
    qty: int = Field(ge=1)
    ref_no: str | None = Field(default=None, max_length=100)
    note: str | None = Field(default=None, max_length=500)


class WarehouseIn(_Model):
    warehouse_id: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=200)
    address: str | None = Field(default=None, max_length=500)


class PurchaseOrderIn(_Model):
    po_id: str = Field(min_length=1, max_length=80)
    supplier_id: str = Field(min_length=1)
    product_id: str = Field(min_length=1)
    qty: int = Field(ge=1)
    unit_price: float = Field(ge=0)
    note: str | None = Field(default=None, max_length=500)
    operation_id: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")


class SupplierIn(_Model):
    supplier_id: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=200)
    contact: str | None = Field(default=None, max_length=100)
    phone: str | None = Field(default=None, max_length=50)
    email: str | None = Field(default=None, max_length=200)
    country: str | None = Field(default=None, max_length=100)
    region: str | None = Field(default=None, max_length=100)
    risk_level: Literal["", "低", "中", "高"] | None = None


class QuotationIn(_Model):
    quote_id: str = Field(min_length=1, max_length=80)
    customer_id: str = Field(min_length=1)
    product_id: str = Field(min_length=1)
    qty: int = Field(ge=1)
    unit_price: int = Field(ge=0)
    valid_until: date


class OrderIn(_Model):
    order_id: str = Field(min_length=1, max_length=80)
    customer_id: str = Field(min_length=1)
    product_id: str = Field(min_length=1)
    quantity: int = Field(ge=1)
    status: Literal["處理中", "已出貨", "已取消"] = "處理中"


class OrderStatusIn(_Model):
    status: Literal["處理中", "已出貨", "已取消"]


class PaymentIn(_Model):
    ref_type: Literal["銷售訂單", "其他"] = "銷售訂單"
    ref_id: str = Field(min_length=1, max_length=80)
    amount: float = Field(gt=0)
    payment_date: date
    note: str | None = Field(default=None, max_length=500)
