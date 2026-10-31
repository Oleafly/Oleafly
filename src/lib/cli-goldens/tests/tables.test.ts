import path from "node:path";
import { describe, it } from "vitest";
import { BIBTEX_DIRECTIVES, BIBTEX_ENTRY_TYPES } from "@oleafly/latex";
import { PROOFREADING_LIMITS, PROSE_PLACEHOLDER } from "@oleafly/editor/prose";
import { annotate, message, SUBMISSION_PROFILES } from "@oleafly/preflight";
import { BUILTIN_PROOFREADING_WORDS } from "@/lib/proofreading/ignored";
import { ACADEMIC_PROFILE_RULES, HARPER_PANICKING_RULES } from "@/lib/proofreading/lint-profile";
import { expectGolden, LINT_FIXTURES, PREFLIGHT_FIXTURES, readJson, REPO } from "./support";

const STANDARD_IDS = [
  "pdf-untagged-output",
  "pdf-structure-missing",
  "pdf-structure-single-pass",
  "pdf-untagged-content",
  "pdf-suspects",
  "pdf-ua-claim-mismatch",
  "figure-alt",
  "output-figure-alt",
  "output-formula-alt",
  "output-table-headers",
  "table-header-rows",
  "heading-skip",
  "empty-heading",
  "output-heading-skip",
  "no-lang",
  "no-title",
  "pdf-xmp-title",
  "pdf-lang-title",
  "pdf-display-doc-title",
  "ua-standard-without-title",
  "ua-standard-on-tectonic",
  "pdf-link-alt",
  "link-text",
  "pdf-no-bookmarks",
  "pdf-reading-order",
  "reading-order-risk",
  "multi-column-reading-order-risk",
  "output-small-text",
  "color-only",
  "no-glyphtounicode",
  "pdf-garbled",
  "pdf-selectable",
  "icon-near-contact",
  "layout-table",
  "output-tagpdf-warning",
  "output-tagging-status",
  "pdf-metadata-extraction-failed",
  "pdf-mark-info-extraction-failed",
  "pdf-structure-extraction-failed",
] as const;

describe("data table goldens", () => {
  it("preflight tables match the committed golden", () => {
    const standards: Record<string, unknown> = {};
    for (const id of STANDARD_IDS) {
      const finding = annotate(
        {
          id,
          lens: "a11y",
          severity: "info",
          title: message("rules.figure-alt.title"),
          detail: message("rules.figure-alt.detail"),
        },
        "source-heuristic",
      );
      standards[id] = { standards: finding.standards, machineCheckable: finding.machineCheckable };
    }
    expectGolden(path.join(PREFLIGHT_FIXTURES, "expected", "tables.json"), {
      standards,
      profiles: SUBMISSION_PROFILES,
      bibtexEntryTypes: BIBTEX_ENTRY_TYPES.map(({ name, required }) => ({ name, required })),
      bibtexDirectives: BIBTEX_DIRECTIVES,
    });
  });

  it("lint tables match the committed golden", () => {
    const harper = readJson<{ version: string }>(path.join(REPO, "node_modules/harper.js/package.json"));
    expectGolden(path.join(LINT_FIXTURES, "expected", "tables.json"), {
      academicRules: ACADEMIC_PROFILE_RULES.map((entry) => entry.rule),
      panickingRules: HARPER_PANICKING_RULES,
      builtinWords: [...BUILTIN_PROOFREADING_WORDS],
      placeholder: PROSE_PLACEHOLDER,
      grammarCharacterLimit: PROOFREADING_LIMITS.grammarCharacters,
      harperVersion: harper.version,
    });
  });
});
