import type { Finding } from "@oleafly/preflight";
import { describe, expect, it } from "vitest";
import { planWritingFixes } from "./writing-fixes";

function finding(from: number, to: number, insert: string, extra: Partial<Finding> = {}): Finding {
  return {
    id: "writing-test",
    lens: "writing",
    severity: "info",
    title: { key: "finding.ignore" },
    detail: { key: "finding.ignore" },
    from,
    to,
    fix: { label: { key: "fixes.insertSpace" }, edits: [{ from, to, insert }] },
    ...extra,
  };
}

describe("planWritingFixes", () => {
  it("groups fixes by file and skips one that overlaps an earlier fix", () => {
    const plan = planWritingFixes(
      [
        finding(5, 5, " "),
        finding(10, 12, "~"),
        finding(11, 13, "x"),
        finding(5, 5, "!"),
        finding(2, 3, "a", { file: "sections/intro.tex" }),
      ],
      "main.tex",
    );
    expect(plan.skipped).toBe(2);
    expect(plan.applied).toHaveLength(3);
    expect(plan.files.get("main.tex")).toEqual([
      { from: 5, to: 5, insert: " " },
      { from: 10, to: 12, insert: "~" },
    ]);
    expect(plan.files.get("sections/intro.tex")).toEqual([{ from: 2, to: 3, insert: "a" }]);
  });

  it("keeps a multi-file fix together or not at all", () => {
    const multi: Finding = {
      ...finding(0, 4, "\\Net{}"),
      fix: {
        label: { key: "fixes.insertSpace" },
        edits: [{ from: 0, to: 4, insert: "\\Net{}" }],
        otherFiles: [{ file: "other.tex", edits: [{ from: 7, to: 11, insert: "\\Net{}" }] }],
      },
    };
    const clash = finding(8, 9, "y", { file: "other.tex" });
    const plan = planWritingFixes([clash, multi], "main.tex");
    expect(plan.applied).toEqual([clash]);
    expect(plan.skipped).toBe(1);
    expect(plan.files.has("main.tex")).toBe(false);
  });

  it("ignores findings without a fix", () => {
    const plan = planWritingFixes([{ ...finding(1, 2, "x"), fix: undefined }], "main.tex");
    expect(plan.applied).toEqual([]);
    expect(plan.skipped).toBe(0);
  });
});
