import { useEffect, useState } from "react";
import type { ModuleManifest, ModuleSetting } from "../types";
import logoExpanded from "../assets/logo-commandops.png";

type Props = {
  modules: ModuleManifest[];
  token: string;
  onClose: () => void;
};

type SettingRow = ModuleSetting & { dirty?: boolean };

// ── Icons ────────────────────────────────────────────────────────


function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function ModulesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
      strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="8" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
      <rect x="13" y="13" width="8" height="8" rx="2" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14, flexShrink: 0 }}>
      <circle cx="7.5" cy="15.5" r="3.5" />
      <path d="M11 12l9-9M17 6l2 2" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14, flexShrink: 0 }}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M1 1l22 22" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

// ── Settings editor ──────────────────────────────────────────────

function SettingsEditor({ moduleId, moduleName, token }: { moduleId: string; moduleName: string; token: string }) {
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError("");
    setSuccess(false);
    fetch(`/registry/modules/${moduleId}/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Erro ${r.status}`);
        return r.json() as Promise<ModuleSetting[]>;
      })
      .then((data) => setRows(data.map((s) => ({ ...s }))))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [moduleId, token]);

  function updateRow(idx: number, patch: Partial<SettingRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch, dirty: true } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, { key: "", value: "", is_secret: false, dirty: true }]);
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  async function save() {
    setSaving(true);
    setError("");
    setSuccess(false);
    try {
      const res = await fetch(`/registry/modules/${moduleId}/settings`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(rows.map(({ key, value, is_secret }) => ({ key, value, is_secret }))),
      });
      if (!res.ok) {
        const body = (await res.json()) as { detail?: string };
        throw new Error(body.detail ?? `Erro ${res.status}`);
      }
      const updated = (await res.json()) as ModuleSetting[];
      setRows(updated.map((s) => ({ ...s })));
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="admin-content-loading">
        <span className="spinner" />
        <span>Carregando configurações…</span>
      </div>
    );
  }

  return (
    <div className="admin-settings-editor">
      <div className="admin-settings-header">
        <div>
          <h3>{moduleName}</h3>
          <p>Variáveis de configuração e segredos do módulo</p>
        </div>
        <button className="button" onClick={save} disabled={saving}>
          <SaveIcon />
          {saving ? "Salvando…" : "Salvar alterações"}
        </button>
      </div>

      {error && <div className="alert">{error}</div>}
      {success && (
        <div className="alert admin-alert-success">
          Configurações salvas com sucesso.
        </div>
      )}

      <div className="admin-settings-table">
        <div className="admin-settings-table-head">
          <span>Chave</span>
          <span>Valor</span>
          <span style={{ textAlign: "center" }}>Segredo</span>
          <span />
        </div>

        {rows.length === 0 && (
          <div className="admin-settings-empty">
            Nenhuma configuração definida para este módulo.
          </div>
        )}

        {rows.map((row, idx) => (
          <div className="admin-settings-row" key={idx}>
            <div className="admin-settings-cell">
              <span className="admin-settings-key-icon"><KeyIcon /></span>
              <input
                className="input admin-input-mono"
                value={row.key}
                placeholder="NOME_DA_CHAVE"
                onChange={(e) => updateRow(idx, { key: e.target.value })}
              />
            </div>
            <div className="admin-settings-cell">
              {row.is_secret && <span className="admin-settings-key-icon"><EyeOffIcon /></span>}
              <input
                className="input admin-input-mono"
                type={row.is_secret ? "password" : "text"}
                value={row.value}
                placeholder={row.is_secret ? "••••••••" : "valor"}
                onChange={(e) => updateRow(idx, { value: e.target.value })}
              />
            </div>
            <div className="admin-settings-cell admin-settings-secret-col">
              <label className="admin-secret-toggle">
                <input
                  type="checkbox"
                  checked={row.is_secret}
                  onChange={(e) => updateRow(idx, { is_secret: e.target.checked })}
                />
                <span className="admin-secret-toggle-label">
                  {row.is_secret ? "Sim" : "Não"}
                </span>
              </label>
            </div>
            <div className="admin-settings-cell admin-settings-action-col">
              <button
                className="admin-remove-btn"
                onClick={() => removeRow(idx)}
                title="Remover variável"
              >
                <TrashIcon />
              </button>
            </div>
          </div>
        ))}
      </div>

      <button className="button secondary admin-add-btn" onClick={addRow}>
        <PlusIcon />
        Adicionar variável
      </button>
    </div>
  );
}

// ── Modules section ──────────────────────────────────────────────

function ModulesSection({
  modules,
  token,
  selectedId,
  onSelect,
}: {
  modules: ModuleManifest[];
  token: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const selected = modules.find((m) => m.id === selectedId) ?? null;

  return (
    <div className="admin-modules-layout">
      <div className="admin-modules-list">
        <div className="admin-modules-list-title">Módulos registrados</div>
        {modules.map((mod) => (
          <button
            key={mod.id}
            className={`admin-module-item${selectedId === mod.id ? " active" : ""}`}
            onClick={() => onSelect(mod.id)}
          >
            <span className="admin-module-item-icon">{mod.icon ?? "⚙"}</span>
            <div className="admin-module-item-info">
              <strong>{mod.name}</strong>
              <span>{mod.id} · v{mod.version}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="admin-modules-content">
        {selected ? (
          <SettingsEditor moduleId={selected.id} moduleName={selected.name} token={token} />
        ) : (
          <div className="admin-content-loading">
            <span style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>
              Selecione um módulo para configurar.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── AdminPanel ───────────────────────────────────────────────────

type AdminSection = "modules";

export function AdminPanel({ modules, token, onClose }: Props) {
  const [section, setSection] = useState<AdminSection>("modules");
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(
    modules[0]?.id ?? null
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="admin-overlay">

      {/* ── Admin header ── */}
      <header className="admin-header">
        <div className="admin-header-left">
          <img src={logoExpanded} alt="CommandOps" className="admin-header-logo" />
          <div className="admin-header-title">
            <strong>Administração da Plataforma</strong>
            <span>Configurações globais</span>
          </div>
        </div>
        <button className="admin-close-btn" onClick={onClose}>
          <CloseIcon />
          Fechar
        </button>
      </header>

      {/* ── Admin body ── */}
      <div className="admin-body">

        {/* Left nav */}
        <nav className="admin-nav">
          <div className="admin-nav-group">
            <div className="admin-nav-group-title">Configuração</div>
            <button
              className={`admin-nav-item${section === "modules" ? " active" : ""}`}
              onClick={() => setSection("modules")}
            >
              <span className="admin-nav-item-icon"><ModulesIcon /></span>
              Módulos
            </button>
          </div>
        </nav>

        {/* Main content */}
        <main className="admin-main">
          {section === "modules" && (
            <ModulesSection
              modules={modules}
              token={token}
              selectedId={selectedModuleId}
              onSelect={setSelectedModuleId}
            />
          )}
        </main>

      </div>
    </div>
  );
}
