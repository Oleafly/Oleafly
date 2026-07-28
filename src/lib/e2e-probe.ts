import { useFilesStore } from "@/store/files";
import {
  getEditorView,
  refreshEditorLints,
} from "@oleafly/editor";
import { diagnosticCardSource } from "@oleafly/editor/diagnostic-card";

export interface E2ePdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
  fontFamily: string | null;
  pdfFontName: string | null;
  loadedFontName: string | null;
  hasEol: boolean;
}

export interface E2ePdfAnnotation {
  id: string | null;
  subtype: string | null;
  url: string | null;
  unsafeUrl: string | null;
  action: string | null;
  destination: string | null;
  rect: number[];
}

export interface E2ePdfPageProbe {
  pageNumber: number;
  text: string;
  width: number;
  height: number;
  rotation: number;
  userUnit: number;
  items: E2ePdfTextItem[];
  annotations: E2ePdfAnnotation[];
  operatorCounts: Record<string, number>;
}

export interface E2ePdfProbe {
  pageCount: number;
  text: string;
  pages: E2ePdfPageProbe[];
  outline: string[];
}

type E2eProbeWindow = Window & {
  __e2ePdfText?: () => Promise<string>;
  __e2ePdfProbe?: () => Promise<E2ePdfProbe>;
  __e2eHasProofreadingDiagnostic?: (text: string) => boolean;
  __e2eMountProofreadingCard?: (text: string) => boolean;
  __e2eRefreshEditorLints?: () => void;
};

function proofreadingTooltip(text: string) {
  const view = getEditorView();
  if (!view) return null;
  const from = view.state.doc.toString().indexOf(text);
  return from < 0
    ? null
    : diagnosticCardSource(view, from + 1);
}

function mountProofreadingCard(text: string): boolean {
  const view = getEditorView();
  const tooltip = proofreadingTooltip(text);
  if (!view || !tooltip) return false;
  const mounted = tooltip.create(view).dom;
  mounted.dataset.e2eProofreadingCard = "true";
  mounted.style.position = "fixed";
  mounted.style.left = "16px";
  mounted.style.top = "72px";
  mounted.style.zIndex = "100";
  document.body.append(mounted);
  return true;
}

function destinationLabel(destination: unknown): string | null {
  if (typeof destination === "string") return destination;
  if (!Array.isArray(destination)) return null;
  try {
    return JSON.stringify(destination, (_key, value) => {
      if (
        value &&
        typeof value === "object" &&
        Number.isInteger((value as { num?: unknown }).num)
      ) {
        return {
          num: (value as { num: number }).num,
          gen: (value as { gen?: number }).gen ?? 0,
        };
      }
      return value;
    });
  } catch {
    return String(destination);
  }
}

function flattenOutline(
  nodes: Awaited<ReturnType<import("pdfjs-dist").PDFDocumentProxy["getOutline"]>>,
): string[] {
  if (!nodes) return [];
  const titles: string[] = [];
  const visit = (items: typeof nodes) => {
    for (const item of items) {
      titles.push(item.title);
      visit(item.items);
    }
  };
  visit(nodes);
  return titles;
}

async function readCompiledPdfProbe(): Promise<E2ePdfProbe> {
  const projectId = useFilesStore.getState().projectId;
  if (!projectId) throw new Error("no active project");

  const { readCompiledPdf } = await import("@/lib/tauri");
  // Importing the preflight extractor configures pdf.js' worker URL through the
  // same production module used by the application. The probe then reads richer
  // public pdf.js metadata without introducing a test-only worker path.
  await import("@oleafly/preflight/pdf-extract");
  const pdfjs = await import("pdfjs-dist");
  const bytes = new Uint8Array(await readCompiledPdf(projectId));
  const loadingTask = pdfjs.getDocument({ data: bytes.slice() });

  try {
    const document = await loadingTask.promise;
    const operatorNames = new Map<number, string>(
      Object.entries(pdfjs.OPS).map(([name, value]) => [value, name]),
    );
    const pages: E2ePdfPageProbe[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      try {
        const [textContent, annotations, operatorList] = await Promise.all([
          page.getTextContent({
            includeMarkedContent: true,
            disableNormalization: true,
          }),
          page.getAnnotations({ intent: "display" }),
          page.getOperatorList(),
        ]);
        const viewport = page.getViewport({ scale: 1 });
        const items: E2ePdfTextItem[] = [];
        const lineParts: string[] = [];
        let previousY: number | null = null;

        for (const rawItem of textContent.items) {
          if (!("str" in rawItem)) continue;
          const item = rawItem;
          const x = item.transform[4] ?? 0;
          const y = item.transform[5] ?? 0;
          if (previousY !== null && Math.abs(y - previousY) > 2) lineParts.push("\n");
          lineParts.push(item.str);
          previousY = y;

          const style = textContent.styles[item.fontName];
          let pdfFontName: string | null = null;
          let loadedFontName: string | null = null;
          try {
            const font = page.commonObjs.get(item.fontName) as {
              name?: unknown;
              loadedName?: unknown;
            };
            pdfFontName = typeof font?.name === "string" ? font.name : null;
            loadedFontName =
              typeof font?.loadedName === "string" ? font.loadedName : null;
          } catch {
            // Font identity from the text item remains useful even when an
            // engine keeps the internal common object unavailable.
          }

          items.push({
            str: item.str,
            x,
            y,
            width: item.width,
            height: item.height,
            fontName: item.fontName,
            fontFamily: style?.fontFamily ?? null,
            pdfFontName,
            loadedFontName,
            hasEol: item.hasEOL,
          });
        }

        const operatorCounts: Record<string, number> = {};
        for (const operator of operatorList.fnArray) {
          const name = operatorNames.get(operator) ?? `op:${operator}`;
          operatorCounts[name] = (operatorCounts[name] ?? 0) + 1;
        }

        pages.push({
          pageNumber,
          text: lineParts.join("").replace(/[ \t]+\n/g, "\n").trim(),
          width: viewport.width,
          height: viewport.height,
          rotation: viewport.rotation,
          userUnit: viewport.userUnit,
          items,
          annotations: annotations.map((annotation) => ({
            id: typeof annotation.id === "string" ? annotation.id : null,
            subtype:
              typeof annotation.subtype === "string" ? annotation.subtype : null,
            url: typeof annotation.url === "string" ? annotation.url : null,
            unsafeUrl:
              typeof annotation.unsafeUrl === "string"
                ? annotation.unsafeUrl
                : null,
            action:
              typeof annotation.action === "string" ? annotation.action : null,
            destination: destinationLabel(annotation.dest),
            rect: Array.isArray(annotation.rect)
              ? annotation.rect.filter(
                  (coordinate: unknown): coordinate is number =>
                    typeof coordinate === "number",
                )
              : [],
          })),
          operatorCounts,
        });
      } finally {
        page.cleanup();
      }
    }

    return {
      pageCount: document.numPages,
      text: pages.map((page) => page.text).join("\n"),
      pages,
      outline: flattenOutline(await document.getOutline()),
    };
  } finally {
    await loadingTask.destroy();
  }
}

export function installE2ePdfProbe() {
  if (!import.meta.env.DEV) return;
  const target = window as unknown as E2eProbeWindow;
  target.__e2ePdfProbe = readCompiledPdfProbe;
  target.__e2ePdfText = async () => (await readCompiledPdfProbe()).text;
  target.__e2eHasProofreadingDiagnostic = (text) =>
    proofreadingTooltip(text) !== null;
  target.__e2eMountProofreadingCard = mountProofreadingCard;
  target.__e2eRefreshEditorLints = () =>
    refreshEditorLints(getEditorView());
}
