import { mkdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";

import { openPGlite, openPostgres } from "./db.ts";
import { createHandler, prefix, type HandlerOptions } from "./http.ts";
import { Application } from "./services.ts";

export type Runtime = { handle: ReturnType<typeof createHandler>; close: () => Promise<void> };

export async function startRuntime(root: string, env: NodeJS.ProcessEnv = process.env, options: HandlerOptions = {}): Promise<Runtime> {
  let db;
  if (env.DATABASE_URL) {
    db = await openPostgres(env.DATABASE_URL);
  } else {
    const profile = env.STIS_DATA_PROFILE ?? "local";
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(profile)) throw new Error("Choose a valid STIS_DATA_PROFILE name.");
    const directory = join(root, ".stis-data");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    db = await openPGlite(join(directory, profile));
  }
  const hosted = Boolean(env.DATABASE_URL);
  const admin = env.STIS_ADMIN_EMAIL && env.STIS_ADMIN_PASSWORD
    ? { email: env.STIS_ADMIN_EMAIL, password: env.STIS_ADMIN_PASSWORD, displayName: env.STIS_ADMIN_NAME }
    : undefined;
  const app = await Application.open({ db, admin, migrate: !hosted, seed: !hosted });
  const allowedHosts = options.allowedHosts ?? env.STIS_ALLOWED_HOSTS?.split(",").map((host) => host.trim()).filter(Boolean);
  return { handle: createHandler(app, { ...options, allowedHosts }), close: () => app.close() };
}

export function toRequest(incoming: IncomingMessage): Request {
  const forwardedProto = String(incoming.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  const protocol = forwardedProto === "https" ? "https" : "http";
  const host = String(incoming.headers["x-forwarded-host"] ?? incoming.headers.host ?? "localhost").split(",")[0].trim();
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(key, item);
  }
  headers.set("host", host);
  const method = incoming.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : Readable.toWeb(incoming) as ReadableStream;
  return new Request(`${protocol}://${host}${incoming.url ?? "/"}`, { method, headers, body, duplex: "half" } as RequestInit);
}

export async function writeResponse(response: Response, outgoing: ServerResponse) {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, key) => { if (key !== "set-cookie") headers[key] = value; });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers["set-cookie"] = cookies;
  outgoing.writeHead(response.status, headers);
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}

export function clientAddress(incoming: IncomingMessage, trustForwarded: boolean) {
  const forwarded = trustForwarded ? String(incoming.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
  return forwarded || incoming.socket?.remoteAddress || "unknown";
}

export function nodeMiddleware(runtime: Promise<Runtime>, trustForwarded = false) {
  return (incoming: IncomingMessage, outgoing: ServerResponse, next: () => void) => {
    if (!incoming.url?.startsWith(prefix)) return next();
    void (async () => {
      try {
        const { handle } = await runtime;
        await writeResponse(await handle(toRequest(incoming), { clientAddress: clientAddress(incoming, trustForwarded) }), outgoing);
      } catch (error) {
        console.error(JSON.stringify({ event: "stis.runtime_failed", code: (error as { code?: string })?.code ?? "Error" }));
        if (!outgoing.headersSent) {
          outgoing.writeHead(503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          outgoing.end(JSON.stringify({ message: "The service is starting or unavailable. Try again shortly." }));
        }
      }
    })();
  };
}
