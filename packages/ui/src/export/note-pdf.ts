import { renderMarkdown } from "../markdown/render";

/** Export PDF d'une note : assembleur PDF minimal écrit ici, sans dépendance.
 * Tout est produit localement, aucun appel réseau, aucune police embarquée —
 * condition E2EE (aucun contenu ne quitte le client) et aucune boîte
 * d'impression : le fichier est téléchargé directement. */
export interface NotePdfInput {
  markdown: string;
  title: string;
}

export interface NotePdfDownloadInput extends NotePdfInput {
  filename: string;
}

/** A4 portrait et marges de 20 mm, en points (1 pt = 1/72"). */
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56.7;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const INDENT_STEP = 18;

type PdfFont = "F1" | "F2" | "F3" | "F4";

/** Polices base 14 référencées par /F1.. /F4 : Helvetica et ses variantes plus
 * Courier pour le code. Aucun /FontFile : le lecteur fournit les glyphes. */
const FONT_BASE_FONT: Record<PdfFont, string> = {
  F1: "Helvetica",
  F2: "Helvetica-Bold",
  F3: "Helvetica-Oblique",
  F4: "Courier",
};
const FONT_NUMBERS: Record<PdfFont, number> = { F1: 3, F2: 4, F3: 5, F4: 6 };

/** Largeurs AFM Helvetica (codes 32 à 126), en 1/1000 em. */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
  584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584,
];

/** Largeurs AFM Helvetica-Bold (codes 32 à 126), en 1/1000 em. */
const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584,
  584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611,
  833, 722, 778, 667, 778, 722, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278,
  278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556,
  556, 500, 389, 280, 389, 584,
];

/** Lettres accentuées WinAnsi équivalentes à une lettre ASCII : les glyphes
 * accentués des polices base 14 partagent la largeur de la lettre de base.
 * Ce qui n'est pas listé ici tombe sur le repli conservateur de 1 em. */
const WINANSI_ASCII_ALIAS: Record<number, number> = {
  0xc0: 0x41,
  0xc1: 0x41,
  0xc2: 0x41,
  0xc3: 0x41,
  0xc4: 0x41,
  0xc5: 0x41,
  0xc7: 0x43,
  0xc8: 0x45,
  0xc9: 0x45,
  0xca: 0x45,
  0xcb: 0x45,
  0xcc: 0x49,
  0xcd: 0x49,
  0xce: 0x49,
  0xcf: 0x49,
  0xd1: 0x4e,
  0xd2: 0x4f,
  0xd3: 0x4f,
  0xd4: 0x4f,
  0xd5: 0x4f,
  0xd6: 0x4f,
  0xd8: 0x4f,
  0xd9: 0x55,
  0xda: 0x55,
  0xdb: 0x55,
  0xdc: 0x55,
  0xdd: 0x59,
  0xe0: 0x61,
  0xe1: 0x61,
  0xe2: 0x61,
  0xe3: 0x61,
  0xe4: 0x61,
  0xe5: 0x61,
  0xe7: 0x63,
  0xe8: 0x65,
  0xe9: 0x65,
  0xea: 0x65,
  0xeb: 0x65,
  0xec: 0x69,
  0xed: 0x69,
  0xee: 0x69,
  0xef: 0x69,
  0xf1: 0x6e,
  0xf2: 0x6f,
  0xf3: 0x6f,
  0xf4: 0x6f,
  0xf5: 0x6f,
  0xf6: 0x6f,
  0xf9: 0x75,
  0xfa: 0x75,
  0xfb: 0x75,
  0xfc: 0x75,
  0xfd: 0x79,
  0xff: 0x79,
  0x91: 0x27,
  0x92: 0x27,
};

/** Points de code cp1252 hors Latin-1 (WinAnsiEncoding). */
const CP1252_SPECIALS: Record<number, number> = {
  0x0152: 0x8c,
  0x0153: 0x9c,
  0x0160: 0x8a,
  0x0161: 0x9a,
  0x0178: 0x9f,
  0x017d: 0x8e,
  0x017e: 0x9e,
  0x0192: 0x83,
  0x02c6: 0x88,
  0x02dc: 0x98,
  0x2013: 0x96,
  0x2014: 0x97,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201a: 0x82,
  0x201c: 0x93,
  0x201d: 0x94,
  0x201e: 0x84,
  0x2020: 0x86,
  0x2021: 0x87,
  0x2022: 0x95,
  0x2026: 0x85,
  0x2030: 0x89,
  0x2039: 0x8b,
  0x203a: 0x9b,
  0x20ac: 0x80,
  0x2122: 0x99,
};

