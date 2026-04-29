import { useEffect, useState } from "react";
import styles from "./VpnView.module.css";

type ModuleProps = {
  token: string;
  user: { username: string; role: string; is_platform_admin: boolean };
  apiBase: string;
  theme: "light" | "dark";
  language: "pt-BR" | "en-US";
};

type VpnTunnel = {
  id: string;
  name: string;
  status: "active" | "inactive" | "error";
  ip: string;
  user: string;
  connected_since: string | null;
};

const STATUS_LABEL: Record<VpnTunnel["status"], string> = {
  active: "Ativo",
  inactive: "Inativo",
  error: "Erro",
};

export default function VpnView({ token, apiBase }: ModuleProps) {
  const [tunnels, setTunnels] = useState<VpnTunnel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(`${apiBase}/tunnels`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<VpnTunnel[]>;
      })
      .then((data) => {
        if (!cancelled) {
          setTunnels(data);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, apiBase]);

  if (loading) {
    return (
      <div className={styles.center}>
        <span className="spinner" />
        <span>Carregando túneis VPN…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="module-error">
        <h3>Erro ao carregar VPN</h3>
        <p>{error}</p>
      </div>
    );
  }

  const active = tunnels.filter((t) => t.status === "active").length;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Túneis VPN</h1>
          <p className={styles.subtitle}>
            {active} ativo{active !== 1 ? "s" : ""} de {tunnels.length} túnel
            {tunnels.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {tunnels.length === 0 ? (
        <div className={styles.empty}>Nenhum túnel encontrado.</div>
      ) : (
        <div className={styles.table}>
          <div className={styles.tableHead}>
            <span>Nome</span>
            <span>IP</span>
            <span>Usuário</span>
            <span>Status</span>
            <span>Conectado desde</span>
          </div>

          {tunnels.map((tunnel) => (
            <div key={tunnel.id} className={styles.tableRow}>
              <span className={styles.name}>{tunnel.name}</span>
              <span className={styles.mono}>{tunnel.ip}</span>
              <span>{tunnel.user}</span>
              <span>
                <span className={`${styles.badge} ${styles[tunnel.status]}`}>
                  {STATUS_LABEL[tunnel.status]}
                </span>
              </span>
              <span className={styles.mono}>
                {tunnel.connected_since
                  ? new Date(tunnel.connected_since).toLocaleString("pt-BR")
                  : "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
