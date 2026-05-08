import { useEffect, useRef } from "react";
import type { ModuleManifest, ModuleProps } from "../types";

type Props = {
  module: ModuleManifest;
  moduleProps: ModuleProps;
};

/** Protocolo postMessage enviado ao iframe quando ele sinalizar READY */
type InitMessage = {
  type: "COMMANDOPS_INIT";
  token: string;
  theme: string;
  language: string;
  user: ModuleProps["user"];
};

function PlaceholderCard({ mod }: { mod: ModuleManifest }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        height: "100%",
        padding: 40,
        color: "var(--muted)",
        textAlign: "center",
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ width: 48, height: 48, opacity: 0.4 }}
      >
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
      <div>
        <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4, color: "var(--foreground)" }}>
          {mod.name}
        </div>
        <div style={{ fontSize: 13 }}>
          Módulo em migração para arquitetura modular.
        </div>
        <div style={{ fontSize: 12, marginTop: 4, opacity: 0.6 }}>
          v{mod.version} · {mod.container}
        </div>
      </div>
    </div>
  );
}

export function ModuleLoader({ module: mod, moduleProps }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!mod.frontend_url) return;

    function handleMessage(event: MessageEvent) {
      if (event.data?.type !== "COMMANDOPS_READY") return;
      const msg: InitMessage = {
        type: "COMMANDOPS_INIT",
        token: moduleProps.token,
        theme: moduleProps.theme,
        language: moduleProps.language,
        user: moduleProps.user,
      };
      iframeRef.current?.contentWindow?.postMessage(msg, event.origin || "*");
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [mod.frontend_url, moduleProps]);

  if (!mod.frontend_url) {
    return <PlaceholderCard mod={mod} />;
  }

  return (
    <div className="module-frame">
      <iframe
        ref={iframeRef}
        src={mod.frontend_url}
        title={mod.name}
        style={{ width: "100%", flex: 1, border: "none", minHeight: 0 }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  );
}
