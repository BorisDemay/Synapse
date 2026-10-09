export interface LineDiff {
  kind: "added" | "context" | "removed";
  text: string;
}

/**
 * A bounded, linear diff for an unlocked-client view. It deliberately avoids
 * quadratic LCS work on a large note while retaining the unchanged prefix and
 * suffix needed to read a conflict.
 */
export function readableLineDiff(base: string, variant: string): LineDiff[] {
  const before = base.split("\n");
  const after = variant.split("\n");
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  ) {
    suffix += 1;
  }
  return [
    ...before
      .slice(0, prefix)
      .map((text) => ({ kind: "context" as const, text })),
    ...before
      .slice(prefix, before.length - suffix)
      .map((text) => ({ kind: "removed" as const, text })),
    ...after
      .slice(prefix, after.length - suffix)
      .map((text) => ({ kind: "added" as const, text })),
    ...before
      .slice(before.length - suffix)
      .map((text) => ({ kind: "context" as const, text })),
  ];
}
