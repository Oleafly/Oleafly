interface RegisteredTextLayer {
  endOfContent: HTMLDivElement;
  removeLocalListeners: () => void;
}

const textLayers = new Map<HTMLDivElement, RegisteredTextLayer>();
let globalSelectionAbort: AbortController | null = null;
let previousRange: Range | null = null;

function resetTextLayer(textLayer: HTMLDivElement, endOfContent: HTMLDivElement): void {
  textLayer.append(endOfContent);
  endOfContent.style.width = "";
  endOfContent.style.height = "";
  // Match pdf.js 6.1.200: keep the one-time `user-select: text` override.
  // Clearing it makes a later Firefox/non-Firefox transition behave
  // differently from TextLayerBuilder and can interrupt the next drag.
  textLayer.classList.remove("selecting");
}

function moveEndOfContentToLayerBoundary(
  textLayer: HTMLDivElement,
  endOfContent: HTMLDivElement,
  boundaryOffset: number,
): void {
  const children = Array.from(textLayer.childNodes);
  const sentinelIndex = children.indexOf(endOfContent);
  let contentOffset = boundaryOffset;
  if (sentinelIndex >= 0 && sentinelIndex < boundaryOffset) {
    contentOffset--;
  }
  const contentChildren = children.filter((child) => child !== endOfContent);
  const reference =
    contentChildren[Math.max(0, Math.min(contentOffset, contentChildren.length))] ?? null;
  textLayer.insertBefore(endOfContent, reference);
}

function enableGlobalSelectionHandling(): void {
  if (globalSelectionAbort) return;
  const controller = new AbortController();
  globalSelectionAbort = controller;
  const { signal } = controller;
  let pointerDown = false;
  let usesFirefoxSelectionBehavior: boolean | undefined;

  const resetAll = () => {
    pointerDown = false;
    for (const [textLayer, { endOfContent }] of textLayers) {
      resetTextLayer(textLayer, endOfContent);
    }
  };

  document.addEventListener(
    "pointerdown",
    () => {
      pointerDown = true;
    },
    { signal },
  );
  document.addEventListener("pointerup", resetAll, { signal });
  window.addEventListener("blur", resetAll, { signal });
  document.addEventListener(
    "keyup",
    () => {
      if (!pointerDown) resetAll();
    },
    { signal },
  );
  document.addEventListener(
    "selectionchange",
    () => {
      const selection = document.getSelection();
      if (!selection || selection.rangeCount === 0) {
        resetAll();
        previousRange = null;
        return;
      }

      const activeTextLayers = new Set<HTMLDivElement>();
      for (let index = 0; index < selection.rangeCount; index++) {
        const range = selection.getRangeAt(index);
        for (const textLayer of textLayers.keys()) {
          try {
            if (range.intersectsNode(textLayer)) activeTextLayers.add(textLayer);
          } catch {
            // A page can be evicted while selectionchange is queued.
          }
        }
      }
      for (const [textLayer, { endOfContent }] of textLayers) {
        if (activeTextLayers.has(textLayer)) {
          textLayer.classList.add("selecting");
        } else {
          resetTextLayer(textLayer, endOfContent);
        }
      }

      const firstRegistration = textLayers.values().next().value;
      if (firstRegistration) {
        // This intentionally probes the sentinel, not the text-layer wrapper.
        // pdf.js' Firefox branch is expressed by `.endOfContent` CSS, whose
        // computed `-moz-user-select` is `none`; the wrapper itself computes to
        // `auto` and would therefore select the wrong DOM-reparenting path.
        usesFirefoxSelectionBehavior ??=
          getComputedStyle(firstRegistration.endOfContent).getPropertyValue(
            "-moz-user-select",
          ) === "none";
      }
      // Firefox implements the cross-span selection workaround in CSS and
      // moving the sentinel there can make the native selection jump.
      if (usesFirefoxSelectionBehavior) return;

      const range = selection.getRangeAt(0);
      let modifyStart = false;
      if (previousRange) {
        try {
          modifyStart =
            range.compareBoundaryPoints(Range.END_TO_END, previousRange) === 0 ||
            range.compareBoundaryPoints(Range.START_TO_END, previousRange) === 0;
        } catch {
          // A selected virtualized page can disappear between selectionchange
          // events. Never compare a live range with a stale/different tree.
          previousRange = null;
        }
      }
      const endpointContainer = modifyStart ? range.startContainer : range.endContainer;
      const endpointOffset = modifyStart ? range.startOffset : range.endOffset;
      const directTextLayer =
        endpointContainer instanceof HTMLDivElement &&
        endpointContainer.classList.contains("textLayer") &&
        textLayers.has(endpointContainer)
          ? endpointContainer
          : null;
      if (directTextLayer) {
        const { endOfContent } = textLayers.get(directTextLayer)!;
        endOfContent.style.width = directTextLayer.style.width;
        endOfContent.style.height = directTextLayer.style.height;
        endOfContent.style.userSelect = "text";
        moveEndOfContentToLayerBoundary(directTextLayer, endOfContent, endpointOffset);
        previousRange = range.cloneRange();
        return;
      }

      let anchor: Node | null = endpointContainer;
      if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
      if (anchor instanceof Element && anchor.classList.contains("highlight")) {
        anchor = anchor.parentNode;
      }
      if (!modifyStart && range.endOffset === 0 && anchor) {
        while (anchor && !anchor.previousSibling) anchor = anchor.parentNode;
        anchor = anchor?.previousSibling ?? anchor;
        while (anchor && !anchor.childNodes.length) {
          anchor = anchor.previousSibling ?? anchor.parentNode;
        }
      }

      const parentTextLayer =
        anchor instanceof Element
          ? anchor.closest<HTMLDivElement>(".textLayer")
          : anchor?.parentElement?.closest<HTMLDivElement>(".textLayer");
      const registered = parentTextLayer ? textLayers.get(parentTextLayer) : undefined;
      if (parentTextLayer && registered && anchor?.parentNode) {
        const { endOfContent } = registered;
        endOfContent.style.width = parentTextLayer.style.width;
        endOfContent.style.height = parentTextLayer.style.height;
        endOfContent.style.userSelect = "text";
        const insertionParent = anchor.parentNode;
        if (insertionParent === parentTextLayer || parentTextLayer.contains(insertionParent)) {
          insertionParent.insertBefore(endOfContent, modifyStart ? anchor : anchor.nextSibling);
        } else {
          parentTextLayer.append(endOfContent);
        }
      }
      previousRange = range.cloneRange();
    },
    { signal },
  );
}

