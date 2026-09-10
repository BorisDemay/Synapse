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
    localStorage.clear();
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

  it("maps storage health to the allowlisted Tauri command", async () => {
    invoke.mockResolvedValue({
      body: { available_bytes: 1024, pending_operation_count: 1 },
      status: 200,
    });

    const response = await fetch("/health/storage", { credentials: "include" });

    expect(invoke).toHaveBeenLastCalledWith("synapse_request", {
      request: { kind: "storage-health" },
    });
    await expect(response.json()).resolves.toEqual({
      available_bytes: 1024,
      pending_operation_count: 1,
    });
  });

  it("uses the development instance instead of a stale remembered URL", async () => {
    localStorage.setItem("synapse-instance-url", "https://old.example.test");
    invoke.mockResolvedValue({ body: { user_id: "user-1" }, status: 200 });
    resetDesktopFetchBridgeForTests();
    installDesktopFetchBridge({ instanceUrl: "http://127.0.0.1:3000" });

    await fetch("/v1/session");

    expect(invoke).toHaveBeenNthCalledWith(1, "set_instance_url", {
      url: "http://127.0.0.1:3000",
    });
  });

  it("reconfigures the native client after the user changes instance URL", async () => {
    localStorage.setItem("synapse-instance-url", "https://old.example.test");
    invoke.mockResolvedValue({ body: { public_signup: false }, status: 200 });
    resetDesktopFetchBridgeForTests();
    installDesktopFetchBridge();

    await fetch("/auth/signup");
    localStorage.setItem("synapse-instance-url", "https://new.example.test");
    await fetch("/auth/signup");

    expect(invoke).toHaveBeenNthCalledWith(1, "set_instance_url", {
      url: "https://old.example.test",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "set_instance_url", {
      url: "https://new.example.test",
    });
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

  it("forwards remember_device through the closed login command", async () => {
    invoke.mockResolvedValue({ status: 204 });

    await fetch("/auth/login", {
      body: JSON.stringify({
        email: "user@example.test",
        password: "secret",
        remember_device: true,
      }),
      method: "POST",
    });

    expect(invoke).toHaveBeenLastCalledWith("synapse_request", {
      request: {
        body: {
          email: "user@example.test",
          password: "secret",
          remember_device: true,
        },
        kind: "login",
      },
    });
  });
});

it("uses the configured build instance only as the initial default", async () => {
  vi.stubEnv("VITE_SYNAPSE_INSTANCE_URL", "http://127.0.0.1:13999");
  localStorage.removeItem("synapse-instance-url");
  installDesktopFetchBridge();
  await fetch("/auth/signup");
  expect(invoke).toHaveBeenCalledWith("set_instance_url", {
    url: "http://127.0.0.1:13999",
  });
  localStorage.setItem("synapse-instance-url", "http://127.0.0.1:13998");
  await fetch("/auth/signup");
  expect(invoke).toHaveBeenCalledWith("set_instance_url", {
    url: "http://127.0.0.1:13998",
  });
  vi.unstubAllEnvs();
});
