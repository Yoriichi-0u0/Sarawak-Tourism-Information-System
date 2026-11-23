import type { Fields } from "../shared/contracts";

export class RequestError extends Error {
  constructor(message: string, readonly status: number, readonly issues?: Fields) {
    super(message);
  }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; guest?: string } = {}): Promise<T> {
  const headers = new Headers();
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.guest) headers.set("Authorization", `Guest ${options.guest}`);
  const response = await fetch(`/api/v1/${path}`, {
    method: options.method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const content = response.headers.get("Content-Type") ?? "";
  if (!content.includes("application/json")) throw new Error("The STIS service is unavailable. Try again shortly.");
  const payload = await response.json();
  if (!response.ok) throw new RequestError(payload.message, response.status, payload.issues);
  return payload as T;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The operation could not be completed.";
}

/** Downloads a file response (such as an itinerary calendar) without exposing credentials in a URL. */
export async function download(path: string, filename: string, options: { guest?: string } = {}) {
  const headers = new Headers();
  if (options.guest) headers.set("Authorization", `Guest ${options.guest}`);
  const response = await fetch(`/api/v1/${path}`, { headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: "The file could not be downloaded." }));
    throw new RequestError(payload.message, response.status);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
