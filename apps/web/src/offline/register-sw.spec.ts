import { expect, it, vi } from "vitest";
import { registerAssetServiceWorker } from "./register-sw";
it("registers immediately if bootstrap finishes after the page load event", () => {
  const register = vi.fn().mockResolvedValue({});
  vi.stubGlobal("navigator", { serviceWorker: { register } });
  const ready = vi
    .spyOn(document, "readyState", "get")
    .mockReturnValue("complete");
  registerAssetServiceWorker();
  expect(register).toHaveBeenCalledWith("/sw.js");
  ready.mockRestore();
  vi.unstubAllGlobals();
});
