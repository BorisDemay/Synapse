import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import {
  COMPACT_ASSISTANT_MEDIA_QUERY,
  defaultAssistantSidePanelsOpen,
  readCompactAssistantViewport,
  resetCompactAssistantLayoutState,
  useCompactAssistantLayout,
} from "./app-shell-layout";

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mql = {
    matches,
    media: COMPACT_ASSISTANT_MEDIA_QUERY,
    addEventListener: vi.fn(
      (_: "change", listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
    ),
    removeEventListener: vi.fn(
      (_: "change", listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
    ),
    dispatch(change: boolean) {
      this.matches = change;
      for (const listener of listeners) {
        listener({ matches: change } as MediaQueryListEvent);
      }
    },
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mql),
  );
  return mql;
}

describe("app-shell-layout", () => {
  beforeEach(() => {
    resetCompactAssistantLayoutState();
    vi.unstubAllGlobals();
  });

  it("uses a 75rem compact assistant breakpoint", () => {
    expect(COMPACT_ASSISTANT_MEDIA_QUERY).toBe("(max-width: 75rem)");
  });

  it("defaults relations and history panels open on wide viewports", () => {
    mockMatchMedia(false);

    expect(readCompactAssistantViewport()).toBe(false);
    expect(defaultAssistantSidePanelsOpen()).toEqual({
      history: true,
      relations: true,
    });
  });

  it("defaults relations and history panels closed on compact viewports", () => {
    mockMatchMedia(true);

    expect(readCompactAssistantViewport()).toBe(true);
    expect(defaultAssistantSidePanelsOpen()).toEqual({
      history: false,
      relations: false,
    });
  });

  it("tracks compact viewport changes", () => {
    const mql = mockMatchMedia(false);
    const layout = useCompactAssistantLayout();

    expect(layout.isCompact.value).toBe(false);

    mql.dispatch(true);

    expect(layout.isCompact.value).toBe(true);
  });

  it("collapses side panels when entering compact viewport", () => {
    const mql = mockMatchMedia(false);
    const layout = useCompactAssistantLayout();
    const historyOpen = ref(true);
    const relationsOpen = ref(true);

    layout.bindSidePanels({
      historyOpen,
      relationsOpen,
    });

    mql.dispatch(true);

    expect(historyOpen.value).toBe(false);
    expect(relationsOpen.value).toBe(false);
  });
});
