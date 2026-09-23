export type MarkdownMenuCommand = {
  checked?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  id: string;
  label: string;
  /** Keyboard hint rendered apart from the accessible label, e.g. Ctrl+Shift+K. */
  shortcut?: string;
  type: "item";
};

export type MarkdownMenuSeparator = { type: "separator" };

export type MarkdownMenuSubmenu = {
  id: string;
  items: MarkdownMenuItem[];
  label: string;
  type: "submenu";
};

export type MarkdownMenuItem =
  | MarkdownMenuCommand
  | MarkdownMenuSeparator
  | MarkdownMenuSubmenu;

/**
 * Vditor hotkey for the link toolbar action, written with the engine's own
 * ⌘/⇧ notation; the engine resolves it to Ctrl+Shift+K (Cmd on macOS) for
 * both matching and tooltips. Ctrl+K stays reserved for the global search
 * palette and must never mutate Markdown.
 */
export const LINK_TOOLBAR_HOTKEY = "⇧⌘K";

export function insertLinkShortcutHint(): string {
  return /Mac/i.test(navigator.platform) ? "Cmd+Shift+K" : "Ctrl+Shift+K";
}

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

const SEPARATOR: MarkdownMenuSeparator = { type: "separator" };

// Small, local palette: inserting an emoji never calls an external service.
const EDITOR_EMOJIS = [
  { id: "smile", glyph: "😄", label: "Sourire" },
  { id: "thumbs-up", glyph: "👍", label: "J’aime" },
  { id: "thumbs-down", glyph: "👎", label: "Je n’aime pas" },
  { id: "eyes", glyph: "👀", label: "Regarder" },
  { id: "heart", glyph: "❤️", label: "Cœur" },
  { id: "rocket", glyph: "🚀", label: "Fusée" },
  { id: "party", glyph: "🎉", label: "Fête" },
] as const;

export function emojiForCommand(id: string): string | undefined {
  return EDITOR_EMOJIS.find((emoji) => `emoji:${emoji.id}` === id)?.glyph;
}

function command(id: string, label: string): MarkdownMenuCommand {
  return { type: "item", id, label };
}

function headingItems(headingLevel: number): MarkdownMenuCommand[] {
  return [1, 2, 3, 4, 5, 6].map((level) => ({
    type: "item" as const,
    id: `h${level}`,
    label: `Titre ${level}`,
    checked: headingLevel === level,
  }));
}

export function markdownContextMenuItems({
  headingLevel = 0,
  inTable,
  selectionEmpty = false,
  viewMode = "ir",
}: {
  headingLevel?: number;
  inTable: boolean;
  selectionEmpty?: boolean;
  viewMode?: "ir" | "sv";
}): MarkdownMenuItem[] {
  const items: MarkdownMenuItem[] = [
    command("undo", "Annuler"),
    command("redo", "Rétablir"),
    SEPARATOR,
    {
      ...command("add-link", "Ajouter un lien"),
      shortcut: insertLinkShortcutHint(),
    },
    command("add-external-link", "Ajouter un lien externe"),
    {
      id: "formater",
      items: [
        command("bold", "Gras"),
        command("italic", "Italique"),
        command("strike", "Barré"),
        SEPARATOR,
        command("inline-code", "Code"),
        command("math-inline", "Mathématiques"),
        command("comment", "Commentaire"),
        SEPARATOR,
        command("remove-format", "Supprimer le formatage"),
      ],
      label: "Formater",
      type: "submenu",
    },
    {
      id: "paragraphe",
      items: [
        command("list", "Liste à puces"),
        command("ordered-list", "Liste numérotée"),
        command("check", "Liste de tâches"),
        command("outdent", "Réduire le retrait"),
        command("indent", "Augmenter le retrait"),
        SEPARATOR,
        ...headingItems(headingLevel),
        {
          type: "item",
          id: "body",
          label: "Corps",
          checked: headingLevel === 0,
        },
        SEPARATOR,
        command("quote", "Citation"),
      ],
      label: "Paragraphe",
      type: "submenu",
    },
    {
      id: "inserer",
      items: [
        command("footnote", "Note de bas de page"),
        command("table", "Tableau"),
        command("callout", "Mise en avant"),
        command("line", "Ligne horizontale"),
        SEPARATOR,
        command("code-block", "Bloc de code"),
        command("math-block", "Bloc mathématiques"),
      ],
      label: "Insérer",
      type: "submenu",
    },
    {
      id: "emoji",
      items: EDITOR_EMOJIS.map(({ id, glyph, label }) =>
        command(`emoji:${id}`, `${glyph} ${label}`),
      ),
      label: "Émojis",
      type: "submenu",
    },
    {
      id: "mode",
      items: [
        { ...command("mode-ir", "Markdown"), checked: viewMode === "ir" },
        { ...command("mode-sv", "Texte brut"), checked: viewMode === "sv" },
      ],
      label: "Mode d’édition",
      type: "submenu",
    },
  ];

  if (inTable) {
    items.push({
      id: "tableau",
      items: [...TABLE_ITEMS],
      label: "Tableau",
      type: "submenu",
    });
  }

  items.push(
    SEPARATOR,
    { type: "item", id: "cut", label: "Couper", disabled: selectionEmpty },
    { type: "item", id: "copy", label: "Copier", disabled: selectionEmpty },
    command("paste", "Coller"),
    command("paste-plain", "Coller en texte brut"),
    command("select-all", "Tout sélectionner"),
  );

  return items;
}
