import {
  Component,
  lazy,
  Suspense,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from "react";
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

type RemoteContainer = {
  init: (scope: Record<string, unknown>) => Promise<void>;
  get: (module: string) => Promise<() => { default: ComponentType<ModuleProps> }>;
};

const moduleCache = new Map<string, ComponentType<ModuleProps>>();

function loadRemoteComponent(mod: ModuleManifest): ComponentType<ModuleProps> {
  if (moduleCache.has(mod.id)) {
    return moduleCache.get(mod.id)!;
  }

  const LazyComponent = lazy(async () => {
    // @originjs/vite-plugin-federation gera ES modules — import dinâmico direto
    const container = (await import(/* @vite-ignore */ mod.remote_url)) as RemoteContainer;

    if (!container?.get || !container?.init) {
      throw new Error(
        `remoteEntry inválido em "${mod.remote_url}" — não exporta get/init`
      );
    }

    // Escopo vazio: o remote usa seu próprio React bundled (singleton declarado no vite.config)
    await container.init({});

    const factory = await container.get("./ModuleView");
    const Module = factory();
    return { default: Module.default };
  });

  moduleCache.set(mod.id, LazyComponent);
  return LazyComponent;
}

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
