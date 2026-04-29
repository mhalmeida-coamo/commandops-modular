import type { ModuleManifest } from "../types";

type Props = {
  modules: ModuleManifest[];
  activeModuleId: string | null;
  collapsed: boolean;
  onNavigate: (moduleId: string) => void;
  onToggleCollapse: () => void;
};

export function Sidebar({ modules, activeModuleId, collapsed, onNavigate, onToggleCollapse }: Props) {
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

      <button
        className="shell-nav-item"
        style={{ margin: "8px", width: "auto" }}
        onClick={onToggleCollapse}
        title={collapsed ? "Expandir menu" : "Recolher menu"}
      >
        <span className="shell-nav-item-icon">{collapsed ? "→" : "←"}</span>
        {!collapsed && <span className="shell-nav-item-label">Recolher</span>}
      </button>
    </aside>
  );
}
