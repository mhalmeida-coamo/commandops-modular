import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import federation from "@originjs/vite-plugin-federation";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // URLs dos remotes — configuráveis por variável de ambiente
  const VPN_REMOTE = env.VITE_VPN_REMOTE || "http://localhost:5101/assets/remoteEntry.js";

  return {
    plugins: [
      react(),
      federation({
        name: "commandops_shell",
        remotes: {
          vpn_module: VPN_REMOTE,
        },
        shared: {
          react: { singleton: true, requiredVersion: "^18.0.0" },
          "react-dom": { singleton: true, requiredVersion: "^18.0.0" },
        },
      }),
    ],
    server: {
      port: 5000,
      proxy: {
        "/registry": {
          target: env.REGISTRY_URL || "http://localhost:5010",
          changeOrigin: true,
        },
        "/api": {
          target: env.GATEWAY_URL || "http://localhost:8080",
          changeOrigin: true,
        },
      },
    },
    build: {
      target: "esnext",
      modulePreload: false,
    },
  };
});
