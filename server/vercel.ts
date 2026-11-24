import type { IncomingMessage, ServerResponse } from "node:http";

import { nodeMiddleware, startRuntime } from "./runtime.ts";

let runtime: ReturnType<typeof startRuntime> | undefined;

export default function handler(incoming: IncomingMessage, outgoing: ServerResponse) {
  if (!process.env.DATABASE_URL) {
    outgoing.writeHead(503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    outgoing.end(JSON.stringify({ message: "The hosted database is not configured for this deployment." }));
    return;
  }
  const url = new URL(incoming.url ?? "/", "http://vercel.internal");
  const rewritten = url.searchParams.get("__stis_path");
  if (!url.pathname.startsWith("/api/v1/") && rewritten !== null) {
    url.searchParams.delete("__stis_path");
    incoming.url = `/api/${rewritten.replace(/^\/+/, "")}${url.searchParams.size ? `?${url.searchParams}` : ""}`;
  }
  runtime ??= startRuntime(process.cwd());
  runtime.catch(() => { runtime = undefined; });
  nodeMiddleware(runtime, true)(incoming, outgoing, () => {
    outgoing.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    outgoing.end(JSON.stringify({ message: "This operation is unavailable." }));
  });
}
