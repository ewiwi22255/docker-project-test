import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import { useLocation } from "react-router-dom";
import { ApiError } from "../api";
import { pageMeta } from "../routes";

// ── 資料載入 ────────────────────────────────────────────────────────
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(() => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    loader()
      .then((d) => id === seq.current && setData(d))
      .catch((e) => id === seq.current && setError(e instanceof ApiError ? e.message : "載入失敗"))
      .finally(() => id === seq.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(reload, [reload]);
  return { data, error, loading, reload, setData };
}

// ── 提示訊息 ────────────────────────────────────────────────────────
type Toast = { id: number; kind: "ok" | "error" | "info"; text: string };
const ToastContext = createContext<(kind: Toast["kind"], text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, kind, text }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/** 包一層：送出期間鎖按鈕，成功／失敗自動跳提示。 */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string | ((r: T) => string)): Promise<T | undefined> => {
      setBusy(true);
      try {
        const result = await fn();
        if (success) toast("ok", typeof success === "function" ? success(result) : success);
        return result;
      } catch (e) {
        toast("error", e instanceof ApiError ? e.message : "操作失敗");
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { busy, run };
}

// ── 版面元件 ────────────────────────────────────────────────────────
export function PageHeader({ description, actions }: { description?: string; actions?: ReactNode }) {
  const { section, title } = pageMeta(useLocation().pathname);
  return (
    <header className="page-header">
      <div>
        <div className="eyebrow"><span className="eyebrow-dot" />{section === title ? section : `${section} / ${title}`}</div>
        <h1>{title}</h1>
        {description && <p className="page-desc">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Card({ title, subtitle, children, actions, className = "", id }: {
  title?: ReactNode; subtitle?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string; id?: string;
}) {
  return (
    <section className={`card ${className}`} id={id}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** 小型走勢線（卡片用，不需要座標軸）。 */
export function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const w = 84, h = 26, pad = 2;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(pad + (i * (w - pad * 2)) / (values.length - 1)).toFixed(1)},${(h - pad - ((v - min) / span) * (h - pad * 2)).toFixed(1)}`);
  return (
    <svg className="sparkline" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Delta({ value, suffix = "較上月" }: { value: number | null; suffix?: string }) {
  if (value === null || !Number.isFinite(value)) return <span className="delta delta-flat">— {suffix}</span>;
  const up = value >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`delta ${up ? "delta-up" : "delta-down"}`}>
      <Icon size={14} strokeWidth={2.4} />{Math.abs(value).toFixed(1)}% <span className="delta-suffix">{suffix}</span>
    </span>
  );
}

export function Kpi({ label, value, unit, hint, tone, icon: Icon, tag, foot, spark }: {
  label: string; value: ReactNode; unit?: string; hint?: ReactNode; tone?: "warn" | "ok";
  icon?: LucideIcon; tag?: string; foot?: ReactNode; spark?: { values: number[]; color: string };
}) {
  return (
    <div className={`kpi ${tone ? `kpi-${tone}` : ""}`}>
      <div className="kpi-top">
        {Icon && <span className="kpi-icon"><Icon size={17} strokeWidth={2} /></span>}
        <span className="kpi-label">{label}</span>
        {tag && <span className="kpi-tag">{tag}</span>}
      </div>
      <div className="kpi-value">{value}{unit && <small>{unit}</small>}</div>
      {(foot || spark) && (
        <div className="kpi-foot">
          <div>{foot}</div>
          {spark && <Sparkline values={spark.values} color={spark.color} />}
        </div>
      )}
      {hint && <div className="kpi-hint">{hint}</div>}
    </div>
  );
}

export function Collapsible({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="collapsible" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="collapsible-body">{children}</div>
    </details>
  );
}

export function Alert({ kind = "info", children }: { kind?: "info" | "ok" | "warn" | "error"; children: ReactNode }) {
  return <div className={`alert alert-${kind}`}>{children}</div>;
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "ok" | "warn" | "danger" | "info"; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Loading() {
  return <div className="loading" aria-busy="true">載入中…</div>;
}

export function Status({ loading, error, empty, children }: { loading: boolean; error: string | null; empty?: boolean; children: ReactNode }) {
  if (loading) return <Loading />;
  if (error) return <Alert kind="error">{error}</Alert>;
  if (empty) return <div className="empty">目前沒有資料</div>;
  return <>{children}</>;
}

// ── 表格 ────────────────────────────────────────────────────────────
export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  align?: "right" | "left" | "center";
}

export function DataTable<T extends Record<string, any>>({ columns, rows, rowKey, maxHeight }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, i: number) => string | number;
  maxHeight?: number;
}) {
  if (!rows.length) return <div className="empty">目前沒有資料</div>;
  return (
    <div className="table-wrap" style={maxHeight ? { maxHeight } : undefined}>
      <table>
        <thead>
          <tr>{columns.map((c) => <th key={c.key} style={{ textAlign: c.align }}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r, i)}>
              {columns.map((c) => (
                <td key={c.key} style={{ textAlign: c.align }}>{c.render ? c.render(r) : r[c.key] ?? "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 表單 ────────────────────────────────────────────────────────────
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: { key: string; label: string }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} className={value === t.key ? "active" : ""} onClick={() => onChange(t.key)} type="button">
          {t.label}
        </button>
      ))}
    </div>
  );
}
