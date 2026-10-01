import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { Alert, Badge, Card, Collapsible, DataTable, Field, PageHeader, Status, useAction, useAsync } from "../components/ui";
import { money, newOperationId, num, stamp } from "../format";

const PO_OP_KEY = "erp.po.operation";
const PO_APPROVAL_KEY = "erp.po.approval";

// ── 採購單 ──────────────────────────────────────────────────────────
// 建立採購單不直接寫入：送交易閘道審批，核准後才建立。
// operation_id 在同一張草稿內保持不變（重送不會產生兩張審批單），按「建立下一張」才換新的。
export function PurchaseOrders() {
  const list = useAsync(() => api<any[]>("/procurement/purchase-orders"));
  const options = useAsync(() => api<{ suppliers: any[]; products: any[] }>("/procurement/form-options"));
  const { busy, run } = useAction();
  const [operationId, setOperationId] = useState(() => sessionStorage.getItem(PO_OP_KEY) || newOperationId());
  const [approvalId, setApprovalId] = useState<string | null>(() => sessionStorage.getItem(PO_APPROVAL_KEY));
  const [approval, setApproval] = useState<{ status: string; reason: string } | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [form, setForm] = useState({ po_id: `PO-${stamp()}`, supplier_id: "", product_id: "", qty: 1, unit_price: 0, note: "" });

  useEffect(() => sessionStorage.setItem(PO_OP_KEY, operationId), [operationId]);
  useEffect(() => {
    if (!approvalId) return setApproval(null);
    sessionStorage.setItem(PO_APPROVAL_KEY, approvalId);
    api(`/procurement/approvals/${encodeURIComponent(approvalId)}`)
      .then(setApproval)
      .catch(() => setApproval({ status: "missing", reason: "" }));
  }, [approvalId, refreshTick]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      ...form,
      supplier_id: form.supplier_id || options.data?.suppliers[0]?.supplier_id,
      product_id: form.product_id || options.data?.products[0]?.product_id,
      operation_id: operationId,
    };
    const r = await run(() => api<any>("/procurement/purchase-orders", { method: "POST", body }));
    if (r?.approval_id) setApprovalId(r.approval_id);
  }

  function startNext() {
    sessionStorage.removeItem(PO_APPROVAL_KEY);
    setApprovalId(null);
    setOperationId(newOperationId());
    setForm((f) => ({ ...f, po_id: `PO-${stamp()}`, qty: 1, unit_price: 0, note: "" }));
    list.reload();
  }

  const statusView: Record<string, [string, "info" | "ok" | "warn" | "error"]> = {
    pending: ["等待核准；採購單尚未建立。", "info"],
    approved: ["已核准並完成採購單建立。", "ok"],
    rejected: ["已被拒絕，未建立採購單。", "warn"],
    missing: ["無法讀取審批單的目前狀態。", "error"],
  };

  return (
    <>
      <PageHeader description="建立採購單並送出審批，核准後才會正式成立。" />
      <Collapsible title="建立採購單" defaultOpen={!!approvalId}>
        <p className="muted">本次操作識別碼：<code>{operationId}</code></p>
        {approvalId ? (
          <>
            {approval && (
              <Alert kind={statusView[approval.status]?.[1] ?? "info"}>
                審批單 <code>{approvalId}</code> {statusView[approval.status]?.[0] ?? approval.status}
                {approval.reason && `（原因：${approval.reason}）`}
              </Alert>
            )}
            <div className="button-row">
              <button className="btn" onClick={() => setRefreshTick((t) => t + 1)} type="button">重新查詢狀態</button>
              <button className="btn btn-primary" onClick={startNext} type="button">建立下一張採購單</button>
            </div>
          </>
        ) : (
          <form className="form-grid" onSubmit={submit}>
            <Field label="採購單號"><input required value={form.po_id} onChange={(e) => setForm({ ...form, po_id: e.target.value })} /></Field>
            <Field label="正式供應商">
              <select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                {(options.data?.suppliers ?? []).map((s) => <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_id} - {s.name}</option>)}
              </select>
            </Field>
            <Field label="品項">
              <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
                {(options.data?.products ?? []).map((p) => <option key={p.product_id} value={p.product_id}>{p.product_id} - {p.name}</option>)}
              </select>
            </Field>
            <Field label="數量"><input type="number" min={1} step={1} value={form.qty} onChange={(e) => setForm({ ...form, qty: Number(e.target.value) })} /></Field>
            <Field label="單價"><input type="number" min={0} step="0.01" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: Number(e.target.value) })} /></Field>
            <Field label="備註"><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
            <div className="form-actions"><button className="btn btn-primary" disabled={busy || !options.data}>送出審批</button></div>
          </form>
        )}
      </Collapsible>
      <Card title="採購單清單">
        <Status loading={list.loading} error={list.error}>
          <DataTable
            rows={list.data ?? []}
            rowKey={(r) => r.po_id}
            columns={[
              { key: "po_id", label: "採購單號" },
              { key: "supplier_name", label: "供應商", render: (r) => r.supplier_name ?? r.supplier_id },
              { key: "order_date", label: "日期" },
              { key: "status", label: "狀態", render: (r) => <Badge tone={r.status === "草稿" ? "neutral" : "info"}>{r.status ?? "—"}</Badge> },
              { key: "total_amount", label: "金額", align: "right", render: (r) => money(r.total_amount) },
            ]}
          />
        </Status>
      </Card>
    </>
  );
}

