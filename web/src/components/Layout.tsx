import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Bell, ChevronDown, ChevronRight, CircleCheck, Clock, LogOut, Menu, PanelLeftClose, PanelLeftOpen,
  Search, ShieldCheck, TriangleAlert, Truck, X, type LucideIcon,
} from "lucide-react";
import { api } from "../api";
import { canUse, useAuth, type User } from "../auth";
import { allowedPages, MODULE_META, pageMeta, SUBPAGES, type ModuleKey } from "../routes";

export interface AttentionItem {
  kind: "low_stock" | "overdue_order" | "pending_po" | "pending_approval";
  priority: "high" | "normal";
  count: number;
  title: string;
  detail: string;
  path: string;
}

export const ATTENTION_ICON: Record<AttentionItem["kind"], LucideIcon> = {
  low_stock: TriangleAlert,
  overdue_order: Clock,
  pending_po: Truck,
  pending_approval: ShieldCheck,
};

export const initials = (name: string) => (name.trim() ? Array.from(name.trim())[0] : "?");

function readCollapsed(): boolean {
  try {
    return localStorage.getItem("erp.sidebar") === "collapsed";
  } catch {
    return false;
  }
}

/** 側欄徽章與通知鈴共用：每次換頁重新抓待處理事項。 */
function useAttention(user: User, pathname: string) {
  const [items, setItems] = useState<AttentionItem[]>([]);
  useEffect(() => {
    if (!canUse(user, "dashboard")) return;
    let alive = true;
    api<{ attention: AttentionItem[] }>("/dashboard")
      .then((d) => alive && setItems(d.attention))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user, pathname]);
  return items;
}

/** 左下角系統狀態：每分鐘確認一次後端是否正常。 */
function useHealth() {
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [down, setDown] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const check = () =>
      api("/health")
        .then(() => {
          setLastOk(Date.now());
          setDown(false);
        })
        .catch(() => setDown(true));
    check();
    const poll = setInterval(check, 60_000);
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, []);
  const minutes = lastOk ? Math.max(0, Math.floor((now - lastOk) / 60_000)) : null;
  return { down, synced: minutes === null ? "連線中…" : minutes < 1 ? "剛剛同步" : `最後同步 ${minutes} 分鐘前` };
}

function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);
  return ref;
}

function PageSearch({ user }: { user: User }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const ref = useOutsideClose(open, close);
  const pages = useMemo(() => allowedPages(user.modules), [user]);
  const results = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (k ? pages.filter((p) => `${p.section} ${p.name}`.toLowerCase().includes(k)) : pages).slice(0, 8);
  }, [q, pages]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(path: string) {
    navigate(path);
    setQ("");
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      go(results[active].path);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div className="search" ref={ref}>
      <Search size={16} className="search-icon" />
      <input
        ref={inputRef}
        value={q}
        placeholder="搜尋功能頁面"
        aria-label="搜尋功能頁面"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      <kbd className="search-kbd">Ctrl K</kbd>
      {open && (
        <div className="popover search-results">
          {results.length ? (
            results.map((p, i) => (
              <button key={p.path} type="button" className={`search-item ${i === active ? "active" : ""}`} onMouseEnter={() => setActive(i)} onClick={() => go(p.path)}>
                <p.icon size={16} />
                <span>{p.name}</span>
                <span className="search-section">{p.section}</span>
              </button>
            ))
          ) : (
            <div className="popover-empty">找不到符合的功能</div>
          )}
        </div>
      )}
    </div>
  );
}

function Notifications({ items }: { items: AttentionItem[] }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useOutsideClose(open, close);
  const total = items.reduce((n, a) => n + a.count, 0);
  return (
    <div className="topbar-menu" ref={ref}>
      <button type="button" className="icon-btn" aria-label={`待處理事項 ${total} 項`} onClick={() => setOpen((o) => !o)}>
        <Bell size={19} />
        {total > 0 && <span className="dot-badge">{total > 99 ? "99+" : total}</span>}
      </button>
      {open && (
        <div className="popover notif">
          <div className="popover-head">待處理事項</div>
          {items.length ? (
            items.map((a, i) => {
              const Icon = ATTENTION_ICON[a.kind];
              return (
                <button key={i} type="button" className="notif-item" onClick={() => { navigate(a.path); setOpen(false); }}>
                  <span className={`attn-icon attn-${a.kind}`}><Icon size={16} /></span>
                  <span className="notif-text">
                    <strong>{a.title}</strong>
                    <span>{a.detail}</span>
                  </span>
                </button>
              );
            })
          ) : (
            <div className="popover-empty"><CircleCheck size={16} /> 目前沒有待處理事項</div>
          )}
        </div>
      )}
    </div>
  );
}

