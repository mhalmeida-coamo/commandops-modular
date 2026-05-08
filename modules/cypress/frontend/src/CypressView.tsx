import { useState } from "react";

type Props = {
  token: string | null;
  theme: string;
  language: string;
};

type PrinterUser = {
  domain: string;
  account: string;
  permission: string;
};

type RoleMember = {
  domain: string;
  account: string;
  permission: string;
};

type Role = {
  name: string;
  description?: string;
  role_type?: string;
  members?: RoleMember[];
  admins?: RoleMember[];
};

type Printer = {
  name: string;
  style: string;
  description: string;
  host: string;
  port: string;
  direct_users: PrinterUser[];
  roles: Role[];
};

type PrinterSearchResult = {
  query: string;
  found: boolean;
  count: number;
  printers: Printer[];
};

type GroupMembersResult = {
  group: string;
  group_cn?: string;
  found: boolean;
  count: number;
  members: GroupMember[];
};

type GroupMember = {
  displayName: string;
  cn: string;
  sAMAccountName: string;
  mail: string;
  department: string;
  title: string;
  employeeID: string;
  type: "user" | "group";
  dn: string;
};

type MemberDetailState =
  | { loading: true }
  | { loading: false; found: boolean; group?: string; groupCn?: string; data?: GroupMember[]; error?: string };

