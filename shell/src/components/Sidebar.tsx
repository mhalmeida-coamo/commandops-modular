import type { ModuleManifest } from "../types";
import logoExpanded from "../assets/logo-commandops.png";
import logoCollapsed from "../assets/commandops-menu-collapsed.png";

type Props = {
  modules: ModuleManifest[];
  activeModuleId: string | null;
  collapsed: boolean;
  user?: { username: string; role?: string; is_platform_admin?: boolean } | null;
  onNavigate: (moduleId: string) => void;
  onToggleCollapse: () => void;
};

const ICON_COMMON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.9",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function ModuleIcon({ id }: { id: string }) {
  switch (id) {
    case "vpn":
      return (
        <svg {...ICON_COMMON}>
          <path d="M12 3.8 5.5 6.5v5.3c0 4.1 2.9 6.5 6.5 8 3.6-1.5 6.5-3.9 6.5-8V6.5z" />
          <rect x="9.2" y="10.3" width="5.6" height="3.8" rx="0.9" />
          <path d="M10.2 10.3V9.1a1.8 1.8 0 0 1 3.6 0v1.2" />
        </svg>
      );
    case "cypress":
      return (
        <svg {...ICON_COMMON}>
          <path d="M7 8.5V5.8a1.3 1.3 0 0 1 1.3-1.3h7.4A1.3 1.3 0 0 1 17 5.8v2.7" />
          <rect x="5" y="8.5" width="14" height="7.8" rx="2.2" />
          <path d="M8 12h.01M16 12h.01" />
          <path d="M8.5 16.3h7v3.2h-7z" />
        </svg>
      );
    case "azure":
    case "postfix":
    case "azure_squid":
      return (
        <svg {...ICON_COMMON}>
          <path d="m12 3.8 6.8 3.9L12 11.6 5.2 7.7z" />
          <path d="m5.2 11.2 6.8 3.9 6.8-3.9" />
          <path d="m5.2 14.7 6.8 3.9 6.8-3.9" />
        </svg>
      );
    case "internet":
      return (
        <svg {...ICON_COMMON}>
          <path d="M5 7.5h14M5 12h10M5 16.5h14" />
          <path d="m14 9.6 2.4-2.1L14 5.4M10 14.1 12.4 12 10 9.9" />
        </svg>
      );
    case "ad":
      return (
        <svg {...ICON_COMMON}>
          <circle cx="9" cy="9" r="2.5" />
          <path d="M5.8 16.2c.8-2 2.4-3.2 4.2-3.2s3.4 1.2 4.2 3.2" />
          <path d="M15.5 7.5h4M15.5 11h4M15.5 14.5h3" />
        </svg>
      );
    case "mdm":
      return (
        <svg {...ICON_COMMON}>
          <rect x="7" y="2" width="10" height="18" rx="2.5" />
          <path d="M11 17.5h2" />
        </svg>
      );
    default:
      return (
        <svg {...ICON_COMMON}>
          <circle cx="12" cy="12" r="7" />
          <path d="M12 8v4l2.5 2.5" />
        </svg>
      );
  }
}


function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={collapsed ? "m7 5 5 5-5 5" : "m12 5-5 5 5 5"} />
    </svg>
  );
}

export function Sidebar({
  modules,
  activeModuleId,
  collapsed,
  user,
  onNavigate,
  onToggleCollapse,
}: Props) {
  const initials = user?.username?.slice(0, 2).toUpperCase() ?? "??";
  const roleLabel = user?.is_platform_admin ? "Admin" : (user?.role ?? "Usuário");

  return (
    <aside className={`sidebar${collapsed ? " collapsed" : ""}`} style={{ position: "relative" }}>

      <button
        className="sidebar-collapse-toggle"
        onClick={onToggleCollapse}
        title={collapsed ? "Expandir menu" : "Recolher menu"}
        aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
      >
        <CollapseIcon collapsed={collapsed} />
      </button>

      {/* Brand */}
      <div className="sidebar-brand">
        <img
          src={collapsed ? logoCollapsed : logoExpanded}
          alt="CommandOps"
          className={`sidebar-brand-logo${collapsed ? " is-collapsed" : ""}`}
        />
        {!collapsed && (
          <div className="sidebar-brand-text">
            <span>Operations Portal</span>
          </div>
        )}
      </div>

      {/* Sections */}
      <div className="sidebar-sections">

        {/* Modules section */}
        <div className="sidebar-section">
          {!collapsed && (
            <div className="sidebar-section-title">Módulos</div>
          )}
          <nav className="nav">
            {modules.map((mod) => (
              <button
                key={mod.id}
                className={activeModuleId === mod.id ? "active" : ""}
                onClick={() => onNavigate(mod.id)}
                title={collapsed ? mod.nav_label : undefined}
              >
                <span className="nav-icon">
                  <ModuleIcon id={mod.id} />
                </span>
                {!collapsed && (
                  <span className="nav-label">{mod.nav_label}</span>
                )}
              </button>
            ))}
          </nav>
        </div>


      </div>

      {/* Bottom user card */}
      <div className="sidebar-user">
        <span className="sidebar-user-avatar">{initials}</span>
        {!collapsed && (
          <div className="sidebar-user-info">
            <span className="sidebar-user-name">{user?.username ?? "—"}</span>
            <span className="sidebar-user-role">{roleLabel}</span>
          </div>
        )}
      </div>

    </aside>
  );
}
