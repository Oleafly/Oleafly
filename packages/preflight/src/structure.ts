import type { Finding } from "./types";

export interface StructNode {
  role: string;
  alt?: string | null;
  lang?: string | null;
  children: StructNode[];
}

export interface StructDoc {
  root: StructNode | null;
  tagged: boolean;
}

function hasRole(node: StructNode, role: string): boolean {
  if (node.role === role) return true;
  return node.children.some((c) => hasRole(c, role));
}

function walk(node: StructNode, visit: (n: StructNode) => void) {
  visit(node);
  for (const c of node.children) walk(c, visit);
}

export function verifyStructure(doc: StructDoc): Finding[] {
  if (!doc.tagged || !doc.root) {
    return [
      {
        id: "pdf-untagged-output",
        lens: "a11y",
        severity: "info",
        title: "Not Section 508 / PDF-UA ready: this PDF is not tagged",
        detail:
          "The compiled PDF has no accessibility tags, so it cannot pass a formal Section 508 or PDF/UA check and a screen reader has no structure to follow. The current compile engine does not produce tags. Use the source and output checks above to make the document as ready as possible; a tagged export is on the roadmap.",
      },
    ];
  }

  const out: Finding[] = [];
  const headingLevels: number[] = [];

  walk(doc.root, (n) => {
    const h = /^H([1-6])$/.exec(n.role);
    if (h) headingLevels.push(Number(h[1]));

    if (n.role === "Figure" || n.role === "Formula") {
      if (!n.alt || !n.alt.trim()) {
        out.push({
          id: "output-figure-alt",
          lens: "a11y",
          severity: "error",
          title: "Tagged figure has no alt text",
          detail:
            "This figure is tagged but carries no alternative text, so a screen reader cannot describe it. Add a description at the source, for example \\includegraphics[alt={...}]{...}.",
        });
      }
    }

    if (n.role === "Table") {
      if (!hasRole(n, "TH")) {
        out.push({
          id: "output-table-headers",
          lens: "a11y",
          severity: "warning",
          title: "Tagged table has no header cells",
          detail:
            "This table has no header (TH) cells, so a screen reader cannot associate data with its column or row headings. Mark the header row so its cells are tagged as headers.",
        });
      }
    }
  });

  for (let i = 1; i < headingLevels.length; i++) {
    if (headingLevels[i] > headingLevels[i - 1] + 1) {
      out.push({
        id: "output-heading-skip",
        lens: "a11y",
        severity: "warning",
        title: "Heading level skipped in the tag tree",
        detail:
          "The tagged headings jump more than one level (for example H1 straight to H3), which breaks the outline a screen reader navigates by. Do not skip heading levels.",
      });
      break;
    }
  }

  return out;
}