/** Octet WinAnsi d'un point de code, ou undefined si non représentable. */
function winAnsiByte(codePoint: number): number | undefined {
  if (codePoint >= 0x20 && codePoint <= 0x7e) {
    return codePoint;
  }
  if (codePoint >= 0xa0 && codePoint <= 0xff) {
    return codePoint;
  }
  return CP1252_SPECIALS[codePoint];
}

/** Largeur d'un point de code en 1/1000 em. Le repli vaut 1 em (1000) pour
 * tout caractère inconnu ou large : il surestime la largeur réelle, ce qui
 * garantit qu'aucune ligne calculée ne dépasse la largeur utile. */
function charWidth(font: PdfFont, codePoint: number): number {
  if (font === "F4") {
    return 600;
  }
  const byte = winAnsiByte(codePoint);
  const code =
    byte !== undefined && WINANSI_ASCII_ALIAS[byte] !== undefined
      ? WINANSI_ASCII_ALIAS[byte]
      : byte;
  if (code === undefined || code < 0x20 || code > 0x7e) {
    return 1000;
  }
  const widths = font === "F2" ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  return widths[code - 0x20] ?? 1000;
}

/** Largeur d'un fragment de texte en points. */
function measure(text: string, font: PdfFont, size: number): number {
  let units = 0;
  for (const char of text) {
    units += charWidth(font, char.codePointAt(0) ?? 0);
  }
  return (units * size) / 1000;
}

/** Chaîne d'octets Latin-1 (un caractère = un octet). */
function latin1Bytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

/** Littéral PDF entre parenthèses : antislash, parenthèses et octets de
 * contrôle échappés, texte converti en WinAnsi (non représentable → « ? »). */
function escapePdfString(value: string): string {
  let out = "";
  for (const char of value) {
    const byte = winAnsiByte(char.codePointAt(0) ?? 0) ?? 0x3f;
    if (byte === 0x5c) {
      out += "\\\\";
    } else if (byte === 0x28) {
      out += "\\(";
    } else if (byte === 0x29) {
      out += "\\)";
    } else if (byte < 0x20 || byte === 0x7f) {
      out += `\\${byte.toString(8).padStart(3, "0")}`;
    } else {
      out += String.fromCharCode(byte);
    }
  }
  return out;
}

/** Nombre PDF : sans notation exponentielle ni zéros superflus. */
function formatNumber(value: number): string {
  return String(Number(value.toFixed(3)));
}

interface PdfTextRun {
  font: PdfFont;
  text: string;
}

interface PdfLine {
  runs: PdfTextRun[];
  size: number;
  indent: number;
  /** Trait horizontal (hr) : aucun texte, seulement un tracé. */
  rule?: boolean;
  /** Interligne forcé (séparateur de blocs). */
  leading?: number;
}

interface LineContext {
  size: number;
  font: PdfFont;
  indent: number;
}

const HEADING_SIZES: Record<string, number> = {
  h1: 20,
  h2: 16,
  h3: 14,
  h4: 12,
  h5: 12,
  h6: 12,
};

function leading(size: number): number {
  return Math.round(size * 1.45);
}

function appendRun(runs: PdfTextRun[], font: PdfFont, text: string): void {
  if (text === "") {
    return;
  }
  const last = runs[runs.length - 1];
  if (last && last.font === font) {
    last.text += text;
  } else {
    runs.push({ font, text });
  }
}

/** Replie des fragments en lignes qui tiennent dans maxWidth. La mesure est
 * faite caractère par caractère avec le repli conservateur de charWidth ; un
 * mot plus long que la ligne est coupé en morceaux. */
