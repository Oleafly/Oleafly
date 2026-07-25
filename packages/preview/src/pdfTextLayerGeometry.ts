interface PdfTextItemLike {
  str: string;
  width: number;
  height: number;
  fontName: string;
}

interface PdfTextStyleLike {
  vertical?: boolean;
}

export interface PdfTextContentGeometry {
  items: readonly unknown[];
  styles: Readonly<Record<string, PdfTextStyleLike>>;
}

export interface PdfTextViewportGeometry {
  scale: number;
  userUnit: number;
}

interface InlinePropertySnapshot {
  value: string;
  priority: string;
}

interface CalibrationCandidate {
  div: HTMLElement;
  pdfAdvance: number;
  transform: InlinePropertySnapshot;
}

function isPdfTextItem(item: unknown): item is PdfTextItemLike {
  if (!item || typeof item !== "object") return false;
  const candidate = item as Partial<PdfTextItemLike>;
  return (
    typeof candidate.str === "string" &&
    typeof candidate.width === "number" &&
    typeof candidate.height === "number" &&
    typeof candidate.fontName === "string"
  );
}

function positiveFinite(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function snapshotInlineProperty(
  element: HTMLElement,
  property: string,
): InlinePropertySnapshot {
  return {
    value: element.style.getPropertyValue(property),
    priority: element.style.getPropertyPriority(property),
  };
}

function restoreInlineProperty(
  element: HTMLElement,
  property: string,
  snapshot: InlinePropertySnapshot,
): void {
  if (snapshot.value) {
    element.style.setProperty(property, snapshot.value, snapshot.priority);
  } else {
    element.style.removeProperty(property);
  }
}

export function calibratedPdfTextScaleX(
  domAdvance: number,
  pdfAdvance: number,
  viewport: PdfTextViewportGeometry,
  minFontSize: number,
): number | null {
  if (
    !Number.isFinite(domAdvance) ||
    domAdvance <= 0 ||
    !Number.isFinite(pdfAdvance) ||
    pdfAdvance <= 0 ||
    !Number.isFinite(viewport.scale) ||
    viewport.scale <= 0 ||
    !Number.isFinite(viewport.userUnit) ||
    viewport.userUnit <= 0
  ) {
    return null;
  }
  return (
    (pdfAdvance *
      viewport.scale *
      viewport.userUnit *
      positiveFinite(minFontSize, 1)) /
    domAdvance
  );
}

/**
 * pdf.js derives `--scale-x` from CanvasRenderingContext2D.measureText.
 * WebKitGTK lays out selectable DOM text through Pango, whose advance can
 * differ from the canvas result even for the same fallback font. Calibrate
 * against the DOM's actual untransformed advance so selection boundaries
 * remain aligned with the PDF text item across browser font engines.
 */
export function calibratePdfTextLayerWidths(
  container: HTMLElement,
  textDivs: readonly HTMLElement[],
  textContent: PdfTextContentGeometry,
  viewport: PdfTextViewportGeometry,
): number {
  const candidates: CalibrationCandidate[] = [];
  let textDivIndex = 0;

  for (const item of textContent.items) {
    if (
      !item ||
      typeof item !== "object" ||
      !("str" in item) ||
      typeof (item as { str?: unknown }).str !== "string"
    ) {
      continue;
    }

    const div = textDivs[textDivIndex++];
    if (!div) break;
    if (!isPdfTextItem(item) || item.str.length === 0) continue;
    const pdfAdvance = textContent.styles[item.fontName]?.vertical
      ? item.height
      : item.width;
    if (!Number.isFinite(pdfAdvance) || pdfAdvance <= 0) continue;
    candidates.push({
      div,
      pdfAdvance,
      transform: snapshotInlineProperty(div, "transform"),
    });
  }

  if (candidates.length === 0) return 0;

  const minFontSize = positiveFinite(
    Number.parseFloat(
      getComputedStyle(container).getPropertyValue("--min-font-size"),
    ),
    1,
  );
  const containerTransform = snapshotInlineProperty(container, "transform");
  const domAdvances: number[] = [];

  // Neutralize both transforms in one write batch. `data-main-rotation`
  // rotates the entire text layer, while each span may rotate independently.
  // Reading after both are neutralized always measures the local inline axis.
  try {
    container.style.setProperty("transform", "none", "important");
    for (const { div } of candidates) {
      div.style.setProperty("transform", "none", "important");
    }
    for (const { div } of candidates) {
      domAdvances.push(div.getBoundingClientRect().width);
    }
  } finally {
    restoreInlineProperty(container, "transform", containerTransform);
    for (const { div, transform } of candidates) {
      restoreInlineProperty(div, "transform", transform);
    }
  }

  let calibrated = 0;
  for (let index = 0; index < candidates.length; index++) {
    const { div, pdfAdvance } = candidates[index];
    const scaleX = calibratedPdfTextScaleX(
      domAdvances[index],
      pdfAdvance,
      viewport,
      minFontSize,
    );
    if (scaleX === null) continue;
    div.style.setProperty(
      "--scale-x",
      String(scaleX),
      div.style.getPropertyPriority("--scale-x"),
    );
    calibrated++;
  }
  return calibrated;
}
