// 子頁中文名稱（與後端權限規則同名）↔ 網址代號 ↔ 圖示。
import {
  ArrowLeftRight, Boxes, ChartColumn, ClipboardList, Coins, FileText, History, LayoutDashboard, Package,
  ReceiptText, ScanBarcode, ShoppingCart, Truck, UserRound, Wallet, Warehouse, type LucideIcon,
} from "lucide-react";
import type { Modules } from "./auth";

export type ModuleKey = keyof Modules;
type SubModule = Exclude<ModuleKey, "dashboard">;

export const MODULE_META: Record<ModuleKey, { label: string; section: string; icon: LucideIcon; base: string }> = {
  dashboard: { label: "營運分析看板", section: "工作台", icon: LayoutDashboard, base: "/dashboard" },
  inventory: { label: "進銷存", section: "進銷存", icon: Package, base: "/inventory" },
  procurement: { label: "採購管理", section: "採購管理", icon: ShoppingCart, base: "/procurement" },
  sales: { label: "銷售管理", section: "銷售管理", icon: Coins, base: "/sales" },
};

export interface SubPage { name: string; slug: string; icon: LucideIcon }

export const SUBPAGES: Record<SubModule, SubPage[]> = {
  inventory: [
    { name: "商品管理", slug: "products", icon: Package },
    { name: "庫存數量", slug: "stock", icon: Boxes },
    { name: "入庫/出庫", slug: "moves", icon: ArrowLeftRight },
    { name: "條碼掃描", slug: "barcode", icon: ScanBarcode },
    { name: "倉庫管理", slug: "warehouses", icon: Warehouse },
  ],
  procurement: [
    { name: "採購單", slug: "orders", icon: ClipboardList },
    { name: "供應商管理", slug: "suppliers", icon: Truck },
    { name: "進貨成本", slug: "costs", icon: Wallet },
    { name: "採購歷史", slug: "history", icon: History },
  ],
  sales: [
    { name: "報價單", slug: "quotations", icon: FileText },
    { name: "銷售單", slug: "orders", icon: ReceiptText },
    { name: "客戶消費視覺化", slug: "customer-overview", icon: ChartColumn },
    { name: "客戶個人消費分析", slug: "customer-analysis", icon: UserRound },
    { name: "收款管理", slug: "payments", icon: Coins },
  ],
};

export function firstPath(modules: Modules): string {
  for (const key of ["dashboard", "inventory", "procurement", "sales"] as ModuleKey[]) {
    const subs = modules[key];
    if (!subs) continue;
    if (key === "dashboard") return "/dashboard";
    const first = SUBPAGES[key].find((p) => subs.includes(p.name));
    if (first) return `${MODULE_META[key].base}/${first.slug}`;
  }
  return "/no-access";
}

/** 依網址找出目前所在的模組與頁面（頁首、麵包屑共用）。 */
export function pageMeta(pathname: string): { section: string; title: string } {
  if (pathname.startsWith("/dashboard")) return { section: "工作台", title: MODULE_META.dashboard.label };
  for (const key of Object.keys(SUBPAGES) as SubModule[]) {
    const base = MODULE_META[key].base;
    if (!pathname.startsWith(`${base}/`)) continue;
    const page = SUBPAGES[key].find((p) => pathname === `${base}/${p.slug}`);
    return { section: MODULE_META[key].section, title: page?.name ?? MODULE_META[key].label };
  }
  return { section: "工作台", title: "沒有權限" };
}

/** 這個人可用的所有頁面（側欄、搜尋共用）。 */
export function allowedPages(modules: Modules): { section: string; name: string; path: string; icon: LucideIcon }[] {
  const out: { section: string; name: string; path: string; icon: LucideIcon }[] = [];
  if (modules.dashboard) out.push({ section: "工作台", name: MODULE_META.dashboard.label, path: "/dashboard", icon: LayoutDashboard });
  for (const key of Object.keys(SUBPAGES) as SubModule[]) {
    const subs = modules[key];
    if (!subs) continue;
    for (const p of SUBPAGES[key]) {
      if (subs.includes(p.name)) out.push({ section: MODULE_META[key].section, name: p.name, path: `${MODULE_META[key].base}/${p.slug}`, icon: p.icon });
    }
  }
  return out;
}
