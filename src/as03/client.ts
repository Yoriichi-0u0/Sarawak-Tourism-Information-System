import type { Fields } from "./contracts";

export class RequestError extends Error {
  constructor(message: string, readonly status: number, readonly issues?: Fields) {
    super(message);
  }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; guest?: string } = {}): Promise<T> {
  const headers = new Headers();
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.guest) headers.set("Authorization", `Guest ${options.guest}`);
  const response = await fetch(`/api/as03/${path}`, {
    method: options.method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const content = response.headers.get("Content-Type") ?? "";
  if (!content.includes("application/json")) throw new Error("Start the local AS03 service to use this application.");
  const payload = await response.json();
  if (!response.ok) throw new RequestError(payload.message, response.status, payload.issues);
  return payload as T;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The operation could not be completed.";
}
