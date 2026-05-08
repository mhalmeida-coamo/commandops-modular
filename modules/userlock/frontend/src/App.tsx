import { useEffect, useState } from "react";
import { UserLockView } from "./UserLockView";

type AuthState = {
  token: string;
  theme: "light" | "dark";
  language: "pt-BR" | "en-US";
  user: { username: string; role: string; is_platform_admin: boolean };
};

export function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);

  useEffect(() => {
    window.parent.postMessage({ type: "COMMANDOPS_READY" }, "*");

    function handleInit(event: MessageEvent) {
      if (event.data?.type !== "COMMANDOPS_INIT") return;
      const { token, theme, language, user } = event.data as AuthState & { type: string };
      document.documentElement.dataset.theme = theme ?? "dark";
      setAuth({
        token,
        theme: theme ?? "dark",
        language: language ?? "pt-BR",
        user,
      });
    }

    window.addEventListener("message", handleInit);
    return () => window.removeEventListener("message", handleInit);
  }, []);

  if (!auth) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          color: "var(--muted)",
          fontSize: 14,
        }}
      >
        Aguardando autenticação…
      </div>
    );
  }

  return (
    <UserLockView
      token={auth.token}
      isEnabled={true}
      theme={auth.theme}
      language={auth.language}
    />
  );
}