function UserMenu({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useOutsideClose(open, close);
  return (
    <div className="topbar-menu" ref={ref}>
      <button type="button" className="user-btn" onClick={() => setOpen((o) => !o)}>
        <span className="avatar">{initials(user.name)}</span>
        <span className="user-btn-name">{user.name}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="popover user-pop">
          <div className="user-pop-head">
            <strong>{user.name}</strong>
            <span>{user.username}・{user.role_name}</span>
            {user.product_levels.length > 0 && <span>權限層級：{user.product_levels.join(" / ")}</span>}
          </div>
          <button type="button" className="popover-action" onClick={onLogout}>
            <LogOut size={16} /> 登出
          </button>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const attention = useAttention(user!, location.pathname);
  const health = useHealth();

  useEffect(() => setMobileOpen(false), [location.pathname]);

  function toggleCollapsed() {
    setCollapsed((c) => {
      try {
        localStorage.setItem("erp.sidebar", c ? "expanded" : "collapsed");
      } catch {
        /* 無痕模式等情況存不了，不影響使用 */
      }
      return !c;
    });
  }

  if (!user) return null;

  const badgeFor = (path: string) => attention.filter((a) => a.path === path).reduce((n, a) => n + a.count, 0);
  const { section, title } = pageMeta(location.pathname);
  const modules = (Object.keys(MODULE_META) as ModuleKey[]).filter((k) => user.modules[k]);

  const item = (path: string, name: string, Icon: LucideIcon) => {
    const badge = badgeFor(path);
    return (
      <NavLink key={path} to={path} className="nav-item" title={collapsed ? name : undefined}>
        <Icon size={18} strokeWidth={1.9} className="nav-icon" />
        <span className="nav-label">{name}</span>
        {badge > 0 && <span className="nav-badge">{badge}</span>}
      </NavLink>
    );
  };

  return (
    <div className={`shell ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}>
      <aside className="sidebar">
        <div className="sb-top">
          <span className="logo"><ShieldCheck size={20} /></span>
          <button type="button" className="sb-collapse" onClick={toggleCollapsed} aria-label={collapsed ? "展開側欄" : "收合側欄"}>
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <button type="button" className="sb-close" onClick={() => setMobileOpen(false)} aria-label="關閉選單">
            <X size={18} />
          </button>
        </div>

        <div className="workspace" title={collapsed ? "進銷存安全系統" : undefined}>
          <span className="ws-avatar">進</span>
          <span className="ws-text">
            <span className="ws-name">進銷存安全系統</span>
            <span className="ws-sub">{user.role_name}</span>
          </span>
        </div>

        <nav className="nav">
          {modules.map((key) => {
            const meta = MODULE_META[key];
            const links =
              key === "dashboard"
                ? [item(meta.base, meta.label, meta.icon)]
                : SUBPAGES[key].filter((p) => user.modules[key]!.includes(p.name)).map((p) => item(`${meta.base}/${p.slug}`, p.name, p.icon));
            return (
              <div key={key} className="nav-section">
                <div className="nav-section-title">{meta.section}</div>
                {links}
              </div>
            );
          })}
        </nav>

        <div className={`sb-status ${health.down ? "down" : ""}`}>
          <span className="status-dot" />
          <span className="sb-status-text">
            <strong>{health.down ? "無法連線到伺服器" : "系統運作正常"}</strong>
            <span>{health.down ? "請確認後端服務" : health.synced}</span>
          </span>
        </div>

        <div className="sb-user">
          <span className="avatar">{initials(user.name)}</span>
          <span className="sb-user-text">
            <strong>{user.name}</strong>
            <span>{user.role_name}</span>
          </span>
          <button type="button" className="sb-logout" onClick={logout} aria-label="登出" title="登出">
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="backdrop" onClick={() => setMobileOpen(false)} />

      <div className="main-col">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" onClick={() => (window.innerWidth <= 900 ? setMobileOpen(true) : toggleCollapsed())} aria-label="切換選單">
            <Menu size={20} />
          </button>
          <nav className="crumbs" aria-label="目前位置">
            <span>{section}</span>
            {section !== title && (
              <>
                <ChevronRight size={15} />
                <strong>{title}</strong>
              </>
            )}
          </nav>
          <div className="topbar-right">
            <PageSearch user={user} />
            <Notifications items={attention} />
            <UserMenu user={user} onLogout={logout} />
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
