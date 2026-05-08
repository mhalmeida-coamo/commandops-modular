import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5104,
    proxy: {
      "/api": { target: "http://localhost:8094", changeOrigin: true },
    },
  },
  build: {
    target: "esnext",
    outDir: "dist",
  },
});
