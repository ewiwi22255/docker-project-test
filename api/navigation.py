"""
api/navigation.py
「誰能用哪個模組」的規則——與舊版 Streamlit 的 frontend/access_navigation.py 相同。

為了前後端分離，API 不 import frontend 套件，所以這裡保留一份同樣的規則；
tests/test_api_navigation_parity.py 會逐一角色比對兩邊結果，任何一邊改了另一邊沒跟上，測試就失敗。
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, status

from backend.access_control import (
    APPROVAL_QUEUE_READ,
    ERP_EXCHANGE_EXPORT,
    ERP_EXCHANGE_PROPOSE,
    ERP_EXCHANGE_RECONCILE,
    PROPOSAL_EVIDENCE_READ,
    RISK_ANALYSIS_READ,
    RISK_OVERVIEW_READ,
    RISK_WHAT_IF_RUN,
    AccessContext,
)

from api.security import current_principal

FULL_MENU = {
    "📊 營運分析看板": [],
    "🤖 AI 智能助理": ["對話介面", "LINE 客服記錄", "Agent Dashboard"],
    "📦 進銷存": ["商品管理", "庫存數量", "入庫/出庫", "條碼掃描", "倉庫管理"],
    "🛒 採購管理": ["採購單", "供應商管理", "進貨成本", "採購歷史", "ERP CSV 交換"],
    "💰 銷售管理": ["報價單", "銷售單", "客戶消費視覺化", "客戶個人消費分析", "收款管理"],
    "📒 財務會計": ["應收/應付", "總帳", "成本分析", "財報"],
    "👥 人資": ["員工資料", "薪資", "出勤"],
    "🌿 碳排放管理": ["碳排放總覽", "碳足跡追蹤", "減量目標", "年度碳目標分析", "ESG 報告", "供應商風險與碳排"],
    "🌱 供應鏈與風險": [],
}

_LEGACY_ROLE_MENUS = {
    "admin": tuple(FULL_MENU),
    "warehouse": ("📊 營運分析看板", "🤖 AI 智能助理", "📦 進銷存", "🛒 採購管理", "🌱 供應鏈與風險"),
    "sales": ("📊 營運分析看板", "🤖 AI 智能助理", "💰 銷售管理", "🌿 碳排放管理"),
    "hr": ("📊 營運分析看板", "🤖 AI 智能助理", "👥 人資"),
}

ROLE_NAMES = {
    "admin": "系統管理員",
    "warehouse": "倉管部",
    "hr": "人資部",
    "sales": "業務部",
    "risk_viewer": "風險觀測員",
    "supply_planner": "供應鏈規劃員",
    "procurement_approver": "採購核准主管",
}


def risk_sections(principal: AccessContext) -> tuple[str, ...]:
    sections: list[str] = []
    if principal.can(RISK_OVERVIEW_READ):
        sections.append("overview")
    if principal.can(RISK_ANALYSIS_READ):
        sections.append("analysis")
    if principal.can(RISK_WHAT_IF_RUN):
        sections.append("what_if")
    return tuple(sections)


def exchange_sections(principal: AccessContext) -> tuple[str, ...]:
    sections: list[str] = []
    if principal.can(ERP_EXCHANGE_PROPOSE):
        sections.append("proposal")
    if principal.can(ERP_EXCHANGE_EXPORT):
        sections.append("export")
    if principal.can(ERP_EXCHANGE_RECONCILE):
        sections.append("reconcile")
    return tuple(sections)


def dashboard_mode(principal: AccessContext) -> str:
    if not principal.can(APPROVAL_QUEUE_READ):
        return "none"
    if principal.role in {"admin", "warehouse"}:
        return "full"
    if principal.can(PROPOSAL_EVIDENCE_READ):
        return "approvals"
    return "none"


def effective_product_levels(principal: AccessContext) -> tuple[str, ...]:
    levels: list[str] = []
    if principal.can(RISK_OVERVIEW_READ):
        levels.append("L1")
    if principal.can(RISK_ANALYSIS_READ) or principal.can(ERP_EXCHANGE_PROPOSE):
        levels.append("L2")
    if principal.can(APPROVAL_QUEUE_READ) or principal.can(ERP_EXCHANGE_EXPORT) or principal.can(ERP_EXCHANGE_RECONCILE):
        levels.append("L3")
    return tuple(levels)


def build_menu_structure(principal: AccessContext) -> dict[str, list[str]]:
    if principal.role == "risk_viewer":
        return {"🌱 供應鏈與風險": []} if risk_sections(principal) else {}
    if principal.role == "supply_planner":
        menu: dict[str, list[str]] = {}
        if risk_sections(principal):
            menu["🌱 供應鏈與風險"] = []
        if exchange_sections(principal):
            menu["🛒 採購管理"] = ["ERP CSV 交換"]
        return menu
    if principal.role == "procurement_approver":
        menu = {}
        if risk_sections(principal):
            menu["🌱 供應鏈與風險"] = []
        if dashboard_mode(principal) == "approvals":
            menu["🤖 AI 智能助理"] = ["Agent Dashboard"]
        if exchange_sections(principal):
            menu["🛒 採購管理"] = ["ERP CSV 交換"]
        return menu

    allowed = _LEGACY_ROLE_MENUS.get(principal.role, ())
    menu = {item: list(FULL_MENU[item]) for item in allowed}
    if not risk_sections(principal):
        menu.pop("🌱 供應鏈與風險", None)
    if not exchange_sections(principal) and "🛒 採購管理" in menu:
        menu["🛒 採購管理"] = [item for item in menu["🛒 採購管理"] if item != "ERP CSV 交換"]
    if dashboard_mode(principal) == "none" and "🤖 AI 智能助理" in menu:
        menu["🤖 AI 智能助理"] = [item for item in menu["🤖 AI 智能助理"] if item != "Agent Dashboard"]
    return menu


# ── 新前端已搬過去的模組 ──────────────────────────────────────────────
# key 是 API／前端路由用的英文代號，value 是舊版選單名稱與「已搬到新前端」的子頁。
MIGRATED_MODULES: dict[str, tuple[str, tuple[str, ...]]] = {
    "dashboard": ("📊 營運分析看板", ()),
    "inventory": ("📦 進銷存", ("商品管理", "庫存數量", "入庫/出庫", "條碼掃描", "倉庫管理")),
    "procurement": ("🛒 採購管理", ("採購單", "供應商管理", "進貨成本", "採購歷史")),
    "sales": ("💰 銷售管理", ("報價單", "銷售單", "客戶消費視覺化", "客戶個人消費分析", "收款管理")),
}


def module_access(principal: AccessContext) -> dict[str, list[str]]:
    """這個人在新前端能用的模組與子頁（依舊版選單規則推導）。"""
    menu = build_menu_structure(principal)
    result: dict[str, list[str]] = {}
    for key, (label, subpages) in MIGRATED_MODULES.items():
        if label not in menu:
            continue
        allowed_subs = menu[label]
        result[key] = [s for s in subpages if s in allowed_subs] if subpages else []
        if subpages and not result[key]:
            result.pop(key)
    return result


def legacy_modules(principal: AccessContext) -> dict[str, list[str]]:
    """還沒搬到新前端、仍在舊版 Streamlit 的模組（前端顯示成「舊版系統」連結）。"""
    menu = build_menu_structure(principal)
    migrated_labels = {label: set(subs) for label, subs in MIGRATED_MODULES.values()}
    legacy: dict[str, list[str]] = {}
    for label, subs in menu.items():
        if label in migrated_labels:
            rest = [s for s in subs if s not in migrated_labels[label]]
            if rest:
                legacy[label] = rest
        else:
            legacy[label] = list(subs)
    return legacy


def require_module(module: str, subpage: str | None = None):
    """FastAPI 依賴：沒有這個模組（或子頁）權限就回 403。"""

    def _guard(principal: AccessContext = Depends(current_principal)) -> AccessContext:
        allowed = module_access(principal)
        if module not in allowed or (subpage is not None and subpage not in allowed[module]):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "此帳號沒有這項功能的權限")
        return principal

    return _guard