// ── 供應商管理 ──────────────────────────────────────────────────────
export function Suppliers() {
  const data = useAsync(() => api<{ suppliers: any[]; region_factors: any[] }>("/procurement/suppliers"));
  const { busy, run } = useAction();
  const blank = { supplier_id: "", name: "", contact: "", phone: "", email: "", country: "", region: "", risk_level: "" };
  const [form, setForm] = useState(blank);
  const [region, setRegion] = useState("");
  const factor = data.data?.region_factors.find((f) => f.risk_key === region);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api("/procurement/suppliers", { method: "POST", body: form }), "已新增供應商")) {
      setForm(blank);
      data.reload();
    }
  }

  const riskTone = (v: string) => (v === "高" ? "danger" : v === "中" ? "warn" : v === "低" ? "ok" : "neutral");

  return (
    <>
      <PageHeader description="維護供應商資料與所在地區的風險等級。" />
      <p className="muted">填寫國家、地區與風險等級後，可在「供應鏈與風險」地圖自動標註位置。</p>
      <Card>
        <Status loading={data.loading} error={data.error}>
          <DataTable
            rows={data.data?.suppliers ?? []}
            rowKey={(r) => r.supplier_id}
            maxHeight={480}
            columns={[
              { key: "supplier_id", label: "代號" },
              { key: "name", label: "名稱" },
              { key: "contact", label: "聯絡人" },
              { key: "phone", label: "電話" },
              { key: "country", label: "國家" },
              { key: "region", label: "地區" },
              { key: "risk_level", label: "風險", render: (r) => (r.risk_level ? <Badge tone={riskTone(r.risk_level)}>{r.risk_level}</Badge> : "—") },
              { key: "is_official", label: "名單狀態", render: (r) => (r.is_official ? <Badge tone="info">正式</Badge> : <Badge>候補</Badge>) },
            ]}
          />
        </Status>
      </Card>
      <Collapsible title="風險等級說明與建議">
        <div className="table-wrap">
          <table>
            <thead><tr><th>等級</th><th>適用情境</th><th>範例</th></tr></thead>
            <tbody>
              <tr><td><Badge tone="danger">高</Badge></td><td>曾發生嚴重延遲／品質爭議、單一供應源且替代困難、所在地區政經不穩或常受天災影響、或地區風險係數偏高</td><td>戰亂／高關稅地區、單一關鍵料源、過去一年內有重大延遲</td></tr>
              <tr><td><Badge tone="warn">中</Badge></td><td>偶有延遲或需較長交期、有備援但切換成本高、地區風險係數中等</td><td>新供應商、跨洲運輸、部分地區天候不穩</td></tr>
              <tr><td><Badge tone="ok">低</Badge></td><td>交期穩定、有多源或本地供應、地區風險係數低、長期合作無重大事件</td><td>國內穩定供應商、成熟地區多源、無重大事件紀錄</td></tr>
            </tbody>
          </table>
        </div>
        {data.data?.region_factors.length ? (
          <div className="inline-form">
            <Field label="查詢地區係數（供風險等級參考）">
              <select value={region} onChange={(e) => setRegion(e.target.value)}>
                <option value="">—</option>
                {data.data.region_factors.map((f) => <option key={f.risk_key} value={f.risk_key}>{f.risk_key}</option>)}
              </select>
            </Field>
          </div>
        ) : (
          <Alert>尚未設定地區風險係數。可在舊版「供應鏈與風險 → 風險係數管理」載入預設範本。</Alert>
        )}
        {factor && (
          <Alert>
            <b>{factor.risk_key}</b> 地區係數加權分：<b>{num(factor.weighted_score)}</b> → 建議風險等級：<b>{factor.suggested_level}</b>
            （≥70 高、40–69 中、&lt;40 低）
          </Alert>
        )}
      </Collapsible>
      <Collapsible title="新增供應商">
        <form className="form-grid" onSubmit={submit}>
          <Field label="供應商代號"><input required value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })} /></Field>
          <Field label="公司名稱"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="聯絡人"><input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></Field>
          <Field label="電話"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Email"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="國家（供應鏈地圖）"><input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></Field>
          <Field label="地區（如東亞、日本）"><input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} /></Field>
          <Field label="風險等級">
            <select value={form.risk_level} onChange={(e) => setForm({ ...form, risk_level: e.target.value })}>
              {["", "低", "中", "高"].map((v) => <option key={v} value={v}>{v || "—"}</option>)}
            </select>
          </Field>
          <div className="form-actions"><button className="btn btn-primary" disabled={busy}>新增</button></div>
        </form>
      </Collapsible>
    </>
  );
}

