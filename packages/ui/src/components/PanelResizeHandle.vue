<script setup lang="ts">
import { ref } from "vue";

import {
  PANEL_ASIDE_IDS,
  PANEL_RESIZE_LABELS,
  PANEL_WIDTH_BOUNDS,
  usePanelLayout,
  widthFromPointerDelta,
  type PanelId,
  type ResizeEdge,
} from "../panel-resize";

const props = defineProps<{
  edge: ResizeEdge;
  panel: PanelId;
}>();

const { beginResize, endResize, resetPanelWidth, setPanelWidth, widths } =
  usePanelLayout();

const dragging = ref(false);
let startWidth = 0;
let startX = 0;

const bounds = PANEL_WIDTH_BOUNDS[props.panel];

function isRtl(element: HTMLElement): boolean {
  return getComputedStyle(element).direction === "rtl";
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) {
    return;
  }
  const target = event.currentTarget as HTMLElement;
  startX = event.clientX;
  startWidth = widths[props.panel];
  dragging.value = true;
  beginResize();
  target.setPointerCapture(event.pointerId);
  target.focus();
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value) {
    return;
  }
  const target = event.currentTarget as HTMLElement;
  setPanelWidth(
    props.panel,
    widthFromPointerDelta({
      startWidth,
      deltaX: event.clientX - startX,
      edge: props.edge,
      rtl: isRtl(target),
    }),
  );
}

function stopResize() {
  if (!dragging.value) {
    return;
  }
  dragging.value = false;
  endResize();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Home") {
    event.preventDefault();
    setPanelWidth(props.panel, bounds.min, true);
    return;
  }
  if (event.key === "End") {
    event.preventDefault();
    setPanelWidth(props.panel, bounds.max, true);
    return;
  }
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
    return;
  }
  event.preventDefault();
  const step = event.shiftKey ? 32 : 8;
  const deltaX = event.key === "ArrowRight" ? step : -step;
  const target = event.currentTarget as HTMLElement;
  setPanelWidth(
    props.panel,
    widthFromPointerDelta({
      startWidth: widths[props.panel],
      deltaX,
      edge: props.edge,
      rtl: isRtl(target),
    }),
    true,
  );
}

function onDblClick() {
  resetPanelWidth(props.panel);
}
</script>

<template>
  <div
    class="app-shell-resize-handle"
    role="separator"
    aria-orientation="vertical"
    tabindex="0"
    :aria-label="PANEL_RESIZE_LABELS[panel]"
    :aria-controls="PANEL_ASIDE_IDS[panel]"
    :aria-valuemin="bounds.min"
    :aria-valuemax="bounds.max"
    :aria-valuenow="widths[panel]"
    :data-edge="edge"
    :data-active="dragging || undefined"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="stopResize"
    @pointercancel="stopResize"
    @lostpointercapture="stopResize"
    @keydown="onKeydown"
    @dblclick="onDblClick"
  />
</template>
