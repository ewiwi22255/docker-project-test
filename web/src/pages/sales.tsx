import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api, ApiError } from "../api";
import { Alert, Badge, Card, Collapsible, DataTable, Field, Kpi, PageHeader, Status, Tabs, useAction, useAsync } from "../components/ui";
import { C, CHART_COLORS, STATUS_COLORS, money, num, stamp, today } from "../format";

const thisYear = new Date().getFullYear();

interface Lookups { customers: { customer_id: string; name: string }[]; products: { product_id: string; name: string; price: number; stock: number }[] }

// ── 報價單 ──────────────────────────────────────────────────────────
export function Quotations() {
  const list = useAsync(() => api<any[]>("/sales/quotations"));
  const lk = useAsync(() => api<Lookups>("/sales/lookups"));
  const { busy, run } = useAction();
  const [form, setForm] = useState({ quote_id: `QT-${stamp()}`, customer_id: "", product_id: "", qty: 1, unit_price: 0, valid_until: today() });

  const product = lk.data?.products.find((p) => p.product_id === (form.product_id || lk.data?.products[0]?.product_id));
  useEffect(() => {
    if (product) setForm((f) => ({ ...f, unit_price: product.price }));
  }, [product?.product_id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = { ...form, customer_id: form.customer_id || lk.data?.customers[0]?.customer_id, product_id: form.product_id || product?.product_id };
    const r = await run(() => api<any>("/sales/quotations", { method: "POST", body }), (r: any) => `報價單 ${r.quote_id} 已建立，金額 ${money(r.total_amount)}`);
    if (r) {
      setForm((f) => ({ ...f, quote_id: `QT-${stamp()}`, qty: 1 }));
      list.reload();
    }
  }

  return (
    <>
      <PageHeader description="建立客戶報價，追蹤報價有效期限。" />
      <Collapsible title="建立報價單">
        <form className="form-grid" onSubmit={submit}>
          <Field label="報價單號"><input required value={form.quote_id} onChange={(e) => setForm({ ...form, quote_id: e.target.value })} /></Field>
          <Field label="客戶">
            <select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
              {(lk.data?.customers ?? []).map((c) => <option key={c.customer_id} value={c.customer_id}>{c.customer_id} - {c.name}</option>)}
            </select>
          </Field>
          <Field label="品項">
            <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
              {(lk.data?.products ?? []).map((p) => <option key={p.product_id} value={p.product_id}>{p.product_id} - {p.name}</option>)}
            </select>
          </Field>
          <Field label="數量"><input type="number" min={1} step={1} value={form.qty} onChange={(e) => setForm({ ...form, qty: Number(e.target.value) })} /></Field>
          <Field label="單價"><input type="number" min={0} step={1} value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: Number(e.target.value) })} /></Field>
          <Field label="報價有效至"><input type="date" required value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} /></Field>
          <div className="form-actions">
            <span className="muted">小計 {money(form.qty * form.unit_price)}</span>
            <button className="btn btn-primary" disabled={busy || !lk.data}>建立</button>
          </div>
        </form>
      </Collapsible>
      <Card>
        <Status loading={list.loading} error={list.error}>
          <DataTable
            rows={list.data ?? []}
            rowKey={(r) => r.quote_id}
            columns={[
              { key: "quote_id", label: "報價單號" },
              { key: "customer_name", label: "客戶", render: (r) => r.customer_name ?? r.customer_id },
              { key: "quote_date", label: "日期" },
              { key: "valid_until", label: "有效至" },
              { key: "status", label: "狀態", render: (r) => <Badge tone="info">{r.status}</Badge> },
              { key: "total_amount", label: "金額", align: "right", render: (r) => money(r.total_amount) },
            ]}
          />
        </Status>
      </Card>
    </>
  );
}

// ── 銷售單 ──────────────────────────────────────────────────────────
const ALERT_VIEW: Record<string, [string, "ok" | "warn" | "danger"]> = {
  done: ["已完成", "ok"],
  pending: ["處理中", "warn"],
  overdue: ["逾期", "danger"],
};

