// Inline SVG paths for the Markdown context menu (24×24 stroke grid). Icons
// are decorative duplicates of their item label; keep every path monochrome
// so it inherits the current text color.
const MENU_ICON_PATHS: Readonly<Record<string, string>> = {
  "add-link":
    "M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1",
  "add-external-link": "M10 5H5v14h14v-5M14 4h6v6M20 4l-9 9",
  bold: "M7 5h6a3 3 0 0 1 0 6H7zm0 6h7a3 3 0 0 1 0 6H7z",
  italic: "M14 5h4M6 19h4M14 5 10 19",
  strike:
    "M5 12h14M15 7.5A4 4 0 0 0 11.5 6C9.5 6 8 7 8 8.5c0 1.3 1.2 2 4 2.7 2.8.7 4 1.4 4 2.8 0 1.6-1.6 2.8-4 2.8a4.8 4.8 0 0 1-4-2",
  "inline-code": "m8 9-3 3 3 3m8-6 3 3-3 3m-3-7-2 8",
  "math-inline": "M17 5H7l5.5 7L7 19h10",
  comment: "M4 5h16v11H10l-6 4V5Z",
  "remove-format": "m15 4 5 5-11 11H5l-1-1v-3L15 4ZM13 21h8",
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  "ordered-list":
    "M10 6h10M10 12h10M10 18h10M4 5l2-1v5M4 11h2.5M4 14h2.5a1 1 0 0 1 0 2H5m1.5 0a1 1 0 0 1 0 2H4",
  check: "M4 6h10M4 12h10M4 18h7M14 15l2 2 4-4",
  quote: "M14 6h6M14 12h6M14 18h6M5 4v16",
  footnote: "M4 20h16M14 3h5M16.5 3v8",
  table: "M4 5h16v14H4zM4 10h16M4 15h16M12 5v14",
  callout: "M4 5h16v11H10l-5 4V5ZM8 9h8M8 12h5",
  line: "M5 12h14",
  "code-block": "m9 7-5 5 5 5m6-10 5 5-5 5",
  "math-block": "M5 5h14v14H5zM9 9h6M9 15h6M9 9l4 3-4 3",
  copy: "M8 8h10v11H8zM6 5h10v3M6 5v11h2",
  cut: "m6 6 12 12m0-12L6 18M7 7a2 2 0 1 0-2-2 2 2 0 0 0 2 2Zm12 12a2 2 0 1 0-2-2 2 2 0 0 0 2 2Z",
  paste: "M9 5h6M10 3h4v4h-4zM7 5H5v16h14V5h-2M9 12h6M9 16h4",
  "paste-plain": "M9 5h6M10 3h4v4h-4zM7 5H5v16h14V5h-2M10 11h4M12 11v6",
  "select-all":
    "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 11v2M20 11v2M11 4h2M11 20h2",
  default: "M5 5h14v14H5z",
};

export const SUBMENU_CHEVRON_PATH = "m9 6 6 6-6 6";

export function menuIconPath(id: string): string {
  return MENU_ICON_PATHS[id] ?? MENU_ICON_PATHS.default;
}
