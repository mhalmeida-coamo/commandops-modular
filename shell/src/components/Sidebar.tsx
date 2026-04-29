import type { ModuleManifest } from "../types";

type Props = {
  modules: ModuleManifest[];
  activeModuleId: string | null;
  collapsed: boolean;
  isPlatformAdmin: boolean;
  onNavigate: (moduleId: string) => void;
  onAdminOpen: () => void;
  onToggleCollapse: () => void;
};

export function Sidebar({
  modules,
  activeModuleId,
  collapsed,
  isPlatformAdmin,
  onNavigate,
  onAdminOpen,
  onToggleCollapse,
}: Props) {
  return (
    <aside className={`shell-sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="shell-sidebar-logo">
        <span style={{ fontSize: 20, flexShrink: 0 }}>⚙️</span>
        {!collapsed && <span>CommandOps</span>}
      </div>

      <nav className="shell-sidebar-nav">
        {modules.map((mod) => (
          <button
            key={mod.id}
            className={`shell-nav-item${activeModuleId === mod.id ? " active" : ""}`}
            onClick={() => onNavigate(mod.id)}
            title={collapsed ? mod.nav_label : undefined}
          >
            <span className="shell-nav-item-icon">{mod.icon}</span>
            {!collapsed && <span className="shell-nav-item-label">{mod.nav_label}</span>}
          </button>
        ))}
      </nav>

      <div style={{ padding: "8px", display: "flex", flexDirection: "column", gap: 2 }}>
        {isPlatformAdmin && (
          <button
            className={`shell-nav-item${activeModuleId === "__admin__" ? " active" : ""}`}
            onClick={onAdminOpen}
            title={collapsed ? "Administração" : undefined}
          >
            <span className="shell-nav-item-icon">🛠️</span>
            {!collapsed && <span className="shell-nav-item-label">Administração</span>}
          </button>
        )}

        <button
          className="shell-nav-item"
          style={{ width: "auto" }}
          onClick={onToggleCollapse}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
        >
          <span className="shell-nav-item-icon">{collapsed ? "→" : "←"}</span>
          {!collapsed && <span className="shell-nav-item-label">Recolher</span>}
        </button>
      </div>
    </aside>
  );
}
