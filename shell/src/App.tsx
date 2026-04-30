import { useState, type FormEvent } from "react";
import type { AppLanguage, ModuleManifest, UserInfo } from "./types";
import logoExpanded from "./assets/logo-commandops.png";
import { useTheme } from "./hooks/useTheme";
import { useModules } from "./hooks/useModules";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { ModuleLoader } from "./components/ModuleLoader";
import { AdminPanel } from "./components/AdminPanel";

const TOKEN_KEY = "commandops_token";

type AuthState = {
  token: string;
  user: UserInfo;
} | null;

function loadAuth(): AuthState {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as AuthState) : null;
  } catch {
    return null;
  }
}

function saveAuth(state: AuthState) {
  if (state) {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(state));
  } else {
    sessionStorage.removeItem(TOKEN_KEY);
  }
}

export function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const [language] = useState<AppLanguage>("pt-BR");
  const [auth, setAuth] = useState<AuthState>(loadAuth);
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const { modules, loading: modulesLoading } = useModules(auth?.token ?? null);

  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const activeModule: ModuleManifest | null =
    modules.find((m) => m.id === activeModuleId) ?? modules[0] ?? null;

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);

    try {
      const res = await fetch("/registry/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginForm),
      });

      if (!res.ok) {
        const err = (await res.json()) as { detail?: string };
        throw new Error(err.detail ?? "Credenciais inválidas");
      }

      const data = (await res.json()) as { token: string; user: UserInfo };
      const state = { token: data.token, user: data.user };
      saveAuth(state);
      setAuth(state);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Erro ao autenticar");
    } finally {
      setLoginLoading(false);
    }
  }

  function handleLogout() {
    saveAuth(null);
    setAuth(null);
    setActiveModuleId(null);
    setShowAdmin(false);
  }

  function handleNavigate(moduleId: string) {
    setShowAdmin(false);
    setActiveModuleId(moduleId);
  }

  function handleAdminOpen() {
    setShowAdmin(true);
    setActiveModuleId(null);
  }

  function handleAdminClose() {
    setShowAdmin(false);
  }

  if (!auth) {
    return (
      <div className="login">
        <form className="login-card" onSubmit={handleLogin}>
          <div className="login-brand">
            <img src={logoExpanded} alt="CommandOps" className="login-brand-logo" />
          </div>
          <span className="login-eyebrow">Enterprise Command Center</span>
          <h2>Operações com governança e precisão.</h2>
          <p style={{ textAlign: "center" }}>Faça login para acessar o painel de operações.</p>

          {loginError && <div className="alert">{loginError}</div>}

          <label className="label">
            Usuário
            <input
              className="input"
              value={loginForm.username}
              onChange={(e) => setLoginForm((f) => ({ ...f, username: e.target.value }))}
              autoComplete="username"
              autoFocus
            />
          </label>

          <label className="label">
            Senha
            <input
              className="input"
              type="password"
              value={loginForm.password}
              onChange={(e) => setLoginForm((f) => ({ ...f, password: e.target.value }))}
              autoComplete="current-password"
            />
          </label>

          <button className="button" type="submit" disabled={loginLoading}>
            {loginLoading ? "Autenticando…" : "Entrar"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <>
      <div className={`shell${sidebarCollapsed ? " sidebar-is-collapsed" : ""}`}>
        <Sidebar
          modules={modules}
          activeModuleId={activeModule?.id ?? null}
          collapsed={sidebarCollapsed}
          user={auth.user}
          onNavigate={handleNavigate}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        />

        <div className="main">
          <Topbar
            activeModule={activeModule}
            user={auth.user}
            theme={theme}
            onThemeToggle={toggleTheme}
            onLogout={handleLogout}
            onAdminOpen={auth.user.is_platform_admin ? handleAdminOpen : undefined}
          />

          <div className="main-shell">
            {modulesLoading ? (
              <div className="module-loading">
                <span className="spinner" />
                <span>Carregando módulos…</span>
              </div>
            ) : activeModule ? (
              <ModuleLoader
                module={activeModule}
                moduleProps={{
                  token: auth.token,
                  user: auth.user,
                  apiBase: activeModule.api_url,
                  theme,
                  language,
                }}
              />
            ) : (
              <div className="module-loading">
                <span style={{ color: "var(--muted)" }}>Nenhum módulo disponível</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {showAdmin && (
        <AdminPanel modules={modules} token={auth.token} onClose={handleAdminClose} />
      )}
    </>
  );
}