function wrapRuns(
  runs: readonly PdfTextRun[],
  size: number,
  maxWidth: number,
): PdfTextRun[][] {
  const lines: PdfTextRun[][] = [];
  let current: PdfTextRun[] = [];
  let width = 0;
  const flush = () => {
    if (current.length > 0) {
      lines.push(current);
      current = [];
      width = 0;
    }
  };

  for (const run of runs) {
    for (const token of run.text.split(/(\s+)/u)) {
      if (token === "") {
        continue;
      }
      if (/^\s+$/u.test(token)) {
        if (current.length === 0) {
          continue; // espaces de tête ignorés
        }
        appendRun(current, run.font, token);
        width += measure(token, run.font, size);
        continue;
      }
      let rest = token;
      while (rest !== "") {
        const restWidth = measure(rest, run.font, size);
        if (current.length > 0 && width + restWidth > maxWidth) {
          flush();
          continue;
        }
        if (current.length > 0 || restWidth <= maxWidth) {
          appendRun(current, run.font, rest);
          width += restWidth;
          break;
        }
        // Ligne vide et mot plus long que la ligne : coupe au plus grand
        // préfixe qui tient, au moins un caractère pour toujours progresser.
        let cut = 0;
        let cutWidth = 0;
        for (const char of rest) {
          const next = cutWidth + measure(char, run.font, size);
          if (next > maxWidth && cut > 0) {
            break;
          }
          cutWidth = next;
          cut += char.length;
        }
        const piece = rest.slice(0, cut);
        appendRun(current, run.font, piece);
        flush();
        rest = rest.slice(cut);
      }
    }
  }
  flush();
  return lines;
}

function wrapToLines(
  runs: readonly PdfTextRun[],
  context: LineContext,
  lines: PdfLine[],
  prefix?: PdfTextRun,
): void {
  const content = prefix ? [prefix, ...runs] : [...runs];
  for (const wrapped of wrapRuns(
    content,
    context.size,
    CONTENT_WIDTH - context.indent,
  )) {
    lines.push({ runs: wrapped, indent: context.indent, size: context.size });
  }
}

/** Fragments en ligne d'un texte : gras (`strong`), italique (`em`), code,
 * liens http(s) suffixés de leur URL, wikiliens réduits à leur texte, sauts de
 * ligne explicites conservés. Les images ne sont pas rendues. */
function collectInline(
  node: Node,
  font: PdfFont,
  groups: PdfTextRun[][],
): void {
  if (node.nodeType === 3) {
    appendRun(groups[groups.length - 1]!, font, node.nodeValue ?? "");
    return;
  }
  if (node.nodeType !== 1) {
    return; // commentaires et nœuds non rendus ignorés
  }
  const element = node as Element;
  switch (element.tagName.toLowerCase()) {
    case "br":
      groups.push([]);
      return;
    case "strong":
    case "b":
      collectChildren(element, "F2", groups);
      return;
    case "em":
    case "i":
      collectChildren(element, "F3", groups);
      return;
    case "code":
      collectChildren(element, "F4", groups);
      return;
    case "img":
      return; // les images ne sont pas rendues dans le PDF
    case "a": {
      collectChildren(element, font, groups);
      const href = element.getAttribute("href") ?? "";
      if (/^https?:\/\//iu.test(href)) {
        appendRun(groups[groups.length - 1]!, font, ` (${href})`);
      }
      return;
    }
    default:
      // Couvre aussi les ancres de wikilien : seul leur texte est conservé,
      // jamais leur cible interne.
      collectChildren(element, font, groups);
  }
}

function collectChildren(
  element: Element,
  font: PdfFont,
  groups: PdfTextRun[][],
): void {
  for (const child of element.childNodes) {
    collectInline(child, font, groups);
  }
}

/** Lignes d'un contenu en ligne (le titre passé en argument compris). */
function inlineLines(
  nodes: Iterable<Node>,
  context: LineContext,
  prefix?: PdfTextRun,
): PdfLine[] {
  const groups: PdfTextRun[][] = [[]];
  for (const node of nodes) {
    collectInline(node, context.font, groups);
  }
  const lines: PdfLine[] = [];
  for (const [index, group] of groups.entries()) {
    wrapToLines(group, context, lines, index === 0 ? prefix : undefined);
  }
  return lines;
}

function pushSpacer(lines: PdfLine[], size: number): void {
  lines.push({
    indent: 0,
    leading: Math.round(size * 0.5),
    runs: [],
    size,
  });
}

