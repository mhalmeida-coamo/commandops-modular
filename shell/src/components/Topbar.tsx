import { useEffect, useRef, useState } from "react";
import type { AppTheme, ModuleManifest, UserInfo } from "../types";

type Props = {
  activeModule: ModuleManifest | null;
  showAdmin: boolean;
  user: UserInfo | null;
  theme: AppTheme;
  onThemeToggle: () => void;
  onLogout: () => void;
};

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: 15, height: 15, flexShrink: 0 }}
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function ModuleNavIcon({ id }: { id: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.9",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (id) {
    case "vpn":
      return (
        <svg {...common}>
          <path d="M12 3.8 5.5 6.5v5.3c0 4.1 2.9 6.5 6.5 8 3.6-1.5 6.5-3.9 6.5-8V6.5z" />
          <rect x="9.2" y="10.3" width="5.6" height="3.8" rx="0.9" />
          <path d="M10.2 10.3V9.1a1.8 1.8 0 0 1 3.6 0v1.2" />
        </svg>
      );
    case "cypress":
      return (
        <svg {...common}>
          <path d="M7 8.5V5.8a1.3 1.3 0 0 1 1.3-1.3h7.4A1.3 1.3 0 0 1 17 5.8v2.7" />
          <rect x="5" y="8.5" width="14" height="7.8" rx="2.2" />
          <path d="M8 12h.01M16 12h.01" />
        </svg>
      );
    case "azure":
    case "postfix":
    case "azure_squid":
      return (
        <svg {...common}>
          <path d="m12 3.8 6.8 3.9L12 11.6 5.2 7.7z" />
          <path d="m5.2 11.2 6.8 3.9 6.8-3.9" />
          <path d="m5.2 14.7 6.8 3.9 6.8-3.9" />
        </svg>
      );
    case "internet":
      return (
        <svg {...common}>
          <path d="M5 7.5h14M5 12h10M5 16.5h14" />
          <path d="m14 9.6 2.4-2.1L14 5.4" />
        </svg>
      );
    case "ad":
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="2.5" />
          <path d="M5.8 16.2c.8-2 2.4-3.2 4.2-3.2s3.4 1.2 4.2 3.2" />
          <path d="M15.5 7.5h4M15.5 11h4" />
        </svg>
      );
    case "mdm":
      return (
        <svg {...common}>
          <rect x="7" y="2" width="10" height="18" rx="2.5" />
          <path d="M11 17.5h2" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7" />
          <path d="M12 8v4l2.5 2.5" />
        </svg>
      );
  }
}

export function Topbar({ activeModule, showAdmin, user, theme, onThemeToggle, onLogout }: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  const initials = user?.username?.slice(0, 2).toUpperCase() ?? "??";
  const roleLabel = user?.is_platform_admin ? "Platform Admin" : (user?.role ?? "Usuário");

  return (
    <header className="app-topbar">
      <div className="app-topbar-title">
        {showAdmin ? (
          <strong>Administração</strong>
        ) : activeModule ? (
          <>
            <span className="app-topbar-title-icon">
              <ModuleNavIcon id={activeModule.id} />
            </span>
            <strong>{activeModule.nav_label}</strong>
          </>
        ) : (
          <strong>CommandOps</strong>
        )}
      </div>

      <div className="app-topbar-actions">
        <button
          className="theme-toggle"
          onClick={onThemeToggle}
          title={theme === "dark" ? "Modo claro" : "Modo escuro"}
          aria-label={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
        >
          <span className="theme-toggle-icon">
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </span>
        </button>

        {user && (
          <div style={{ position: "relative" }} ref={dropdownRef}>
            <button
              className={`app-user-pill${dropdownOpen ? " open" : ""}`}
              onClick={() => setDropdownOpen((v) => !v)}
              aria-expanded={dropdownOpen}
              aria-haspopup="true"
            >
              <span className="app-user-avatar">{initials}</span>
              <span className="app-user-name">{user.username}</span>
              <span className={`app-user-chevron${dropdownOpen ? " open" : ""}`}>▾</span>
            </button>

            {dropdownOpen && (
              <div className="app-user-dropdown" role="menu">
                <div className="app-user-dropdown-head">
                  <span className="app-user-dropdown-avatar">{initials}</span>
                  <div className="app-user-dropdown-meta">
                    <strong>{user.username}</strong>
                    <span>{roleLabel}</span>
                  </div>
                </div>

                <div className="app-user-dropdown-actions">
                  <button
                    className="app-user-dropdown-item"
                    role="menuitem"
                    onClick={() => { onThemeToggle(); setDropdownOpen(false); }}
                  >
                    <span style={{ display: "inline-flex", opacity: 0.7, flexShrink: 0 }}>
                      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
                    </span>
                    {theme === "dark" ? "Modo claro" : "Modo escuro"}
                  </button>

                  <div className="app-user-dropdown-divider" />

                  <button
                    className="app-user-dropdown-item danger"
                    role="menuitem"
                    onClick={() => { setDropdownOpen(false); onLogout(); }}
                  >
                    <SignOutIcon />
                    Sair
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
