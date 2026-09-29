import { describe, expect, it, vi } from "vitest";

import { buildNotePdf, downloadNotePdf } from "./note-pdf";

/** Vue Latin-1 des octets : chaque caractère vaut exactement un octet, donc un
 * index de chaîne est un offset d'octet. Indispensable pour vérifier la table
 * xref octet par octet. */
function latin1(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) {
    text += String.fromCharCode(byte);
  }
  return text;
}

function noteText(bytes: Uint8Array): string {
  return latin1(bytes);
}

/** Décode une chaîne littérale PDF (antislashs et octals résolus). */
function decodeLiteral(value: string): string {
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char !== "\\") {
      out += char;
      continue;
    }
    index += 1;
    const next = value[index]!;
    if (next >= "0" && next <= "7") {
      let octal = next;
      while (
        octal.length < 3 &&
        value[index + 1] !== undefined &&
        value[index + 1]! >= "0" &&
        value[index + 1]! <= "7"
      ) {
        index += 1;
        octal += value[index]!;
      }
      out += String.fromCharCode(Number.parseInt(octal, 8));
    } else if (next === "n") {
      out += "\n";
    } else if (next === "r") {
      out += "\r";
    } else if (next === "t") {
      out += "\t";
    } else {
      out += next;
    }
  }
  return out;
}

/** Textes réellement dessinés, dans l'ordre des opérateurs Tj. */
function drawnText(text: string): string[] {
  return [...text.matchAll(/\(((?:\\.|[^()\\])*)\) Tj/gu)].map((match) =>
    decodeLiteral(match[1]!),
  );
}