/**
 * Install the selection behavior provided by pdf.js' TextLayerBuilder around a
 * raw TextLayer. The end-of-content sentinel is what lets a pointer drag cross
 * absolutely positioned spans and lines without the browser losing its range.
 */
export function registerPdfTextSelection(
  textLayer: HTMLDivElement,
  pageNumber: number,
  normalizeText: (text: string) => string,
): () => void {
  textLayer.tabIndex = 0;
  textLayer.setAttribute("aria-label", `Selectable text for PDF page ${pageNumber}`);

  const endOfContent = document.createElement("div");
  endOfContent.className = "endOfContent";
  endOfContent.ariaHidden = "true";
  textLayer.append(endOfContent);

  const onMouseDown = () => textLayer.classList.add("selecting");
  const onCopy = (event: ClipboardEvent) => {
    const selectedText = document.getSelection()?.toString() ?? "";
    const text = normalizeText(selectedText).replaceAll("\0", "");
    event.clipboardData?.setData("text/plain", text);
    event.preventDefault();
    event.stopPropagation();
  };
  textLayer.addEventListener("mousedown", onMouseDown);
  textLayer.addEventListener("copy", onCopy);

  const registration: RegisteredTextLayer = {
    endOfContent,
    removeLocalListeners: () => {
      textLayer.removeEventListener("mousedown", onMouseDown);
      textLayer.removeEventListener("copy", onCopy);
    },
  };
  textLayers.set(textLayer, registration);
  enableGlobalSelectionHandling();

  return () => {
    const current = textLayers.get(textLayer);
    if (current !== registration) return;
    current.removeLocalListeners();
    textLayers.delete(textLayer);
    // `previousRange` can point into the page that is about to be evicted.
    // Clearing it for every unregister is cheap and avoids cross-tree
    // compareBoundaryPoints calls while another PDF page remains registered.
    previousRange = null;
    if (textLayers.size === 0) {
      globalSelectionAbort?.abort();
      globalSelectionAbort = null;
    }
  };
}
