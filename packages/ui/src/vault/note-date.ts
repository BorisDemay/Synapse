import { parseNote } from "../markdown/parse";

function parsePropertyDate(
  value: string | string[] | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) {
    return undefined;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Extracts the 48-bit Unix-ms timestamp embedded in a UUID v7 string. */
export function uuidV7Timestamp(id: string): number | undefined {
  const hex = id.replace(/-/gu, "");
  if (hex.length !== 32) {
    return undefined;
  }
  const timestamp = Number(BigInt(`0x${hex.slice(0, 12)}`));
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return undefined;
  }
  return timestamp;
}

/**
 * Best-effort last-modified timestamp for vault tree ordering.
 * Priority: revision history time, YAML updated/modified/date, UUID v7 creation time.
 */
export function noteUpdatedAt(
  id: string,
  content: string,
  recordedAt?: string,
): number {
  if (recordedAt) {
    const parsed = Date.parse(recordedAt);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  const properties = parseNote(content).properties;
  for (const key of ["updated", "modified", "date"] as const) {
    const parsed = parsePropertyDate(properties[key]);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return uuidV7Timestamp(id) ?? 0;
}
