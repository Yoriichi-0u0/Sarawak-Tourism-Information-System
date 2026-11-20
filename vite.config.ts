import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function as03(): Plugin {
  return {
    name: "as03-local-service",
    async configureServer(server) {
      const service = (await import("./server/as03/http.ts")).startAS03(server.config.root);
      server.middlewares.use(service.middleware);
      server.httpServer?.once("close", service.close);
    },
    async configurePreviewServer(server) {
      const service = (await import("./server/as03/http.ts")).startAS03(server.config.root);
      server.middlewares.use(service.middleware);
      server.httpServer.once("close", service.close);
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "as03" ? [as03()] : [])],
  server: {
    port: 5173,
    fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.as03-data/**"] },
  },
  build: { target: "es2022", outDir: mode === "as03" ? "dist-as03" : "dist" },
}));
