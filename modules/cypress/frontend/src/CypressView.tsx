import { useState } from "react";
import styles from "./CypressView.module.css";

type ModuleProps = {
  token: string;
  user: { username: string; role: string; is_platform_admin: boolean };
  apiBase: string;
  theme: "light" | "dark";
  language: "pt-BR" | "en-US";
};

type DirectUser = { domain: string; account: string; permission: string };
type RoleMember = { domain: string; account: string; permission: string };
type Role = {
  name: string;
  docuvault: string;
  permission: string;
  description: string;
  role_type: string;
  members: RoleMember[];
  admins: RoleMember[];
};
type Printer = {
  name: string;
  style: string;
  description: string;
  host: string;
  port: string;
  direct_users: DirectUser[];
  roles: Role[];
};
type PrinterResult = { query: string; found: boolean; count: number; printers: Printer[] };

type LdapMember = {
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
type GroupDetail = { loading: boolean; error: string; found?: boolean; groupCn?: string; data?: LdapMember[] };

export default function CypressView({ token, apiBase, language, theme }: ModuleProps) {
  const t = (pt: string, en: string) => (language === "pt-BR" ? pt : en);
  const themeClass = theme === "dark" ? styles.themeDark : styles.themeLight;
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PrinterResult | null>(null);
  const [resultMsg, setResultMsg] = useState("");

  const [expandedPrinters, setExpandedPrinters] = useState<Set<string>>(new Set());
  const [expandedRoles, setExpandedRoles] = useState<Set<string>>(new Set());
  const [expandedMembers, setExpandedMembers] = useState<Set<string>>(new Set());
  const [groupDetails, setGroupDetails] = useState<Record<string, GroupDetail>>({});

  const [addModal, setAddModal] = useState<{ group: string; key: string } | null>(null);
  const [addUser, setAddUser] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addMsg, setAddMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) { setResultMsg(t("Digite o nome da impressora.", "Enter a printer name.")); return; }
    setLoading(true);
    setResultMsg("");
    setResult(null);
    setExpandedPrinters(new Set());
    setExpandedRoles(new Set());
    setExpandedMembers(new Set());
    setGroupDetails({});
    try {
      const res = await fetch(`${apiBase}/api/cypress/printer/search?q=${encodeURIComponent(query.trim())}`, { headers: auth });
      if (!res.ok) { const e = (await res.json()) as { detail?: string }; throw new Error(e.detail ?? `HTTP ${res.status}`); }
      const data = (await res.json()) as PrinterResult;
      setResult(data);
      if (!data.found) setResultMsg(t("Nenhuma impressora encontrada.", "No printers found."));
      else {
        setResultMsg(t(`${data.count} impressora(s) encontrada(s).`, `${data.count} printer(s) found.`));
        if (data.printers.length === 1) setExpandedPrinters(new Set([data.printers[0].name]));
      }
    } catch (err) {
      setResultMsg(err instanceof Error ? err.message : t("Erro na busca.", "Search error."));
    } finally {
      setLoading(false);
    }
  }

  function togglePrinter(name: string) {
    setExpandedPrinters(prev => { const s = new Set(prev); s.has(name) ? s.delete(name) : s.add(name); return s; });
  }

  function toggleRole(key: string) {
    setExpandedRoles(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s; });
  }

  async function toggleMember(key: string, groupName: string) {
    if (expandedMembers.has(key)) {
      setExpandedMembers(prev => { const s = new Set(prev); s.delete(key); return s; });
      return;
    }
    setExpandedMembers(prev => new Set([...prev, key]));
    if (groupDetails[key]?.data || groupDetails[key]?.loading) return;
    setGroupDetails(prev => ({ ...prev, [key]: { loading: true, error: "" } }));
    try {
      const res = await fetch(`${apiBase}/api/cypress/group/members?group=${encodeURIComponent(groupName)}`, { headers: auth });
      if (!res.ok) { const e = (await res.json()) as { detail?: string }; throw new Error(e.detail ?? `HTTP ${res.status}`); }
      const data = (await res.json()) as { found: boolean; group_cn?: string; members: LdapMember[] };
      setGroupDetails(prev => ({ ...prev, [key]: { loading: false, error: "", found: data.found, groupCn: data.group_cn, data: data.members } }));
    } catch (err) {
      setGroupDetails(prev => ({ ...prev, [key]: { loading: false, error: err instanceof Error ? err.message : "Erro" } }));
    }
  }

  function openAddModal(group: string, key: string) {
    setAddModal({ group, key });
    setAddUser("");
    setAddMsg(null);
  }

  function closeAddModal() { setAddModal(null); setAddUser(""); setAddMsg(null); }

  async function handleAddUser() {
    if (!addModal || !addUser.trim() || addLoading) return;
    setAddLoading(true);
    setAddMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/cypress/group/add-user`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ group: addModal.group, user: addUser.trim() }),
      });
      const data = (await res.json()) as { success?: boolean; message?: string; detail?: string };
      if (!res.ok) { setAddMsg({ ok: false, text: data.detail ?? "Erro ao adicionar" }); return; }
      setAddMsg({ ok: true, text: data.message ?? "Operação concluída" });
      if (data.success) {
        setGroupDetails(prev => ({ ...prev, [addModal.key]: { loading: false, error: "", data: undefined } }));
      }
    } catch (err) {
      setAddMsg({ ok: false, text: err instanceof Error ? err.message : "Erro desconhecido" });
    } finally {
      setAddLoading(false);
    }
  }

  function MemberGroupAccordion({ groupName, memberKey }: { groupName: string; memberKey: string }) {
    const isOpen = expandedMembers.has(memberKey);
    const details = groupDetails[memberKey];
    return (
      <div className={styles.accordionItem}>
        <button type="button" className={styles.accordionToggle} onClick={() => void toggleMember(memberKey, groupName)}>
          <span className={`${styles.caret}${isOpen ? ` ${styles.caretOpen}` : ""}`}>▶</span>
          <span className={styles.accordionIcon}>👥</span>
          <span className={styles.accordionCopy}>
            <span className={styles.accordionTitle}>{groupName}</span>
          </span>
        </button>
        {isOpen && (
          <div className={styles.accordionContent}>
            {details?.loading && <div className={styles.loadingRow}><span className={styles.spinner} />{t("Carregando membros…", "Loading members…")}</div>}
            {details?.error && <div className={styles.logError}>{details.error}</div>}
            {details && !details.loading && !details.error && (
              <>
                <div className={styles.memberToolbar}>
                  {details.groupCn && <span className={styles.muted}>{t("Grupo:", "Group:")} {details.groupCn}</span>}
                  <button className={`button secondary ${styles.addUserBtn}`} type="button" onClick={() => openAddModal(groupName, memberKey)}>
                    + {t("Adicionar usuário", "Add user")}
                  </button>
                </div>
                {(!details.data || details.data.length === 0) && (
                  <span className={styles.muted}>{t("Nenhum membro encontrado.", "No members found.")}</span>
                )}
                {details.data && details.data.length > 0 && (
                  <div className={styles.tableShell}>
                    <table className={styles.table}>
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
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`${styles.card} ${themeClass}`}>
      <div className={styles.headline}>
        <div>
          <div className={styles.eyebrow}>Printer Server</div>
          <h2 className={styles.title}>Cypress</h2>
          <span className={styles.subtitle}>
            {t("Busque impressoras, visualize grupos de acesso e gerencie membros via AD.", "Search printers, view access groups and manage members via AD.")}
          </span>
        </div>
      </div>

      {/* Search form */}
      <form className={styles.searchRow} onSubmit={(e) => void handleSearch(e)}>
        <input
          className={styles.searchInput}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t("Nome da impressora…", "Printer name…")}
          disabled={loading}
          autoFocus
        />
        <button className={styles.searchBtn} type="submit" disabled={loading}>
          {loading ? <span className={styles.spinner} /> : t("Buscar", "Search")}
        </button>
      </form>

      {resultMsg && (
        <p className={result?.found ? styles.resultMsg : styles.muted}>{resultMsg}</p>
      )}

      {/* Printer accordion */}
      {result?.found && (
        <div className={styles.accordion}>
          {result.printers.map(printer => {
            const isOpen = expandedPrinters.has(printer.name);
            return (
              <div key={printer.name} className={styles.accordionItem}>
                <button type="button" className={styles.accordionToggle} onClick={() => togglePrinter(printer.name)}>
                  <span className={`${styles.caret}${isOpen ? ` ${styles.caretOpen}` : ""}`}>▶</span>
                  <span className={styles.accordionIcon}>🖨</span>
                  <span className={styles.accordionCopy}>
                    <span className={styles.accordionTitle}>{printer.name}</span>
                    <span className={styles.accordionMeta}>{[printer.style, printer.description].filter(Boolean).join(" — ")}</span>
                  </span>
                </button>

                {isOpen && (
                  <div className={styles.accordionContent}>
                    <div className={styles.metaRow}>
                      {printer.host && <span><strong>Host:</strong> {printer.host}</span>}
                      {printer.port && <span><strong>Porta:</strong> {printer.port}</span>}
                    </div>

                    {/* Direct users */}
                    {printer.direct_users.length > 0 && (
                      <div className={styles.subpanel}>
                        <h4 className={styles.subpanelTitle} style={{ color: "var(--success, #16a34a)" }}>
                          {t(`Grupos com acesso direto (${printer.direct_users.length})`, `Direct access groups (${printer.direct_users.length})`)}
                        </h4>
                        <div className={styles.accordion}>
                          {printer.direct_users.map((u, idx) => (
                            <MemberGroupAccordion
                              key={idx}
                              groupName={u.account}
                              memberKey={`direct-${printer.name}-${idx}`}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Roles */}
                    {printer.roles.length > 0 && (
                      <div className={styles.subpanel}>
                        <h4 className={styles.subpanelTitle} style={{ color: "var(--info, #2563eb)" }}>
                          {t(`Roles (${printer.roles.length})`, `Roles (${printer.roles.length})`)}
                        </h4>
                        <div className={styles.accordion}>
                          {printer.roles.map((role, rIdx) => {
                            const roleKey = `role-${printer.name}-${rIdx}`;
                            const isRoleOpen = expandedRoles.has(roleKey);
                            return (
                              <div key={roleKey} className={styles.accordionItem}>
                                <button type="button" className={styles.accordionToggle} onClick={() => toggleRole(roleKey)}>
                                  <span className={`${styles.caret}${isRoleOpen ? ` ${styles.caretOpen}` : ""}`}>▶</span>
                                  <span className={styles.accordionIcon}>🔐</span>
                                  <span className={styles.accordionCopy}>
                                    <span className={styles.accordionTitle}>
                                      {role.name}
                                      {role.role_type && <span className={styles.inlineBadge}>{role.role_type}</span>}
                                      {role.members.length > 0 && (
                                        <span className={styles.memberCount}>({role.members.length} member{role.members.length !== 1 ? "s" : ""})</span>
                                      )}
                                    </span>
                                  </span>
                                </button>

                                {isRoleOpen && (
                                  <div className={styles.accordionContent}>
                                    {role.members.length === 0 ? (
                                      <span className={styles.muted}>{t("Nenhum membro neste role.", "No members in this role.")}</span>
                                    ) : (
                                      <div className={styles.accordion}>
                                        {role.members.map((member, mIdx) => (
                                          <MemberGroupAccordion
                                            key={mIdx}
                                            groupName={member.account}
                                            memberKey={`member-${printer.name}-${rIdx}-${mIdx}`}
                                          />
                                        ))}
                                      </div>
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
            );
          })}
        </div>
      )}

      {/* Add user modal */}
      {addModal && (
        <div className={styles.modalOverlay} onClick={e => { if (e.target === e.currentTarget) closeAddModal(); }}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>{t("Adicionar usuário ao grupo", "Add user to group")}</h3>
            <p className={styles.modalSubtitle}>{addModal.group}</p>
            <div className={styles.modalField}>
              <label className={styles.modalLabel}>{t("Login, e-mail ou UPN", "Login, email or UPN")}</label>
              <input
                className={styles.modalInput}
                value={addUser}
                onChange={e => setAddUser(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") void handleAddUser(); }}
                placeholder={t("Ex.: mhalmeida", "Ex.: jdoe")}
                autoFocus
                disabled={addLoading}
              />
            </div>
            {addMsg && <div className={addMsg.ok ? styles.logOk : styles.logError}>{addMsg.text}</div>}
            <div className={styles.modalActions}>
              <button className={`button secondary`} onClick={closeAddModal} disabled={addLoading}>{t("Cancelar", "Cancel")}</button>
              <button className={`button`} onClick={() => void handleAddUser()} disabled={addLoading || !addUser.trim()}>
                {addLoading ? <span className={styles.spinner} /> : t("Adicionar", "Add")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
