import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou d'empilement : l'ordre de superposition de l'interface doit être
 * décrit par une échelle unique de tokens `--synapse-z-*` déclarée dans
 * `packages/ui/src/styles/tokens.css`.
 *
 * Un littéral d'empilement dispersé dans un composant rend l'ordre dépendant de
 * l'ordre du DOM dès que deux valeurs sont égales : c'est la cause des menus qui
 * passent les uns sous les autres.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const TOKENS_CSS = join(repoRoot, "packages/ui/src/styles/tokens.css");
const PLUGIN_TS = join(repoRoot, "packages/ui/src/plugin.ts");

/** Échelle attendue : la clé de bande doit rester strictement croissante. */
const Z_INDEX_SCALE = {
  "--synapse-z-resize-handle": 10,
  "--synapse-z-panel-backdrop": 20,
  "--synapse-z-panel": 30,
  "--synapse-z-nav-toggle": 40,
  "--synapse-z-drawer-backdrop": 50,
  "--synapse-z-drawer": 60,
  "--synapse-z-overlay": 1000,
  "--synapse-z-tooltip": 1100,
  "--synapse-z-toast": 1200,
  "--synapse-z-primevue-overlay": 2000,
  "--synapse-z-primevue-modal": 2100,
  "--synapse-z-primevue-tooltip": 2200,
} as const;

/** Bande réservée aux overlays internes de PrimeVue, configurée dans plugin.ts. */
const PRIMEVUE_Z_INDEX = {
  overlay: "--synapse-z-primevue-overlay",
  menu: "--synapse-z-primevue-overlay",
  modal: "--synapse-z-primevue-modal",
  tooltip: "--synapse-z-primevue-tooltip",
} as const;

const SCANNED_DIRECTORIES = [
  "packages/ui/src",
  "apps/web/src",
  "apps/desktop/src",
];
const SCANNED_EXTENSIONS = [".css", ".vue", ".ts"];
const IGNORED_SEGMENTS = ["node_modules", "dist", "vendor", "coverage"];
const ALLOWED_LITERAL_VALUES = [
  "auto",
  "inherit",
  "initial",
  "unset",
  "revert",
];

function collectFiles(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (IGNORED_SEGMENTS.includes(entry.name)) {
      continue;
    }

    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      collectFiles(path, files);
      continue;
    }

    if (SCANNED_EXTENSIONS.includes(extname(entry.name))) {
      files.push(path);
    }
  }

  return files;
}

interface StackingLiteral {
  readonly file: string;
  readonly line: number;
  readonly value: string;
}

function stackingLiterals(): StackingLiteral[] {
  const found: StackingLiteral[] = [];
  const pattern = /z-index\s*:\s*([^;}]+)/g;

  for (const directory of SCANNED_DIRECTORIES) {
    for (const file of collectFiles(join(repoRoot, directory))) {
      const source = readFileSync(file, "utf8");
      const lines = source.split("\n");

      pattern.lastIndex = 0;

      for (const match of source.matchAll(pattern)) {
        const value = match[1].trim();

        if (
          ALLOWED_LITERAL_VALUES.includes(value) ||
          value.startsWith("var(--synapse-z-") ||
          value.startsWith("calc(")
        ) {
          continue;
        }

        const line = source.slice(0, match.index).split("\n").length;

        found.push({
          file: file.replace(`${repoRoot}/`, ""),
          line,
          value: lines[line - 1]?.trim() ?? value,
        });
      }
    }
  }

  return found;
}

/** Balises dont le `title` reste légitime : il nomme un cadre pour les lecteurs d'écran. */
const TITLE_ALLOWED_TAGS = ["iframe"];

/**
 * Un `title` natif est dessiné par le navigateur hors de l'arbre d'empilement :
 * il ne suit ni le thème, ni le défilement, et reste affiché au-dessus d'un menu
 * qui vient de s'ouvrir. Toutes les infobulles doivent donc passer par
 * `v-synapse-tooltip` (packages/ui/src/tooltip.ts).
 */
const TITLE_ATTRIBUTE = /(?<![-\w:])(?::)?title\s*=/g;

function nativeTooltips(): StackingLiteral[] {
  const found: StackingLiteral[] = [];

  for (const directory of SCANNED_DIRECTORIES) {
    for (const file of collectFiles(join(repoRoot, directory))) {
      if (extname(file) !== ".vue") {
        continue;
      }

      const source = readFileSync(file, "utf8");
      const lines = source.split("\n");

      TITLE_ATTRIBUTE.lastIndex = 0;

      for (const match of source.matchAll(TITLE_ATTRIBUTE)) {
        const before = source.slice(0, match.index);
        const tagStart = before.lastIndexOf("<");

        // Hors d'une balise, `title =` est une affectation de script, pas un attribut.
        if (tagStart < before.lastIndexOf(">")) {
          continue;
        }

        const tag =
          before.slice(tagStart + 1).match(/^[A-Za-z][\w.-]*/)?.[0] ?? "";

        if (TITLE_ALLOWED_TAGS.includes(tag)) {
          continue;
        }

        const line = before.split("\n").length;

        found.push({
          file: file.replace(`${repoRoot}/`, ""),
          line,
          value: lines[line - 1]?.trim() ?? match[0],
        });
      }
    }
  }

  return found;
}

describe("échelle d'empilement (z-index)", () => {
  const tokensCss = readFileSync(TOKENS_CSS, "utf8");

  it("déclare chaque bande de l'échelle dans tokens.css", () => {
    for (const [token, value] of Object.entries(Z_INDEX_SCALE)) {
      expect(tokensCss, `${token} doit valoir ${value}`).toContain(
        `${token}: ${value};`,
      );
    }
  });

  it("garde des bandes strictement croissantes", () => {
    const values = Object.values(Z_INDEX_SCALE);
    const ordered = [...values].sort((left, right) => left - right);

    expect(new Set(values).size).toBe(values.length);
    expect(values).toEqual(ordered);
  });

  it("configure la bande PrimeVue au-dessus de la pile applicative", () => {
    const plugin = readFileSync(PLUGIN_TS, "utf8");
    const configured = new Map<string, string>();

    for (const match of plugin.matchAll(/^\s*(\w+):\s*(\d+),/gm)) {
      configured.set(match[1], match[2]);
    }

    for (const [key, token] of Object.entries(PRIMEVUE_Z_INDEX)) {
      expect(
        configured.get(key),
        `plugin.ts doit configurer zIndex.${key}`,
      ).toBe(String(Z_INDEX_SCALE[token as keyof typeof Z_INDEX_SCALE]));
    }
  });

  it("n'utilise aucun littéral d'empilement hors de l'échelle", () => {
    const literals = stackingLiterals();

    expect(
      literals.map(
        (literal) => `${literal.file}:${literal.line} → ${literal.value}`,
      ),
      "utilisez var(--synapse-z-*) ou calc() à partir de l'échelle",
    ).toEqual([]);
  });
});

describe("infobulles", () => {
  it("enregistre la directive d'infobulle dans plugin.ts", () => {
    expect(readFileSync(PLUGIN_TS, "utf8")).toContain(
      'app.directive("synapse-tooltip", synapseTooltip)',
    );
  });

  it("bannit l'infobulle native hors des cadres", () => {
    const titles = nativeTooltips();

    expect(
      titles.map((title) => `${title.file}:${title.line} → ${title.value}`),
      "remplacez title= par v-synapse-tooltip",
    ).toEqual([]);
  });
});