describe("buildNotePdf", () => {
  it("produit un fichier PDF 1.4 complet", () => {
    const bytes = buildNotePdf({ markdown: "Bonjour.", title: "Note" });
    const text = noteText(bytes);

    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text).toContain("/Type /Catalog");
    expect(text).toContain("/Type /Page");
    expect(text).toContain("/Encoding /WinAnsiEncoding");
    expect(text).toContain("trailer");
    expect(text).toContain("startxref");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("commence par un commentaire binaire de 4 octets > 127", () => {
    const bytes = buildNotePdf({ markdown: "Bonjour.", title: "Note" });

    expect(bytes[9]).toBe(0x25); // « % » juste après la ligne %PDF-1.4\n
    for (let index = 10; index < 14; index += 1) {
      expect(bytes[index]).toBeGreaterThan(127);
    }
  });

  it("écrit une table xref dont chaque offset pointe exactement sur son objet", () => {
    const bytes = buildNotePdf({
      markdown: "## Section\n\nUn paragraphe.\n\n- un\n- deux",
      title: "Note",
    });
    const text = noteText(bytes);

    const xrefIndex = text.indexOf("\nxref\n");
    expect(xrefIndex).toBeGreaterThan(0);
    const trailerIndex = text.indexOf("trailer", xrefIndex);
    expect(trailerIndex).toBeGreaterThan(xrefIndex);
    const table = text.slice(xrefIndex, trailerIndex);

    const entries = [...table.matchAll(/^(\d{10}) (\d{5}) ([nf])\r?\n/gmu)].map(
      (match) => ({
        generation: match[2]!,
        kind: match[3]!,
        offset: Number(match[1]!),
      }),
    );

    expect(entries.length).toBeGreaterThan(5);
    expect(entries[0]).toEqual({
      generation: "65535",
      kind: "f",
      offset: 0,
    });

    for (const [index, entry] of entries.entries()) {
      if (entry.kind === "f") {
        expect(index).toBe(0);
        continue;
      }
      expect(entry.generation).toBe("00000");
      expect(
        text.slice(entry.offset, entry.offset + `${index} 0 obj`.length),
      ).toBe(`${index} 0 obj`);
    }
  });

  it("fait pointer startxref sur le mot-clé xref et déclare /Size", () => {
    const bytes = buildNotePdf({ markdown: "Texte", title: "Note" });
    const text = noteText(bytes);

    const startxref = /startxref\r?\n(\d+)\r?\n%%EOF/gu.exec(text);
    expect(startxref).not.toBeNull();
    const offset = Number(startxref![1]);
    expect(text.slice(offset, offset + "xref".length)).toBe("xref");

    const size = /\/Size (\d+)/gu.exec(text);
    const xrefCount = /xref\n0 (\d+)\n/u.exec(text);
    expect(Number(xrefCount![1])).toBe(Number(size![1]));
  });

  it("encode le texte en WinAnsi et échoue les parenthèses et l'antislash", () => {
    const bytes = buildNotePdf({
      markdown: "Café crème (test) et antislash \\ ici.",
      title: "Accents",
    });
    const text = noteText(bytes);

    // Le « é » est l'octet WinAnsi 0xE9, jamais la séquence UTF-8 0xC3 0xA9.
    expect(text).toContain("Caf\u00e9 cr\u00e8me");
    expect(text).toContain("\\(test\\)");
    expect(text).toContain("\\\\ ici");
    const utf8Pairs = [...bytes].some(
      (byte, index) => byte === 0xc3 && bytes[index + 1] === 0xa9,
    );
    expect(utf8Pairs).toBe(false);
  });

  it("remplace les caractères non représentables par « ? »", () => {
    const text = noteText(
      buildNotePdf({ markdown: "Emoji 😀 et CJK 漢字.", title: "Note" }),
    );

    expect(text).toContain("Emoji ? et CJK ??");
  });

  it("coupe un paragraphe long sur plusieurs lignes", () => {
    const paragraph = "mot ".repeat(200).trim();
    const text = noteText(buildNotePdf({ markdown: paragraph, title: "Long" }));
    const stream = text.slice(
      text.indexOf("stream\n"),
      text.indexOf("\nendstream"),
    );

    expect([...stream.matchAll(/\bTj\b/gu)].length).toBeGreaterThan(1);
  });

  it("coupe une ligne de code trop longue pour la largeur utile", () => {
    const wide = "x".repeat(400);
    const drawn = drawnText(
      noteText(
        buildNotePdf({ markdown: `\`\`\`\n${wide}\n\`\`\``, title: "Code" }),
      ),
    ).filter((value) => value.startsWith("x"));

    // 10 pt Courier = 6 pt par caractère : 80 caractères tiennent dans 481,88 pt.
    expect(drawn.length).toBeGreaterThan(1);
    for (const line of drawn) {
      expect(line.length).toBeLessThanOrEqual(80);
    }
    expect(drawn.join("")).toBe(wide);
  });

  it("pagine une note très longue", () => {
    const text = noteText(
      buildNotePdf({
        markdown: Array.from(
          { length: 120 },
          (_, index) => `## Titre ${index}\n\nParagraphe ${index}.`,
        ).join("\n\n"),
        title: "Pagination",
      }),
    );

    const count = /\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/u.exec(text);
    expect(Number(count![1])).toBeGreaterThan(1);
    expect([...text.matchAll(/\/Type \/Page[^s]/gu)].length).toBe(
      Number(count![1]),
    );
  });

  it("ne référence ni URI, ni fichier embarqué, ni police embarquée", () => {
    const text = noteText(
      buildNotePdf({
        markdown: "Un **gras**, un *italique*, du `code` et rien d'autre.",
        title: "Sans ressource",
      }),
    );

    expect(text).not.toContain("/URI");
    expect(text).not.toContain("/EmbeddedFile");
    expect(text).not.toContain("/FontFile");
    expect(text).not.toContain("/Subtype /Image");
  });

  it("n'ajoute l'URL d'un lien que pour les liens http(s)", () => {
    const text = noteText(
      buildNotePdf({
        markdown:
          "[site](https://exemple.test/page) et [local](#ancre) et [[Autre note|un wikilien]].",
        title: "Liens",
      }),
    );

    const drawn = drawnText(text).join("\n");

    expect(drawn).toContain("site (https://exemple.test/page)");
    expect(drawn).toContain("local");
    expect(drawn).toContain("un wikilien");
    expect(drawn).not.toContain("#ancre");
  });

  it("utilise le titre passé en argument comme premier titre", () => {
    const text = noteText(
      buildNotePdf({ markdown: "Corps.", title: "Mon titre" }),
    );
    const h1 = /%PDF-1\.4\n%.{4}\n[^]*?\/F2 20 Tf[^]*?\(Mon titre\) Tj/u;

    expect(text).toMatch(h1);
  });

  it("aplatit les tableaux en lignes de cellules", () => {
    const text = noteText(
      buildNotePdf({
        markdown: "| A | B |\n| --- | --- |\n| 1 | 2 |",
        title: "Tableau",
      }),
    );

    expect(text).toContain("(A | B)");
    expect(text).toContain("(1 | 2)");
  });

  it("rend les titres, listes, citations et blocs de code", () => {
    const text = noteText(
      buildNotePdf({
        markdown:
          "### Sous-titre\n\n- puce\n\n1. premier\n\n> citation\n\n```\nconst x = 1;\n```",
        title: "Structure",
      }),
    );

    expect(text).toContain("/F2 14 Tf");
    // Puce WinAnsi (octet 0x95), jamais l'UTF-8 de U+2022.
    expect(drawnText(text)).toContain("\u0095 puce");
    expect(drawnText(text)).toContain("1. premier");
    expect(drawnText(text)).toContain("citation");
    expect(text).toContain("/F4 10 Tf");
    expect(drawnText(text)).toContain("const x = 1;");
  });
});

describe("downloadNotePdf", () => {
  it("télécharge un fichier .pdf via une URL blob révoquée, sans impression", async () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:note-pdf");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const createElement = vi.spyOn(document, "createElement");

    try {
      downloadNotePdf({
        filename: "Note épinglée.pdf",
        markdown: "Bonjour.",
        title: "Note épinglée",
      });

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const blob = createObjectURL.mock.calls[0][0];
      expect(blob.type).toBe("application/pdf");
      // jsdom ne fournit pas Blob.arrayBuffer : on lit le blob par FileReader.
      const bytes = await new Promise<Uint8Array>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          resolve(new Uint8Array(reader.result as ArrayBuffer));
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
      });
      expect(latin1(bytes)).toContain("%PDF-1.4");

      const anchor = createElement.mock.results
        .map((result) => result.value)
        .find(
          (element): element is HTMLAnchorElement =>
            element instanceof HTMLAnchorElement,
        );
      expect(anchor?.download).toBe("Note épinglée.pdf");
      expect(anchor?.getAttribute("href")).toBe("blob:note-pdf");
      expect(anchorClick).toHaveBeenCalledTimes(1);
      // Le lien est retiré du document une fois le clic déclenché.
      expect(document.body.querySelector("a[download]")).toBeNull();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:note-pdf");
    } finally {
      delete (URL as unknown as Record<string, unknown>).createObjectURL;
      delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
      anchorClick.mockRestore();
      createElement.mockRestore();
    }
  });
});
