import { useState, type FormEvent } from "react";
import { api } from "../api";
import { Alert, Badge, Card, Collapsible, DataTable, Field, PageHeader, Status, useAction, useAsync } from "../components/ui";
import { dec, money, num } from "../format";


interface Warehouse { warehouse_id: string; name: string; address: string }

// ── 商品管理 ────────────────────────────────────────────────────────
export function Products() {
  const products = useAsync(() => api<any[]>("/inventory/products"));
  const warehouses = useAsync(() => api<Warehouse[]>("/inventory/warehouses"));
  const { busy, run } = useAction();
  const blank = { product_id: "", name: "", barcode: "", price: 0, cost: 0, stock: 0, reorder_point: 0, daily_sales: 0, warehouse_id: "" };
  const [form, setForm] = useState(blank);
  const set = (k: keyof typeof blank, v: string | number) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = { ...form, warehouse_id: form.warehouse_id || warehouses.data?.[0]?.warehouse_id || "WH01", barcode: form.barcode || null };
    const ok = await run(() => api("/inventory/products", { method: "POST", body }), `已新增商品【${form.name}】`);
    if (ok) {
      setForm(blank);
      products.reload();
    }
  }

  return (
    <>
      <PageHeader description="新增商品，並查看所有商品的售價、成本與庫存。" />
      <Collapsible title="新增商品">
        <form className="form-grid" onSubmit={submit}>
          <Field label="產品編號"><input required value={form.product_id} onChange={(e) => set("product_id", e.target.value)} /></Field>
          <Field label="產品名稱"><input required value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="條碼（選填）"><input value={form.barcode} onChange={(e) => set("barcode", e.target.value)} /></Field>
          <Field label="售價 (NTD)"><input type="number" min={0} step={1} value={form.price} onChange={(e) => set("price", Number(e.target.value))} /></Field>
          <Field label="成本 (NTD)"><input type="number" min={0} step="0.01" value={form.cost} onChange={(e) => set("cost", Number(e.target.value))} /></Field>
          <Field label="初始庫存"><input type="number" min={0} step={1} value={form.stock} onChange={(e) => set("stock", Number(e.target.value))} /></Field>
          <Field label="安全庫存"><input type="number" min={0} step={1} value={form.reorder_point} onChange={(e) => set("reorder_point", Number(e.target.value))} /></Field>
          <Field label="預估日均銷量"><input type="number" min={0} step={1} value={form.daily_sales} onChange={(e) => set("daily_sales", Number(e.target.value))} /></Field>
          <Field label="倉庫">
            <select value={form.warehouse_id} onChange={(e) => set("warehouse_id", e.target.value)}>
              {(warehouses.data ?? []).map((w) => <option key={w.warehouse_id} value={w.warehouse_id}>{w.warehouse_id} - {w.name}</option>)}
            </select>
          </Field>
          <div className="form-actions"><button className="btn btn-primary" disabled={busy}>新增</button></div>
        </form>
      </Collapsible>
      <Card title="商品清單">
        <Status loading={products.loading} error={products.error}>
          <DataTable
            rows={products.data ?? []}
            rowKey={(r) => r.product_id}
            columns={[
              { key: "product_id", label: "編號" },
              { key: "name", label: "名稱" },
              { key: "barcode", label: "條碼" },
              { key: "stock", label: "庫存", align: "right" },
              { key: "price", label: "售價", align: "right", render: (r) => money(r.price) },
              { key: "cost", label: "成本", align: "right", render: (r) => money(r.cost) },
              { key: "reorder_point", label: "目前水位", align: "right" },
              { key: "baseline_reorder_point", label: "基準水位", align: "right" },
              { key: "warehouse_id", label: "倉庫" },
            ]}
          />
        </Status>
      </Card>
    </>
  );
}

// ── 庫存數量 ────────────────────────────────────────────────────────
const STOCK_STATUS: Record<string, [string, "danger" | "info" | "ok"]> = {
  restock: ["需補貨", "danger"],
  ai_adjusted: ["AI 調整中", "info"],
  normal: ["正常", "ok"],
};

