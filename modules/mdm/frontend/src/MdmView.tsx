import { useEffect, useRef, useState, useCallback } from "react";
import "./mdm.css";

type AppLanguage = "pt-BR" | "en-US";
type Props = { token: string; isAdmin?: boolean; language?: AppLanguage; theme?: "light" | "dark" };

function t(lang: AppLanguage | undefined, ptBr: string, enUs: string) {
  return lang === "en-US" ? enUs : ptBr;
}

async function apiRequest<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

type DeviceGroup = {
  ReferenceId: string;
  Name: string;
  Path: string;
  Kind?: string;
};

type LicenseHistoryItem = {
  id: number;
  collected_at: string;
  purchased: number;
  used: number;
  available: number;
};

function toIsoDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

type LicenseSummary = {
  purchased: number;
  used_android: number;
  available: number;
  limit: number;
  below_limit: boolean;
};

type LicenseRaw = {
  RegistrationCode?: string;
  ExpiryDate?: string;
  PurchasedLicenses?: number;
  UsedLicenses?: {
    Android?: number;
    Apple?: number;
    WindowsCE?: number;
    WindowsDesktop?: number;
    WindowsModern?: number;
    Linux?: number;
    Chrome?: number;
  };
  UsedDeploymentServers?: number;
  PurchasedServers?: number;
  LastActivationDate?: string;
  ProductVersion?: string;
  LicenseType?: string;
  LicenseState?: string;
};

type LicenseResponse = { raw: LicenseRaw; summary: LicenseSummary };

type MdmCfg = {
  baseUrl: string;
  username: string;
  password: string;
  clientId: string;
  clientSecret: string;
  licenseLimit: number | string;
  alertRecipients: string;
  emailSubject: string;
  alertEnabled: boolean;
  alertCronHour: number | string;
  alertCronMinute: number | string;
  alertTimezone: string;
};

const MASK_PREFIX = "__MASKED__:";
const isMasked = (v: unknown) => typeof v === "string" && v.startsWith(MASK_PREFIX);
const maskDisplay = (v: unknown) => (isMasked(v) ? "" : String(v ?? ""));
const maskPlaceholder = (v: unknown) => (isMasked(v) ? "••••••••" : "");

function formatDate(value?: string, lang?: AppLanguage) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(lang === "en-US" ? "en-US" : "pt-BR");
}

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ─── Device Group Filter ──────────────────────────────────────────────────────

type DeviceGroupFilterProps = {
  groups: DeviceGroup[];
  selected: DeviceGroup | null;
  onSelect: (g: DeviceGroup | null) => void;
  placeholder?: string;
  language?: AppLanguage;
  theme?: "light" | "dark";
};

function DeviceGroupFilter({ groups, selected, onSelect, placeholder, language, theme }: DeviceGroupFilterProps) {
  placeholder = placeholder ?? t(language, "Todos os grupos", "All groups");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const dark = theme !== "light";

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const filtered = groups.filter(
    (g) =>
      g.Name.toLowerCase().includes(search.toLowerCase()) ||
      g.Path.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div ref={ref} style={{ position: "relative", minWidth: 180 }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "5px 10px", borderRadius: 8,
          border: "1px solid var(--panel-border-strong)",
          background: "var(--bg-tertiary)", cursor: "pointer",
          fontSize: 13, userSelect: "none",
        }}
        onClick={() => { setOpen((o) => !o); setSearch(""); }}
      >
        <span style={{ flex: 1, color: selected ? "var(--text)" : "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }}>
          {selected ? selected.Name : placeholder}
        </span>
        {selected && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSelect(null); }}
            style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0, lineHeight: 1, fontSize: 14 }}
            title={t(language, "Limpar", "Clear")}
          >×</button>
        )}
        <svg viewBox="0 0 12 8" width={10} fill="none" stroke="currentColor" strokeWidth={1.5} style={{ color: "var(--muted)", flexShrink: 0, transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }}>
          <path d="M1 1l5 5 5-5" strokeLinecap="round" />
        </svg>
      </div>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, minWidth: 240,
          background: "var(--bg-secondary)", border: "1px solid var(--border)",
          borderRadius: 8, boxShadow: dark ? "0 8px 24px rgba(0,0,0,0.45)" : "0 8px 24px rgba(15,23,42,0.12)",
          zIndex: 200, overflow: "hidden",
        }}>
          <div style={{ padding: "8px 8px 4px" }}>
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t(language, "Pesquisar grupo…", "Search group…")}
              style={{
                width: "100%", background: "var(--bg-tertiary)",
                border: "1px solid var(--border)", borderRadius: 6,
                padding: "5px 8px", fontSize: 12, color: "var(--text)",
                outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ maxHeight: 240, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--muted)" }}>
                {t(language, "Nenhum grupo encontrado", "No groups found")}
              </div>
            ) : (
              filtered.map((g) => (
                <div
                  key={g.ReferenceId}
                  onClick={() => { onSelect(g); setOpen(false); setSearch(""); }}
                  style={{
                    padding: "7px 12px", cursor: "pointer", fontSize: 13,
                    color: selected?.ReferenceId === g.ReferenceId ? "var(--accent)" : "var(--text)",
                    background: selected?.ReferenceId === g.ReferenceId ? "rgba(74,158,255,0.1)" : "transparent",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--shell-sidebar-hover)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = selected?.ReferenceId === g.ReferenceId ? "rgba(74,158,255,0.1)" : "transparent"; }}
                  title={g.Path}
                >{g.Name}</div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── License Chart (area + stacked bar) ──────────────────────────────────────

type Period = "7" | "30" | "90";
type ChartType = "area" | "bar";

const AREA_SERIES = [
  { key: "purchased" as const, color: "#4a9eff", gradId: "grad-mdm-p" },
  { key: "used"      as const, color: "#e05252", gradId: "grad-mdm-u" },
  { key: "available" as const, color: "#4caf7d", gradId: "grad-mdm-a" },
] as const;

const BAR_SERIES = [
  { key: "used"      as const, color: "#e05252" },
  { key: "available" as const, color: "#4caf7d" },
] as const;

function smoothLinePath(pts: [number, number][]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0][0]} ${pts[0][1]}`;
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1];
    const [x2, y2] = pts[i];
    const cx = (x1 + x2) / 2;
    d += ` C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
  }
  return d;
}

