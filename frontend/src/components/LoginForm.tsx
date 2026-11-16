import { useState, type FormEvent } from "react";
import { api } from "../api";
import type { Me } from "../types";

const fieldClass = "mt-1 w-full rounded-lg border bg-white p-2.5 text-sm";

/** 아이디·비밀번호 로그인. 계정은 backend/scripts/add_user.py로 만든다 (회원가입 화면 없음). */
export default function LoginForm({ onLogin }: { onLogin: (me: Me) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await api.login(username, password));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border bg-white p-6">
        <div>
          <h1 className="text-lg font-semibold text-ink">CRM 시안 생성</h1>
          <p className="mt-1 text-sm text-gray-500">계정으로 로그인하세요.</p>
        </div>
        <label className="block">
          <span className="text-sm font-medium">아이디</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">비밀번호</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className={fieldClass}
          />
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover active:bg-primary-pressed disabled:opacity-40"
        >
          {busy ? "확인 중…" : "로그인"}
        </button>
      </form>
    </div>
  );
}
