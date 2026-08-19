import type { Finding, PdfFacts } from "./types";

export interface CompileContext {
  status: "idle" | "success" | "error" | "unavailable";
  log: string;
}

function finding(
  id: string,
  severity: Finding["severity"],
  title: string,
  detail: string,
): Finding {
  return { id, lens: "compile", severity, title, detail, certainty: "verified" };
}

function distinctPageSizes(pdf: PdfFacts): string[] {
  const sizes = new Set<string>();
  for (const page of pdf.pages) {
    const width = Math.round(page.width * 10) / 10;
    const height = Math.round(page.height * 10) / 10;
    sizes.add(`${width} × ${height}`);
  }
  return [...sizes];
}

export function runCompileRules(context?: CompileContext, pdf?: PdfFacts): Finding[] {
  const out: Finding[] = [];
  const log = context?.log ?? "";
  const logLines = log.split("\n");
  const lowerLog = log.toLowerCase();

  if (context?.status === "error") {
    out.push(
      finding(
        "compile-failed",
        "error",
        "The latest compilation failed",
        "Submission output must come from a successful build. Fix the first compiler error, compile again, and rerun Preflight.",
      ),
    );
  }

  const overfull = [...log.matchAll(/Overfull \\hbox \(([\d.]+)pt too wide\)/gi)].map((match) => Number(match[1]));
  if (overfull.length > 0) {
    const widest = Math.max(...overfull);
    out.push(
      finding(
        "compile-overfull-box",
        widest >= 10 ? "error" : "warning",
        `${overfull.length} overfull line${overfull.length === 1 ? "" : "s"} in the output`,
        `The compiler reports content extending beyond its text box, up to ${widest.toFixed(1)} pt. Inspect these locations for clipped text, equations, tables, or links.`,
      ),
    );
  }

  const missingGlyphs = logLines.filter((line) => {
    const lower = line.toLowerCase();
    return lower.includes("missing character:") && lower.includes("there is no ");
  });
  if (missingGlyphs.length > 0) {
    out.push(
      finding(
        "compile-missing-glyph",
        "error",
        `${missingGlyphs.length} missing glyph${missingGlyphs.length === 1 ? "" : "s"}`,
        "The selected fonts cannot render every character. Missing glyphs can silently disappear from the PDF, including symbols in names, equations, and citations.",
      ),
    );
  }

  const hasUndefinedReference =
    lowerLog.includes("there were undefined references") ||
    lowerLog.includes("undefined citation") ||
    logLines.some((line) => {
      const lower = line.toLowerCase();
      return lower.includes("reference ") && lower.includes(" on page ") && lower.includes(" undefined");
    });
  if (hasUndefinedReference) {
    out.push(
      finding(
        "compile-unresolved-references",
        "error",
        "The compiled output has unresolved references",
        "At least one citation or cross-reference remained unresolved after compilation. The submitted PDF may contain [?] or ??. Check the log and run the required bibliography and LaTeX passes.",
      ),
    );
  }

  if (/Label\(s\) may have changed|Rerun to get cross-references right|Please \(re\)run (?:Biber|BibTeX)/i.test(log)) {
    out.push(
      finding(
        "compile-rerun-required",
        "warning",
        "Another compilation pass is required",
        "The latest log says labels, citations, or the table of contents are not settled. Recompile until the rerun warning disappears before exporting.",
      ),
    );
  }

  const hasDuplicateDestination = logLines.some((line) => {
    const lower = line.toLowerCase();
    return lower.includes("destination with the same identifier") && lower.includes("duplicate ignored");
  });
  if (hasDuplicateDestination) {
    out.push(
      finding(
        "compile-duplicate-destination",
        "warning",
        "Duplicate PDF destinations",
        "Two anchors share the same destination, so links or bookmarks can jump to the wrong place. This commonly comes from duplicate labels or page numbering resets.",
      ),
    );
  }

  if (pdf) {
    const sizes = distinctPageSizes(pdf);
    if (sizes.length > 1) {
      out.push(
        finding(
          "compile-mixed-page-sizes",
          "warning",
          "Mixed page sizes in one PDF",
          `The PDF contains ${sizes.length} page sizes (${sizes.join(", ")}). Mixed media boxes often indicate an incorrectly included page or figure and can fail publisher production checks.`,
        ),
      );
    }
  }

  return out;
}
