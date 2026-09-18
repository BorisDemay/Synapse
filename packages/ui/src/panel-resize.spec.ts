import { describe, expect, it, beforeEach } from "vitest";

import {
  PANEL_WIDTH_BOUNDS,
  PANEL_WIDTH_STORAGE_KEY,
  clampPanelWidth,
  resetPanelLayoutState,
  usePanelLayout,
  widthFromPointerDelta,
} from "./panel-resize";

describe("clampPanelWidth", () => {
  it("borne la largeur de chaque panneau entre min et max", () => {
    expect(clampPanelWidth("sidebar", 100)).toBe(
      PANEL_WIDTH_BOUNDS.sidebar.min,
    );
    expect(clampPanelWidth("sidebar", 900)).toBe(
      PANEL_WIDTH_BOUNDS.sidebar.max,
    );
    expect(clampPanelWidth("relations", 256)).toBe(256);
    expect(clampPanelWidth("assistantHistory", 100)).toBe(
      PANEL_WIDTH_BOUNDS.assistantHistory.min,
    );
    expect(clampPanelWidth("assistant", 1000)).toBe(
      PANEL_WIDTH_BOUNDS.assistant.max,
    );
  });

  it("arrondit à l'entier le plus proche", () => {
    expect(clampPanelWidth("sidebar", 272.4)).toBe(272);
    expect(clampPanelWidth("sidebar", 272.6)).toBe(273);
  });
});

describe("widthFromPointerDelta", () => {
  it("augmente la largeur quand on tire le bord end vers la droite", () => {
    expect(
      widthFromPointerDelta({
        startWidth: 272,
        deltaX: 40,
        edge: "end",
        rtl: false,
      }),
    ).toBe(312);
  });

  it("diminue la largeur quand on tire le bord start vers la droite", () => {
    expect(
      widthFromPointerDelta({
        startWidth: 384,
        deltaX: 40,
        edge: "start",
        rtl: false,
      }),
    ).toBe(344);
  });

  it("inverse le signe en rtl", () => {
    expect(
      widthFromPointerDelta({
        startWidth: 272,
        deltaX: 40,
        edge: "end",
        rtl: true,
      }),
    ).toBe(232);
    expect(
      widthFromPointerDelta({
        startWidth: 384,
        deltaX: 40,
        edge: "start",
        rtl: true,
      }),
    ).toBe(424);
  });
});

describe("usePanelLayout", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetPanelLayoutState();
  });

  it("expose les largeurs par défaut", () => {
    const layout = usePanelLayout();

    expect(layout.widths.sidebar).toBe(PANEL_WIDTH_BOUNDS.sidebar.default);
    expect(layout.widths.relations).toBe(PANEL_WIDTH_BOUNDS.relations.default);
    expect(layout.widths.assistantHistory).toBe(
      PANEL_WIDTH_BOUNDS.assistantHistory.default,
    );
    expect(layout.widths.assistant).toBe(PANEL_WIDTH_BOUNDS.assistant.default);
  });

  it("restaure les largeurs depuis localStorage", () => {
    window.localStorage.setItem(
      PANEL_WIDTH_STORAGE_KEY,
      JSON.stringify({
        sidebar: 320,
        relations: 200,
        assistantHistory: 220,
        assistant: 480,
      }),
    );

    const layout = usePanelLayout();

    expect(layout.widths.sidebar).toBe(320);
    expect(layout.widths.relations).toBe(200);
    expect(layout.widths.assistantHistory).toBe(220);
    expect(layout.widths.assistant).toBe(480);
  });

  it("ne persiste pas à chaque mise à jour live", () => {
    const layout = usePanelLayout();

    layout.setPanelWidth("sidebar", 300);

    expect(window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY)).toBeNull();
    expect(layout.widths.sidebar).toBe(300);
  });

  it("persiste les largeurs clampées sur demande", () => {
    const layout = usePanelLayout();

    layout.setPanelWidth("sidebar", 900, true);

    const stored = JSON.parse(
      window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY) ?? "{}",
    );
    expect(stored.sidebar).toBe(PANEL_WIDTH_BOUNDS.sidebar.max);
    expect(layout.widths.sidebar).toBe(PANEL_WIDTH_BOUNDS.sidebar.max);
  });

  it("expose les variables CSS en pixels", () => {
    const layout = usePanelLayout();
    layout.setPanelWidth("relations", 200);

    expect(layout.cssVars.value["--app-shell-sidebar-width-expanded"]).toBe(
      "272px",
    );
    expect(layout.cssVars.value["--app-shell-relations-width"]).toBe("200px");
    expect(layout.cssVars.value["--app-shell-assistant-history-width"]).toBe(
      "256px",
    );
    expect(layout.cssVars.value["--app-shell-assistant-width"]).toBe("384px");
  });
});
