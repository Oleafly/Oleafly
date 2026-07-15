import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PositionedText } from "./types";
import type { StructNode, StructDoc } from "./structure";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export interface PdfExtract {
  pages: PositionedText[][];
  pageText: string[];
  lang: string | null;
  title: string | null;
  tagged: boolean;
  struct: StructDoc;
}

function normStruct(node: any): StructNode | null {
  if (!node || typeof node !== "object") return null;
  // Marked-content / object leaf refs carry no structural role; skip them.
  if (node.type) return null;
  const children = Array.isArray(node.children)
    ? node.children.map(normStruct).filter((c: StructNode | null): c is StructNode => c !== null)
    : [];
  return { role: String(node.role ?? ""), alt: node.alt ?? null, lang: node.lang ?? null, children };
}

export async function extractForPreflight(bytes: Uint8Array): Promise<PdfExtract> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  try {
    const doc = await loadingTask.promise;

    const pages: PositionedText[][] = [];
    const pageText: string[] = [];
    const structRoots: StructNode[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      try {
        const tc = await page.getTextContent();
        const items: PositionedText[] = [];
        const lineParts: string[] = [];
        let lastY: number | null = null;
        for (const item of tc.items as any[]) {
          const str = typeof item?.str === "string" ? item.str : "";
          const x = item?.transform?.[4] ?? 0;
          const y = item?.transform?.[5] ?? 0;
          const width = typeof item?.width === "number" ? item.width : 0;
          items.push({ str, x, y, width });
          if (lastY !== null && Math.abs(y - lastY) > 2) lineParts.push("\n");
          lineParts.push(str);
          lastY = y;
        }
        pages.push(items);
        pageText.push(lineParts.join("").replace(/[ \t]+\n/g, "\n").trim());

        try {
          const tree: any = await (page as any).getStructTree?.();
          const norm = tree ? normStruct(tree) : null;
          if (norm) structRoots.push(norm);
        } catch {
        }
      } finally {
        try {
          page.cleanup();
        } catch {
        }
      }
    }

    let lang: string | null = null;
    let title: string | null = null;
    let tagged = false;
    try {
      const md: any = await doc.getMetadata();
      title = md?.info?.Title || null;
      lang = md?.info?.Language || null;
    } catch {
    }
    try {
      const markInfo: any = await (doc as any).getMarkInfo?.();
      tagged = markInfo?.Marked === true;
    } catch {
    }

    const structChildren = structRoots.flatMap((r) => r.children);
    const struct: StructDoc = {
      root: structChildren.length ? { role: "Document", alt: null, lang, children: structChildren } : null,
      tagged: tagged || structChildren.length > 0,
    };

    return { pages, pageText, lang, title, tagged, struct };
  } finally {
    try {
      await loadingTask.destroy();
    } catch {
    }
  }
}
