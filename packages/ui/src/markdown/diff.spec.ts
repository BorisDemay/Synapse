import { describe, expect, it } from "vitest";

import { readableLineDiff } from "./diff";

describe("readableLineDiff", () => {
  it("keeps the common context and marks only the changed region", () => {
    expect(readableLineDiff("one\ntwo\nthree", "one\nTWO\nthree")).toEqual([
      { kind: "context", text: "one" },
      { kind: "removed", text: "two" },
      { kind: "added", text: "TWO" },
      { kind: "context", text: "three" },
    ]);
  });
});