export function Orders() {
  const lk = useAsync(() => api<Lookups>("/sales/lookups"));
  const recent = useAsync(() => api<{ order_id: string; status: string }[]>("/sales/orders/recent"));
  const { busy, run } = useAction();
  const defaultFilters = { keyword: "", start: "2023-01-01", end: today(), status: "全部" };
  const [draft, setDraft] = useState(defaultFilters);
  const [filters, setFilters] = useState(defaultFilters);
  const result = useAsync(() => api<any>("/sales/orders", { query: filters }), [filters]);

  const [form, setForm] = useState({ order_id: `ORD-${stamp("second")}`, customer_id: "", product_id: "", quantity: 1, status: "處理中" });
  const [statusForm, setStatusForm] = useState({ order_id: "", status: "已出貨" });

  async function createOrder(e: FormEvent) {
    e.preventDefault();
    const body = { ...form, customer_id: form.customer_id || lk.data?.customers[0]?.customer_id, product_id: form.product_id || lk.data?.products[0]?.product_id };
    const r = await run(() => api<any>("/sales/orders", { method: "POST", body }), (r: any) => `訂單 ${r.order_id} 已建立，金額 ${money(r.total_amount)}`);
    if (r) {
      setForm((f) => ({ ...f, order_id: `ORD-${stamp("second")}`, quantity: 1 }));
      result.reload();
      recent.reload();
      lk.reload();
    }
  }

  async function updateStatus(e: FormEvent) {
    e.preventDefault();
    const id = statusForm.order_id || recent.data?.[0]?.order_id;
    if (!id) return;
    if (await run(() => api(`/sales/orders/${encodeURIComponent(id)}`, { method: "PATCH", body: { status: statusForm.status } }), `訂單 ${id} 已更新為「${statusForm.status}」`)) {
      result.reload();
      recent.reload();
    }
  }

  const a = result.data?.analytics;
  return (
    <>
      <PageHeader description="建立訂單、更新出貨狀態，並依條件查詢與分析。" />
      <Collapsible title="建立銷售單">
        <form className="form-grid" onSubmit={createOrder}>
          <Field label="訂單編號"><input required value={form.order_id} onChange={(e) => setForm({ ...form, order_id: e.target.value })} /></Field>
          <Field label="客戶">
            <select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
              {(lk.data?.customers ?? []).map((c) => <option key={c.customer_id} value={c.customer_id}>{c.customer_id} - {c.name}</option>)}
            </select>
          </Field>
          <Field label="產品">
            <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
              {(lk.data?.products ?? []).map((p) => <option key={p.product_id} value={p.product_id}>{p.product_id} - {p.name}（{money(p.price)}，庫存 {p.stock}）</option>)}
            </select>
          </Field>
          <Field label="數量"><input type="number" min={1} step={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} /></Field>
          <Field label="狀態">
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {["處理中", "已出貨", "已取消"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <div className="form-actions"><button className="btn btn-primary" disabled={busy || !lk.data}>送出</button></div>
        </form>
      </Collapsible>

      <Collapsible title="更新訂單狀態">
        <p className="muted">處理中：未滿 3 天｜逾期：處理中超過 3 天｜已完成：已出貨或已取消。</p>
        <form className="form-grid" onSubmit={updateStatus}>
          <Field label="選擇訂單">
            <select value={statusForm.order_id} onChange={(e) => setStatusForm({ ...statusForm, order_id: e.target.value })}>
              {(recent.data ?? []).map((o) => <option key={o.order_id} value={o.order_id}>{o.order_id}（{o.status}）</option>)}
            </select>
          </Field>
          <Field label="新狀態">
            <select value={statusForm.status} onChange={(e) => setStatusForm({ ...statusForm, status: e.target.value })}>
              {["已出貨", "已取消", "處理中"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <div className="form-actions"><button className="btn btn-primary" disabled={busy || !recent.data?.length}>更新狀態</button></div>
        </form>
      </Collapsible>

      <Card title="查詢">
        <form className="filter-row" onSubmit={(e) => { e.preventDefault(); setFilters(draft); }}>
          <Field label="搜尋單號"><input placeholder="輸入單號關鍵字…" value={draft.keyword} onChange={(e) => setDraft({ ...draft, keyword: e.target.value })} /></Field>
          <Field label="開始日期"><input type="date" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} /></Field>
          <Field label="結束日期"><input type="date" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} /></Field>
          <Field label="訂單狀態">
            <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
              {["全部", "處理中", "已出貨", "已取消"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <div className="filter-actions">
            <button className="btn btn-primary">搜尋</button>
            <button className="btn" type="button" onClick={() => { setDraft(defaultFilters); setFilters(defaultFilters); }}>重設</button>
          </div>
        </form>
        <Status loading={result.loading} error={result.error}>
          <DataTable
            rows={result.data?.orders ?? []}
            rowKey={(r) => r.order_id}
            maxHeight={420}
            columns={[
              { key: "alert", label: "警示", render: (r) => { const [t, tone] = ALERT_VIEW[r.alert]; return <Badge tone={tone}>{t}</Badge>; } },
              { key: "order_id", label: "訂單編號" },
              { key: "customer_name", label: "客戶" },
              { key: "product_name", label: "產品" },
              { key: "quantity", label: "數量", align: "right" },
              { key: "status", label: "狀態" },
              { key: "total_amount", label: "金額", align: "right", render: (r) => money(r.total_amount) },
              { key: "order_date", label: "日期" },
            ]}
          />
        </Status>
      </Card>

      {a && a.order_count > 0 && (
        <>
          <div className="kpi-grid">
            <Kpi label="篩選總營收" value={money(a.total_amount)} />
            <Kpi label="訂單總數" value={`${num(a.order_count)} 筆`} />
            <Kpi label="總銷售數量" value={`${num(a.total_quantity)} 件`} />
            <Kpi label="平均客單價" value={money(a.average_order_value)} />
          </div>
          <div className="grid-2">
            <Card title="訂單狀態分布">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={a.status_distribution} dataKey="count" nameKey="status" outerRadius={100} label>
                    {a.status_distribution.map((d: any, i: number) => <Cell key={d.status} fill={STATUS_COLORS[d.status] ?? CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </Card>
            <Card title="每日銷售趨勢">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={a.daily_trend}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" />
                  <YAxis tickFormatter={(v) => num(v)} width={80} />
                  <Tooltip formatter={(v) => money(v) as any} />
                  <Line dataKey="amount" name="金額" stroke={C.blue} dot />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          </div>
          <Card title="篩選範圍內之熱銷商品排行（Top 10）">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={a.top_products}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="product" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="quantity" name="數量" fill={C.teal} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </>
      )}
    </>
  );
}

// ── 客戶消費視覺化 ──────────────────────────────────────────────────
export function CustomerOverview() {
  const customers = useAsync(() => api<any[]>("/sales/customers"));
  const [year, setYear] = useState(thisYear);
  const [customerId, setCustomerId] = useState("");
  const [tab, setTab] = useState("amt");
  const data = useAsync(() => api<any>("/sales/customer-overview", { query: { year, customer_id: customerId } }), [year, customerId]);

  return (
    <>
      <PageHeader description="本月累積、當年度累積與各月消費趨勢。" />
      <Card>
        <div className="filter-row">
          <Field label="年度"><input type="number" min={2020} max={2030} value={year} onChange={(e) => setYear(Number(e.target.value))} /></Field>
          <Field label="選擇公司">
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">全部公司</option>
              {(customers.data ?? []).map((c) => <option key={c.customer_id} value={c.customer_id}>{c.name}（{c.customer_id}）</option>)}
            </select>
          </Field>
        </div>
      </Card>
      <Status loading={data.loading} error={data.error}>
        {data.data && !data.data.has_data && <Alert kind="warn">{year} 年尚無訂單資料（或所選公司無訂單）。</Alert>}
        {data.data?.has_data && (
          <>
            <div className="kpi-grid kpi-grid-3">
              <Kpi label="本月累積消費量（件）" value={num(data.data.metrics.month_qty)} />
              <Kpi label="當年度累積消費量（件）" value={num(data.data.metrics.ytd_qty)} />
              <Kpi label="當年度總消費金額（NTD）" value={money(data.data.metrics.ytd_amount)} />
            </div>
            <Card title={`${year} 年各月消費趨勢`} actions={<Tabs value={tab} onChange={setTab} tabs={[{ key: "amt", label: "消費金額" }, { key: "qty", label: "消費數量" }]} />}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.data.monthly}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" />
                  <YAxis tickFormatter={(v) => num(v)} width={80} />
                  <Tooltip formatter={(v) => (tab === "amt" ? money(v) : num(v)) as any} />
                  <Bar dataKey={tab} name={tab === "amt" ? "金額 (NTD)" : "數量"} fill={C.teal} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card title="各公司當年度消費金額比較">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.data.by_customer}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => num(v)} width={80} />
                  <Tooltip formatter={(v) => money(v) as any} />
                  <Bar dataKey="amt" name="金額 (NTD)" fill={C.blue} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </>
        )}
      </Status>
    </>
  );
}

// ── 客戶個人消費分析 ────────────────────────────────────────────────
export function CustomerAnalysis() {
  const customers = useAsync(() => api<any[]>("/sales/customers"));
  const [customerId, setCustomerId] = useState("");
  const [year, setYear] = useState(thisYear);
  const [tab, setTab] = useState("amt");
  const cid = customerId || customers.data?.[0]?.customer_id || "";
  const detail = useAsync(() => (cid ? api<any>(`/sales/customers/${encodeURIComponent(cid)}`, { query: { year } }) : Promise.resolve(null)), [cid, year]);
  const [ai, setAi] = useState<{ text: string; key: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const aiKey = `${cid}-${year}`;

  async function runAi() {
    setAiBusy(true);
    setAiError(null);
    try {
      const r = await api<{ text: string }>(`/sales/customers/${encodeURIComponent(cid)}/ai-analysis`, { method: "POST", query: { year } });
      setAi({ text: r.text || "AI 沒有回傳內容，請稍後再試。", key: aiKey });
    } catch (e) {
      setAiError(e instanceof ApiError ? e.message : "AI 分析產生失敗");
    } finally {
      setAiBusy(false);
    }
  }

  const d = detail.data;
  const yearly = useMemo(() => d?.by_year ?? [], [d]);
  return (
    <>
      <PageHeader description="單一客戶的消費輪廓、歷年趨勢與 AI 分析。" />
      <Card>
        <div className="filter-row">
          <Field label="搜尋客戶">
            <select value={cid} onChange={(e) => setCustomerId(e.target.value)}>
              {(customers.data ?? []).map((c) => <option key={c.customer_id} value={c.customer_id}>{c.name}（{c.customer_id}）</option>)}
            </select>
          </Field>
          <Field label="分析年度"><input type="number" min={2020} max={2030} value={year} onChange={(e) => setYear(Number(e.target.value))} /></Field>
        </div>
      </Card>
      <Status loading={detail.loading} error={detail.error} empty={!d}>
        {d && (
          <>
            <Card title={`${d.profile.name}（${d.profile.customer_id}）`}>
              <p className="muted">聯絡人：{d.profile.contact || "—"}　電話：{d.profile.phone || "—"}　Email：{d.profile.email || "—"}</p>
              <div className="kpi-grid">
                <Kpi label="本月累積消費量（件）" value={num(d.metrics.month_qty)} />
                <Kpi label="當年度累積消費量（件）" value={num(d.metrics.ytd_qty)} />
                <Kpi label="當年度總消費金額（NTD）" value={money(d.metrics.ytd_amount)} />
                <Kpi label="歷年總消費金額（NTD）" value={money(d.metrics.lifetime_amount)} />
              </div>
            </Card>
            <div className="grid-2">
              <Card title={`${year} 年各月消費`} actions={<Tabs value={tab} onChange={setTab} tabs={[{ key: "amt", label: "金額" }, { key: "qty", label: "數量" }]} />}>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={d.monthly}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => num(v)} width={70} />
                    <Tooltip formatter={(v) => (tab === "amt" ? money(v) : num(v)) as any} />
                    <Line dataKey={tab} name={tab === "amt" ? "金額" : "數量"} stroke={C.blue} dot />
                  </LineChart>
                </ResponsiveContainer>
              </Card>
              <Card title="產品別消費金額占比">
                {d.by_product.length ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={d.by_product} dataKey="amt" nameKey="product_name" outerRadius={90}>
                        {d.by_product.map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v) => money(v) as any} />
                      <Legend layout="vertical" align="right" verticalAlign="middle" />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <p className="muted">尚無產品消費資料。</p>}
              </Card>
              <Card title="訂單狀態筆數分布">
                {d.status_distribution.length ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={d.status_distribution} dataKey="count" nameKey="status" outerRadius={90}>
                        {d.status_distribution.map((s: any, i: number) => <Cell key={s.status} fill={STATUS_COLORS[s.status] ?? CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Pie>
                      <Tooltip />
                      <Legend layout="vertical" align="right" verticalAlign="middle" />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <p className="muted">尚無訂單。</p>}
              </Card>
              <Card title="歷年消費金額 (NTD)">
                {yearly.length ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={yearly}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="year" />
                      <YAxis tickFormatter={(v) => num(v)} width={70} />
                      <Tooltip formatter={(v) => money(v) as any} />
                      <Line dataKey="amt" name="金額" stroke={C.teal} dot />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <p className="muted">尚無歷年訂單。</p>}
              </Card>
            </div>
            <Card title="AI 智慧分析" actions={<button className="btn btn-primary" disabled={aiBusy} onClick={runAi} type="button">{aiBusy ? "分析中…（約 10–60 秒）" : "產生 AI 客戶分析"}</button>}>
              {aiError && <Alert kind="error">{aiError}</Alert>}
              {ai && ai.key === aiKey ? <div className="ai-text">{ai.text}</div> : !aiError && <p className="muted">依此客戶的消費資料產生輪廓摘要、趨勢判讀、風險提醒與銷售建議。</p>}
            </Card>
            <Card title="訂單總覽">
              <DataTable
                rows={d.orders}
                rowKey={(r) => r.order_id}
                maxHeight={400}
                columns={[
                  { key: "order_date", label: "訂單日期" },
                  { key: "order_id", label: "訂單編號" },
                  { key: "product_name", label: "產品名稱" },
                  { key: "quantity", label: "數量", align: "right" },
                  { key: "total_amount", label: "金額", align: "right", render: (r) => money(r.total_amount) },
                  { key: "status", label: "狀態" },
                ]}
              />
            </Card>
          </>
        )}
      </Status>
    </>
  );
}

// ── 收款管理 ────────────────────────────────────────────────────────
export function Payments() {
  const list = useAsync(() => api<any[]>("/sales/payments"));
  const { busy, run } = useAction();
  const [form, setForm] = useState({ ref_type: "銷售訂單", ref_id: "", amount: 0, payment_date: today(), note: "" });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api("/sales/payments", { method: "POST", body: form }), "已登記收款")) {
      setForm((f) => ({ ...f, ref_id: "", amount: 0, note: "" }));
      list.reload();
    }
  }

  return (
    <>
      <PageHeader description="登記收款，查看最近的收款紀錄。" />
      <Collapsible title="登記收款">
        <form className="form-grid" onSubmit={submit}>
          <Field label="類型">
            <select value={form.ref_type} onChange={(e) => setForm({ ...form, ref_type: e.target.value })}>
              {["銷售訂單", "其他"].map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="單據編號（如訂單號）"><input required value={form.ref_id} onChange={(e) => setForm({ ...form, ref_id: e.target.value })} /></Field>
          <Field label="收款金額"><input type="number" min={0.01} step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} /></Field>
          <Field label="日期"><input type="date" required value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} /></Field>
          <Field label="備註"><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          <div className="form-actions"><button className="btn btn-primary" disabled={busy}>登記</button></div>
        </form>
      </Collapsible>
      <Card title="最近 50 筆收款">
        <Status loading={list.loading} error={list.error}>
          <DataTable
            rows={list.data ?? []}
            rowKey={(r) => r.payment_id}
            columns={[
              { key: "payment_id", label: "序號" },
              { key: "ref_type", label: "類型" },
              { key: "ref_id", label: "單據" },
              { key: "amount", label: "金額", align: "right", render: (r) => money(r.amount) },
              { key: "payment_date", label: "日期" },
              { key: "note", label: "備註" },
            ]}
          />
        </Status>
      </Card>
    </>
  );
}
