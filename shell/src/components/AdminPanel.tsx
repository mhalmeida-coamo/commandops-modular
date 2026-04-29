import { useEffect, useState } from "react";
import type { ModuleManifest, ModuleSetting } from "../types";

type Props = {
  modules: ModuleManifest[];
  token: string;
};

type SettingRow = ModuleSetting & { dirty?: boolean };

function SettingsEditor({ moduleId, token }: { moduleId: string; token: string }) {
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
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
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
      <div className="module-loading" style={{ minHeight: 80 }}>
        <span className="spinner" />
        <span>Carregando configurações…</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {error && <div className="alert">{error}</div>}
      {success && (
        <div
          className="alert"
          style={{
            background: "rgba(34,197,94,0.1)",
            borderColor: "rgba(34,197,94,0.3)",
            color: "var(--success)",
          }}
        >
          Configurações salvas com sucesso.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 80px 36px",
            gap: 8,
            fontSize: "var(--text-xs)",
            color: "var(--muted)",
            padding: "0 4px",
          }}
        >
          <span>Chave</span>
          <span>Valor</span>
          <span style={{ textAlign: "center" }}>Segredo</span>
          <span />
        </div>

        {rows.map((row, idx) => (
          <div
            key={idx}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 80px 36px",
              gap: 8,
              alignItems: "center",
            }}
          >
            <input
              className="input"
              value={row.key}
              placeholder="CHAVE"
              style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}
              onChange={(e) => updateRow(idx, { key: e.target.value })}
            />
            <input
              className="input"
              type={row.is_secret ? "password" : "text"}
              value={row.value}
              placeholder={row.is_secret ? "••••••••" : "valor"}
              style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}
              onChange={(e) => updateRow(idx, { value: e.target.value })}
            />
            <div style={{ display: "flex", justifyContent: "center" }}>
              <input
                type="checkbox"
                checked={row.is_secret}
                onChange={(e) => updateRow(idx, { is_secret: e.target.checked })}
                style={{ width: 16, height: 16, cursor: "pointer" }}
              />
            </div>
            <button
              className="button danger"
              style={{ padding: "6px", width: 32, height: 32, justifyContent: "center" }}
              onClick={() => removeRow(idx)}
              title="Remover"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button className="button secondary" onClick={addRow}>
          + Adicionar
        </button>
        <button className="button" onClick={save} disabled={saving}>
          {saving ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </div>
  );
}

export function AdminPanel({ modules, token }: Props) {
  const [openModuleId, setOpenModuleId] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h2 style={{ fontSize: "var(--text-xl)", fontWeight: 700, marginBottom: 4 }}>
          Administração
        </h2>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>
          Configurações de módulos da plataforma.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {modules.map((mod) => (
          <div
            key={mod.id}
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--panel-border)",
              borderRadius: "var(--radius-lg)",
              overflow: "hidden",
            }}
          >
            <button
              onClick={() => setOpenModuleId(openModuleId === mod.id ? null : mod.id)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "16px 20px",
                background: "none",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ fontSize: 20 }}>{mod.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: "var(--text)", fontSize: "var(--text-sm)" }}>
                  {mod.name}
                </div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginTop: 2 }}>
                  {mod.id} · v{mod.version}
                </div>
              </div>
              <span
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--muted)",
                  transform: openModuleId === mod.id ? "rotate(180deg)" : "none",
                  transition: "transform 0.2s",
                  display: "inline-block",
                }}
              >
                ▼
              </span>
            </button>

            {openModuleId === mod.id && (
              <div
                style={{
                  padding: "0 20px 20px",
                  borderTop: "1px solid var(--panel-border)",
                  paddingTop: 16,
                }}
              >
                <SettingsEditor moduleId={mod.id} token={token} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