export function Stock() {
  const stock = useAsync(() => api<any[]>("/inventory/stock"));
  const suggestions = useAsync(() => api<any[]>("/inventory/restock-suggestions"));
  const { busy, run } = useAction();

  async function apply() {
    if (!confirm("將所有產品的安全庫存與日均銷量更新為建議值？")) return;
    await run(() => api<{ updated: number }>("/inventory/restock-suggestions/apply", { method: "POST" }), (r) => `已更新 ${r.updated} 項產品的安全庫存`);
    stock.reload();
    suggestions.reload();
  }

  async function makePo() {
    const r = await run(() => api<{ created: boolean; purchase_order: any }>("/inventory/restock-suggestions/purchase-order", { method: "POST" }));
    if (!r) return;
    if (!r.created) alert("目前所有庫存皆高於建議安全水位，無須採購。");
    else alert(`已為 ${r.purchase_order.items} 項產品建立採購單「${r.purchase_order.po_id}」（狀態：草稿），請至「採購管理」查看。`);
  }

  return (
    <>
      <PageHeader description="各商品庫存與安全存量，並依近期銷售速度提出補貨建議。" />
      <Card>
        <Status loading={stock.loading} error={stock.error}>
          <DataTable
            rows={stock.data ?? []}
            rowKey={(r) => r.product_id}
            columns={[
              { key: "product_id", label: "編號" },
              { key: "name", label: "名稱" },
              { key: "stock", label: "庫存", align: "right" },
              { key: "reorder_point", label: "安全線", align: "right" },
              { key: "baseline_reorder_point", label: "基準線", align: "right" },
              { key: "warehouse_id", label: "倉庫" },
              { key: "status", label: "狀態", render: (r) => { const [t, tone] = STOCK_STATUS[r.status] ?? [r.status, "ok"]; return <Badge tone={tone}>{t}</Badge>; } },
            ]}
          />
        </Status>
      </Card>
      <Collapsible title="智慧補貨與動態安全庫存建議">
        <p className="muted">
          依過去 30 天「實際銷售訂單」計算日均銷量，並依「前置天數 7 天」與「緩衝天數 3 天」建議最佳的安全庫存水位與補貨數量。
        </p>
        <Status loading={suggestions.loading} error={suggestions.error}>
          <DataTable
            rows={suggestions.data ?? []}
            rowKey={(r) => r.product_id}
            columns={[
              { key: "product_id", label: "產品編號" },
              { key: "name", label: "產品名稱" },
              { key: "stock", label: "目前庫存", align: "right" },
              { key: "reorder_point", label: "原安全庫存", align: "right" },
              { key: "suggested_reorder_point", label: "建議安全庫存", align: "right" },
              { key: "daily_sales", label: "近 30 天日均銷", align: "right", render: (r) => dec(r.daily_sales) },
              { key: "suggested_order_qty", label: "建議進貨量", align: "right" },
            ]}
          />
          <div className="button-row">
            <button className="btn" disabled={busy} onClick={apply} type="button">套用所有建議的安全庫存水位</button>
            <button className="btn btn-primary" disabled={busy} onClick={makePo} type="button">一鍵產生建議採購單</button>
          </div>
        </Status>
      </Collapsible>
    </>
  );
}

