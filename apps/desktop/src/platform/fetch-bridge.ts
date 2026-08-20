import { invoke } from "@tauri-apps/api/core";

export type SynapseRequest =
  | { kind: "session" }
  | { kind: "public-signup" }
  | { body: Record<string, unknown>; kind: "signup" }
  | { body: Record<string, unknown>; kind: "login" }
  | { kind: "logout" }
  | { body: Record<string, unknown>; kind: "change-password" }
  | { kind: "sessions" }
  | { kind: "revoke-other-sessions" }
  | { kind: "revoke-session"; sessionId: string }
  | { body: Record<string, unknown>; kind: "delete-account" }
  | { kind: "list-vaults" }
  | { kind: "create-vault" }
  | { kind: "get-envelope"; vaultId: string }
  | { body: Record<string, unknown>; kind: "put-envelope"; vaultId: string }
  | { kind: "pull"; query: string; vaultId: string }
  | { body: Record<string, unknown>; kind: "push"; vaultId: string };

interface SynapseResponse {
  body?: unknown;
  status: number;
}

const nativeFetch = globalThis.fetch.bind(globalThis);
const INSTANCE_URL_KEY = "synapse-instance-url";
let installed = false;
let instanceReady: Promise<void> | undefined;

function ensureInstance(): Promise<void> {
  if (!instanceReady) {
    const url =
      localStorage.getItem(INSTANCE_URL_KEY) ?? "http://127.0.0.1:3000";
    instanceReady = invoke("set_instance_url", { url }).then(
      () => undefined,
      (error) => {
        instanceReady = undefined;
        throw error;
      },
    );
  }
  return instanceReady;
}

function pathFrom(input: RequestInfo | URL): URL | null {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  try {
    const url = new URL(raw, window.location.origin);
    return url.origin === window.location.origin ? url : null;
  } catch {
    return null;
  }
}

async function bodyFrom(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<string> {
  if (init?.body !== undefined) {
    return new Request("https://synapse.invalid", {
      body: init.body,
      method: "POST",
    }).text();
  }
  if (input instanceof Request) {
    return input.clone().text();
  }
  return "";
}

function jsonBody(body: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(body || "{}");
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function mapRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<SynapseRequest | null> {
  const url = pathFrom(input);
  if (!url) {
    return null;
  }
  const method =
    init?.method ?? (input instanceof Request ? input.method : "GET");
  const body = await bodyFrom(input, init);
  const json = jsonBody(body);
  const match = url.pathname.match(
    /^\/v1\/vaults\/([^/]+)(?:\/(envelope|operations))?$/u,
  );
  if (url.pathname === "/v1/session" && method === "GET")
    return { kind: "session" };
  if (url.pathname === "/auth/signup" && method === "GET")
    return { kind: "public-signup" };
  if (url.pathname === "/auth/signup" && method === "POST" && json)
    return { body: json, kind: "signup" };
  if (url.pathname === "/auth/login" && method === "POST" && json)
    return { body: json, kind: "login" };
  if (url.pathname === "/auth/logout" && method === "POST")
    return { kind: "logout" };
  if (url.pathname === "/auth/password" && method === "POST" && json)
    return { body: json, kind: "change-password" };
  if (url.pathname === "/auth/sessions" && method === "GET")
    return { kind: "sessions" };
  if (url.pathname === "/auth/sessions/revoke-others" && method === "POST")
    return { kind: "revoke-other-sessions" };
  const revoke = url.pathname.match(/^\/auth\/sessions\/([^/]+)\/revoke$/u);
  if (revoke && method === "POST")
    return { kind: "revoke-session", sessionId: revoke[1] };
  if (url.pathname === "/auth/account/delete" && method === "POST" && json)
    return { body: json, kind: "delete-account" };
  if (url.pathname === "/v1/vaults" && method === "GET")
    return { kind: "list-vaults" };
  if (url.pathname === "/vaults" && method === "POST")
    return { kind: "create-vault" };
  if (match?.[2] === "envelope" && method === "GET")
    return { kind: "get-envelope", vaultId: match[1] };
  if (match?.[2] === "envelope" && method === "PUT" && json)
    return { body: json, kind: "put-envelope", vaultId: match[1] };
  if (match?.[2] === "operations" && method === "GET")
    return { kind: "pull", query: url.search, vaultId: match[1] };
  if (match?.[2] === "operations" && method === "POST" && json)
    return { body: json, kind: "push", vaultId: match[1] };
  return null;
}

function responseFrom(result: SynapseResponse): Response {
  if (result.body === undefined) {
    return new Response(null, { status: result.status });
  }
  return new Response(JSON.stringify(result.body), {
    headers: { "content-type": "application/json" },
    status: result.status,
  });
}

export function installDesktopFetchBridge(): void {
  if (installed) return;
  installed = true;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = await mapRequest(input, init);
    if (!request) {
      return nativeFetch(input, init);
    }
    await ensureInstance();
    return responseFrom(
      await invoke<SynapseResponse>("synapse_request", { request }),
    );
  };
}

/** Test-only reset; production installs the bridge once during bootstrap. */
export function resetDesktopFetchBridgeForTests(): void {
  globalThis.fetch = nativeFetch;
  installed = false;
  instanceReady = undefined;
}
