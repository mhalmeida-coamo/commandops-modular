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

/**
 * Mapa de módulos conhecidos pelo shell.
 * Cada entrada usa import() estático resolvido pelo Vite em build time —
 * requisito do @originjs/vite-plugin-federation.
 * Adicionar um novo tipo de módulo = nova entrada aqui + declaração no vite.config.ts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MODULE_REGISTRY: Record<string, ComponentType<any>> = {};

const VpnModule = lazy(() =>
  // @ts-expect-error — remote declarado no vite.config.ts
  import("vpn_module/ModuleView").then((m: { default: ComponentType<ModuleProps> }) => ({
    default: m.default,
  }))
);
MODULE_REGISTRY["vpn"] = VpnModule;

export function ModuleLoader({ module: mod, moduleProps }: Props) {
  const RemoteComponent = MODULE_REGISTRY[mod.id];

  if (!RemoteComponent) {
    return (
      <div className="module-error">
        <h3>Módulo não suportado</h3>
        <p>O módulo "{mod.id}" não está registrado nesta versão do shell.</p>
      </div>
    );
  }

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
