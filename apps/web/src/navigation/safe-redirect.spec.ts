import { describe, expect, it } from "vitest";

import { safeInternalRedirect } from "./safe-redirect";

describe("safeInternalRedirect", () => {
  it("accepte un chemin interne, y compris ses paramètres", () => {
    expect(safeInternalRedirect("/vault?note=note-1")).toBe(
      "/vault?note=note-1",
    );
    expect(safeInternalRedirect("/admin")).toBe("/admin");
  });

  it("refuse une adresse externe ou protocol-relative", () => {
    expect(safeInternalRedirect("https://evil.example/vault")).toBeNull();
    expect(safeInternalRedirect("//evil.example/vault")).toBeNull();
    expect(safeInternalRedirect("/\\evil.example")).toBeNull();
    expect(safeInternalRedirect("javascript:alert(1)")).toBeNull();
    expect(safeInternalRedirect(undefined)).toBeNull();
    expect(safeInternalRedirect(["/vault"])).toBeNull();
  });

  it("refuse les écrans d'authentification pour ne pas boucler", () => {
    expect(safeInternalRedirect("/login")).toBeNull();
    expect(safeInternalRedirect("/login?redirect=/vault")).toBeNull();
    expect(safeInternalRedirect("/unlock")).toBeNull();
    expect(safeInternalRedirect("/activate")).toBeNull();
  });
});