// ── 入庫／出庫 ──────────────────────────────────────────────────────
export function Moves() {
  const products = useAsync(() => api<any[]>("/inventory/product-options"));
  const moves = useAsync(() => api<any[]>("/inventory/moves"));
  const { busy, run } = useAction();
  const [form, setForm] = useState({ product_id: "", move_type: "入庫", qty: 1, ref_no: "", note: "" });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const product_id = form.product_id || products.data?.[0]?.product_id;
    if (!product_id) return;
    const r = await run(
      () => api<any>("/inventory/moves", { method: "POST", body: { ...form, product_id } }),
      (r: any) => `已${form.move_type} ${form.qty} 件 ${r.name}，目前庫存 ${r.stock}`,
    );
    if (r) {
      setForm((f) => ({ ...f, qty: 1, ref_no: "", note: "" }));
      moves.reload();
      products.reload(); // 下拉選單顯示的庫存數同步更新
    }
  }

  return (
    <>
      <PageHeader description="登記商品入庫與出庫，庫存數量會立即更新。" />
      <Card>
        <form className="form-grid" onSubmit={submit}>
          <Field label="商品">
            <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
              {(products.data ?? []).map((p: any) => <option key={p.product_id} value={p.product_id}>{p.product_id} - {p.name}（庫存 {p.stock}）</option>)}
            </select>
          </Field>
          <Field label="類型">
            <div className="radio-row">
              {["入庫", "出庫"].map((t) => (
                <label key={t}><input type="radio" checked={form.move_type === t} onChange={() => setForm({ ...form, move_type: t })} /> {t}</label>
              ))}
            </div>
          </Field>
          <Field label="數量"><input type="number" min={1} step={1} required value={form.qty} onChange={(e) => setForm({ ...form, qty: Number(e.target.value) })} /></Field>
          <Field label="單據編號（選填）"><input value={form.ref_no} onChange={(e) => setForm({ ...form, ref_no: e.target.value })} /></Field>
          <Field label="備註"><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          <div className="form-actions"><button className="btn btn-primary" disabled={busy}>確認</button></div>
        </form>
      </Card>
      <Card title="最近異動">
        <Status loading={moves.loading} error={moves.error}>
          <DataTable
            rows={moves.data ?? []}
            rowKey={(r) => r.move_id}
            columns={[
              { key: "move_id", label: "序號" },
              { key: "product_id", label: "商品" },
              { key: "qty", label: "數量", align: "right" },
              { key: "move_type", label: "類型" },
              { key: "ref_no", label: "單據" },
              { key: "move_date", label: "日期" },
              { key: "note", label: "備註" },
            ]}
          />
        </Status>
      </Card>
    </>
  );
}

// ── 條碼掃描 ────────────────────────────────────────────────────────
export function Barcode() {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<any | null>(null);
  const [miss, setMiss] = useState(false);

  async function lookup(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    try {
      setResult(await api(`/inventory/barcode/${encodeURIComponent(code.trim())}`));
      setMiss(false);
    } catch {
      setResult(null);
      setMiss(true);
    }
  }

  return (
    <>
      <PageHeader description="輸入或掃描條碼，快速查到商品資料。" />
      <Card>
        <form className="inline-form" onSubmit={lookup}>
          <input autoFocus placeholder="請掃描條碼或手動輸入" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn btn-primary">查詢</button>
        </form>
        {result && <Alert kind="ok"><b>{result.name}</b>（{result.product_id}）・庫存：{num(result.stock)}・售價：{money(result.price)}</Alert>}
        {miss && <Alert kind="warn">找不到此條碼對應的商品</Alert>}
      </Card>
    </>
  );
}

// ── 倉庫管理 ────────────────────────────────────────────────────────
export function Warehouses() {
  const list = useAsync(() => api<Warehouse[]>("/inventory/warehouses"));
  const { busy, run } = useAction();
  const [form, setForm] = useState({ warehouse_id: "", name: "", address: "" });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api("/inventory/warehouses", { method: "POST", body: form }), "已新增倉庫")) {
      setForm({ warehouse_id: "", name: "", address: "" });
      list.reload();
    }
  }

  return (
    <>
      <PageHeader description="維護倉庫據點資料。" />
      <Collapsible title="新增倉庫">
        <form className="form-grid" onSubmit={submit}>
          <Field label="倉庫代號"><input required value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })} /></Field>
          <Field label="倉庫名稱"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="地址"><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          <div className="form-actions"><button className="btn btn-primary" disabled={busy}>新增</button></div>
        </form>
      </Collapsible>
      <Card>
        <Status loading={list.loading} error={list.error}>
          <DataTable
            rows={list.data ?? []}
            rowKey={(r) => r.warehouse_id}
            columns={[
              { key: "warehouse_id", label: "代號" },
              { key: "name", label: "名稱" },
              { key: "address", label: "地址" },
            ]}
          />
        </Status>
      </Card>
    </>
  );
}
