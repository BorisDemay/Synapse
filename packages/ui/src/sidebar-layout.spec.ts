import { describe, expect, it, beforeEach } from "vitest";

import {
  resetSidebarLayoutState,
  useSidebarLayout,
} from "./sidebar-layout";

describe("useSidebarLayout", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetSidebarLayoutState();
  });

  it("restores collapsed and compact preferences from localStorage", () => {
    window.localStorage.setItem("synapse-ui-sidebar-collapsed", "true");
    window.localStorage.setItem("synapse-ui-sidebar-compact", "true");

    const layout = useSidebarLayout();

    expect(layout.collapsed.value).toBe(true);
    expect(layout.compact.value).toBe(true);
  });

  it("persists sidebar collapse when toggled", () => {
    const layout = useSidebarLayout();

    layout.toggleCollapsed();

    expect(layout.collapsed.value).toBe(true);
    expect(window.localStorage.getItem("synapse-ui-sidebar-collapsed")).toBe(
      "true",
    );
  });

  it("persists compact mode when toggled", () => {
    const layout = useSidebarLayout();

    layout.toggleCompact();

    expect(layout.compact.value).toBe(true);
    expect(window.localStorage.getItem("synapse-ui-sidebar-compact")).toBe(
      "true",
    );
  });
});
