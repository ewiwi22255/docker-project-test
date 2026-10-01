import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Activity, ChevronRight, CircleCheck, Download, FileText, Package, TriangleAlert } from "lucide-react";
import { api } from "../api";
import { canUse, useAuth } from "../auth";
import { ATTENTION_ICON, type AttentionItem } from "../components/Layout";
import { Badge, Card, DataTable, Delta, Kpi, PageHeader, Status, useAsync } from "../components/ui";
import { C, compactMoney, money, num, pctChange, STATUS_COLORS } from "../format";

interface Product {
  product_id: string;
  name: string;
  stock: number;
  reorder_point: number | null;
  sales_30d: number;
  status: "low" | "near" | "normal";
}

interface Summary {
  as_of: string;
  month: string;
  kpis: {
    revenue_this_month: number; revenue_last_month: number;
    orders_this_month: number; orders_last_month: number;
    inventory_value: number; low_stock_count: number;
    pending_count: number; pending_high_priority: number;
  };
  order_status: { status: string; count: number }[];
  monthly: { month: string; revenue: number; orders: number }[];
  products: Product[];
  attention: AttentionItem[];
}

const STOCK_STATUS: Record<Product["status"], { label: string; tone: "danger" | "warn" | "ok" }> = {
  low: { label: "低於安全量", tone: "danger" },
  near: { label: "接近安全量", tone: "warn" },
  normal: { label: "正常", tone: "ok" },
};

const monthLabel = (m: string) => `${Number(m.slice(5))}月`;

