import { useEffect, useState } from "react";
import type { ModuleManifest } from "../types";

type ModulesState = {
  modules: ModuleManifest[];
  loading: boolean;
  error: string | null;
};

export function useModules(token: string | null): ModulesState {
  const [state, setState] = useState<ModulesState>({
    modules: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!token) {
      setState({ modules: [], loading: false, error: null });
      return;
    }

    let cancelled = false;

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
          setState({ modules: sorted, loading: false, error: null });
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setState({ modules: [], loading: false, error: err.message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  return state;
}
