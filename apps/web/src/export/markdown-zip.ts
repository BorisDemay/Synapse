export interface MarkdownExportNote {
  content: string;
  path?: string;
  title: string;
}

export interface MarkdownExportFile {
  bytes: Uint8Array;
  path: string;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(target: Uint8Array, offset: number, value: number) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32(target: Uint8Array, offset: number, value: number) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

export function markdownExportFilename(
  title: string,
  used: readonly string[],
): string {
  const stem =
    title
      .replaceAll(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replaceAll(/^\.+/g, "")
      .replaceAll(/-+/g, "-")
      .replaceAll(/^-+|-+$/g, "")
      .slice(0, 80) || "note";
  let filename = `${stem}.md`;
  let suffix = 2;
  while (used.includes(filename)) {
    filename = `${stem}-${suffix}.md`;
    suffix += 1;
  }
  return filename;
}

function zipSafePath(path: string): string {
  return (
    path
      .replaceAll("\\", "/")
      .replaceAll("..", "")
      .replace(/^\/+/u, "")
      .replaceAll(/[<>:"|?*\u0000-\u001f]/g, "-") || "note.md"
  );
}

export function buildMarkdownZip(
  notes: readonly MarkdownExportNote[],
  files: readonly MarkdownExportFile[] = [],
): Uint8Array {
  const encoder = new TextEncoder();
  const packed: {
    crc: number;
    data: Uint8Array;
    name: Uint8Array;
  }[] = [];
  const usedNames: string[] = [];
  for (const note of notes) {
    const filename = note.path
      ? zipSafePath(note.path)
      : markdownExportFilename(note.title, usedNames);
    usedNames.push(filename);
    const name = encoder.encode(filename);
    const data = encoder.encode(note.content);
    packed.push({ crc: crc32(data), data, name });
  }
  for (const file of files) {
    const filename = zipSafePath(file.path);
    usedNames.push(filename);
    packed.push({
      crc: crc32(file.bytes),
      data: file.bytes,
      name: encoder.encode(filename),
    });
  }

  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;
  for (const file of packed) {
    const local = new Uint8Array(30 + file.name.length + file.data.length);
    writeUint32(local, 0, 0x04034b50);
    writeUint16(local, 4, 20);
    writeUint16(local, 6, 1 << 11);
    writeUint16(local, 8, 0);
    writeUint16(local, 10, 0);
    writeUint16(local, 12, 0);
    writeUint32(local, 14, file.crc);
    writeUint32(local, 18, file.data.length);
    writeUint32(local, 22, file.data.length);
    writeUint16(local, 26, file.name.length);
    writeUint16(local, 28, 0);
    local.set(file.name, 30);
    local.set(file.data, 30 + file.name.length);
    localChunks.push(local);

    const central = new Uint8Array(46 + file.name.length);
    writeUint32(central, 0, 0x02014b50);
    writeUint16(central, 4, 20);
    writeUint16(central, 6, 20);
    writeUint16(central, 8, 1 << 11);
    writeUint16(central, 10, 0);
    writeUint16(central, 12, 0);
    writeUint16(central, 14, 0);
    writeUint32(central, 16, file.crc);
    writeUint32(central, 20, file.data.length);
    writeUint32(central, 24, file.data.length);
    writeUint16(central, 28, file.name.length);
    writeUint16(central, 30, 0);
    writeUint16(central, 32, 0);
    writeUint16(central, 34, 0);
    writeUint16(central, 36, 0);
    writeUint32(central, 38, 0);
    writeUint32(central, 42, offset);
    central.set(file.name, 46);
    centralChunks.push(central);
    offset += local.length;
  }

  const centralSize = centralChunks.reduce(
    (sum, chunk) => sum + chunk.length,
    0,
  );
  const end = new Uint8Array(22);
  writeUint32(end, 0, 0x06054b50);
  writeUint16(end, 4, 0);
  writeUint16(end, 6, 0);
  writeUint16(end, 8, packed.length);
  writeUint16(end, 10, packed.length);
  writeUint32(end, 12, centralSize);
  writeUint32(end, 16, offset);
  writeUint16(end, 20, 0);

  const total = offset + centralSize + end.length;
  const zip = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of [...localChunks, ...centralChunks, end]) {
    zip.set(chunk, cursor);
    cursor += chunk.length;
  }
  return zip;
}
