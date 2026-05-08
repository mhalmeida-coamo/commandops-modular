import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5101,
    proxy: {
      "/api": { target: "http://localhost:8091", changeOrigin: true },
    },
  },
  build: {
    target: "esnext",
    outDir: "dist",
  },
});
