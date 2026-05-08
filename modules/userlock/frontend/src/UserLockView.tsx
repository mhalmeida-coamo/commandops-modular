import { useCallback, useEffect, useMemo, useState } from "react";

type AppLanguage = "pt-BR" | "en-US";

type LockEvent = {
  event_id: string;
  timestamp: number;
  source_system: "ad" | "radius" | "kerberos" | "entra" | string;
  lock_type: string;
  lock_reason: string;
  username: string;
  upn: string;
  domain: string;
  origin_device: string;
  origin_ip: string;
  origin_host: string;
  client_app: string;
  os: string;
  severity: "low" | "medium" | "high" | "critical" | string;
  status: "active" | "resolved" | string;
  created_at: number;
};

type LockPage = { total: number; page: number; per_page: number; items: LockEvent[] };
type Props = {
  token: string | null;
  isEnabled: boolean;
  language: AppLanguage;
  theme: string;
};

type Section = "overview" | "events" | "users" | "devices" | "reports" | "alerts";
type SectionFilters = {
  period: string;
  source: string;
  user: string;
  host: string;
  ip: string;
  mac: string;
  code: string;
  status: string;
  severity: string;
};

async function apiFetch<T>(path: string, token: string | null): Promise<T> {
  const res = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function fmtTs(ts: number, locale: string): string {
  if (!ts) return "-";
  return new Date(ts * 1000).toLocaleString(locale);
}

function sourceLabel(s: string, lang: AppLanguage): string {
  switch (s) {
    case "ad": return "AD";
    case "radius": return "Radius";
    case "kerberos": return "Kerberos";
    case "entra": return lang === "pt-BR" ? "Entra ID" : "Entra ID";
    default: return s || "-";
  }
}

const LOCKOUT_TYPES = new Set(["account_lockout", "account_locked"]);

function eventStatusLabel(ev: LockEvent, lang: AppLanguage): string {
  if (ev.status === "resolved") return lang === "pt-BR" ? "Resolvido" : "Resolved";
  if (LOCKOUT_TYPES.has(ev.lock_type)) return lang === "pt-BR" ? "Bloqueado" : "Blocked";
  return lang === "pt-BR" ? "Falha" : "Failed";
}

function eventStatusStyle(ev: LockEvent): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-block", padding: "2px 8px", borderRadius: 99,
    fontSize: "0.75rem", fontWeight: 600,
  };
  if (ev.status === "resolved")
    return { ...base, background: "rgba(56,161,105,0.15)", color: "var(--success, #38a169)" };
  if (LOCKOUT_TYPES.has(ev.lock_type))
    return { ...base, background: "rgba(229,62,62,0.12)", color: "var(--danger, #e53e3e)" };
  return { ...base, background: "rgba(234,179,8,0.15)", color: "var(--warning, #b45309)" };
}

const LOCK_TYPE_LABEL: Record<string, string> = {
  account_lockout:              "Lockout",
  account_unlocked:             "Desbloqueado",
  auth_failed:                  "Auth falhou",
  auth_reject:                  "Auth rejeitado",
  invalid_login:                "Login inválido",
  invalid_login_workstation:    "Login inválido (WS)",
  invalid_password:             "Senha inválida",
  kerberos_request_failed:      "Kerberos falhou",
  preauth_failed:               "Pré-auth falhou",
  ntlm_invalid_login:           "NTLM inválido",
  radius_ldap_failed:           "RADIUS LDAP",
  radius_wifi_invalid_password: "RADIUS Wi-Fi",
  auth_event:                   "Auth event",
};

function eventCode(ev: LockEvent): string {
  const txt = `${ev.lock_type || ""} ${ev.lock_reason || ""}`;
  const m = txt.match(/(AADSTS\d+|0x[0-9A-Fa-f]+|\b\d{4,6}\b)/);
  if (m) return m[1];
  if (ev.lock_type && LOCK_TYPE_LABEL[ev.lock_type]) return LOCK_TYPE_LABEL[ev.lock_type];
  if (ev.lock_type) return ev.lock_type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return "-";
}

const ERROR_CODE_DESC: Record<string, string> = {
  "50140": "Interrupção 'Manter conectado' (Entra ID)",
  "50126": "Usuário ou senha inválidos (Entra ID)",
  "50053": "Conta bloqueada — muitas tentativas (Entra ID)",
  "50057": "Conta desabilitada (Entra ID)",
  "50058": "Sessão silenciosa não autorizada (Entra ID)",
  "50074": "Autenticação forte exigida (MFA) (Entra ID)",
  "50076": "MFA necessário para este recurso (Entra ID)",
  "50079": "MFA necessário — configuração incompleta (Entra ID)",
  "50089": "Token de fluxo expirado (Entra ID)",
  "50097": "Autenticação de dispositivo necessária (Entra ID)",
  "50105": "Usuário sem licença atribuída (Entra ID)",
  "50128": "Domínio inválido ou tenant não encontrado (Entra ID)",
  "50129": "Dispositivo não associado ao tenant (Entra ID)",
  "50131": "Acesso bloqueado por Acesso Condicional (Entra ID)",
  "50133": "Sessão inválida — senha alterada recentemente (Entra ID)",
  "50135": "Redefinição de senha necessária (Entra ID)",
  "50144": "Senha do AD expirada (Entra ID)",
  "50173": "Token de acesso expirado (Entra ID)",
  "51004": "Conta não encontrada no diretório (Entra ID)",
  "51006": "Autenticação do Windows integrada necessária (Entra ID)",
  "53000": "Acesso Condicional: dispositivo não compatível (Entra ID)",
  "53001": "Acesso Condicional: dispositivo não ingressado no domínio (Entra ID)",
  "53003": "Acesso bloqueado por Acesso Condicional (Entra ID)",
  "53004": "MFA bloqueado — tentativas suspeitas (Entra ID)",
  "65001":  "Aplicativo sem permissão de acesso (Entra ID)",
  "65004":  "Usuário recusou consentimento ao aplicativo (Entra ID)",
  "70000":  "Concessão inválida (Entra ID)",
  "70011":  "Escopo inválido para o aplicativo (Entra ID)",
  "70044":  "Sessão expirada ou inválida (Entra ID)",
  "75011":  "Método de autenticação incompatível (Entra ID)",
  "80001":  "Agente de autenticação indisponível (Entra ID)",
  "90014":  "Campo obrigatório ausente na requisição (Entra ID)",
  "0x6":    "KRB_ERR: Usuário não encontrado no Kerberos",
  "0x12":   "KRB_ERR: Conta desabilitada, expirada ou bloqueada",
  "0x17":   "KRB_ERR: Senha expirada",
  "0x18":   "KRB_ERR: Senha inválida (pré-autenticação falhou)",
  "0x19":   "KRB_ERR: Política de senha não atendida",
  "0x25":   "KRB_ERR: Relógio do cliente fora de sincronismo",
  "0x32":   "KRB_ERR: Solicitação inválida",
  "0x3f":   "KRB_ERR: Sem suporte genérico",
  "3221225578": "NTLM: Usuário ou senha incorretos",
  "3221225581": "NTLM: Conta não autorizada a fazer login",
  "3221226036": "NTLM: Conta bloqueada",
};

function errorCodeDesc(code: string): string {
  return ERROR_CODE_DESC[code] || ERROR_CODE_DESC[code.toLowerCase()] || "";
}

