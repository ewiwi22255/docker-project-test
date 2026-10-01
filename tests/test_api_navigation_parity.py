"""API 的選單規則（api/navigation.py）必須與舊版 Streamlit（frontend/access_navigation.py）逐一角色相同。"""

from __future__ import annotations

import pytest

from backend.access_control import AccessContext, capabilities_for_role
from api import navigation as api_nav
from frontend import access_navigation as ui_nav

ROLES = ["admin", "warehouse", "sales", "hr", "risk_viewer", "supply_planner", "procurement_approver", "unknown"]


def _principal(role: str) -> AccessContext:
    return AccessContext(
        username=f"u-{role}", role=role, name=role, organization_id="org",
        entitlements=frozenset({"l1_monitor", "l2_decision", "l3_governed_action"}),
        capabilities=frozenset(capabilities_for_role(role)),
    )


@pytest.mark.parametrize("role", ROLES)
def test_rules_match_legacy_ui(role):
    p = _principal(role)
    assert api_nav.build_menu_structure(p) == ui_nav.build_menu_structure(p)
    assert api_nav.effective_product_levels(p) == ui_nav.effective_product_levels(p)
    assert api_nav.dashboard_mode(p) == ui_nav.dashboard_mode(p)
    assert api_nav.risk_sections(p) == ui_nav.risk_sections(p)
    assert api_nav.ROLE_NAMES == ui_nav.ROLE_NAMES
    assert api_nav.FULL_MENU == ui_nav.FULL_MENU


@pytest.mark.parametrize("role", ROLES)
def test_migrated_plus_legacy_covers_whole_menu(role):
    """新前端 + 舊版連結，合起來剛好等於舊版選單：不多給、也不漏掉。"""
    p = _principal(role)
    menu = ui_nav.build_menu_structure(p)
    covered: dict[str, set] = {}
    for key, subs in api_nav.module_access(p).items():
        label = api_nav.MIGRATED_MODULES[key][0]
        covered.setdefault(label, set()).update(subs)
    for label, subs in api_nav.legacy_modules(p).items():
        covered.setdefault(label, set()).update(subs)
    assert set(covered) == set(menu)
    for label, subs in menu.items():
        assert covered[label] == set(subs)