function exportCsv(products: Product[]) {
  const header = ["產品名稱", "SKU", "現有庫存", "安全存量", "庫存狀態", "近 30 天銷量"];
  const lines = products.map((p) => [p.name, p.product_id, p.stock, p.reorder_point ?? "", STOCK_STATUS[p.status].label, p.sales_30d]);
  const csv = [header, ...lines].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  // 加 BOM，Excel 才會用 UTF-8 開中文
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `產品庫存明細_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Dashboard() {
  const { user } = useAuth();
  const { data, loading, error } = useAsync(() => api<Summary>("/dashboard"));
  const [range, setRange] = useState(12);
  const [stockFilter, setStockFilter] = useState<"all" | Product["status"]>("all");

  const trend = useMemo(() => {
    if (!data) return null;
    const cur = data.monthly.slice(-range);
    const prev = data.monthly.slice(-range * 2, -range);
    const total = cur.reduce((n, m) => n + m.revenue, 0);
    const prevTotal = prev.length === range ? prev.reduce((n, m) => n + m.revenue, 0) : 0;
    return { cur, total, growth: pctChange(total, prevTotal) };
  }, [data, range]);

  const [y, m] = (data?.month ?? "").split("-");
  const k = data?.kpis;
  const last6 = data?.monthly.slice(-6) ?? [];
  const totalOrders = data?.order_status.reduce((n, s) => n + s.count, 0) ?? 0;
  const shipped = data?.order_status.find((s) => s.status === "已出貨")?.count ?? 0;
  const products = data?.products.filter((p) => stockFilter === "all" || p.status === stockFilter) ?? [];

  return (
    <>
      <PageHeader
        description="查看營運、庫存與訂單的目前狀態。"
        actions={
          <button className="btn btn-primary" type="button" disabled={!data} onClick={() => data && exportCsv(data.products)}>
            <Download size={16} /> 匯出 Excel
          </button>
        }
      />
      <Status loading={loading} error={error}>
        {data && k && trend && (
          <>
            <div className="kpi-grid">
              <Kpi
                label="本月營收" icon={Activity} tag={`${y}/${m}`} value={money(k.revenue_this_month)}
                foot={<Delta value={pctChange(k.revenue_this_month, k.revenue_last_month)} />}
                spark={{ values: last6.map((x) => x.revenue), color: k.revenue_this_month >= k.revenue_last_month ? C.ok : C.danger }}
              />
              <Kpi
                label="本月訂單數" icon={FileText} tag={`${y}/${m}`} value={num(k.orders_this_month)} unit="筆"
                foot={<Delta value={pctChange(k.orders_this_month, k.orders_last_month)} />}
                spark={{ values: last6.map((x) => x.orders), color: k.orders_this_month >= k.orders_last_month ? C.ok : C.danger }}
              />
              <Kpi label="庫存總價值" icon={Package} tag="截至今日" value={compactMoney(k.inventory_value)} foot={<span className="muted-sm">依進貨成本計算</span>} />
              <a className="kpi-link" href="#attention">
                <Kpi
                  label="待處理事項" icon={TriangleAlert} tag="待處理" value={num(k.pending_count)} unit="項"
                  tone={k.pending_count ? "warn" : "ok"}
                  foot={
                    k.pending_count ? (
                      <span className="kpi-warn-foot">
                        <strong>{k.pending_high_priority} 項高優先</strong>・查看待辦 <ChevronRight size={15} />
                      </span>
                    ) : (
                      <span className="muted-sm">目前沒有待處理事項</span>
                    )
                  }
                />
              </a>
            </div>

            <div className="grid-main">
              <Card
                title="庫存健康度"
                subtitle="各產品現有庫存與安全存量"
                actions={canUse(user, "inventory", "庫存數量") && <Link className="link-more" to="/inventory/stock">查看全部 <ChevronRight size={15} /></Link>}
              >
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={data.products} barGap={6} margin={{ top: 22, right: 8, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C.grid} />
                    <XAxis dataKey="product_id" tickLine={false} axisLine={false} tick={{ fill: C.axis, fontSize: 12 }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fill: C.axis, fontSize: 12 }} />
                    <Tooltip cursor={{ fill: "rgba(148,163,184,.12)" }} labelFormatter={(id) => data.products.find((p) => p.product_id === id)?.name ?? id} />
                    <Bar dataKey="stock" name="現有庫存" fill={C.teal} radius={[3, 3, 0, 0]} maxBarSize={34}>
                      <LabelList dataKey="stock" position="top" fill="#334155" fontSize={12} />
                    </Bar>
                    <Bar dataKey="reorder_point" name="安全存量" fill={C.lightBlue} radius={[3, 3, 0, 0]} maxBarSize={34}>
                      <LabelList dataKey="reorder_point" position="top" fill="#64748b" fontSize={12} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="chart-foot">
                  <span className="legend"><i style={{ background: C.teal }} />現有庫存</span>
                  <span className="legend"><i style={{ background: C.lightBlue }} />安全存量</span>
                  <span className="chart-unit">單位：件</span>
                </div>
              </Card>

              <Card title="訂單執行狀態" subtitle="目前所有銷售訂單的處理進度">
                <div className="donut-wrap">
                  <div className="donut">
                    <ResponsiveContainer width="100%" height={190}>
                      <PieChart>
                        <Pie data={data.order_status} dataKey="count" nameKey="status" innerRadius={62} outerRadius={84} paddingAngle={2} stroke="none">
                          {data.order_status.map((s) => <Cell key={s.status} fill={STATUS_COLORS[s.status] ?? C.slate} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="donut-center">
                      <strong>{num(totalOrders)}</strong>
                      <span>總訂單</span>
                    </div>
                  </div>
                  <ul className="donut-legend">
                    {data.order_status.map((s) => (
                      <li key={s.status}>
                        <i style={{ background: STATUS_COLORS[s.status] ?? C.slate }} />
                        <span>
                          {s.status}
                          <small>{totalOrders ? ((s.count / totalOrders) * 100).toFixed(1) : 0}%</small>
                        </span>
                        <strong>{num(s.count)}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="card-note">
                  <span className="status-dot" /> 出貨完成率 <strong>{totalOrders ? ((shipped / totalOrders) * 100).toFixed(1) : 0}%</strong>
                </div>
              </Card>
            </div>

            <div className="grid-main">
              <Card
                title="營收趨勢"
                subtitle={`過去 ${range} 個月的月度營收表現`}
                actions={
                  <select className="select-sm" value={range} onChange={(e) => setRange(Number(e.target.value))} aria-label="期間">
                    <option value={6}>近 6 個月</option>
                    <option value={12}>近 12 個月</option>
                    <option value={24}>近 24 個月</option>
                  </select>
                }
              >
                <div className="trend-head">
                  <span className="muted-sm">期間總營收</span>
                  <div className="trend-total">
                    <strong>{compactMoney(trend.total)}</strong>
                    {trend.growth !== null && (
                      <span className={`pill ${trend.growth >= 0 ? "pill-ok" : "pill-danger"}`}>
                        {trend.growth >= 0 ? "↗" : "↘"} {Math.abs(trend.growth).toFixed(1)}% 較前期
                      </span>
                    )}
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={trend.cur} margin={{ top: 8, right: 12, left: -4, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.blue} stopOpacity={0.22} />
                        <stop offset="100%" stopColor={C.blue} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C.grid} />
                    <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} tick={{ fill: C.axis, fontSize: 12 }} />
                    <YAxis tickFormatter={(v) => compactMoney(v).replace("$", "")} tickLine={false} axisLine={false} width={56} tick={{ fill: C.axis, fontSize: 12 }} />
                    <Tooltip formatter={(v) => [money(v), "營收"] as any} labelFormatter={(l) => String(l)} />
                    <Area type="monotone" dataKey="revenue" stroke={C.blue} strokeWidth={2.2} fill="url(#revFill)" dot={{ r: 3.5, fill: "#fff", stroke: C.blue, strokeWidth: 2 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>

              <Card
                id="attention"
                title="需要關注"
                subtitle="即時需要追蹤與處理的項目"
                actions={data.attention.length > 0 && <span className="count-chip">{data.attention.length}</span>}
              >
                {data.attention.length ? (
                  <ul className="attn-list">
                    {data.attention.map((a, i) => {
                      const Icon = ATTENTION_ICON[a.kind];
                      return (
                        <li key={i}>
                          <Link to={a.path} className="attn-item">
                            <span className={`attn-icon attn-${a.kind}`}><Icon size={17} /></span>
                            <span className="attn-text">
                              <strong>{a.title}</strong>
                              <span>{a.detail}</span>
                            </span>
                            <ChevronRight size={16} className="attn-chevron" />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="attn-empty"><CircleCheck size={28} /> 目前沒有需要關注的項目</div>
                )}
              </Card>
            </div>

            <Card
              title="產品庫存明細"
              subtitle="依目前庫存與安全存量顯示產品狀態"
              actions={
                <select className="select-sm" value={stockFilter} onChange={(e) => setStockFilter(e.target.value as typeof stockFilter)} aria-label="篩選庫存狀態">
                  <option value="all">全部狀態</option>
                  <option value="low">低於安全量</option>
                  <option value="near">接近安全量</option>
                  <option value="normal">正常</option>
                </select>
              }
            >
              <DataTable
                rows={products}
                rowKey={(r) => r.product_id}
                columns={[
                  { key: "name", label: "產品名稱", render: (r) => <strong className="cell-strong">{r.name}</strong> },
                  { key: "product_id", label: "SKU" },
                  { key: "stock", label: "現有庫存", align: "right", render: (r) => num(r.stock) },
                  { key: "reorder_point", label: "安全存量", align: "right", render: (r) => num(r.reorder_point) },
                  { key: "status", label: "庫存狀態", render: (r) => <Badge tone={STOCK_STATUS[r.status].tone}>{STOCK_STATUS[r.status].label}</Badge> },
                  { key: "sales_30d", label: "近 30 天銷量", align: "right", render: (r) => num(r.sales_30d) },
                ]}
              />
            </Card>
          </>
        )}
      </Status>
    </>
  );
}
