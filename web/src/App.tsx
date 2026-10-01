import type { ComponentType } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { canUse, useAuth } from "./auth";
import Layout from "./components/Layout";
import { Loading } from "./components/ui";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import * as inventory from "./pages/inventory";
import * as procurement from "./pages/procurement";
import * as sales from "./pages/sales";
import { firstPath, SUBPAGES } from "./routes";

type Sub = "inventory" | "procurement" | "sales";

const PAGES: Record<Sub, Record<string, ComponentType>> = {
  inventory: {
    products: inventory.Products,
    stock: inventory.Stock,
    moves: inventory.Moves,
    barcode: inventory.Barcode,
    warehouses: inventory.Warehouses,
  },
  procurement: {
    orders: procurement.PurchaseOrders,
    suppliers: procurement.Suppliers,
    costs: procurement.Costs,
    history: procurement.History,
  },
  sales: {
    quotations: sales.Quotations,
    orders: sales.Orders,
    "customer-overview": sales.CustomerOverview,
    "customer-analysis": sales.CustomerAnalysis,
    payments: sales.Payments,
  },
};

function ModulePage({ module }: { module: Sub }) {
  const { slug = "" } = useParams();
  const { user } = useAuth();
  const meta = SUBPAGES[module].find((p) => p.slug === slug);
  const Page = PAGES[module][slug];
  if (!meta || !Page) return <Navigate to={firstPath(user!.modules)} replace />;
  if (!canUse(user, module, meta.name)) return <Navigate to="/no-access" replace />;
  // key 讓切換子頁時重置表單狀態
  return <Page key={`${module}/${slug}`} />;
}

function NoAccess() {
  return (
    <div className="card empty-state">
      <h2>此帳號沒有這項功能的權限</h2>
      <p className="muted">請從左側選單選擇可用的功能，或聯絡系統管理員開通權限。</p>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  const home = firstPath(user.modules);
  return (
    <Routes>
      <Route path="/login" element={<Navigate to={home} replace />} />
      <Route element={<Layout />}>
        <Route path="/dashboard" element={canUse(user, "dashboard") ? <Dashboard /> : <Navigate to="/no-access" replace />} />
        <Route path="/inventory/:slug" element={<ModulePage module="inventory" />} />
        <Route path="/procurement/:slug" element={<ModulePage module="procurement" />} />
        <Route path="/sales/:slug" element={<ModulePage module="sales" />} />
        <Route path="/no-access" element={<NoAccess />} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}
