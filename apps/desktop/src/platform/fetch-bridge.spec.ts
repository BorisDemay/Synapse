import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  installDesktopFetchBridge,
  resetDesktopFetchBridgeForTests,
} from "./fetch-bridge";

describe("desktop Synapse fetch bridge", () => {
  beforeEach(() => {
    invoke.mockReset();
    resetDesktopFetchBridgeForTests();
    installDesktopFetchBridge();
  });

  it("maps the session endpoint to the allowlisted Tauri command", async () => {
    invoke.mockResolvedValue({ body: { user_id: "user-1" }, status: 200 });

    const response = await fetch("/v1/session", { credentials: "include" });

    expect(invoke).toHaveBeenNthCalledWith(1, "set_instance_url", {
      url: "http://127.0.0.1:3000",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "synapse_request", {
      request: { kind: "session" },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ user_id: "user-1" });
  });

  it("does not intercept third-party requests", async () => {
    const nativeFetch = globalThis.fetch;
    const external = vi.fn().mockResolvedValue(new Response("ok"));
    globalThis.fetch = external;
    installDesktopFetchBridge();

    await fetch("https://api.openai.com/v1/responses");

    expect(invoke).not.toHaveBeenCalled();
    expect(external).toHaveBeenCalledOnce();
    globalThis.fetch = nativeFetch;
  });

  it("sends JSON payloads as typed command data, never an HTTP request", async () => {
    invoke.mockResolvedValue({ status: 204 });

    await fetch("/auth/login", {
      body: JSON.stringify({ email: "user@example.test", password: "secret" }),
      method: "POST",
    });

    expect(invoke).toHaveBeenLastCalledWith("synapse_request", {
      request: {
        body: { email: "user@example.test", password: "secret" },
        kind: "login",
      },
    });
  });
});
