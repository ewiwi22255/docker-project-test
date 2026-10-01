import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { firstPath } from "../routes";

export default function Login() {
  const { user, login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={firstPath(user.modules)} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "登入失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand"><ShieldCheck size={26} /></div>
        <h1>進銷存安全系統</h1>
        <p className="muted">請使用公司帳號登入</p>
        <label className="field">
          <span className="field-label">使用者帳號</span>
          <input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">密碼</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <div className="alert alert-error">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy} type="submit">
          {busy ? "登入中…" : "登入"}
        </button>
        <details className="demo-accounts">
          <summary>示範帳號</summary>
          <p>admin / admin（系統管理員）・wh1 / wh1（倉管）・sales1 / sales1（業務）・hr1 / hr1（人資）</p>
        </details>
      </form>
    </div>
  );
}