function listLines(
  element: Element,
  ordered: boolean,
  context: LineContext,
): PdfLine[] {
  const lines: PdfLine[] = [];
  let index = 1;
  for (const item of element.children) {
    if (item.tagName.toLowerCase() !== "li") {
      continue;
    }
    const marker = ordered ? `${index}. ` : "\u2022 ";
    index += 1;
    const itemContext: LineContext = {
      font: context.font,
      indent: context.indent + INDENT_STEP,
      size: context.size,
    };
    const inlineNodes: Node[] = [];
    const nestedLists: Element[] = [];
    for (const child of item.childNodes) {
      if (
        child.nodeType === 1 &&
        /^(ul|ol)$/iu.test((child as Element).tagName)
      ) {
        nestedLists.push(child as Element);
      } else {
        inlineNodes.push(child);
      }
    }
    lines.push(
      ...inlineLines(inlineNodes, itemContext, {
        font: context.font,
        text: marker,
      }),
    );
    for (const nested of nestedLists) {
      lines.push(
        ...listLines(
          nested,
          nested.tagName.toLowerCase() === "ol",
          itemContext,
        ),
      );
    }
  }
  return lines;
}

function tableLines(element: Element): PdfLine[] {
  const lines: PdfLine[] = [];
  for (const row of element.querySelectorAll("tr")) {
    const cells = [...row.children].map((cell) =>
      (cell.textContent ?? "").replaceAll(/\s+/gu, " ").trim(),
    );
    if (cells.length === 0) {
      continue;
    }
    wrapToLines(
      [{ font: "F1", text: cells.join(" | ") }],
      { font: "F1", indent: 0, size: 10 },
      lines,
    );
  }
  return lines;
}

function codeBlockLines(element: Element): PdfLine[] {
  const lines: PdfLine[] = [];
  const context: LineContext = { font: "F4", indent: 0, size: 10 };
  for (const codeLine of (element.textContent ?? "").split("\n")) {
    wrapToLines([{ font: "F4", text: codeLine }], context, lines);
  }
  return lines;
}

/** Parcours du HTML déjà assaini par renderMarkdown : les images et les
 * attributs de style ne sont jamais utilisés, seul le texte est repris. */
function blockLines(element: Element, context: LineContext): PdfLine[] {
  const tag = element.tagName.toLowerCase();
  const headingSize = HEADING_SIZES[tag];
  if (headingSize !== undefined) {
    const lines = inlineLines(element.childNodes, {
      font: "F2",
      indent: context.indent,
      size: headingSize,
    });
    pushSpacer(lines, headingSize);
    return lines;
  }
  switch (tag) {
    case "ul":
      return listLines(element, false, context);
    case "ol":
      return listLines(element, true, context);
    case "blockquote": {
      const quoteContext: LineContext = {
        font: "F3",
        indent: context.indent + INDENT_STEP,
        size: context.size,
      };
      const lines: PdfLine[] = [];
      for (const child of element.children) {
        lines.push(...blockLines(child, quoteContext));
      }
      pushSpacer(lines, context.size);
      return lines;
    }
    case "pre":
      return codeBlockLines(element);
    case "table":
      return tableLines(element);
    case "hr":
      return [{ indent: 0, rule: true, runs: [], size: 11 }];
    case "br":
      return [{ indent: 0, runs: [], size: context.size }];
    default: {
      const lines = inlineLines(element.childNodes, context);
      pushSpacer(lines, context.size);
      return lines;
    }
  }
}

/** Construit les lignes de texte de la note, titre compris. */
function layoutNoteLines(markdown: string, title: string): PdfLine[] {
  const lines: PdfLine[] = [];
  const titleRuns: PdfTextRun[] = [{ font: "F2", text: title }];
  wrapToLines(titleRuns, { font: "F2", indent: 0, size: 20 }, lines);
  pushSpacer(lines, 20);

  const document = new DOMParser().parseFromString(
    renderMarkdown(markdown),
    "text/html",
  );
  for (const child of document.body.children) {
    lines.push(...blockLines(child, { font: "F1", indent: 0, size: 11 }));
  }
  return lines;
}

interface PlacedLine {
  line: PdfLine;
  y: number;
}

/** Découpe les lignes en pages : une ligne qui passerait sous la marge basse
 * ouvre une page suivante. */
function paginate(lines: readonly PdfLine[]): PlacedLine[][] {
  const pages: PlacedLine[][] = [];
  let page: PlacedLine[] = [];
  let y = PAGE_HEIGHT - MARGIN;

  for (const line of lines) {
    const advance = line.leading ?? leading(line.size);
    const hasContent = line.runs.length > 0 || line.rule === true;
    if (hasContent && y - advance < MARGIN) {
      pages.push(page);
      page = [];
      y = PAGE_HEIGHT - MARGIN;
    }
    y -= advance;
    if (hasContent) {
      page.push({ line, y });
    }
  }
  pages.push(page);
  return pages;
}

