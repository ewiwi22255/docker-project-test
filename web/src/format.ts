const intFmt = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 });
const decFmt = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 });

export const money = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : `$${intFmt.format(Number(v))}`);
export const num = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : intFmt.format(Number(v)));
export const dec = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : decFmt.format(Number(v)));

const pad = (n: number) => String(n).padStart(2, "0");

export function stamp(fmt: "minute" | "second" = "minute", d = new Date()): string {
  const base = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  return fmt === "minute" ? `${base}${pad(d.getHours())}${pad(d.getMinutes())}` : `${base}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export const today = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function newOperationId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** $6.24M、$282K：卡片上的大數字用 */
export function compactMoney(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${intFmt.format(n)}`;
}

/** 與前期相比的變化百分比；前期為 0 時沒有意義，回 null */
export function pctChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

// 介面配色（與 styles.css 的 --chart-* 一致）
export const C = {
  teal: "#4b7a83",
  tealDark: "#3c6c74",
  blue: "#3b6fd4",
  lightBlue: "#d6e2f5",
  slate: "#94a3b8",
  grid: "#e8ecf1",
  axis: "#8a94a1",
  warn: "#ea7a17",
  danger: "#dc4c4c",
  ok: "#2f9e6e",
};
export const CHART_COLORS = [C.teal, C.blue, "#9fb7d9", "#e9a23b", "#6aa88f", "#8f7fd1", "#d97a7a", "#5fb3c7"];
export const STATUS_COLORS: Record<string, string> = { 已出貨: C.teal, 處理中: C.blue, 已取消: "#cbd5e1" };