function btnStyle(active: boolean) {
  return {
    display: "flex", alignItems: "center", gap: 5,
    fontSize: 12, padding: "4px 12px", borderRadius: 7, border: "1px solid",
    cursor: "pointer" as const,
    borderColor: active ? "var(--border)" : "var(--panel-border-strong)",
    background: active ? "var(--bg-tertiary)" : "transparent",
    color: active ? "var(--text)" : "var(--muted)",
    fontWeight: active ? 600 : 400,
    transition: "all 0.15s",
  };
}

function LicenseChart({
  history,
  language,
  theme,
  onOpenExport,
}: {
  history: LicenseHistoryItem[];
  language?: AppLanguage;
  theme?: "light" | "dark";
  onOpenExport?: () => void;
}) {
  const dark = theme !== "light";
  const [period, setPeriod] = useState<Period>("30");
  const [chartType, setChartType] = useState<ChartType>("area");
  const [hovered, setHovered] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const seriesLabel = (key: string) => {
    if (key === "purchased") return t(language, "Compradas", "Purchased");
    if (key === "used") return t(language, "Em Uso", "In Use");
    return t(language, "Disponíveis", "Available");
  };
  const periodLabels: [Period, string][] = [
    ["7",  t(language, "7 dias",  "7 days")],
    ["30", t(language, "30 dias", "30 days")],
    ["90", t(language, "90 dias", "90 days")],
  ];
  const chartTypes: [ChartType, string, string][] = [
    ["area", t(language, "Área",   "Area"),  "M2 14 C4 8 7 4 10 6 C13 8 15 3 18 5 L18 18 L2 18Z"],
    ["bar",  t(language, "Barras", "Bars"),  "M2 18V8h4v10M8 18V4h4v14M14 18V10h4v8"],
  ];

  const data = history.slice(-parseInt(period));
  const n = data.length;
  const W = 960, H = 240;
  const PAD = { t: 16, r: 20, b: 36, l: 52 };
  const cW = W - PAD.l - PAD.r;
  const cH = H - PAD.t - PAD.b;
  const maxVal = Math.max(...data.map((d) => d.purchased), 1);
  const yMax = Math.ceil((maxVal * 1.1) / 10) * 10;
  const sy = (v: number) => PAD.t + cH - (v / yMax) * cH;
  const bottom = PAD.t + cH;
  const sx = (i: number) => (n <= 1 ? PAD.l + cW / 2 : PAD.l + (i / (n - 1)) * cW);
  const makeArea = (vals: number[]) => {
    const pts: [number, number][] = vals.map((v, i) => [sx(i), sy(v)]);
    const line = smoothLinePath(pts);
    return `${line} L ${sx(n - 1)} ${bottom} L ${sx(0)} ${bottom} Z`;
  };
  const barSlot = n > 1 ? cW / n : cW;
  const barW = Math.max(4, barSlot * 0.68);
  const bx = (i: number) => PAD.l + barSlot * i + barSlot / 2;

  const xTickIndices = (() => {
    if (n <= 1) return [0];
    const maxTicks = chartType === "bar" ? Math.min(n, 12) : 8;
    const step = Math.max(Math.floor(n / maxTicks), 1);
    const idx: number[] = [];
    for (let i = 0; i < n; i += step) idx.push(i);
    if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
    return idx;
  })();

  const activeSeries = (chartType === "area" ? AREA_SERIES : BAR_SERIES) as readonly { key: string; color: string }[];

  const clientToSvgX = useCallback((clientX: number): number => {
    if (!svgRef.current) return 0;
    const rect = svgRef.current.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * W;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (n === 0) return;
    const svgX = clientToSvgX(e.clientX);
    if (chartType === "area") {
      let nearest = 0;
      let minDist = Infinity;
      for (let i = 0; i < n; i++) {
        const dist = Math.abs(sx(i) - svgX);
        if (dist < minDist) { minDist = dist; nearest = i; }
      }
      setHovered(nearest);
    } else {
      let found: number | null = null;
      for (let i = 0; i < n; i++) {
        const x = bx(i) - barW / 2;
        if (svgX >= x && svgX <= x + barW) { found = i; break; }
      }
      setHovered(found);
    }
  }, [n, chartType, clientToSvgX, sx, bx, barW]);

  const renderTooltip = () => {
    if (hovered === null || hovered >= n) return null;
    const d = data[hovered];
    const tx = chartType === "area" ? sx(hovered) : bx(hovered);
    const tooltipW = 148;
    const tooltipH = chartType === "area" ? 82 : 62;
    const pad = 10;
    const tooltipX = tx + 14 + tooltipW > W - PAD.r ? tx - 14 - tooltipW : tx + 14;
    const tooltipY = PAD.t + 4;
    const dateStr = new Date(d.collected_at).toLocaleDateString(language === "en-US" ? "en-US" : "pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

    return (
      <g style={{ pointerEvents: "none" }}>
        {chartType === "area" && (
          <line x1={tx} x2={tx} y1={PAD.t} y2={bottom} stroke={dark ? "rgba(255,255,255,0.18)" : "var(--border)"} strokeWidth={1} strokeDasharray="4 3" />
        )}
        {chartType === "bar" && (
          <rect x={bx(hovered) - barW / 2 - 2} y={PAD.t} width={barW + 4} height={cH} fill={dark ? "rgba(255,255,255,0.05)" : "var(--bg-tertiary)"} rx={2} />
        )}
        {chartType === "area" && AREA_SERIES.map(({ key, color }) => (
          <circle key={key} cx={tx} cy={sy(d[key])} r={4} fill={color} stroke={dark ? "#151c2e" : "var(--bg-secondary)"} strokeWidth={1.5} />
        ))}
        <rect x={tooltipX} y={tooltipY} width={tooltipW} height={tooltipH} fill={dark ? "#1a2133" : "var(--bg-secondary)"} stroke={dark ? "rgba(255,255,255,0.18)" : "var(--border)"} strokeWidth={1} rx={7} style={{ filter: dark ? "drop-shadow(0 4px 12px rgba(0,0,0,0.5))" : "drop-shadow(0 4px 12px rgba(15,23,42,0.12))" }} />
        <text x={tooltipX + pad} y={tooltipY + 16} fontSize={10} style={{ fill: "var(--muted)" }}>{dateStr}</text>
        {chartType === "area" ? (
          <>
            <text x={tooltipX + pad} y={tooltipY + 34} fontSize={11} fill="#4a9eff">{seriesLabel("purchased") + ": "}<tspan fontWeight="600">{d.purchased}</tspan></text>
            <text x={tooltipX + pad} y={tooltipY + 52} fontSize={11} fill="#e05252">{seriesLabel("used") + ": "}<tspan fontWeight="600">{d.used}</tspan></text>
            <text x={tooltipX + pad} y={tooltipY + 68} fontSize={11} fill="#4caf7d">{seriesLabel("available") + ": "}<tspan fontWeight="600">{d.available}</tspan></text>
          </>
        ) : (
          <>
            <text x={tooltipX + pad} y={tooltipY + 34} fontSize={11} fill="#e05252">{seriesLabel("used") + ": "}<tspan fontWeight="600">{d.used}</tspan></text>
            <text x={tooltipX + pad} y={tooltipY + 52} fontSize={11} fill="#4caf7d">{seriesLabel("available") + ": "}<tspan fontWeight="600">{d.available}</tspan></text>
          </>
        )}
      </g>
    );
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {activeSeries.map(({ color, key }) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)" }}>
              {chartType === "area"
                ? <div style={{ width: 24, height: 2.5, borderRadius: 2, background: color }} />
                : <div style={{ width: 12, height: 12, borderRadius: 2, background: color }} />}
              {seriesLabel(key)}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 2, background: "var(--bg-tertiary)", borderRadius: 8, padding: 2 }}>
            {chartTypes.map(([type, label, iconPath]) => (
              <button key={type} type="button" onClick={() => setChartType(type)} style={btnStyle(chartType === type)}>
                <svg viewBox="0 0 20 20" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                  <path d={iconPath} />
                </svg>
                {label}
              </button>
            ))}
          </div>
          <div style={{ width: 1, height: 20, background: "var(--border)" }} />
          {periodLabels.map(([p, lbl]) => (
            <button key={p} type="button" onClick={() => setPeriod(p)} style={btnStyle(period === p)}>{lbl}</button>
          ))}
          <button type="button" onClick={onOpenExport} style={btnStyle(false)}>
            {t(language, "Exportar CSV", "Export CSV")}
          </button>
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block", cursor: "crosshair" }}
        aria-label={t(language, "Gráfico de histórico de licenças MDM", "MDM license history chart")}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHovered(null)}
      >
        <defs>
          {AREA_SERIES.map(({ color, gradId }) => (
            <linearGradient key={gradId} id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          ))}
        </defs>
        {[0.25, 0.5, 0.75, 1].map((frac) => {
          const y = PAD.t + cH - frac * cH;
          const v = Math.round(frac * yMax);
          return (
            <g key={frac}>
              <line x1={PAD.l} x2={PAD.l + cW} y1={y} y2={y} stroke={dark ? "rgba(255,255,255,0.05)" : "var(--border)"} />
              <text x={PAD.l - 6} y={y + 4} textAnchor="end" fontSize={10} style={{ fill: "var(--muted)" }}>{v}</text>
            </g>
          );
        })}
        {chartType === "area" && (
          <>
            {AREA_SERIES.map(({ key, gradId }) => (
              <path key={key} d={makeArea(data.map((d) => d[key]))} fill={`url(#${gradId})`} />
            ))}
            {AREA_SERIES.map(({ key, color }) => (
              <path key={key} d={smoothLinePath(data.map((d, i) => [sx(i), sy(d[key])]))} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
            ))}
            {xTickIndices.map((i) => (
              <text key={i} x={sx(i)} y={bottom + 16} textAnchor="middle" fontSize={10} style={{ fill: "var(--muted)" }}>
                {formatDateShort(data[i].collected_at)}
              </text>
            ))}
          </>
        )}
        {chartType === "bar" && (
          <>
            {data.map((d, i) => {
              const usedH  = (d.used      / yMax) * cH;
              const availH = (d.available / yMax) * cH;
              const x = bx(i) - barW / 2;
              const isHov = hovered === i;
              return (
                <g key={i}>
                  <rect x={x} y={bottom - usedH} width={barW} height={usedH} fill="#e05252" opacity={isHov ? 1 : 0.85} rx={usedH > 3 ? 1 : 0} />
                  <rect x={x} y={bottom - usedH - availH} width={barW} height={availH} fill="#4caf7d" opacity={isHov ? 0.95 : 0.75} rx={availH > 3 ? 1 : 0} />
                </g>
              );
            })}
            {xTickIndices.map((i) => (
              <text key={i} x={bx(i)} y={bottom + 16} textAnchor="middle" fontSize={10} style={{ fill: "var(--muted)" }}>
                {formatDateShort(data[i].collected_at)}
              </text>
            ))}
          </>
        )}
        <rect x={PAD.l} y={PAD.t} width={cW} height={cH} fill="transparent" />
        {renderTooltip()}
      </svg>
    </div>
  );
}

