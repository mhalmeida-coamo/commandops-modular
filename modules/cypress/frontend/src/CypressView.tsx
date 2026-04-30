import { useState, useCallback } from "react";
import styles from "./CypressView.module.css";

type ModuleProps = {
  token: string;
  user: { username: string; role: string; is_platform_admin: boolean };
  apiBase: string;
  theme: "light" | "dark";
  language: "pt-BR" | "en-US";
};

type Printer = {
  id: string;
  name: string;
  queue: string;
  location: string;
  description: string;
};

type Group = {
  id: string;
  name: string;
  group_dn: string;
};

type Member = {
  dn: string;
  sAMAccountName: string;
  displayName: string;
  mail: string;
};

type AddUserResult = {
  status: "added" | "already_member" | "not_found" | "failed";
  user_dn: string | null;
  message: string;
};

type MembersState = {
  loading: boolean;
  error: string;
  data: Member[] | null;
};

type AddModal = {
  groupDn: string;
  groupName: string;
};

export default function CypressView({ token, apiBase, language, theme }: ModuleProps) {
  const t = (pt: string, en: string) => (language === "pt-BR" ? pt : en);

  const [search, setSearch] = useState("");
  const [printers, setPrinters] = useState<Printer[] | null>(null);
  const [printersLoading, setPrintersLoading] = useState(false);
  const [printersError, setPrintersError] = useState("");

  const [expandedPrinterId, setExpandedPrinterId] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState("");

  const [expandedGroupDn, setExpandedGroupDn] = useState<string | null>(null);
  const [membersMap, setMembersMap] = useState<Record<string, MembersState>>({});

  const [addModal, setAddModal] = useState<AddModal | null>(null);
  const [addUsername, setAddUsername] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addResult, setAddResult] = useState<AddUserResult | null>(null);

  const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  async function fetchPrinters() {
    setPrintersLoading(true);
    setPrintersError("");
    setPrinters(null);
    setExpandedPrinterId(null);
    setGroups(null);
    setExpandedGroupDn(null);
    setMembersMap({});
    try {
      const res = await fetch(
        `${apiBase}/api/cypress/printers?search=${encodeURIComponent(search.trim())}`,
        { headers: authHeaders }
      );
      if (!res.ok) {
        const err = (await res.json()) as { detail?: string };
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as Printer[];
      setPrinters(data);
    } catch (err) {
      setPrintersError(err instanceof Error ? err.message : t("Erro ao buscar impressoras", "Error fetching printers"));
    } finally {
      setPrintersLoading(false);
    }
  }

  const fetchGroups = useCallback(async () => {
    setGroupsLoading(true);
    setGroupsError("");
    setGroups(null);
    setExpandedGroupDn(null);
    try {
      const res = await fetch(`${apiBase}/api/cypress/groups`, { headers: authHeaders });
      if (!res.ok) {
        const err = (await res.json()) as { detail?: string };
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as Group[];
      setGroups(data);
    } catch (err) {
      setGroupsError(err instanceof Error ? err.message : t("Erro ao buscar grupos", "Error fetching groups"));
    } finally {
      setGroupsLoading(false);
    }
  }, [apiBase, token]);

  async function handlePrinterClick(printer: Printer) {
    if (expandedPrinterId === printer.id) {
      setExpandedPrinterId(null);
      setGroups(null);
      setExpandedGroupDn(null);
      return;
    }
    setExpandedPrinterId(printer.id);
    setExpandedGroupDn(null);
    await fetchGroups();
  }

  async function handleGroupClick(group: Group) {
    const dn = group.group_dn;
    if (expandedGroupDn === dn) {
      setExpandedGroupDn(null);
      return;
    }
    setExpandedGroupDn(dn);

    if (membersMap[dn]?.data || membersMap[dn]?.loading) return;

    setMembersMap((prev) => ({ ...prev, [dn]: { loading: true, error: "", data: null } }));
    try {
      const res = await fetch(
        `${apiBase}/api/cypress/groups/${encodeURIComponent(dn)}/members`,
        { headers: authHeaders }
      );
      if (!res.ok) {
        const err = (await res.json()) as { detail?: string };
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { members: Member[] };
      setMembersMap((prev) => ({ ...prev, [dn]: { loading: false, error: "", data: data.members } }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro";
      setMembersMap((prev) => ({ ...prev, [dn]: { loading: false, error: msg, data: null } }));
    }
  }

  function openAddModal(group: Group) {
    setAddModal({ groupDn: group.group_dn, groupName: group.name });
    setAddUsername("");
    setAddResult(null);
  }

  function closeAddModal() {
    setAddModal(null);
    setAddUsername("");
    setAddResult(null);
  }

  async function handleAddUser() {
    if (!addModal || !addUsername.trim() || addLoading) return;
    setAddLoading(true);
    setAddResult(null);
    try {
      const res = await fetch(`${apiBase}/api/cypress/groups/add-user`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ group_dn: addModal.groupDn, username: addUsername.trim() }),
      });
      const data = (await res.json()) as AddUserResult;
      setAddResult(data);
      if (data.status === "added") {
        setMembersMap((prev) => ({ ...prev, [addModal.groupDn]: { loading: false, error: "", data: null } }));
      }
    } catch (err) {
      setAddResult({
        status: "failed",
        user_dn: null,
        message: err instanceof Error ? err.message : "Erro desconhecido",
      });
    } finally {
      setAddLoading(false);
    }
  }

  const themeClass = theme === "dark" ? styles.themeDark : styles.themeLight;

  return (
    <div className={`${styles.card} ${themeClass}`}>
      <div className={styles.headline}>
        <div>
          <h2 className={styles.title}>Cypress</h2>
          <span className={styles.subtitle}>
            {t(
              "Pesquise impressoras, visualize grupos de acesso e adicione usuários via AD.",
              "Search printers, view access groups and add users via AD."
            )}
          </span>
        </div>
      </div>

      {/* Search */}
      <div className={styles.searchRow}>
        <input
          className={styles.searchInput}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void fetchPrinters(); }}
          placeholder={t("Nome, fila ou localização…", "Name, queue or location…")}
          disabled={printersLoading}
        />
        <button
          className={styles.searchBtn}
          onClick={() => void fetchPrinters()}
          disabled={printersLoading}
        >
          {printersLoading ? <span className={styles.spinner} /> : t("Buscar", "Search")}
        </button>
      </div>

      {printersError && <div className={styles.logError}>{printersError}</div>}

      {/* Printer list */}
      {printers !== null && (
        printers.length === 0 ? (
          <div className={styles.emptyState}>
            {t("Nenhuma impressora encontrada.", "No printers found.")}
          </div>
        ) : (
          <div className={styles.printerList}>
            {printers.map((printer) => {
              const isOpen = expandedPrinterId === printer.id;
              return (
                <div key={printer.id}>
                  <div
                    className={`${styles.printerRow}${isOpen ? ` ${styles.active}` : ""}`}
                    onClick={() => void handlePrinterClick(printer)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") void handlePrinterClick(printer); }}
                  >
                    <div className={styles.printerInfo}>
                      <span className={styles.printerName}>{printer.name || printer.queue}</span>
                      <span className={styles.printerMeta}>
                        {[printer.queue, printer.location].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                    <svg className={`${styles.chevron}${isOpen ? ` ${styles.chevronOpen}` : ""}`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m7 5 5 5-5 5" />
                    </svg>
                  </div>

                  {isOpen && (
                    <div className={styles.groupsPanel}>
                      {groupsLoading && (
                        <div className={styles.loadingRow}>
                          <span className={styles.spinner} />
                          {t("Carregando grupos…", "Loading groups…")}
                        </div>
                      )}
                      {groupsError && <div className={styles.logError}>{groupsError}</div>}
                      {groups !== null && groups.length === 0 && (
                        <div className={styles.emptyState}>
                          {t("Nenhum grupo encontrado.", "No groups found.")}
                        </div>
                      )}
                      {groups?.map((group) => {
                        const groupOpen = expandedGroupDn === group.group_dn;
                        const ms = membersMap[group.group_dn];
                        return (
                          <div key={group.group_dn}>
                            <div
                              className={styles.groupRow}
                              onClick={() => void handleGroupClick(group)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") void handleGroupClick(group); }}
                            >
                              <div>
                                <div className={styles.groupName}>{group.name}</div>
                                <div className={styles.groupDn}>{group.group_dn}</div>
                              </div>
                              <svg className={`${styles.chevron}${groupOpen ? ` ${styles.chevronOpen}` : ""}`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="m7 5 5 5-5 5" />
                              </svg>
                            </div>

                            {groupOpen && (
                              <div className={styles.membersPanel}>
                                {ms?.loading && (
                                  <div className={styles.loadingRow}>
                                    <span className={styles.spinner} />
                                    {t("Carregando membros…", "Loading members…")}
                                  </div>
                                )}
                                {ms?.error && <div className={styles.logError}>{ms.error}</div>}
                                {ms?.data && ms.data.length === 0 && (
                                  <div className={styles.emptyState}>
                                    {t("Grupo sem membros.", "Group has no members.")}
                                  </div>
                                )}
                                {ms?.data?.map((m) => (
                                  <div key={m.dn} className={styles.memberRow}>
                                    <span className={styles.memberName}>
                                      {m.displayName || m.sAMAccountName || m.dn}
                                    </span>
                                    {m.sAMAccountName && (
                                      <span className={styles.memberLogin}>{m.sAMAccountName}</span>
                                    )}
                                  </div>
                                ))}
                                <button
                                  className={styles.addBtn}
                                  onClick={() => openAddModal(group)}
                                  disabled={ms?.loading}
                                >
                                  {t("+ Adicionar usuário", "+ Add user")}
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Add user modal */}
      {addModal && (
        <div className={styles.modalOverlay} onClick={(e) => { if (e.target === e.currentTarget) closeAddModal(); }}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>{t("Adicionar usuário ao grupo", "Add user to group")}</h3>
            <p className={styles.modalSubtitle}>{addModal.groupName}</p>

            <div className={styles.modalField}>
              <label className={styles.modalLabel}>
                {t("Login, e-mail ou UPN", "Login, email or UPN")}
              </label>
              <input
                className={styles.modalInput}
                value={addUsername}
                onChange={(e) => setAddUsername(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleAddUser(); }}
                placeholder={t("Ex.: mhalmeida ou mhalmeida@coamo.com.br", "Ex.: jdoe or jdoe@domain.com")}
                autoFocus
                disabled={addLoading}
              />
            </div>

            {addResult && (
              <div className={
                addResult.status === "added" ? styles.logOk :
                addResult.status === "already_member" ? styles.logWarn :
                styles.logError
              }>
                {addResult.message}
              </div>
            )}

            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={closeAddModal} disabled={addLoading}>
                {t("Cancelar", "Cancel")}
              </button>
              <button
                className={styles.btnPrimary}
                onClick={() => void handleAddUser()}
                disabled={addLoading || !addUsername.trim()}
              >
                {addLoading ? <span className={styles.spinner} /> : t("Adicionar", "Add")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
