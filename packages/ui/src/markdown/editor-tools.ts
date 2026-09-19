export type MarkdownMenuCommand = {
  checked?: boolean;
  destructive?: boolean;
  id: string;
  label: string;
  type: "item";
};

export type MarkdownMenuSeparator = { type: "separator" };

export type MarkdownMenuItem = MarkdownMenuCommand | MarkdownMenuSeparator;

export type MarkdownMenuGroup = {
  id: string;
  items: MarkdownMenuItem[];
  label: string;
};

export const TOOLBAR_LABELS: Readonly<Record<string, string>> = {
  emoji: "Émojis",
  headings: "Titres",
  bold: "Gras",
  italic: "Italique",
  strike: "Barré",
  link: "Lien",
  list: "Puces",
  "ordered-list": "Numéros",
  check: "Tâches",
  outdent: "Réduire",
  indent: "Indenter",
  quote: "Citation",
  line: "Séparateur",
  code: "Bloc code",
  "inline-code": "Code",
  table: "Tableau",
  undo: "Annuler",
  redo: "Rétablir",
};

const STYLE_TOOL_IDS = [
  "bold",
  "italic",
  "strike",
  "inline-code",
  "code",
  "link",
] as const;

const TABLE_ITEMS: readonly MarkdownMenuCommand[] = [
  {
    type: "item",
    id: "row-add-above",
    label: "Insérer une ligne au-dessus",
  },
  { type: "item", id: "row-add", label: "Insérer une ligne en dessous" },
  {
    type: "item",
    id: "column-add-before",
    label: "Insérer une colonne à gauche",
  },
  { type: "item", id: "column-add", label: "Insérer une colonne à droite" },
  {
    type: "item",
    id: "row-delete",
    label: "Supprimer la ligne",
    destructive: true,
  },
  {
    type: "item",
    id: "column-delete",
    label: "Supprimer la colonne",
    destructive: true,
  },
];

function toolbarItem(
  id: (typeof STYLE_TOOL_IDS)[number] | "emoji" | "undo" | "redo",
): MarkdownMenuCommand {
  return { type: "item", id, label: TOOLBAR_LABELS[id] ?? id };
}

export function markdownContextMenuGroups({
  inTable,
}: {
  inTable: boolean;
}): MarkdownMenuGroup[] {
  const groups: MarkdownMenuGroup[] = [
    {
      id: "style",
      label: "Style",
      items: STYLE_TOOL_IDS.map(toolbarItem),
    },
    {
      id: "insert",
      label: "Insérer",
      items: [toolbarItem("emoji")],
    },
    {
      id: "edit",
      label: "Édition",
      items: [
        toolbarItem("undo"),
        toolbarItem("redo"),
        { type: "separator" },
        { type: "item", id: "copy", label: "Copier" },
        { type: "item", id: "cut", label: "Couper" },
        { type: "item", id: "paste", label: "Coller" },
      ],
    },
  ];

  if (inTable) {
    groups.push({
      id: "table",
      label: "Tableau",
      items: [...TABLE_ITEMS],
    });
  }

  return groups;
}

export function flattenMenuCommands(
  groups: readonly MarkdownMenuGroup[],
): MarkdownMenuCommand[] {
  return groups.flatMap((group) =>
    group.items.filter(
      (item): item is MarkdownMenuCommand => item.type === "item",
    ),
  );
}