function pageContentStream(page: readonly PlacedLine[]): string {
  let stream = "";
  for (const { line, y } of page) {
    if (line.rule === true) {
      stream += `0.5 w ${formatNumber(MARGIN)} ${formatNumber(y)} m ${formatNumber(PAGE_WIDTH - MARGIN)} ${formatNumber(y)} l S\n`;
      continue;
    }
    if (line.runs.length === 0) {
      continue;
    }
    stream += "BT\n";
    let x = MARGIN + line.indent;
    for (const run of line.runs) {
      stream += `/${run.font} ${formatNumber(line.size)} Tf\n`;
      stream += `1 0 0 1 ${formatNumber(x)} ${formatNumber(y)} Tm\n`;
      stream += `(${escapePdfString(run.text)}) Tj\n`;
      x += measure(run.text, run.font, line.size);
    }
    stream += "ET\n";
  }
  return stream;
}

function fontResources(): string {
  const entries = (Object.keys(FONT_NUMBERS) as PdfFont[]).map(
    (font) => `/${font} ${FONT_NUMBERS[font]} 0 R`,
  );
  return `<< /Font << ${entries.join(" ")} >> >>`;
}

/** Assemble les objets numérotés en un fichier PDF (en-tête, xref, trailer). */
function assemblePdf(objects: readonly (string | undefined)[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const write = (text: string) => {
    const bytes = latin1Bytes(text);
    chunks.push(bytes);
    offset += bytes.length;
  };

  write("%PDF-1.4\n");
  // Ligne de commentaire binaire : les quatre octets > 127 évitent que des
  // transferts en mode texte n'abîment le fichier.
  write("%\u00e2\u00e3\u00cf\u00d3\n");

  const offsets: number[] = [];
  for (let number = 1; number < objects.length; number += 1) {
    const body = objects[number];
    if (body === undefined) {
      throw new Error(`Objet PDF ${number} manquant`);
    }
    offsets[number] = offset;
    write(`${number} 0 obj\n${body}\nendobj\n`);
  }

  const xrefOffset = offset;
  const size = objects.length;
  let xref = `xref\n0 ${size}\n0000000000 65535 f\r\n`;
  for (let number = 1; number < size; number += 1) {
    xref += `${String(offsets[number]).padStart(10, "0")} 00000 n\r\n`;
  }
  write(xref);
  write(
    `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );

  const pdf = new Uint8Array(offset);
  let cursor = 0;
  for (const chunk of chunks) {
    pdf.set(chunk, cursor);
    cursor += chunk.length;
  }
  return pdf;
}

/** Construit un PDF A4 en mémoire, texte sélectionnable, polices base 14. */
export function buildNotePdf({ markdown, title }: NotePdfInput): Uint8Array {
  const pages = paginate(layoutNoteLines(markdown, title));
  const objects: (string | undefined)[] = [undefined, undefined, undefined];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";

  for (const font of Object.keys(FONT_NUMBERS) as PdfFont[]) {
    objects[FONT_NUMBERS[font]] =
      `<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_BASE_FONT[font]} /Encoding /WinAnsiEncoding >>`;
  }

  const kids: string[] = [];
  pages.forEach((page, index) => {
    const pageNumber = 7 + index * 2;
    const contentNumber = pageNumber + 1;
    const stream = pageContentStream(page);
    kids.push(`${pageNumber} 0 R`);
    objects[pageNumber] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${formatNumber(PAGE_WIDTH)} ${formatNumber(PAGE_HEIGHT)}] ` +
      `/Resources ${fontResources()} /Contents ${contentNumber} 0 R >>`;
    objects[contentNumber] =
      `<< /Length ${latin1Bytes(stream).length} >>\nstream\n${stream}\nendstream`;
  });
  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;

  return assemblePdf(objects);
}

/** Télécharge le PDF construit localement : Blob + lien `download`, aucun
 * appel réseau et aucune boîte d'impression. */
export function downloadNotePdf({
  filename,
  markdown,
  title,
}: NotePdfDownloadInput): void {
  const bytes = buildNotePdf({ markdown, title });
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
