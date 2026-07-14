import { linter, type Diagnostic } from "@codemirror/lint";
import { runSourceRules } from "@openleaf/preflight";

// Only findings that map to a source range are shown here; whole-document and
// PDF findings live in the Preflight panel instead.
export function createPreflightLinter() {
  return linter(
    (view): Diagnostic[] => {
      const diags: Diagnostic[] = [];
      for (const f of runSourceRules(view.state.doc.toString())) {
        if (typeof f.from !== "number" || typeof f.to !== "number") continue;
        diags.push({
          from: f.from,
          to: f.to,
          severity: f.severity,
          message: `${f.title}. ${f.detail}`,
          source: "preflight",
        });
      }
      return diags;
    },
    { delay: 900 },
  );
}
