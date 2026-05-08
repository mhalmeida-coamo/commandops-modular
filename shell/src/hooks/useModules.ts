import { useCallback, useEffect, useRef, useState } from "react";
import type { ModuleManifest } from "../types";

const POLL_MS = 30_000;

type ModulesState = {
  modules: ModuleManifest[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

export function useModules(token: string | null): ModulesState {
  const [refreshNonce, setRefreshNonce] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [state, setState] = useState<ModulesState>({
    modules: [],
    loading: true,
    error: null,
    refresh: () => undefined,
  });

  const refresh = useCallback(() => setRefreshNonce((v) => v + 1), []);

  useEffect(() => {
    if (!token) {
      setState((prev) => ({ ...prev, modules: [], loading: false, error: null, refresh }));
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null, refresh }));

    async function fetchModules() {
      try {
        const r = await fetch("/registry/modules");
        if (!r.ok) throw new Error(`Registry returned ${r.status}`);
        const all = (await r.json()) as ModuleManifest[];

        if (!cancelled) {
          const visible = all
            .filter((m) => m.health !== "danger")
            .sort((a, b) =>
              a.section !== b.section
                ? a.section.localeCompare(b.section)
                : a.name.localeCompare(b.name)
            );
          setState({ modules: visible, loading: false, error: null, refresh });
        }
      } catch (err) {
        if (!cancelled) {
          setState({ modules: [], loading: false, error: (err as Error).message, refresh });
        }
      }
    }

    fetchModules();

    timerRef.current = setInterval(() => {
      if (!cancelled) fetchModules();
    }, POLL_MS);

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [token, refresh, refreshNonce]);

  return state;
}
