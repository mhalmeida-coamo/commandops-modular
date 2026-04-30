import { useState } from "react";
import styles from "./VpnView.module.css";

type ModuleProps = {
  token: string;
  user: { username: string; role: string; is_platform_admin: boolean };
  apiBase: string;
  theme: "light" | "dark";
  language: "pt-BR" | "en-US";
};

type GroupAction = "removed" | "added" | "already_absent" | "already_present" | "not_found" | "failed";

type VpnResult = {
  login: string;
  previous_vpn_value: "TRUE" | "NOT_SET";
  vpn_value: "TRUE" | "NOT_SET";
  bloqueio_ext_action: GroupAction;
  internet_mail_action: GroupAction;
  internet_mail_group: string;
  warnings?: string[];
};

type VpnResponse = {
  status: string;
  result: VpnResult;
};

const GROUP_ACTION_LABEL: Record<GroupAction, string> = {
  removed: "Removido",
  added: "Adicionado",
  already_absent: "Já ausente",
  already_present: "Já presente",
  not_found: "Não encontrado",
  failed: "Falha",
};

export default function VpnView({ token, apiBase, language, theme }: ModuleProps) {
  const t = (pt: string, en: string) => (language === "pt-BR" ? pt : en);

  const [username, setUsername] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<VpnResult | null>(null);
  const [appliedEnabled, setAppliedEnabled] = useState(true);
  const [validatingStatus, setValidatingStatus] = useState(false);

  function alreadyInState(r: VpnResult): boolean {
    if (appliedEnabled) return r.previous_vpn_value === "TRUE";
    return r.previous_vpn_value === "NOT_SET";
  }

  async function applyPolicy(requestedEnabled: boolean) {
    if (!username.trim() || loading) {
      if (!username.trim()) {
        setError(t("Informe o usuário AD antes de alternar o switch.", "Provide the AD user before toggling the switch."));
      }
      return;
    }
    setError("");
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/vpn/process`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ username: username.trim(), enabled: requestedEnabled }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { detail?: string };
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as VpnResponse;
      const isActiveNow = data.result.vpn_value === "TRUE";
      setEnabled(isActiveNow);
      setAppliedEnabled(requestedEnabled);
      setResult(data.result);
      setUsername("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }

  async function validateCurrentStatus() {
    const user = username.trim();
    if (!user || user.length < 3 || loading) return;
    setValidatingStatus(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/api/vpn/status?username=${encodeURIComponent(user)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = (await res.json()) as { detail?: string };
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { vpn_value: "TRUE" | "NOT_SET" };
      const isActive = data.vpn_value === "TRUE";
      setEnabled(isActive);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao validar status");
    } finally {
      setValidatingStatus(false);
    }
  }

  return (
    <form
      className={`${styles.card} ${theme === "dark" ? styles.themeDark : styles.themeLight}`}
      onSubmit={(e) => e.preventDefault()}
    >
      <div className={styles.headline}>
        <div>
          <h2 className={styles.title}>VPN</h2>
          <span className={styles.subtitle}>
            {t(
              "Ative ou desative VPN para um usuário, aplicando Dial-in no AD e o grupo de bloqueio de envio externo.",
              "Enable or disable VPN for a user, applying AD Dial-in and external-send block group policy."
            )}
          </span>
        </div>
        <span className={`${styles.modePill} ${enabled ? styles.on : styles.off}`}>
          {t(
            enabled ? "VPN habilitada" : "VPN desabilitada",
            enabled ? "VPN enabled" : "VPN disabled"
          )}
        </span>
      </div>

      <div className={styles.shell}>
        <label className={styles.userField}>
          <span>{t("Usuário AD (login, e-mail ou UPN)", "AD user (login, email or UPN)")}</span>
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onBlur={() => { void validateCurrentStatus(); }}
            placeholder={t("Ex.: mhalmeida ou mhalmeida@coamo.com.br", "Example: mhalmeida or mhalmeida@coamo.com.br")}
            disabled={loading}
          />
        </label>

        <div className={styles.modeCard}>
          <div className={styles.modeCopy}>
            <strong>{t("Estado da política VPN", "VPN policy state")}</strong>
            <span>
              {t(
                enabled
                  ? "Permitir acesso e remover bloqueio de envio externo"
                  : "Definir Not set e aplicar bloqueio de envio externo",
                enabled
                  ? "Allow access and remove external-send block"
                  : "Set Not set and apply external-send block"
              )}
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={t("Alternar política VPN", "Toggle VPN policy")}
            className={`${styles.toggle} ${enabled ? styles.toggleOn : styles.toggleOff}`}
            onClick={() => {
              const next = !enabled;
              setEnabled(next);
              void applyPolicy(next);
            }}
            disabled={loading}
          >
            <span className={styles.track} aria-hidden="true">
              <span className={styles.thumb} />
            </span>
            <span className={styles.toggleLabel} aria-hidden="true">
              {enabled ? "ON" : "OFF"}
            </span>
          </button>
        </div>
      </div>

      <div className={styles.actions}>
        <span className={styles.switchHint}>
          {loading
            ? t("Aplicando política...", "Applying policy...")
            : validatingStatus
              ? t("Validando estado atual da VPN...", "Validating current VPN status...")
              : t("Altere o switch para executar a ação imediatamente.", "Toggle the switch to execute the action immediately.")}
        </span>
      </div>

      {error && <div className="alert">{error}</div>}

      {result && (
        <div className={styles.results}>
          {alreadyInState(result) ? (
            <div className={styles.logWarn}>
              {appliedEnabled
                ? t("Usuário já possui acesso VPN.", "User already has VPN access.")
                : t("Usuário não possui acesso a VPN.", "User does not have VPN access.")}
            </div>
          ) : (
            <>
              <div className={styles.resultGrid}>
                <div>
                  <span>{t("Login", "Login")}</span>
                  <strong>{result.login}</strong>
                </div>
                <div>
                  <span>{t("Dial-in", "Dial-in")}</span>
                  <strong>{result.vpn_value === "TRUE" ? "TRUE" : "NOT SET"}</strong>
                </div>
                <div>
                  <span>{t("CA - Bloqueio Ext", "CA - Block Ext")}</span>
                  <strong>{GROUP_ACTION_LABEL[result.bloqueio_ext_action] ?? result.bloqueio_ext_action}</strong>
                </div>
                <div>
                  <span>{t("InternetMail", "InternetMail")}</span>
                  <strong>
                    {GROUP_ACTION_LABEL[result.internet_mail_action] ?? result.internet_mail_action}
                    {" "}
                    <span style={{ fontWeight: 400, opacity: 0.7 }}>({result.internet_mail_group})</span>
                  </strong>
                </div>
              </div>
              {result.warnings?.length ? (
                <div className={styles.logWarn}>
                  {t("Avisos:", "Warnings:")} {result.warnings.join(" | ")}
                </div>
              ) : (
                <div className={styles.logOk}>
                  {t("Política VPN aplicada com sucesso.", "VPN policy applied successfully.")}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </form>
  );
}
