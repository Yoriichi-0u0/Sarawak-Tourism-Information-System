import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function stisApi(): Plugin {
  const mount = async (root: string, use: (handler: never) => void, closing: (close: () => void) => void) => {
    const { nodeMiddleware, startRuntime } = await import("./server/runtime.ts");
    const runtime = startRuntime(root, process.env, { allowedHosts: process.env.STIS_ALLOWED_HOSTS ? undefined : ["localhost", "127.0.0.1"] });
    use(nodeMiddleware(runtime) as never);
    closing(() => { void runtime.then((started) => started.close()); });
  };
  return {
    name: "stis-api",
    async configureServer(server) {
      await mount(server.config.root, (handler) => server.middlewares.use(handler), (close) => server.httpServer?.once("close", close));
    },
    async configurePreviewServer(server) {
      await mount(server.config.root, (handler) => server.middlewares.use(handler), (close) => server.httpServer.once("close", close));
    },
  };
}

export default defineConfig({
  plugins: [react(), stisApi()],
  server: {
    port: 5173,
    fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.stis-data/**", "**/.as03-data/**"] },
  },
  build: { target: "es2022", outDir: "dist" },
});