// ── 進貨成本 ────────────────────────────────────────────────────────
export function Costs() {
  const data = useAsync(() => api<any[]>("/procurement/costs"));
  return (
    <>
      <PageHeader description="比較各商品的售價、進貨成本與毛利率。" />
      <Card>
        <Status loading={data.loading} error={data.error}>
          <DataTable
            rows={data.data ?? []}
            rowKey={(r) => r.product_id}
            columns={[
              { key: "product_id", label: "品號" },
              { key: "name", label: "品名" },
              { key: "cost", label: "成本", align: "right", render: (r) => money(r.cost) },
              { key: "price", label: "售價", align: "right", render: (r) => money(r.price) },
              { key: "margin", label: "毛利率", align: "right", render: (r) => (r.price ? `${Math.round(((r.price - (r.cost ?? 0)) / r.price) * 100)}%` : "—") },
            ]}
          />
        </Status>
      </Card>
    </>
  );
}

// ── 採購歷史 ────────────────────────────────────────────────────────
export function History() {
  const data = useAsync(() => api<any[]>("/procurement/history"));
  return (
    <>
      <PageHeader description="最近 100 筆採購明細。" />
      <Card>
        <Status loading={data.loading} error={data.error}>
          <DataTable
            rows={data.data ?? []}
            rowKey={(r, i) => `${r.po_id}-${i}`}
            columns={[
              { key: "po_id", label: "採購單號" },
              { key: "order_date", label: "日期" },
              { key: "supplier_name", label: "供應商" },
              { key: "product_name", label: "品名" },
              { key: "qty", label: "數量", align: "right" },
              { key: "unit_price", label: "單價", align: "right", render: (r) => money(r.unit_price) },
              { key: "subtotal", label: "小計", align: "right", render: (r) => money(r.subtotal) },
            ]}
          />
        </Status>
      </Card>
    </>
  );
}
