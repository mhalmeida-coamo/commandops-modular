import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5000,
    proxy: {
      "/registry": {
        target: "http://localhost:9000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/registry/, ""),
      },
      "/api": {
        target: "http://localhost:38000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  build: {
    target: "esnext",
  },
});
