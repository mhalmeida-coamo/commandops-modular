import type { ModuleManifest } from "../types";
import logoExpanded from "../assets/logo-commandops.png";
import logoCollapsed from "../assets/commandops-menu-collapsed.png";

type Props = {
  modules: ModuleManifest[];
  activeModuleId: string | null;
  collapsed: boolean;
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
    case "azure_squid":
      return (
        <svg {...ICON_COMMON}>
          <path d="m12 3.8 6.8 3.9L12 11.6 5.2 7.7z" />
          <path d="m5.2 11.2 6.8 3.9 6.8-3.9" />
          <path d="m5.2 14.7 6.8 3.9 6.8-3.9" />
        </svg>
      );
    case "ssh":
      return (
        <svg {...ICON_COMMON}>
          <path d="M5 7.5h14M5 12h10M5 16.5h14" />
          <path d="m14 9.6 2.4-2.1L14 5.4M10 14.1 12.4 12 10 9.9" />
        </svg>
      );
    case "ad_ldap":
    case "ad_create":
    case "ad_transfer":
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
    case "userlock":
      return (
        <svg {...ICON_COMMON}>
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          <circle cx="12" cy="16" r="1" />
        </svg>
      );
    case "cadlogin":
      return (
        <svg {...ICON_COMMON}>
          <rect x="3" y="4" width="18" height="14" rx="2" />
          <path d="M8 10h8M8 14h5" />
        </svg>
      );
    case "demitidos":
      return (
        <svg {...ICON_COMMON}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <line x1="17" y1="8" x2="23" y2="14" />
          <line x1="23" y1="8" x2="17" y2="14" />
        </svg>
      );
    case "smb_cypress":
      return (
        <svg {...ICON_COMMON}>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
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

function healthDotClass(health: ModuleManifest["health"]): string {
  if (health === "healthy") return "health-dot healthy";
  if (health === "warning") return "health-dot degraded";
  return "health-dot unreachable";
}

const SECTION_LABELS: Record<string, string> = {
  identity: "Identidade",
  network: "Rede",
  devices: "Dispositivos",
};

export function Sidebar({
  modules,
  activeModuleId,
  collapsed,
  onNavigate,
  onToggleCollapse,
}: Props) {
  // agrupa por section mantendo ordem de entrada (já vem ordenado do hook)
  const sections = modules.reduce<Record<string, ModuleManifest[]>>((acc, m) => {
    const key = m.section || "outros";
    if (!acc[key]) acc[key] = [];
    acc[key].push(m);
    return acc;
  }, {});

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

      <div className="sidebar-sections">
        {Object.entries(sections).map(([section, mods]) => (
          <div className="sidebar-section" key={section}>
            {!collapsed && (
              <div className="sidebar-section-title">
                {SECTION_LABELS[section] ?? section}
              </div>
            )}
            <nav className="nav">
              {mods.map((mod) => (
                <button
                  key={mod.id}
                  className={activeModuleId === mod.id ? "active" : ""}
                  onClick={() => onNavigate(mod.id)}
                  title={collapsed ? mod.name : undefined}
                >
                  <span className="nav-icon">
                    <ModuleIcon id={mod.id} />
                  </span>
                  {!collapsed && (
                    <>
                      <span className="nav-label">{mod.name}</span>
                      <span
                        className={healthDotClass(mod.health)}
                        title={mod.health}
                        style={{ marginLeft: "auto", flexShrink: 0 }}
                      />
                    </>
                  )}
                  {collapsed && (
                    <span
                      className={healthDotClass(mod.health)}
                      title={mod.health}
                      style={{ position: "absolute", top: 6, right: 6, width: 6, height: 6 }}
                    />
                  )}
                </button>
              ))}
            </nav>
          </div>
        ))}
      </div>
    </aside>
  );
}
