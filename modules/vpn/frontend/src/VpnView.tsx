import { useState } from "react";
import styles from "./VpnView.module.css";

type ModuleProps = {
  token: string;
  user: { username: string; role: string; is_platform_admin: boolean };
  apiBase: string;
  theme: "light" | "dark";
  language: "pt-BR" | "en-US";
};

type VpnResult = {
  login: string;
  vpn_value: "TRUE" | "NOT_SET";
  group_action: "removed" | "added" | "already_absent" | "already_present" | "failed";
  group_name: string;
  warnings?: string[];
};

type VpnResponse = {
  status: string;
  result: VpnResult;
};

const GROUP_ACTION_LABEL: Record<VpnResult["group_action"], string> = {
  removed: "Removido",
  added: "Adicionado",
  already_absent: "Já ausente",
  already_present: "Já presente",
  failed: "Falha",
};

export default function VpnView({ token, apiBase, language }: ModuleProps) {
  const t = (pt: string, en: string) => (language === "pt-BR" ? pt : en);

  const [username, setUsername] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<VpnResult | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || loading) return;
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
        body: JSON.stringify({ username: username.trim(), enabled }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { detail?: string };
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as VpnResponse;
      setResult(data.result);
      setUsername("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className={styles.card} onSubmit={handleSubmit}>
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
            onClick={() => setEnabled((v) => !v)}
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
        <button
          type="submit"
          className="button"
          disabled={loading || !username.trim()}
        >
          {loading
            ? t("Processando...", "Processing...")
            : t("Aplicar política VPN", "Apply VPN policy")}
        </button>
      </div>

      {error && <div className="alert">{error}</div>}

      {result && (
        <div className={styles.results}>
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
              <span>{t("Ação de grupo", "Group action")}</span>
              <strong>{GROUP_ACTION_LABEL[result.group_action] ?? result.group_action}</strong>
            </div>
            <div>
              <span>{t("Grupo", "Group")}</span>
              <strong>{result.group_name}</strong>
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
        </div>
      )}
    </form>
  );
}
