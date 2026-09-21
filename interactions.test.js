import { describe, expect, test } from "bun:test";
import { completionPercent, hasCollapsedAncestor } from "./interactions.js";

describe("interactive tree helpers", () => {
  test("calculates completion and hides all nested descendants of a collapsed branch", () => {
    const node = (parent, expanded = "true") => ({
      dataset: { parent },
      getAttribute: () => expanded,
    });
    const rows = new Map([
      ["root", node(undefined, "false")],
      ["child", node("root")],
    ]);

    expect(completionPercent(2, 10)).toBe(20);
    expect(hasCollapsedAncestor(node("child"), rows)).toBe(true);
  });
});
