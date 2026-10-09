import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TitleBar from "./TitleBar.vue";

const windowApi = vi.hoisted(() => ({
  close: vi.fn(),
  isMaximized: vi.fn(async () => false),
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowApi,
}));

describe("TitleBar", () => {
  beforeEach(() => {
    windowApi.close.mockReset();
    windowApi.minimize.mockReset();
    windowApi.toggleMaximize.mockReset();
    windowApi.isMaximized.mockReset();
    windowApi.isMaximized.mockResolvedValue(false);
  });

  it("exposes themed window controls instead of the native chrome", async () => {
    const wrapper = mount(TitleBar);

    expect(wrapper.get("header").attributes("data-tauri-drag-region")).toBe("");
    await wrapper.get('button[aria-label="Réduire"]').trigger("click");
    await wrapper.get('button[aria-label="Agrandir"]').trigger("click");
    await wrapper.get('button[aria-label="Fermer"]').trigger("click");

    expect(windowApi.minimize).toHaveBeenCalledOnce();
    expect(windowApi.toggleMaximize).toHaveBeenCalledOnce();
    expect(windowApi.close).toHaveBeenCalledOnce();
  });
});