// ─── Settings Modal ───────────────────────────────────────────────────────────

const DEFAULT_CFG: MdmCfg = {
  baseUrl: "https://coamo.mdmcloud.com.br",
  username: "",
  password: "",
  clientId: "",
  clientSecret: "",
  licenseLimit: 15,
  alertRecipients: "",
  emailSubject: "",
  alertEnabled: true,
  alertCronHour: 11,
  alertCronMinute: 0,
  alertTimezone: "America/Sao_Paulo",
};

type SettingsModalProps = { token: string; onClose: () => void; language?: AppLanguage };

function SettingsModal({ token, onClose, language }: SettingsModalProps) {
  const [cfg, setCfg] = useState<MdmCfg>(DEFAULT_CFG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiRequest<MdmCfg>("/api/mdm/settings", token)
      .then((data) => setCfg({ ...DEFAULT_CFG, ...data }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      await apiRequest("/api/mdm/settings", token, { method: "POST", body: JSON.stringify(cfg) });
      setMsg({ text: t(language, "Configurações salvas com sucesso.", "Settings saved successfully."), ok: true });
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : t(language, "Erro ao salvar.", "Error saving."), ok: false });
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmail = async () => {
    setTesting(true);
    setMsg(null);
    try {
      const res = await apiRequest<{ message: string }>("/api/mdm/test-email", token, { method: "POST" });
      setMsg({ text: res.message || t(language, "E-mail de teste enviado.", "Test email sent."), ok: true });
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : t(language, "Erro ao enviar e-mail de teste.", "Error sending test email."), ok: false });
    } finally {
      setTesting(false);
    }
  };

  const set = (key: keyof MdmCfg) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setCfg((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <div className="mdm-modal-backdrop" ref={backdropRef} onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}>
      <div className="mdm-modal" role="dialog" aria-modal="true" aria-label={t(language, "Configurações MDM", "MDM Settings")}>
        <div className="mdm-modal-header">
          <h3>{t(language, "Configurações MDM", "MDM Settings")}</h3>
          <button className="mdm-modal-close" onClick={onClose} aria-label={t(language, "Fechar", "Close")}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M5 5l10 10M15 5 5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="mdm-modal-loading">{t(language, "Carregando configurações…", "Loading settings…")}</div>
        ) : (
          <form className="mdm-modal-body" onSubmit={handleSave}>
            <fieldset className="mdm-fieldset">
              <legend>{t(language, "Credenciais da API MobiControl", "MobiControl API Credentials")}</legend>
              <div className="mdm-form-row">
                <label>
                  Base URL
                  <input className="input" value={maskDisplay(cfg.baseUrl)} placeholder={maskPlaceholder(cfg.baseUrl) || "https://coamo.mdmcloud.com.br"} onChange={set("baseUrl")} />
                </label>
                <label>
                  {t(language, "Usuário", "User")}
                  <input className="input" value={maskDisplay(cfg.username)} placeholder={maskPlaceholder(cfg.username) || "testeapi"} onChange={set("username")} />
                </label>
              </div>
              <div className="mdm-form-row">
                <label>
                  {t(language, "Senha", "Password")}
                  <input className="input" type="password" value={maskDisplay(cfg.password)} placeholder={maskPlaceholder(cfg.password) || "••••••••"} onChange={set("password")} autoComplete="new-password" />
                </label>
                <label>
                  Client ID
                  <input className="input" value={maskDisplay(cfg.clientId)} placeholder={maskPlaceholder(cfg.clientId)} onChange={set("clientId")} />
                </label>
              </div>
              <div className="mdm-form-row">
                <label style={{ gridColumn: "1 / -1" }}>
                  Client Secret
                  <input className="input" type="password" value={maskDisplay(cfg.clientSecret)} placeholder={maskPlaceholder(cfg.clientSecret) || "••••••••"} onChange={set("clientSecret")} autoComplete="new-password" />
                </label>
              </div>
            </fieldset>

            <fieldset className="mdm-fieldset">
              <legend>{t(language, "Alerta de Licenças", "License Alert")}</legend>
              <div className="mdm-form-row">
                <label>
                  {t(language, "Limite de licenças disponíveis", "Available licenses limit")}
                  <input className="input" type="number" min={0} value={cfg.licenseLimit ?? 15} onChange={(e) => setCfg((p) => ({ ...p, licenseLimit: Number(e.target.value) || 0 }))} />
                </label>
                <label>
                  {t(language, "Assunto do e-mail", "Email subject")}
                  <input className="input" value={cfg.emailSubject || ""} placeholder={t(language, "ALERTA – Licenças MDM abaixo do limite", "ALERT – MDM licenses below limit")} onChange={set("emailSubject")} />
                </label>
              </div>
              <div className="mdm-form-row">
                <label style={{ gridColumn: "1 / -1" }}>
                  {t(language, "Destinatários (separados por vírgula)", "Recipients (comma-separated)")}
                  <input className="input" value={cfg.alertRecipients || ""} placeholder="email1@coamo.com.br, email2@coamo.com.br" onChange={set("alertRecipients")} />
                </label>
              </div>
            </fieldset>

            <fieldset className="mdm-fieldset">
              <legend>{t(language, "Agendamento da coleta diária", "Daily collection schedule")}</legend>
              <div className="mdm-form-row" style={{ alignItems: "center" }}>
                <label style={{ flexDirection: "row", alignItems: "center", gap: 10, cursor: "pointer" }}>
                  <input type="checkbox" checked={cfg.alertEnabled ?? true} onChange={(e) => setCfg((p) => ({ ...p, alertEnabled: e.target.checked }))} style={{ width: 16, height: 16, cursor: "pointer" }} />
                  {t(language, "Alerta por e-mail habilitado", "Email alert enabled")}
                </label>
              </div>
              <div className="mdm-form-row">
                <label>
                  {t(language, "Hora (0–23)", "Hour (0–23)")}
                  <input className="input" type="number" min={0} max={23} value={cfg.alertCronHour ?? 11} onChange={(e) => setCfg((p) => ({ ...p, alertCronHour: Number(e.target.value) }))} />
                </label>
                <label>
                  {t(language, "Minuto (0–59)", "Minute (0–59)")}
                  <input className="input" type="number" min={0} max={59} value={cfg.alertCronMinute ?? 0} onChange={(e) => setCfg((p) => ({ ...p, alertCronMinute: Number(e.target.value) }))} />
                </label>
              </div>
              <div className="mdm-form-row">
                <label style={{ gridColumn: "1 / -1" }}>
                  {t(language, "Fuso horário", "Timezone")}
                  <input className="input" value={cfg.alertTimezone || ""} placeholder="America/Sao_Paulo" onChange={set("alertTimezone")} />
                </label>
              </div>
              <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0" }}>
                {t(language,
                  "A coleta de dados ocorre diariamente no horário configurado. O e-mail só é enviado quando o alerta está habilitado e as licenças disponíveis ficam abaixo do limite.",
                  "Data is collected daily at the configured time. The email is only sent when the alert is enabled and available licenses fall below the limit."
                )}
              </p>
            </fieldset>

            {msg && <p className={`mdm-modal-msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</p>}

            <div className="mdm-modal-footer">
              <button type="submit" className="button primary" disabled={saving}>
                {saving ? t(language, "Salvando…", "Saving…") : t(language, "Salvar", "Save")}
              </button>
              <button type="button" className="button secondary" onClick={handleTestEmail} disabled={testing || saving}>
                {testing ? t(language, "Enviando…", "Sending…") : t(language, "Testar envio de e-mail", "Test email sending")}
              </button>
              <button type="button" className="button secondary" onClick={onClose}>
                {t(language, "Fechar", "Close")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export function MdmView({ token, isAdmin = false, language, theme }: Props) {
  const [data, setData] = useState<LicenseResponse | null>(null);
  const [history, setHistory] = useState<LicenseHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportFrom, setExportFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 89); return toIsoDateInput(d);
  });
  const [exportTo, setExportTo] = useState(() => toIsoDateInput(new Date()));
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<DeviceGroup | null>(null);
  const [selectedSubGroup, setSelectedSubGroup] = useState<DeviceGroup | null>(null);
  const [groupUsed, setGroupUsed] = useState<number | null>(null);
  const [groupCountLoading, setGroupCountLoading] = useState(false);

  const fetchLicense = async (): Promise<void> => {
    try {
      const response = await apiRequest<LicenseResponse>("/api/mdm/license", token);
      setData(response);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t(language, "Erro ao carregar dados da licença", "Error loading license data"));
    }
  };

  const fetchHistory = async (): Promise<void> => {
    try {
      const response = await apiRequest<LicenseHistoryItem[]>("/api/mdm/license/history", token);
      setHistory(Array.isArray(response) ? response : []);
    } catch { /* non-critical */ }
  };

  const fetchGroups = async (): Promise<void> => {
    try {
      const response = await apiRequest<DeviceGroup[]>("/api/mdm/devicegroups", token);
      setGroups(Array.isArray(response) ? response : []);
    } catch { /* non-critical */ }
  };

  const fetchGroupDeviceCount = async (groupPath: string): Promise<void> => {
    setGroupCountLoading(true);
    setGroupUsed(null);
    try {
      const res = await apiRequest<{ count: number }>(`/api/mdm/groups/device-count?group_path=${encodeURIComponent(groupPath)}`, token);
      setGroupUsed(typeof res.count === "number" ? res.count : null);
    } catch {
      setGroupUsed(null);
    } finally {
      setGroupCountLoading(false);
    }
  };

  const handleGroupSelect = (g: DeviceGroup | null) => {
    setSelectedGroup(g);
    setSelectedSubGroup(null);
    setGroupUsed(null);
    if (g) void fetchGroupDeviceCount(g.Path);
  };

  const handleSubGroupSelect = (g: DeviceGroup | null) => {
    setSelectedSubGroup(g);
    setGroupUsed(null);
    if (g) void fetchGroupDeviceCount(g.Path);
    else if (selectedGroup) void fetchGroupDeviceCount(selectedGroup.Path);
  };

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchLicense(), fetchHistory()]);
    setRefreshing(false);
  };

  const exportHistoryCsv = async () => {
    if (!exportFrom || !exportTo) {
      setExportError(t(language, "Selecione as duas datas.", "Select both dates.")); return;
    }
    if (exportFrom > exportTo) {
      setExportError(t(language, "A data inicial deve ser menor ou igual à final.", "Start date must be before or equal to end date.")); return;
    }
    setExportError(null);
    setExporting(true);
    try {
      const qs = new URLSearchParams({ start_date: exportFrom, end_date: exportTo }).toString();
      const rows = await apiRequest<LicenseHistoryItem[]>(`/api/mdm/license/history?${qs}`, token);
      const list = Array.isArray(rows) ? rows : [];
      const header = ["Data coleta", "Compradas", "Em uso", "Disponiveis"];
      const body = list.map((item) => [
        item.collected_at ? new Date(item.collected_at).toLocaleDateString(language === "en-US" ? "en-US" : "pt-BR") : "",
        String(item.purchased ?? ""), String(item.used ?? ""), String(item.available ?? ""),
      ]);
      const csv = [header, ...body].map((cols) => cols.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
      const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const [fromYear, fromMonth, fromDay] = exportFrom.split("-");
      const [toYear, toMonth, toDay] = exportTo.split("-");
      const windowLabel =
        fromMonth === toMonth && fromYear === toYear
          ? `${fromDay}-${toDay}/${fromMonth}/${fromYear}`
          : `${fromDay}/${fromMonth}/${fromYear}-${toDay}/${toMonth}/${toYear}`;
      a.href = url;
      a.download = `consumo de licenças MDM ${windowLabel}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setShowExportModal(false);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : t(language, "Falha ao exportar CSV.", "Failed to export CSV."));
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchLicense(), fetchHistory(), fetchGroups()]).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div className="mdm-loading">{t(language, "Carregando dados da licença…", "Loading license data…")}</div>;

  if (error) {
    return (
      <div className="mdm-error">
        <p>{error}</p>
        <button className="button secondary" onClick={refresh} disabled={refreshing}>
          {refreshing ? t(language, "Tentando novamente…", "Retrying…") : t(language, "Tentar novamente", "Try again")}
        </button>
      </div>
    );
  }

  if (!data) return <div className="mdm-error">{t(language, "Nenhum dado encontrado", "No data found")}</div>;

  const { summary, raw } = data;
  const total = summary.purchased;
  const used = summary.used_android;
  const available = summary.available;

  const getPathDepth = (path: string) => path.split("\\").filter(Boolean).length;
  const minDepth = groups.length > 0 ? Math.min(...groups.map((g) => getPathDepth(g.Path))) : 1;
  const topLevelGroups = groups.filter((g) => getPathDepth(g.Path) === minDepth + 1);
  const subGroups = selectedGroup
    ? groups.filter((g) => {
        if (!g.Path.startsWith(selectedGroup.Path + "\\")) return false;
        const remainder = g.Path.slice(selectedGroup.Path.length + 1);
        return !remainder.includes("\\");
      })
    : [];

  const displayUsed = groupUsed !== null ? groupUsed : used;
  const displayAvailable = available;
  const percent = total > 0 ? Math.round((displayUsed / total) * 100) : 0;
  const isLow = summary.below_limit;

  return (
    <>
      {showSettings && (
        <SettingsModal token={token} onClose={() => setShowSettings(false)} language={language} />
      )}
      {showExportModal && (
        <div className="mdm-modal-backdrop" onClick={() => !exporting && setShowExportModal(false)}>
          <div className="mdm-modal" role="dialog" aria-modal="true" aria-label={t(language, "Exportar consumo de licenças MDM", "Export MDM license consumption")} onClick={(e) => e.stopPropagation()}>
            <div className="mdm-modal-header">
              <h3>{t(language, "Consumo de licenças MDM", "MDM license consumption")}</h3>
              <button className="mdm-modal-close" onClick={() => !exporting && setShowExportModal(false)} aria-label={t(language, "Fechar", "Close")} disabled={exporting} type="button">×</button>
            </div>
            <div className="mdm-modal-body">
              <div className="mdm-form-row">
                <label>
                  {t(language, "Data inicial", "Start date")}
                  <input className="input" type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} disabled={exporting} />
                </label>
                <label>
                  {t(language, "Data final", "End date")}
                  <input className="input" type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)} disabled={exporting} />
                </label>
              </div>
              {exportError && <p className="mdm-modal-msg err">{exportError}</p>}
              <div className="mdm-modal-footer">
                <button className="button secondary" onClick={() => setShowExportModal(false)} disabled={exporting} type="button">
                  {t(language, "Cancelar", "Cancel")}
                </button>
                <button className="button primary" onClick={exportHistoryCsv} disabled={exporting} type="button">
                  {exporting ? t(language, "Exportando…", "Exporting…") : t(language, "Exportar CSV", "Export CSV")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mdm-container">
        {isLow && (
          <div className="mdm-alert">
            ⚠️ {t(language, "Atenção! Restam apenas", "Warning! Only")} <strong>{available}</strong> {t(language, "licenças disponíveis (limite configurado:", "licenses available (configured limit:")} {summary.limit}).
          </div>
        )}

        <header className="mdm-header">
          <h3 className="mdm-section-title">{t(language, "Painel de Licenças MDM", "MDM License Panel")}</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <DeviceGroupFilter groups={topLevelGroups} selected={selectedGroup} onSelect={handleGroupSelect} language={language} theme={theme} />
            {subGroups.length > 0 && (
              <DeviceGroupFilter groups={subGroups} selected={selectedSubGroup} onSelect={handleSubGroupSelect} placeholder={t(language, "Todos os sub-grupos", "All sub-groups")} language={language} theme={theme} />
            )}
            {isAdmin && (
              <button className="button secondary mdm-settings-btn" onClick={() => setShowSettings(true)} title={t(language, "Configurações MDM", "MDM Settings")} type="button">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" style={{ width: 16, height: 16 }}>
                  <path d="M10 4.2v1.4M10 14.4v1.4M4.2 10H5.6M14.4 10h1.4M6 6l1 1M13 13l1 1M14 6l-1 1M7 13l-1 1" strokeLinecap="round" />
                  <circle cx="10" cy="10" r="2.6" />
                </svg>
                {t(language, "Configurações", "Settings")}
              </button>
            )}
            <button className="button primary" onClick={refresh} disabled={refreshing} type="button">
              {refreshing ? t(language, "Atualizando…", "Refreshing…") : t(language, "Atualizar agora", "Refresh now")}
            </button>
          </div>
        </header>

        <div className="mdm-stat-cards">
          <div className="mdm-stat-card">
            <h4>{t(language, "Compradas", "Purchased")}</h4>
            <div className="mdm-stat-value">{total}</div>
          </div>
          <div className="mdm-stat-card">
            <h4>{t(language, "Em Uso", "In Use")}</h4>
            <div className="mdm-stat-value">
              {groupCountLoading ? <span style={{ fontSize: 20, color: "var(--muted)" }}>…</span> : displayUsed}
            </div>
            {selectedGroup && (
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                {selectedSubGroup ? selectedSubGroup.Name : selectedGroup.Name}
              </div>
            )}
          </div>
          <div className="mdm-stat-card">
            <h4>{t(language, "Disponíveis", "Available")}</h4>
            <div className={`mdm-stat-value${isLow ? " danger" : ""}`}>
              {groupCountLoading ? <span style={{ fontSize: 20, color: "var(--muted)" }}>…</span> : displayAvailable}
            </div>
          </div>
        </div>

        <div className="mdm-grid">
          <div className="mdm-card">
            <h4>{t(language, "Informações da Licença", "License Information")}</h4>
            <p><strong>{t(language, "Tipo:", "Type:")}</strong>{" "}<span className={`mdm-chip ${raw.LicenseType === "Perpetual" ? "perpetual" : "standard"}`}>{raw.LicenseType || "—"}</span></p>
            <p><strong>{t(language, "Estado:", "Status:")}</strong>{" "}<span className={`mdm-chip ${raw.LicenseState === "Perpetual" ? "perpetual" : "standard"}`}>{raw.LicenseState || "—"}</span></p>
            <p><strong>{t(language, "Data de Expiração:", "Expiry Date:")}</strong><br />{formatDate(raw.ExpiryDate, language)}</p>
            <p><strong>{t(language, "Última Ativação:", "Last Activation:")}</strong><br />{formatDate(raw.LastActivationDate, language)}</p>
          </div>

          <div className="mdm-progress">
            <h4>{t(language, "Utilização de Licenças Android", "Android License Usage")}</h4>
            <div className="mdm-progress-meta">
              <div><strong>{t(language, "Usadas:", "Used:")}</strong> {displayUsed}</div>
              <div><strong>{t(language, "Total:", "Total:")}</strong> {total}</div>
              <div><strong>{t(language, "Disponíveis:", "Available:")}</strong> {displayAvailable}</div>
            </div>
            <div className="mdm-progress-bar">
              <div className={`mdm-progress-fill ${isLow ? "danger" : ""}`} style={{ width: `${Math.min(percent, 100)}%` }} />
            </div>
            <div className="mdm-progress-footer">{percent}% {t(language, "utilizado", "used")}</div>
          </div>
        </div>

        <div className="mdm-chart-section">
          <h4>{t(language, "Histórico Diário de Licenças", "Daily License History")}</h4>
          {history.length === 0 ? (
            <p className="mdm-chart-empty">
              {t(language,
                "Nenhum registro histórico disponível. Os dados são coletados automaticamente todos os dias no horário configurado.",
                "No historical records available. Data is collected automatically every day at the configured time."
              )}
            </p>
          ) : (
            <LicenseChart history={history} language={language} theme={theme} onOpenExport={() => { setExportError(null); setShowExportModal(true); }} />
          )}
        </div>
      </div>
    </>
  );
}