function isIpLike(v: string): boolean {
  const s = (v || "").trim();
  if (!s) return false;
  const ipv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
  const ipv6 = /^[0-9a-fA-F:]+$/;
  return ipv4.test(s) || (s.includes(":") && ipv6.test(s));
}

function MultiAreaChart({
  series,
  visibleSources,
  xLabels,
}: {
  series: Record<string, number[]>;
  visibleSources: string[];
  xLabels?: string[];
}) {
  const w = 900;
  const h = 230;
  const left = 16;
  const right = 16;
  const top = 12;
  const bottom = 36;
  const count = Math.max(...Object.values(series).map((arr) => arr.length), 1);
  const colors: Record<string, { stroke: string; fill: string; label: string }> = {
    radius: { stroke: "#2b67ec", fill: "rgba(43,103,236,0.20)", label: "Radius" },
    ad: { stroke: "#34a853", fill: "rgba(52,168,83,0.18)", label: "AD" },
    kerberos: { stroke: "#8a52cf", fill: "rgba(138,82,207,0.18)", label: "Kerberos" },
    entra: { stroke: "#f4a62a", fill: "rgba(244,166,42,0.20)", label: "Entra ID" },
  };
  const max = Math.max(
    1,
    ...visibleSources.flatMap((src) => series[src] || [0]),
  );

  const linePath = (values: number[]) =>
    values
      .map((v, i) => {
        const x = left + (i / Math.max(count - 1, 1)) * (w - left - right);
        const y = h - bottom - (v / max) * (h - top - bottom);
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");

  const areaPath = (values: number[]) => {
    const line = linePath(values);
    const lastX = left + (Math.max(values.length - 1, 0) / Math.max(count - 1, 1)) * (w - left - right);
    return `${line} L ${lastX.toFixed(2)} ${h - bottom} L ${left} ${h - bottom} Z`;
  };

  const step = Math.max(1, Math.ceil(count / 8));

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 200 }}>
        {visibleSources.map((src) => {
          const values = series[src] || new Array(count).fill(0);
          const c = colors[src] || colors.radius;
          return (
            <g key={src}>
              <path d={areaPath(values)} fill={c.fill} />
              <path d={linePath(values)} fill="none" stroke={c.stroke} strokeWidth="2.5" />
            </g>
          );
        })}
        {xLabels && xLabels.map((label, i) => {
          if (i % step !== 0 && i !== count - 1) return null;
          const x = left + (i / Math.max(count - 1, 1)) * (w - left - right);
          return (
            <text key={i} x={x} y={h - 8} textAnchor="middle" fontSize={11} fill="currentColor" opacity={0.45}>
              {label}
            </text>
          );
        })}
      </svg>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
        {visibleSources.map((src) => {
          const c = colors[src] || colors.radius;
          return (
            <div key={src} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, opacity: 0.9 }}>
              <span style={{ width: 10, height: 10, borderRadius: 99, background: c.stroke, display: "inline-block" }} />
              <span>{c.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function UserLockView({ token, isEnabled, language, theme }: Props) {
  const t = (pt: string, en: string) => (language === "pt-BR" ? pt : en);
  const locale = language === "pt-BR" ? "pt-BR" : "en-US";
  const isDark = String(theme || "").toLowerCase().includes("dark");
  const c = {
    pageBg: isDark ? "#081226" : "#f4f7fb",
    panelBg: isDark ? "#0c1a2f" : "#f9fbff",
    cardBg: isDark ? "#0f1f37" : "#ffffff",
    border: isDark ? "#223a61" : "#dbe4f2",
    text: isDark ? "#e6edf8" : "#111827",
    muted: isDark ? "#9bb0cf" : "#475569",
    accent: "#2563eb",
    tableBorder: isDark ? "#1b2f50" : "#e5e7eb",
    rowBorder: isDark ? "#162947" : "#f1f5f9",
    inputBg: isDark ? "#122642" : "#fff",
  };

  const [section, setSection] = useState<Section>("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<LockEvent | null>(null);
  const [heatFilter, setHeatFilter] = useState<{ source: string; slotIdx: number; slotLabel: string } | null>(null);

  const defaultFilters: SectionFilters = {
    period: "24h",
    source: "",
    user: "",
    host: "",
    ip: "",
    mac: "",
    code: "",
    status: "",
    severity: "",
  };
  const [sectionFilters, setSectionFilters] = useState<Record<Section, SectionFilters>>({
    overview: { ...defaultFilters },
    events: { ...defaultFilters },
    users: { ...defaultFilters },
    devices: { ...defaultFilters },
    reports: { ...defaultFilters },
    alerts: { ...defaultFilters },
  });
  const [autoRefresh, setAutoRefresh] = useState("60");
  const [appliedAt, setAppliedAt] = useState(0);
  const [recentPage, setRecentPage] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setIsFullscreen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const [chartHours, setChartHours] = useState(24);
  const [page, setPage] = useState<LockPage | null>(null);
  const [allItems, setAllItems] = useState<LockEvent[]>([]);
  const [recentUnlocks, setRecentUnlocks] = useState<LockEvent[]>([]);
  const recentPerPage = 8;

  const filters = sectionFilters[section];
  const period = filters.period;
  const source = filters.source;
  const user = filters.user;
  const host = filters.host;
  const ip = filters.ip;
  const mac = filters.mac;
  const code = filters.code;
  const status = filters.status;
  const severity = filters.severity;

  const setFilter = (key: keyof SectionFilters, value: string) => {
    setSectionFilters((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [key]: value,
      },
    }));
  };

  const clearCurrentFilters = () => {
    setSectionFilters((prev) => ({
      ...prev,
      [section]: { ...defaultFilters },
    }));
    setHeatFilter(null);
  };

  const periodToPage = useMemo(() => {
    if (period === "15m") return 200;
    if (period === "1h") return 400;
    if (period === "6h") return 700;
    if (period === "24h") return 1000;
    if (period === "7d") return 1000;
    return 1000;
  }, [period]);

  const load = useCallback(async () => {
    if (!token || !isEnabled) return;
    setLoading(true);
    setError("");
    try {
      const fetchSourcePages = async (src: string) => {
        const qs = new URLSearchParams({
          page: "1",
          per_page: String(periodToPage),
          ...(src && { source: src }),
          ...(status && { status }),
          ...(severity && { severity }),
          ...(user && { username: user }),
        });
        const first = await apiFetch<LockPage>(`/api/userlock/v1/locks?${qs.toString()}`, token);
        const items: LockEvent[] = [...(first.items || [])];
        const maxPages = 5;
        const totalPages = Math.min(
          maxPages,
          Math.max(1, Math.ceil((first.total || 0) / Math.max(1, first.per_page || periodToPage))),
        );
        for (let p = 2; p <= totalPages; p++) {
          const qsp = new URLSearchParams({
            page: String(p),
            per_page: String(periodToPage),
            ...(src && { source: src }),
            ...(status && { status }),
            ...(severity && { severity }),
            ...(user && { username: user }),
          });
          const pg = await apiFetch<LockPage>(`/api/userlock/v1/locks?${qsp.toString()}`, token);
          if (!pg.items?.length) break;
          items.push(...pg.items);
          if (pg.items.length < periodToPage) break;
        }
        return { first, items };
      };

      if (!source) {
        const sources = ["radius", "ad", "kerberos", "entra"];
        const results = await Promise.all(sources.map((s) => fetchSourcePages(s)));
        const combined = results.flatMap((r) => r.items);
        combined.sort((a, b) => b.timestamp - a.timestamp);
        setAllItems(combined);
        setPage({
          total: combined.length,
          page: 1,
          per_page: Math.min(combined.length, periodToPage),
          items: combined.slice(0, periodToPage),
        });
      } else {
        const { first, items } = await fetchSourcePages(source);
        items.sort((a, b) => b.timestamp - a.timestamp);
        setAllItems(items);
        setPage(first);
      }

      try {
        const uqs = new URLSearchParams({ lock_type: "account_unlocked", per_page: "20", page: "1" });
        const upage = await apiFetch<LockPage>(`/api/userlock/v1/locks?${uqs.toString()}`, token);
        setRecentUnlocks((upage.items || []).sort((a, b) => b.timestamp - a.timestamp));
      } catch { /* non-critical */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
      setAllItems([]);
    } finally {
      setLoading(false);
    }
  }, [token, isEnabled, periodToPage, source, status, severity, user]);

  useEffect(() => {
    void load();
  }, [load, appliedAt]);

  useEffect(() => {
    const sec = Number(autoRefresh);
    if (!sec || sec <= 0) return;
    const id = window.setInterval(() => {
      void load();
    }, sec * 1000);
    return () => window.clearInterval(id);
  }, [autoRefresh, load]);

  const items = useMemo(() => {
    const arr = allItems.length ? allItems : (page?.items || []);
    const newestTs = arr.length ? arr[0].timestamp : Math.floor(Date.now() / 1000);
    const windowSec =
      period === "15m" ? 15 * 60 :
      period === "1h" ? 60 * 60 :
      period === "6h" ? 6 * 60 * 60 :
      period === "24h" ? 24 * 60 * 60 :
      period === "7d" ? 7 * 24 * 60 * 60 :
      30 * 24 * 60 * 60;
    const fromTs = newestTs - windowSec;
    return arr.filter((ev) => {
      const h = `${ev.origin_host || ""} ${ev.origin_device || ""}`.toLowerCase();
      const codeStr = `${eventCode(ev)} ${ev.lock_reason || ""} ${ev.lock_type || ""}`.toLowerCase();
      const macField = `${ev.origin_device || ""} ${ev.lock_reason || ""}`.toLowerCase();
      if (ev.timestamp < fromTs) return false;
      if (host && !h.includes(host.toLowerCase())) return false;
      if (ip && !(ev.origin_ip || "").toLowerCase().includes(ip.toLowerCase())) return false;
      if (mac && !macField.includes(mac.toLowerCase())) return false;
      if (code && !codeStr.includes(code.toLowerCase())) return false;
      return true;
    });
  }, [allItems, page, host, ip, mac, code, period]);

  const heatFilteredItems = useMemo(() => {
    if (!heatFilter) return items;
    return items.filter((ev) => {
      if (ev.source_system !== heatFilter.source) return false;
      return Math.floor(new Date(ev.timestamp * 1000).getHours() / 2) === heatFilter.slotIdx;
    });
  }, [items, heatFilter]);

  const recentTotalPages = Math.max(1, Math.ceil(heatFilteredItems.length / recentPerPage));
  const recentRows = useMemo(() => {
    const start = (recentPage - 1) * recentPerPage;
    return heatFilteredItems.slice(start, start + recentPerPage);
  }, [heatFilteredItems, recentPage]);

  useEffect(() => {
    if (recentPage > recentTotalPages) setRecentPage(1);
  }, [recentPage, recentTotalPages]);

  const lockoutItems = items.filter((i) => LOCKOUT_TYPES.has(i.lock_type));

  const chartLockoutItems = useMemo(() => {
    if (!lockoutItems.length) return lockoutItems;
    const newestTs = lockoutItems[0].timestamp;
    const startTs = newestTs - chartHours * 3600;
    return lockoutItems.filter((ev) => ev.timestamp >= startTs);
  }, [lockoutItems, chartHours]);

  const kpiTotalLocks = lockoutItems.length;
  const kpiUsers = new Set(lockoutItems.map((i) => i.username || i.upn).filter(Boolean)).size;
  const kpiSources = new Set(lockoutItems.map((i) => i.source_system).filter(Boolean)).size;
  const latest = lockoutItems[0]?.timestamp || 0;

  const bySource = useMemo(() => {
    const m: Record<string, number> = { radius: 0, ad: 0, kerberos: 0, entra: 0 };
    for (const i of lockoutItems) m[i.source_system] = (m[i.source_system] || 0) + 1;
    return m;
  }, [lockoutItems]);

  const chartBySource = useMemo(() => {
    const m: Record<string, number> = { radius: 0, ad: 0, kerberos: 0, entra: 0 };
    for (const i of chartLockoutItems) m[i.source_system] = (m[i.source_system] || 0) + 1;
    return m;
  }, [chartLockoutItems]);

  const seriesBySource = useMemo(() => {
    const allSources = ["radius", "ad", "kerberos", "entra"];
    const newestTs = lockoutItems.length ? lockoutItems[0].timestamp : Math.floor(Date.now() / 1000);
    const endBucket = Math.floor(newestTs / 3600) * 3600;
    const bucketCount = chartHours;
    const startBucket = endBucket - (bucketCount - 1) * 3600;
    const srcData: Record<string, number[]> = {
      radius: new Array(bucketCount).fill(0),
      ad: new Array(bucketCount).fill(0),
      kerberos: new Array(bucketCount).fill(0),
      entra: new Array(bucketCount).fill(0),
    };
    for (const ev of lockoutItems) {
      const src = allSources.includes(ev.source_system) ? ev.source_system : "";
      if (!src) continue;
      const b = Math.floor(ev.timestamp / 3600) * 3600;
      const idx = Math.floor((b - startBucket) / 3600);
      if (idx >= 0 && idx < bucketCount) srcData[src][idx] += 1;
    }
    const xLabels = Array.from({ length: bucketCount }, (_, i) => {
      const ts = startBucket + i * 3600;
      const d = new Date(ts * 1000);
      return `${String(d.getHours()).padStart(2, "0")}h`;
    });
    return { data: srcData, xLabels };
  }, [lockoutItems, chartHours]);

  const topUsers = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of lockoutItems) {
      const key = i.username || i.upn || "-";
      m.set(key, (m.get(key) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [lockoutItems]);

  const topDevices = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of lockoutItems) {
      const key = i.origin_device || i.origin_host || "-";
      m.set(key, (m.get(key) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [lockoutItems]);

  const usersRows = useMemo(() => {
    return topUsers.map(([u, count]) => {
      const userEvents = lockoutItems.filter((i) => (i.username || i.upn || "-") === u);
      const last = userEvents[0];
      const src = new Set(userEvents.map((e) => sourceLabel(e.source_system, language))).size;
      const ips = [...new Set(userEvents.map((e) => e.origin_ip).filter(Boolean))];
      const devices = [...new Set(userEvents.map((e) => e.origin_device || e.origin_host).filter(Boolean))];
      return {
        user: u,
        count,
        sources: src,
        lastTs: last?.timestamp || 0,
        ips,
        devices,
      };
    });
  }, [topUsers, lockoutItems, language]);

  const devicesRows = useMemo(() => {
    return topDevices.map(([d, count]) => {
      const devEvents = lockoutItems.filter((i) => (i.origin_device || i.origin_host || "-") === d);
      const last = devEvents[0];
      const src = new Set(devEvents.map((e) => sourceLabel(e.source_system, language))).size;
      return {
        device: d,
        count,
        sources: src,
        lastTs: last?.timestamp || 0,
        lastIp: last?.origin_ip || "-",
      };
    });
  }, [topDevices, lockoutItems, language]);

  const topCodes = useMemo(() => {
    const src = allItems.length ? allItems : (page?.items || []);
    const m = new Map<string, number>();
    for (const i of src) {
      const key = eventCode(i);
      m.set(key, (m.get(key) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [allItems, page]);

  const topReasons = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) {
      const key = i.lock_reason || i.lock_type || "-";
      m.set(key, (m.get(key) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [items]);

  const latestLockouts = useMemo(() => {
    return lockoutItems
      .slice(0, 3)
      .map((ev) => ({
        ts: ev.timestamp,
        user: ev.username || ev.upn || "-",
        source: sourceLabel(ev.source_system, language),
        code: eventCode(ev),
      }));
  }, [lockoutItems, language]);

  const latestUnlocks = useMemo(() => {
    return recentUnlocks.slice(0, 3).map((ev) => ({
      ts: ev.timestamp,
      unlockedUser: ev.username || ev.upn || "-",
      actor: ev.origin_host || "-",
    }));
  }, [recentUnlocks]);

  const heat = useMemo(() => {
    const slots = ["00-02", "02-04", "04-06", "06-08", "08-10", "10-12", "12-14", "14-16", "16-18", "18-20", "20-22", "22-24"];
    const src = ["radius", "ad", "kerberos", "entra"];
    const base: Record<string, number[]> = {};
    src.forEach((s) => (base[s] = new Array(slots.length).fill(0)));
    for (const i of items) {
      const d = new Date(i.timestamp * 1000);
      const idx = Math.floor(d.getHours() / 2);
      if (!base[i.source_system]) base[i.source_system] = new Array(slots.length).fill(0);
      base[i.source_system][idx] += 1;
    }
    return { slots, base };
  }, [items]);

  const chartDonut = useMemo(() => {
    const total = Math.max(chartLockoutItems.length, 1);
    const r = Math.round((chartBySource.radius / total) * 360);
    const a = Math.round((chartBySource.ad / total) * 360);
    const k = Math.round((chartBySource.kerberos / total) * 360);
    const e = 360 - r - a - k;
    return `conic-gradient(#2b67ec 0 ${r}deg, #34a853 ${r}deg ${r + a}deg, #8a52cf ${r + a}deg ${r + a + k}deg, #f4a62a ${r + a + k}deg ${r + a + k + e}deg)`;
  }, [chartLockoutItems.length, chartBySource]);

  const menu = [
    ["overview", t("Visão Geral", "Overview")],
    ["events", t("Eventos", "Events")],
    ["users", t("Usuários", "Users")],
    ["devices", t("Dispositivos", "Devices")],
    ["reports", t("Relatórios", "Reports")],
    ["alerts", t("Alertas", "Alerts")],
  ] as const;

  if (!isEnabled) {
    return <div className="module-shell"><div className="module-panel"><div className="module-panel-body">{t("Módulo desativado.", "Module disabled.")}</div></div></div>;
  }

  const fsStyle: React.CSSProperties = isFullscreen ? {
    position: "fixed", inset: 0, zIndex: 9000,
    borderRadius: 0, border: "none",
    background: c.pageBg, overflowY: "auto",
  } : {};

  return (
    <div style={{ background: c.pageBg, minHeight: "100%", borderRadius: 12, border: `1px solid ${c.border}`, color: c.text, ...fsStyle }}>
      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", minHeight: isFullscreen ? "100vh" : "calc(100vh - 180px)" }}>
        <aside
          style={{
            borderRight: `1px solid ${c.border}`,
            padding: "16px 12px",
            background: isDark ? "#0a1628" : "#eef2fa",
            position: "sticky",
            top: 0,
            height: isFullscreen ? "100vh" : "calc(100vh - 180px)",
            overflowY: "auto",
            alignSelf: "start",
            display: "flex",
            flexDirection: "column",
            boxSizing: "border-box",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: c.muted, letterSpacing: 1, marginBottom: 20, paddingLeft: 4 }}>MENU</div>
          {menu.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id as Section)}
              style={{
                width: "100%",
                textAlign: "left",
                marginBottom: 6,
                borderRadius: 8,
                padding: "10px 12px",
                border: section === id ? `1.5px solid ${c.accent}` : `1px solid transparent`,
                background: section === id ? c.accent : "transparent",
                color: section === id ? "#fff" : c.text,
                fontWeight: section === id ? 700 : 500,
                cursor: "pointer",
                fontSize: 14,
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => { if (section !== id) (e.currentTarget as HTMLButtonElement).style.background = isDark ? "#1a2f50" : "#dce6f5"; }}
              onMouseLeave={(e) => { if (section !== id) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
            >
              {label}
            </button>
          ))}
        </aside>

        <main style={{ padding: 20, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 40 }}>{t("Painel de Monitoramento de Bloqueios de Login", "Login Lockout Monitoring Panel")}</h2>
              <div style={{ color: c.muted, marginTop: 4 }}>{t("Radius, AD, Kerberos e Entra ID", "Radius, AD, Kerberos and Entra ID")}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 10, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "#16a34a" }}>●</span>
                <span>{t("Atualização automática", "Auto refresh")}</span>
                <select value={autoRefresh} onChange={(e) => setAutoRefresh(e.target.value)} style={{ border: `1px solid ${c.border}`, background: c.inputBg, color: c.text, borderRadius: 8, padding: "4px 8px" }}>
                  <option value="30">30s</option>
                  <option value="60">1min</option>
                  <option value="300">5min</option>
                  <option value="900">15min</option>
                </select>
              </div>
              <button
                type="button"
                title={isFullscreen ? t("Sair do fullscreen (Esc)", "Exit fullscreen (Esc)") : t("Tela cheia", "Fullscreen")}
                onClick={() => setIsFullscreen((f) => !f)}
                style={{
                  background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 10,
                  padding: "8px 11px", cursor: "pointer", color: c.text,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = isDark ? "#1a2f50" : "#dce6f5"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = c.cardBg; }}
              >
                {isFullscreen ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/>
                    <line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/>
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
                    <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div style={{ marginTop: 16, background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 12, padding: 14, overflow: "hidden" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <select value={period} onChange={(e) => setFilter("period", e.target.value)} style={{ padding: 10, border: `1px solid ${c.border}`, background: c.inputBg, color: c.text, borderRadius: 8, minWidth: 170, flex: "1 1 170px", maxWidth: "100%" }}>
                <option value="15m">{t("Últimos 15 minutos", "Last 15 minutes")}</option>
                <option value="1h">{t("Última 1 hora", "Last 1 hour")}</option>
                <option value="6h">{t("Últimas 6 horas", "Last 6 hours")}</option>
                <option value="24h">{t("Últimas 24h", "Last 24h")}</option>
                <option value="7d">{t("Últimos 7 dias", "Last 7 days")}</option>
                <option value="30d">{t("Últimos 30 dias", "Last 30 days")}</option>
              </select>
              <select value={source} onChange={(e) => setFilter("source", e.target.value)} style={{ padding: 10, border: `1px solid ${c.border}`, background: c.inputBg, color: c.text, borderRadius: 8, minWidth: 120, flex: "1 1 120px", maxWidth: "100%" }}>
                <option value="">{t("Todas", "All")}</option>
                <option value="radius">Radius</option>
                <option value="ad">AD</option>
                <option value="kerberos">Kerberos</option>
                <option value="entra">Entra ID</option>
              </select>
              <input value={user} onChange={(e) => setFilter("user", e.target.value)} placeholder={t("Buscar usuário", "Search user")} style={{ padding: 10, border: `1px solid ${c.border}`, background: c.inputBg, color: c.text, borderRadius: 8, minWidth: 190, flex: "1 1 190px", maxWidth: "100%" }} />
              <input value={host} onChange={(e) => setFilter("host", e.target.value)} placeholder={t("Buscar hostname", "Search hostname")} style={{ padding: 10, border: `1px solid ${c.border}`, background: c.inputBg, color: c.text, borderRadius: 8, minWidth: 190, flex: "1 1 190px", maxWidth: "100%" }} />
              <input value={ip} onChange={(e) => setFilter("ip", e.target.value)} placeholder={t("Buscar IP", "Search IP")} style={{ padding: 10, border: `1px solid ${c.border}`, background: c.inputBg, color: c.text, borderRadius: 8, minWidth: 160, flex: "1 1 160px", maxWidth: "100%" }} />
              <input value={mac} onChange={(e) => setFilter("mac", e.target.value)} placeholder={t("Buscar MAC", "Search MAC")} style={{ padding: 10, border: `1px solid ${c.border}`, background: c.inputBg, color: c.text, borderRadius: 8, minWidth: 170, flex: "1 1 170px", maxWidth: "100%" }} />
              <input value={code} onChange={(e) => setFilter("code", e.target.value)} placeholder={t("Buscar código", "Search code")} style={{ padding: 10, border: `1px solid ${c.border}`, background: c.inputBg, color: c.text, borderRadius: 8, minWidth: 170, flex: "1 1 170px", maxWidth: "100%" }} />
              <select value={status} onChange={(e) => setFilter("status", e.target.value)} style={{ padding: 10, border: `1px solid ${c.border}`, background: c.inputBg, color: c.text, borderRadius: 8, minWidth: 130, flex: "1 1 130px", maxWidth: "100%" }}>
                <option value="">{t("Todos", "All")}</option>
                <option value="active">{t("Bloqueado", "Blocked")}</option>
                <option value="resolved">{t("Resolvido", "Resolved")}</option>
              </select>
              <select value={severity} onChange={(e) => setFilter("severity", e.target.value)} style={{ padding: 10, border: `1px solid ${c.border}`, background: c.inputBg, color: c.text, borderRadius: 8, minWidth: 180, flex: "1 1 180px", maxWidth: "100%" }}>
                <option value="">{t("Todas as severidades", "All severities")}</option>
                <option value="critical">{t("Crítica", "Critical")}</option>
                <option value="high">{t("Alta", "High")}</option>
                <option value="medium">{t("Média", "Medium")}</option>
                <option value="low">{t("Baixa", "Low")}</option>
              </select>
              <button onClick={() => setAppliedAt(Date.now())} style={{ border: 0, borderRadius: 8, background: "#2563eb", color: "#fff", padding: "10px 14px", fontWeight: 700, whiteSpace: "nowrap", flex: "0 0 auto" }}>{t("Aplicar filtros", "Apply filters")}</button>
              <button onClick={() => { clearCurrentFilters(); setAppliedAt(Date.now()); }} style={{ border: `1px solid ${c.border}`, borderRadius: 8, background: c.inputBg, color: c.text, padding: "10px 14px", whiteSpace: "nowrap", flex: "0 0 auto" }}>{t("Limpar", "Clear")}</button>
            </div>
            <div style={{ marginTop: 10, color: c.muted }}>{t("Todos os gráficos e tabelas são atualizados conforme os filtros selecionados.", "All charts and tables update based on selected filters.")}</div>
          </div>

          {loading && <div style={{ marginTop: 12 }}>{t("Carregando...", "Loading...")}</div>}
          {error && <div style={{ marginTop: 12, color: "#b91c1c" }}>{error}</div>}

          {section === "overview" && (
          <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12, marginTop: 14 }}>
            {[
              [t("Total de bloqueios", "Total lockouts"), String(kpiTotalLocks)],
              [t("Usuários afetados", "Affected users"), String(kpiUsers)],
              [t("Origens únicas", "Unique sources"), String(kpiSources)],
              [t("Último bloqueio", "Latest lockout"), latest ? fmtTs(latest, locale) : "-"],
            ].map(([label, value]) => (
              <div key={label} style={{ background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 12, padding: 14 }}>
                <div style={{ color: c.muted, fontWeight: 600 }}>{label}</div>
                <div style={{ fontSize: 32, fontWeight: 800, color: "#1e40af", marginTop: 6 }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            <div style={{ background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 12, padding: 12 }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 20 }}>{t("3 últimos bloqueios", "Last 3 lockouts")}</h3>
              {latestLockouts.length === 0 && (
                <div style={{ color: c.muted }}>{t("Sem dados no período.", "No data in selected period.")}</div>
              )}
              {latestLockouts.map((r, idx) => (
                <div key={`${r.ts}-${idx}`} style={{ padding: "8px 0", borderBottom: `1px solid ${c.rowBorder}` }}>
                  <div style={{ fontWeight: 700 }}>{r.user}</div>
                  <div style={{ fontSize: 13, color: c.muted }}>
                    {fmtTs(r.ts, locale)} · {r.source} · {r.code}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 12, padding: 12 }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 20 }}>{t("3 últimos desbloqueios", "Last 3 unlocks")}</h3>
              {latestUnlocks.length === 0 && (
                <div style={{ color: c.muted }}>{t("Sem eventos de desbloqueio no período.", "No unlock events in selected period.")}</div>
              )}
              {latestUnlocks.map((r, idx) => (
                <div key={`${r.ts}-${idx}`} style={{ padding: "8px 0", borderBottom: `1px solid ${c.rowBorder}` }}>
                  <div style={{ fontWeight: 700 }}>
                    {t("Desbloqueado", "Unlocked")}: {r.unlockedUser}
                  </div>
                  <div style={{ fontSize: 13, color: c.muted }}>
                    {t("Por", "By")} {r.actor} · {fmtTs(r.ts, locale)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1.3fr 1.3fr", gap: 12, marginTop: 12 }}>
            <div style={{ background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 12, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
                <h3 style={{ margin: 0, fontSize: 22 }}>{t("Bloqueios por hora", "Lockouts by hour")}</h3>
                <div style={{ display: "flex", gap: 4 }}>
                  {([1, 2, 4, 8, 12, 24] as const).map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setChartHours(h)}
                      style={{
                        padding: "4px 10px",
                        borderRadius: 6,
                        border: chartHours === h ? "none" : `1px solid ${c.border}`,
                        background: chartHours === h ? c.accent : c.inputBg,
                        color: chartHours === h ? "#fff" : c.muted,
                        fontWeight: chartHours === h ? 700 : 500,
                        fontSize: 12,
                        cursor: "pointer",
                        transition: "all 0.12s",
                      }}
                    >
                      {h}h
                    </button>
                  ))}
                </div>
              </div>
              <MultiAreaChart
                series={seriesBySource.data}
                visibleSources={source ? [source] : ["radius", "ad", "kerberos", "entra"]}
                xLabels={seriesBySource.xLabels}
              />
            </div>
            <div style={{ background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 12, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                <h3 style={{ margin: 0, fontSize: 22 }}>{t("Distribuição por origem", "Source distribution")}</h3>
                <span style={{ fontSize: 11, color: c.muted, fontWeight: 600 }}>({t("últimas", "last")} {chartHours}h)</span>
              </div>
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <div style={{ width: 150, height: 150, borderRadius: "50%", background: chartDonut, flexShrink: 0 }} />
                <div style={{ fontSize: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 99, background: "#2b67ec", display: "inline-block" }} />
                    Radius: <b>{chartBySource.radius}</b>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 99, background: "#34a853", display: "inline-block" }} />
                    AD: <b>{chartBySource.ad}</b>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 99, background: "#8a52cf", display: "inline-block" }} />
                    Kerberos: <b>{chartBySource.kerberos}</b>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 99, background: "#f4a62a", display: "inline-block" }} />
                    Entra ID: <b>{chartBySource.entra}</b>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 12, padding: 12 }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 22 }}>{t("Principais códigos de erro", "Top error codes")}</h3>
              {topCodes.map(([k, v]) => {
                const desc = errorCodeDesc(k);
                const isNumeric = /^[\dA-Fx]+$/i.test(k) && desc;
                return (
                  <div key={k} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "2px 8px", marginBottom: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {desc || k}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, textAlign: "right", minWidth: 32 }}>{v}</div>
                    {isNumeric && (
                      <div style={{ fontSize: 11, color: c.muted, fontFamily: "monospace", gridColumn: "1 / -1", marginBottom: 2 }}>
                        {k}
                      </div>
                    )}
                    <div style={{ gridColumn: "1 / -1", background: c.border, height: 6, borderRadius: 8 }}>
                      <div style={{ width: `${Math.max(4, (v / Math.max(topCodes[0]?.[1] || 1, 1)) * 100)}%`, background: "#2563eb", height: 6, borderRadius: 8 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr", gap: 12, marginTop: 12 }}>
            <div style={{ background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 12, padding: 12 }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 22 }}>{t("Eventos por origem e período", "Events by source and period")}</h3>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: 6 }}>Src</th>
                    {heat.slots.map((s) => <th key={s} style={{ padding: 6 }}>{s}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(heat.base).map(([s, vals]) => (
                    <tr key={s}>
                      <td style={{ padding: 6 }}>{sourceLabel(s, language)}</td>
                      {vals.map((v, idx) => {
                        const isActive = heatFilter?.source === s && heatFilter?.slotIdx === idx;
                        const hasValue = v > 0;
                        return (
                          <td
                            key={idx}
                            onClick={() => hasValue ? setHeatFilter(isActive ? null : { source: s, slotIdx: idx, slotLabel: heat.slots[idx] }) : undefined}
                            style={{
                              padding: 6,
                              textAlign: "center",
                              background: isActive
                                ? "rgba(37,99,235,0.7)"
                                : `rgba(37,99,235,${Math.min(0.08 + v * 0.07, 0.55)})`,
                              cursor: hasValue ? "pointer" : "default",
                              outline: isActive ? "2px solid #2563eb" : undefined,
                              borderRadius: isActive ? 4 : undefined,
                              fontWeight: isActive ? 700 : undefined,
                              color: isActive ? "#fff" : undefined,
                              userSelect: "none",
                            }}
                            title={hasValue ? `${sourceLabel(s, language)} · ${heat.slots[idx]} · ${v} eventos` : undefined}
                          >
                            {v}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 12, padding: 12 }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 22 }}>{t("Resumo rápido", "Quick summary")}</h3>
              <div>{t("Origem com mais eventos", "Top source")}: <b>{Object.entries(bySource).sort((a, b) => b[1] - a[1])[0]?.[0] || "-"}</b></div>
              <div>{t("Usuário mais impactado", "Top user")}: <b>{topUsers[0]?.[0] || "-"}</b></div>
              <div>{t("Hostname recorrente", "Recurring hostname")}: <b>{items.find((x) => x.origin_host)?.origin_host || "-"}</b></div>
              <div>{t("IP recorrente", "Recurring IP")}: <b>{items.find((x) => x.origin_ip)?.origin_ip || "-"}</b></div>
            </div>
          </div>
          </>
          )}

          {(section === "overview" || section === "events") && (
          <div style={{ marginTop: 12, background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 12, padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
              <h3 style={{ margin: 0, fontSize: 22 }}>{t("Eventos recentes", "Recent events")}</h3>
              {heatFilter && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(37,99,235,0.15)", border: "1px solid #2563eb", borderRadius: 99, padding: "3px 10px", fontSize: 13, fontWeight: 600, color: "#2563eb" }}>
                  {sourceLabel(heatFilter.source, language)} · {heatFilter.slotLabel}
                  <button
                    onClick={() => setHeatFilter(null)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#2563eb", fontWeight: 700, fontSize: 15, lineHeight: 1, padding: "0 2px" }}
                    title={t("Limpar filtro do gráfico", "Clear chart filter")}
                  >×</button>
                </span>
              )}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {[t("Data/Hora", "Date/Time"), t("Origem", "Source"), t("Usuário", "User"), "Hostname", "IP", t("Código", "Code"), t("Descrição", "Description"), "Status"].map((h) => (
                      <th key={h} style={{ textAlign: "left", borderBottom: `1px solid ${c.tableBorder}`, padding: "10px 8px" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentRows.map((ev) => (
                    <tr key={ev.event_id} onClick={() => setSelected(ev)} style={{ cursor: "pointer" }}>
                      <td style={{ padding: "10px 8px", borderBottom: `1px solid ${c.rowBorder}` }}>{fmtTs(ev.timestamp, locale)}</td>
                      <td style={{ padding: "10px 8px", borderBottom: `1px solid ${c.rowBorder}` }}>{sourceLabel(ev.source_system, language)}</td>
                      <td style={{ padding: "10px 8px", borderBottom: `1px solid ${c.rowBorder}` }}>{ev.username || ev.upn || "-"}</td>
                      <td style={{ padding: "10px 8px", borderBottom: `1px solid ${c.rowBorder}` }}>{ev.origin_device || ev.origin_host || "-"}</td>
                      <td style={{ padding: "10px 8px", borderBottom: `1px solid ${c.rowBorder}` }}>
                        {isIpLike(ev.origin_ip || "") ? ev.origin_ip : "-"}
                      </td>
                      <td style={{ padding: "10px 8px", borderBottom: `1px solid ${c.rowBorder}` }}>{eventCode(ev)}</td>
                      <td style={{ padding: "10px 8px", borderBottom: `1px solid ${c.rowBorder}` }}>{ev.lock_reason || ev.lock_type || "-"}</td>
                      <td style={{ padding: "10px 8px", borderBottom: `1px solid ${c.rowBorder}` }}>
                        <span style={eventStatusStyle(ev)}>
                          {eventStatusLabel(ev, language)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span style={{ color: c.muted, fontSize: 13 }}>
                {t("Página", "Page")} {recentPage} / {recentTotalPages}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setRecentPage((p) => Math.max(1, p - 1))}
                  disabled={recentPage <= 1}
                  style={{
                    border: `1px solid ${c.border}`,
                    background: c.inputBg,
                    color: c.text,
                    borderRadius: 8,
                    padding: "6px 10px",
                    cursor: recentPage <= 1 ? "not-allowed" : "pointer",
                    opacity: recentPage <= 1 ? 0.5 : 1,
                  }}
                >
                  {t("Anterior", "Previous")}
                </button>
                <button
                  type="button"
                  onClick={() => setRecentPage((p) => Math.min(recentTotalPages, p + 1))}
                  disabled={recentPage >= recentTotalPages}
                  style={{
                    border: `1px solid ${c.border}`,
                    background: c.inputBg,
                    color: c.text,
                    borderRadius: 8,
                    padding: "6px 10px",
                    cursor: recentPage >= recentTotalPages ? "not-allowed" : "pointer",
                    opacity: recentPage >= recentTotalPages ? 0.5 : 1,
                  }}
                >
                  {t("Próxima", "Next")}
                </button>
              </div>
            </div>
          </div>
          )}

          {section === "users" && (
            <div style={{ marginTop: 12, background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 12, padding: 12 }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 22 }}>{t("Top usuários com bloqueios", "Top users with lockouts")}</h3>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {[t("Usuário", "User"), t("Eventos", "Events"), t("Origens", "Sources"), t("Último evento", "Last event"), "IP", t("Dispositivo", "Device")].map((h) => (
                        <th key={h} style={{ textAlign: "left", borderBottom: `1px solid ${c.tableBorder}`, padding: "10px 8px" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {usersRows.map((r) => (
                      <tr key={r.user}>
                        <td style={{ padding: "10px 8px", borderBottom: `1px solid ${c.rowBorder}` }}>{r.user}</td>
                        <td style={{ padding: "10px 8px", borderBottom: `1px solid ${c.rowBorder}` }}><b>{r.count}</b></td>
                        <td style={{ padding: "10px 8px", borderBottom: `1px solid ${c.rowBorder}` }}>{r.sources}</td>
                        <td style={{ padding: "10px 8px", borderBottom: `1px solid ${c.rowBorder}` }}>{r.lastTs ? fmtTs(r.lastTs, locale) : "-"}</td>
                        <td style={{ padding: "10px 8px", borderBottom: `1px solid ${c.rowBorder}` }}>{r.ips.length ? r.ips.join(", ") : "-"}</td>
                        <td style={{ padding: "10px 8px", borderBottom: `1px solid ${c.rowBorder}` }}>{r.devices.length ? r.devices.join(", ") : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {section === "devices" && (
            <div style={{ marginTop: 12, background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 12, padding: 12 }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 22 }}>{t("Top dispositivos", "Top devices")}</h3>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {[t("Dispositivo", "Device"), t("Eventos", "Events"), t("Origens", "Sources"), t("Último evento", "Last event"), "IP"].map((h) => (
                        <th key={h} style={{ textAlign: "left", borderBottom: `1px solid ${c.tableBorder}`, padding: "10px 8px" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {devicesRows.map((r) => (
                      <tr key={r.device}>
                        <td style={{ padding: "10px 8px", borderBottom: `1px solid ${c.rowBorder}` }}>{r.device}</td>
                        <td style={{ padding: "10px 8px", borderBottom: `1px solid ${c.rowBorder}` }}><b>{r.count}</b></td>
                        <td style={{ padding: "10px 8px", borderBottom: `1px solid ${c.rowBorder}` }}>{r.sources}</td>
                        <td style={{ padding: "10px 8px", borderBottom: `1px solid ${c.rowBorder}` }}>{r.lastTs ? fmtTs(r.lastTs, locale) : "-"}</td>
                        <td style={{ padding: "10px 8px", borderBottom: `1px solid ${c.rowBorder}` }}>{r.lastIp}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {section === "reports" && (() => {
            const total = topReasons.reduce((s, [, n]) => s + n, 0) || 1;
            const maxCount = topReasons[0]?.[1] || 1;
            const rankColors = ["#e53e3e", "#dd6b20", "#d69e2e"];
            function reasonCategory(reason: string): { label: string; color: string; dot: string } {
              const r = reason.toLowerCase();
              if (r.includes("entra") || r.includes("aadsts") || r.includes("50") || r.includes("azure") || r.includes("signed in") || r.includes("mismatch") || r.includes("credentials mismatch"))
                return { label: "Entra ID", color: "#f97316", dot: "#f97316" };
              if (r.includes("kerberos") || r.includes("preauth") || r.includes("krb"))
                return { label: "Kerberos", color: "#8b5cf6", dot: "#8b5cf6" };
              if (r.includes("ntlm") || r.includes("ntlm_invalid"))
                return { label: "NTLM", color: "#ec4899", dot: "#ec4899" };
              if (r.includes("radius") || r.includes("network policy") || r.includes("certificate") || r.includes("expired"))
                return { label: "RADIUS", color: "#10b981", dot: "#10b981" };
              if (r.includes("ad lockout") || r.includes("uf_lockout") || r.includes("resolvido") || r.includes("resolved"))
                return { label: "AD", color: "#3b82f6", dot: "#3b82f6" };
              if (r.includes("does not exist") || r.includes("not exist"))
                return { label: "AD", color: "#3b82f6", dot: "#3b82f6" };
              return { label: "Outro", color: "#6b7280", dot: "#6b7280" };
            }
            return (
              <div style={{ marginTop: 12, background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 12, padding: "20px 24px" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 20 }}>
                  <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: c.text }}>{t("Principais motivos de bloqueio", "Top lockout reasons")}</h3>
                  <span style={{ fontSize: 13, color: c.muted, fontWeight: 400 }}>{total} {t("eventos totais", "total events")}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {topReasons.map(([reason, count], idx) => {
                    const pct = Math.round((count / total) * 1000) / 10;
                    const barPct = Math.round((count / maxCount) * 100);
                    const cat = reasonCategory(reason);
                    const isTop3 = idx < 3;
                    const shortReason = reason.length > 72 ? reason.slice(0, 70) + "…" : reason;
                    return (
                      <div
                        key={reason}
                        title={reason}
                        style={{
                          background: isDark ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.03)",
                          border: `1px solid ${isTop3 ? cat.color + "40" : c.border}`,
                          borderRadius: 10,
                          padding: "12px 16px",
                          transition: "transform 0.15s, box-shadow 0.15s",
                          cursor: "default",
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateX(3px)"; (e.currentTarget as HTMLDivElement).style.boxShadow = `0 4px 20px ${cat.color}22`; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; (e.currentTarget as HTMLDivElement).style.boxShadow = ""; }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                          <div style={{
                            minWidth: 28, height: 28, borderRadius: 8,
                            background: isTop3 ? `${rankColors[idx]}22` : "rgba(255,255,255,0.05)",
                            border: `1.5px solid ${isTop3 ? rankColors[idx] : c.border}`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 11, fontWeight: 700,
                            color: isTop3 ? rankColors[idx] : c.muted,
                            flexShrink: 0,
                          }}>
                            {`#${idx + 1}`}
                          </div>
                          <span style={{
                            fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
                            padding: "2px 7px", borderRadius: 20,
                            background: cat.color + "22", color: cat.color,
                            border: `1px solid ${cat.color}44`,
                            textTransform: "uppercase", flexShrink: 0,
                          }}>{cat.label}</span>
                          <span style={{ fontSize: 13, color: c.text, fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {shortReason}
                          </span>
                          <span style={{
                            fontSize: 13, fontWeight: 700, color: c.text,
                            background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)",
                            padding: "2px 10px", borderRadius: 20, flexShrink: 0,
                          }}>{count.toLocaleString()}</span>
                          <span style={{ fontSize: 12, color: cat.color, fontWeight: 700, minWidth: 42, textAlign: "right", flexShrink: 0 }}>{pct}%</span>
                        </div>
                        <div style={{ height: 5, borderRadius: 99, background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)", overflow: "hidden" }}>
                          <div style={{
                            height: "100%", borderRadius: 99, width: `${barPct}%`,
                            background: isTop3
                              ? `linear-gradient(90deg, ${cat.color}aa, ${cat.color})`
                              : `linear-gradient(90deg, ${cat.color}66, ${cat.color}aa)`,
                            transition: "width 0.8s cubic-bezier(0.34,1.56,0.64,1)",
                          }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {section === "alerts" && (() => {
            const now = Math.floor(Date.now() / 1000);
            const win15 = now - 15 * 60;
            const win30 = now - 30 * 60;
            const win60 = now - 60 * 60;

            const burstMap = new Map<string, number>();
            for (const ev of lockoutItems) {
              if (ev.timestamp < win15) continue;
              const u = ev.username || ev.upn || "-";
              burstMap.set(u, (burstMap.get(u) || 0) + 1);
            }
            const burstAlerts = [...burstMap.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]);

            const ipUserMap = new Map<string, Set<string>>();
            for (const ev of lockoutItems) {
              if (!ev.origin_ip || ev.timestamp < win60) continue;
              if (!ipUserMap.has(ev.origin_ip)) ipUserMap.set(ev.origin_ip, new Set());
              ipUserMap.get(ev.origin_ip)!.add(ev.username || ev.upn || "-");
            }
            const multiUserIPs = [...ipUserMap.entries()].filter(([, s]) => s.size >= 2).sort((a, b) => b[1].size - a[1].size);

            const userSrcMap = new Map<string, Set<string>>();
            for (const ev of lockoutItems) {
              if (ev.timestamp < win30) continue;
              const u = ev.username || ev.upn || "-";
              if (!userSrcMap.has(u)) userSrcMap.set(u, new Set());
              userSrcMap.get(u)!.add(ev.source_system);
            }
            const multiSrcUsers = [...userSrcMap.entries()].filter(([, s]) => s.size >= 2).sort((a, b) => b[1].size - a[1].size);

            const codeMap = new Map<string, number>();
            for (const ev of items) {
              if (ev.timestamp < win60) continue;
              const evCode = eventCode(ev);
              if (evCode && evCode !== "-") codeMap.set(evCode, (codeMap.get(evCode) || 0) + 1);
            }
            const hotCodes = [...codeMap.entries()].filter(([, n]) => n >= 10).sort((a, b) => b[1] - a[1]);

            type AlertItem = { id: string; severity: "critical" | "high" | "medium"; title: string; detail: string; meta: string };
            const alerts: AlertItem[] = [];

            for (const [u, count] of burstAlerts) {
              alerts.push({
                id: `burst-${u}`,
                severity: count >= 5 ? "critical" : "high",
                title: t("Burst de bloqueios", "Lockout burst"),
                detail: u,
                meta: `${count} ${t("bloqueios nos últimos 15 min", "lockouts in last 15 min")}`,
              });
            }
            for (const [ip2, users] of multiUserIPs) {
              alerts.push({
                id: `multiip-${ip2}`,
                severity: users.size >= 4 ? "critical" : "high",
                title: t("IP com múltiplos usuários bloqueados", "IP locking multiple users"),
                detail: ip2,
                meta: `${users.size} ${t("usuários afetados na última hora", "users affected in last hour")}`,
              });
            }
            for (const [u, srcs] of multiSrcUsers) {
              alerts.push({
                id: `multisrc-${u}`,
                severity: "medium",
                title: t("Bloqueio em múltiplas origens", "Multi-source lockout"),
                detail: u,
                meta: `${[...srcs].join(", ")} — ${t("últimos 30 min", "last 30 min")}`,
              });
            }
            for (const [evCode2, count] of hotCodes) {
              alerts.push({
                id: `code-${evCode2}`,
                severity: "medium",
                title: t("Código de erro recorrente", "Recurring error code"),
                detail: evCode2,
                meta: `${count} ${t("ocorrências na última hora", "occurrences in last hour")}`,
              });
            }

            const sevOrder = { critical: 0, high: 1, medium: 2 };
            alerts.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);

            const sevStyle: Record<string, { border: string; bg: string; badge: string; label: string }> = {
              critical: { border: "#e53e3e", bg: "rgba(229,62,62,0.07)", badge: "rgba(229,62,62,0.15)", label: t("Crítico", "Critical") },
              high:     { border: "#dd6b20", bg: "rgba(221,107,32,0.07)", badge: "rgba(221,107,32,0.15)", label: t("Alto", "High") },
              medium:   { border: "#d69e2e", bg: "rgba(214,158,46,0.07)", badge: "rgba(214,158,46,0.15)", label: t("Médio", "Medium") },
            };

            return (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
                  <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: c.text }}>{t("Alertas ativos", "Active alerts")}</h3>
                  {alerts.length > 0 && (
                    <span style={{ fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 20, background: "rgba(229,62,62,0.15)", color: "#e53e3e" }}>
                      {alerts.length} {t("detectado(s)", "detected")}
                    </span>
                  )}
                </div>

                {alerts.length === 0 ? (
                  <div style={{ background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 12, padding: "40px 24px", textAlign: "center" }}>
                    <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.4 }}>✓</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: c.text, marginBottom: 6 }}>{t("Nenhum alerta detectado", "No alerts detected")}</div>
                    <div style={{ fontSize: 13, color: c.muted }}>{t("Nenhuma anomalia nos dados do período selecionado.", "No anomalies found in data for the selected period.")}</div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {alerts.map((al) => {
                      const s = sevStyle[al.severity];
                      return (
                        <div key={al.id} style={{
                          display: "flex", alignItems: "center", gap: 14,
                          background: s.bg,
                          border: `1px solid ${s.border}44`,
                          borderLeft: `3px solid ${s.border}`,
                          borderRadius: 10, padding: "14px 18px",
                        }}>
                          <span style={{
                            fontSize: 10, fontWeight: 800, letterSpacing: "0.07em",
                            textTransform: "uppercase", padding: "3px 9px",
                            borderRadius: 6, background: s.badge, color: s.border,
                            flexShrink: 0, minWidth: 56, textAlign: "center",
                          }}>{s.label}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, color: c.muted, marginBottom: 2, fontWeight: 500 }}>{al.title}</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: c.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{al.detail}</div>
                          </div>
                          <div style={{ fontSize: 12, color: c.muted, textAlign: "right", flexShrink: 0, whiteSpace: "nowrap" }}>{al.meta}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {selected && (
            <div onClick={() => setSelected(null)} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,0.45)", display: "grid", placeItems: "center", zIndex: 9999 }}>
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: c.cardBg,
                  color: c.text,
                  border: `1px solid ${c.border}`,
                  borderRadius: 12,
                  width: "min(980px,95vw)",
                  maxHeight: "80vh",
                  overflow: "auto",
                  padding: 18,
                }}
              >
                <h3 style={{ marginTop: 0, color: c.text }}>{t("Detalhes do evento", "Event details")}</h3>
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    fontSize: 13,
                    lineHeight: 1.45,
                    background: c.inputBg,
                    color: c.text,
                    border: `1px solid ${c.border}`,
                    borderRadius: 10,
                    padding: 12,
                    overflowX: "auto",
                  }}
                >
                  {JSON.stringify(selected, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