async function apiFetch<T>(path: string, token: string | null, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options?.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j.detail) detail = String(j.detail);
    } catch { /* ignore */ }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export function CypressView({ token, theme, language }: Props) {
  const t = (pt: string, en: string) => (language === "pt-BR" ? pt : en);

  const [printerQuery, setPrinterQuery] = useState("");
  const [printerLoading, setPrinterLoading] = useState(false);
  const [printerResult, setPrinterResult] = useState("");
  const [printerData, setPrinterData] = useState<PrinterSearchResult | null>(null);
  const [expandedPrinters, setExpandedPrinters] = useState<Set<string>>(new Set());
  const [expandedRoles, setExpandedRoles] = useState<Set<string>>(new Set());
  const [expandedMembers, setExpandedMembers] = useState<Set<string>>(new Set());
  const [memberDetails, setMemberDetails] = useState<Record<string, MemberDetailState>>({});

  const [addGroupModalOpen, setAddGroupModalOpen] = useState(false);
  const [addGroupName, setAddGroupName] = useState("");
  const [addGroupMemberKey, setAddGroupMemberKey] = useState("");
  const [addGroupUser, setAddGroupUser] = useState("");
  const [addGroupStatus, setAddGroupStatus] = useState("");
  const [addGroupStatusType, setAddGroupStatusType] = useState<"success" | "error" | "">("");
  const [addGroupLoading, setAddGroupLoading] = useState(false);

  const handlePrinterSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!printerQuery.trim()) {
      setPrinterResult(t("Digite o nome da impressora.", "Enter the printer name."));
      return;
    }
    setPrinterLoading(true);
    setPrinterResult("");
    setPrinterData(null);
    setExpandedPrinters(new Set());
    setExpandedRoles(new Set());
    setExpandedMembers(new Set());
    setMemberDetails({});
    try {
      const data = await apiFetch<PrinterSearchResult>(
        `/api/cypress/v1/printer/search?q=${encodeURIComponent(printerQuery.trim())}`,
        token,
      );
      setPrinterData(data);
      if (!data.found) {
        setPrinterResult(t("Nenhuma impressora encontrada.", "No printers found."));
      } else {
        setPrinterResult(t(`Encontrada(s) ${data.count} impressora(s).`, `Found ${data.count} printer(s).`));
        if (data.count === 1) {
          setExpandedPrinters(new Set([data.printers[0].name]));
        }
      }
    } catch (error) {
      setPrinterResult(error instanceof Error ? error.message : t("Falha na busca.", "Search failed."));
    } finally {
      setPrinterLoading(false);
    }
  };

  const togglePrinter = (name: string) => {
    setExpandedPrinters((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const toggleRole = (key: string) => {
    setExpandedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const loadGroupMembers = async (memberKey: string, account: string) => {
    setMemberDetails((prev) => ({ ...prev, [memberKey]: { loading: true } }));
    try {
      const data = await apiFetch<GroupMembersResult>(
        `/api/cypress/v1/group/members?group=${encodeURIComponent(account)}`,
        token,
      );
      setMemberDetails((prev) => ({
        ...prev,
        [memberKey]: { loading: false, found: data.found, group: data.group, groupCn: data.group_cn, data: data.members || [] },
      }));
    } catch {
      setMemberDetails((prev) => ({
        ...prev,
        [memberKey]: { loading: false, found: false, error: t("Erro ao carregar membros", "Error loading members") },
      }));
    }
  };

  const toggleMember = async (memberKey: string, account: string) => {
    const isExpanded = expandedMembers.has(memberKey);
    setExpandedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(memberKey)) next.delete(memberKey); else next.add(memberKey);
      return next;
    });
    if (!isExpanded && !memberDetails[memberKey]) {
      await loadGroupMembers(memberKey, account);
    }
  };

  const refreshGroupDetails = async (memberKey: string, account: string) => {
    await loadGroupMembers(memberKey, account);
  };

  const openAddGroupModal = (group: string, memberKey: string) => {
    setAddGroupName(group);
    setAddGroupMemberKey(memberKey);
    setAddGroupUser("");
    setAddGroupStatus("");
    setAddGroupStatusType("");
    setAddGroupModalOpen(true);
  };

  const closeAddGroupModal = () => {
    setAddGroupModalOpen(false);
    setAddGroupName("");
    setAddGroupMemberKey("");
    setAddGroupUser("");
    setAddGroupStatus("");
    setAddGroupStatusType("");
    setAddGroupLoading(false);
  };

  const submitAddGroupUser = async () => {
    if (!addGroupUser.trim()) {
      setAddGroupStatus(t("Informe o usuário.", "Enter the user."));
      setAddGroupStatusType("error");
      return;
    }
    setAddGroupLoading(true);
    setAddGroupStatus(t("Adicionando usuário...", "Adding user..."));
    setAddGroupStatusType("");
    try {
      const data = await apiFetch<{ success: boolean; message?: string }>(
        "/api/cypress/v1/group/add-user",
        token,
        { method: "POST", body: JSON.stringify({ group: addGroupName, user: addGroupUser.trim() }) },
      );
      setAddGroupStatus(data.message || t("Usuário adicionado.", "User added."));
      setAddGroupStatusType(data.success ? "success" : "error");
      if (data.success && addGroupMemberKey) {
        void refreshGroupDetails(addGroupMemberKey, addGroupName);
      }
    } catch (error) {
      setAddGroupStatus(error instanceof Error ? error.message : t("Falha ao adicionar.", "Failed to add."));
      setAddGroupStatusType("error");
    } finally {
      setAddGroupLoading(false);
    }
  };

  return (
    <div className="module-shell" style={{ padding: "clamp(16px, 2vw, 28px)" }}>
      <div className="module-panel">
        <div className="module-hero">
          <div className="module-hero-copy">
            <div className="module-eyebrow">Printer Server</div>
            <h2 className="module-title">Cypress</h2>
            <p className="module-copy">
              {t(
                "Consulte impressoras, grupos vinculados e acessos herdados do ambiente de impressão corporativa.",
                "Search printers, linked groups and inherited access from the corporate print environment.",
              )}
            </p>
          </div>
          <div className="module-status-chip">operacional</div>
        </div>

        <div className="module-panel-body module-section">
          <div className="module-subpanel">
            <form onSubmit={handlePrinterSearch} className="module-section">
              <div className="module-form-grid wide-first">
                <label>
                  {t("Nome da impressora", "Printer name")}
                  <input
                    className="input"
                    value={printerQuery}
                    onChange={(e) => setPrinterQuery(e.target.value)}
                    disabled={printerLoading}
                    placeholder="Ex: LS302"
                  />
                </label>
              </div>
              <div className="module-toolbar">
                <button className="button" disabled={printerLoading}>
                  {printerLoading ? t("Buscando...", "Searching...") : t("Buscar", "Search")}
                </button>
              </div>
            </form>
            {printerResult && <p style={{ marginTop: 12 }}>{printerResult}</p>}
          </div>

          {printerData && printerData.found && (
            <div className="module-accordion">
              {printerData.printers.map((printer) => (
                <div key={printer.name} className="module-accordion-item">
                  <button
                    type="button"
                    className="module-accordion-toggle"
                    onClick={() => togglePrinter(printer.name)}
                  >
                    <span className="module-accordion-caret">
                      {expandedPrinters.has(printer.name) ? "▼" : "▶"}
                    </span>
                    <span className="module-accordion-icon">🖨</span>
                    <span className="module-accordion-copy">
                      <span className="module-accordion-title">{printer.name}</span>
                      <span className="module-accordion-meta">
                        {printer.style} — {printer.description}
                      </span>
                    </span>
                  </button>

                  {expandedPrinters.has(printer.name) && (
                    <div className="module-accordion-content">
                      <div className="module-metadata-row">
                        <span><strong>{t("Host", "Host")}:</strong> {printer.host}</span>
                        <span><strong>{t("Porta", "Port")}:</strong> {printer.port}</span>
                      </div>

                      {printer.direct_users.length > 0 && (
                        <div className="module-subpanel" style={{ marginBottom: 16 }}>
                          <h4 style={{ marginBottom: 12, color: "var(--success)" }}>
                            {t("Grupos do AD com acesso direto", "AD groups with direct access")} ({printer.direct_users.length})
                          </h4>
                          <div className="module-accordion">
                            {printer.direct_users.map((user, idx) => {
                              const memberKey = `direct-${printer.name}-${idx}`;
                              const isExpanded = expandedMembers.has(memberKey);
                              const details = memberDetails[memberKey];
                              return (
                                <div key={memberKey} className="module-accordion-item">
                                  <button
                                    type="button"
                                    className="module-accordion-toggle"
                                    onClick={() => toggleMember(memberKey, user.account)}
                                  >
                                    <span className="module-accordion-caret">{isExpanded ? "▼" : "▶"}</span>
                                    <span className="module-accordion-icon">👥</span>
                                    <span className="module-accordion-copy">
                                      <span className="module-accordion-title">
                                        {user.domain}\{user.account}
                                      </span>
                                    </span>
                                  </button>

                                  {isExpanded && (
                                    <div className="module-accordion-content">
                                      <MemberDetailPanel
                                        details={details}
                                        accountName={(details && !details.loading && details.groupCn) ? details.groupCn : user.account}
                                        onAddUser={() => openAddGroupModal(user.account, memberKey)}
                                        t={t}
                                      />
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {printer.roles.length > 0 && (
                        <div className="module-subpanel">
                          <h4 style={{ marginBottom: 12, color: "var(--info)" }}>
                            Roles ({printer.roles.length})
                          </h4>
                          <div className="module-accordion">
                            {printer.roles.map((role, idx) => {
                              const roleKey = `role-${printer.name}-${idx}`;
                              const isRoleExpanded = expandedRoles.has(roleKey);
                              return (
                                <div key={roleKey} className="module-accordion-item">
                                  <button
                                    type="button"
                                    className="module-accordion-toggle"
                                    onClick={() => toggleRole(roleKey)}
                                  >
                                    <span className="module-accordion-caret">{isRoleExpanded ? "▼" : "▶"}</span>
                                    <span className="module-accordion-icon">🔐</span>
                                    <span className="module-accordion-copy">
                                      <span className="module-accordion-title">
                                        {role.name}
                                        {role.role_type && (
                                          <span className="module-inline-badge">{role.role_type}</span>
                                        )}
                                        {role.members && role.members.length > 0 && (
                                          <span style={{ color: "var(--muted)", fontSize: "0.85em" }}>
                                            ({role.members.length} member{role.members.length > 1 ? "s" : ""})
                                          </span>
                                        )}
                                      </span>
                                    </span>
                                  </button>

                                  {isRoleExpanded && (
                                    <div className="module-accordion-content">
                                      {role.members && role.members.length > 0 ? (
                                        <div className="module-accordion">
                                          {role.members.map((member, mIdx) => {
                                            const memberKey = `member-${printer.name}-${idx}-${mIdx}`;
                                            const isExpanded = expandedMembers.has(memberKey);
                                            const details = memberDetails[memberKey];
                                            return (
                                              <div key={memberKey} className="module-accordion-item">
                                                <button
                                                  type="button"
                                                  className="module-accordion-toggle"
                                                  onClick={() => toggleMember(memberKey, member.account)}
                                                >
                                                  <span className="module-accordion-caret">{isExpanded ? "▼" : "▶"}</span>
                                                  <span className="module-accordion-icon">👤</span>
                                                  <span className="module-accordion-copy">
                                                    <span className="module-accordion-title">
                                                      {member.domain}\{member.account}
                                                    </span>
                                                  </span>
                                                </button>

                                                {isExpanded && (
                                                  <div className="module-accordion-content">
                                                    <MemberDetailPanel
                                                      details={details}
                                                      accountName={(details && !details.loading && details.groupCn) ? details.groupCn : member.account}
                                                      onAddUser={() => openAddGroupModal(member.account, memberKey)}
                                                      t={t}
                                                    />
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      ) : (
                                        <span style={{ color: "var(--muted)", fontSize: "0.9em" }}>
                                          {t("Nenhum membro definido", "No members defined")}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {addGroupModalOpen && (
        <div
          onClick={closeAddGroupModal}
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--panel)",
              border: "1px solid var(--panel-border-strong)",
              borderRadius: 20,
              width: "100%",
              maxWidth: 440,
              padding: 24,
              display: "flex",
              flexDirection: "column",
              gap: 16,
              boxShadow: "var(--surface-shadow-strong)",
            }}
          >
            <h3 style={{ margin: 0, fontSize: 17 }}>
              {t("Adicionar usuário ao grupo", "Add user to group")}: {addGroupName}
            </h3>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
              {t("Usuário (login)", "User (login)")}
              <input
                className="input"
                value={addGroupUser}
                onChange={(e) => setAddGroupUser(e.target.value)}
                placeholder={t("Ex: joao.silva", "e.g. john.doe")}
                disabled={addGroupLoading}
                onKeyDown={(e) => { if (e.key === "Enter") void submitAddGroupUser(); }}
              />
            </label>
            {addGroupStatus && (
              <p className={`alert${addGroupStatusType === "success" ? " success" : ""}`} style={{ margin: 0 }}>
                {addGroupStatus}
              </p>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="button secondary" onClick={closeAddGroupModal} disabled={addGroupLoading}>
                {t("Cancelar", "Cancel")}
              </button>
              <button className="button" onClick={() => void submitAddGroupUser()} disabled={addGroupLoading}>
                {addGroupLoading ? t("Adicionando...", "Adding...") : t("Adicionar", "Add")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MemberDetailPanel({
  details,
  accountName,
  onAddUser,
  t,
}: {
  details: MemberDetailState | undefined;
  accountName: string;
  onAddUser: () => void;
  t: (pt: string, en: string) => string;
}) {
  if (!details) return null;
  if (details.loading) return <span>{t("Carregando membros...", "Loading members...")}</span>;
  if ("error" in details && details.error) return <span style={{ color: "var(--danger)" }}>{details.error}</span>;
  return (
    <>
      {details.found && (
        <div className="module-toolbar" style={{ marginBottom: 8 }}>
          <span style={{ color: "var(--muted)", fontSize: 12 }}>
            {t("Grupo", "Group")}: {accountName}
          </span>
          <button className="button secondary" type="button" onClick={onAddUser}>
            + {t("Adicionar usuário", "Add user")}
          </button>
        </div>
      )}
      {details.data && details.data.length === 0 && (
        <span style={{ color: "var(--muted)" }}>{t("Nenhum membro encontrado", "No members found")}</span>
      )}
      {details.data && details.data.length > 0 && (
        <div className="module-table-shell">
          <table className="table" style={{ fontSize: "0.85em" }}>
            <thead>
              <tr>
                <th>{t("Nome", "Name")}</th>
                <th>Login</th>
                <th>{t("Matrícula", "Employee ID")}</th>
                <th>{t("Depto", "Dept")}</th>
                <th>{t("Cargo", "Title")}</th>
                <th>Email</th>
              </tr>
            </thead>
            <tbody>
              {details.data.map((m, i) => (
                <tr key={i}>
                  <td>{m.displayName || m.cn}</td>
                  <td>{m.sAMAccountName}</td>
                  <td>{m.employeeID}</td>
                  <td>{m.department}</td>
                  <td>{m.title}</td>
                  <td>{m.mail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
