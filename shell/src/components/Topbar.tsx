import type { AppTheme, ModuleManifest, UserInfo } from "../types";

type Props = {
  activeModule: ModuleManifest | null;
  user: UserInfo | null;
  theme: AppTheme;
  onThemeToggle: () => void;
  onLogout: () => void;
};

export function Topbar({ activeModule, user, theme, onThemeToggle, onLogout }: Props) {
  return (
    <header className="shell-topbar">
      <div className="shell-topbar-title">
        {activeModule ? (
          <>
            <span style={{ marginRight: 8 }}>{activeModule.icon}</span>
            {activeModule.nav_label}
          </>
        ) : (
          "CommandOps"
        )}
      </div>

      <div className="shell-topbar-actions">
        <button className="theme-toggle" onClick={onThemeToggle} title="Alternar tema">
          {theme === "dark" ? "☀️" : "🌙"}
        </button>

        {user && (
          <button
            className="button secondary"
            style={{ fontSize: 12, padding: "6px 12px" }}
            onClick={onLogout}
            title={`Sair (${user.username})`}
          >
            {user.username}
          </button>
        )}
      </div>
    </header>
  );
}
