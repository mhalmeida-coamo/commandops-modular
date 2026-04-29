import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from "react";
import type { ModuleManifest, ModuleProps } from "../types";

type Props = {
  module: ModuleManifest;
  moduleProps: ModuleProps;
};

type ErrorState = { hasError: boolean; message: string };

class ModuleErrorBoundary extends Component<
  { children: ReactNode; moduleId: string },
  ErrorState
> {
  constructor(props: { children: ReactNode; moduleId: string }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(err: Error): ErrorState {
    return { hasError: true, message: err.message };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error(`[ModuleLoader] Module "${this.props.moduleId}" crashed:`, err, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="module-error">
          <h3>Módulo indisponível</h3>
          <p>O módulo "{this.props.moduleId}" encontrou um erro e foi isolado.</p>
          <p style={{ marginTop: 8, fontFamily: "var(--font-mono)", fontSize: 12 }}>
            {this.state.message}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

const moduleCache = new Map<string, React.ComponentType<ModuleProps>>();

function loadRemoteComponent(mod: ModuleManifest): React.ComponentType<ModuleProps> {
  if (moduleCache.has(mod.id)) {
    return moduleCache.get(mod.id)!;
  }

  const LazyComponent = lazy(async () => {
    const script = document.createElement("script");
    script.src = mod.remote_url;
    script.type = "module";

    await new Promise<void>((resolve, reject) => {
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load remote: ${mod.remote_url}`));
      document.head.appendChild(script);
    });

    const container = (window as Record<string, unknown>)[`${mod.id}_module`] as {
      get: (module: string) => Promise<() => { default: React.ComponentType<ModuleProps> }>;
      init: (shareScope: unknown) => Promise<void>;
    };

    if (!container) {
      throw new Error(`Remote container "${mod.id}_module" not found after loading script`);
    }

    await container.init(__webpack_share_scopes__?.default ?? {});
    const factory = await container.get("./ModuleView");
    const Module = factory();
    return { default: Module.default };
  });

  moduleCache.set(mod.id, LazyComponent);
  return LazyComponent;
}

declare const __webpack_share_scopes__: { default: unknown } | undefined;

export function ModuleLoader({ module: mod, moduleProps }: Props) {
  const RemoteComponent = loadRemoteComponent(mod);

  return (
    <ModuleErrorBoundary moduleId={mod.id}>
      <div className="module-frame">
        <Suspense
          fallback={
            <div className="module-loading">
              <span className="spinner" />
              <span>Carregando {mod.name}…</span>
            </div>
          }
        >
          <RemoteComponent {...moduleProps} />
        </Suspense>
      </div>
    </ModuleErrorBoundary>
  );
}
