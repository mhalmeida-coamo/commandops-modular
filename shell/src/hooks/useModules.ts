import { useCallback, useEffect, useState } from "react";
import type { ModuleManifest } from "../types";

type ModulesState = {
  modules: ModuleManifest[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

export function useModules(token: string | null): ModulesState {
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [state, setState] = useState<ModulesState>({
    modules: [],
    loading: true,
    error: null,
    refresh: () => undefined,
  });

  const refresh = useCallback(() => {
    setRefreshNonce((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!token) {
      setState((prev) => ({ ...prev, modules: [], loading: false, error: null, refresh }));
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null, refresh }));

    fetch("/registry/modules", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Registry returned ${r.status}`);
        return r.json() as Promise<ModuleManifest[]>;
      })
      .then((modules) => {
        if (!cancelled) {
          const sorted = [...modules]
            .filter((m) => m.status === "enabled")
            .sort((a, b) => a.nav_order - b.nav_order);
          setState({ modules: sorted, loading: false, error: null, refresh });
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setState({ modules: [], loading: false, error: err.message, refresh });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token, refresh, refreshNonce]);

  return state;
}
