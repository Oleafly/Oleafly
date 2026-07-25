/**
 * Runtime adapter for pdf.js' public TextAccessibilityManager contract.
 *
 * pdfjs-dist 6.1.200 publishes the manager's type and consumes it from
 * TextLayer/AnnotationLayer, but the components bundle does not export the
 * class itself. This implementation follows that version's ordering and
 * aria-owns behavior so our custom virtualized renderer can still connect
 * annotations to their nearest text run.
 */
export class PdfTextAccessibilityManager {
  private enabled = false;
  private textChildren: HTMLElement[] | null = null;
  private readonly textNodes = new Map<string, number>();
  private readonly waitingElements = new Map<HTMLElement, boolean>();

  setTextMapping(textDivs: HTMLElement[]): void {
    this.textChildren = textDivs;
  }

  enable(): void {
    if (this.enabled) throw new Error("PDF text accessibility is already enabled");
    if (!this.textChildren) throw new Error("PDF text mapping has not been set");

    this.enabled = true;
    this.textChildren = this.textChildren.slice().sort(compareElementPositions);
    for (const [id, nodeIndex] of this.textNodes) {
      const element = document.getElementById(id);
      const child = this.textChildren[nodeIndex];
      if (!element || !child) {
        this.textNodes.delete(id);
        continue;
      }
      addAriaOwner(id, child);
    }
    for (const [element, isRemovable] of this.waitingElements) {
      this.addPointerInTextLayer(element, isRemovable);
    }
    this.waitingElements.clear();
  }

  disable(): void {
    if (!this.enabled) return;
    this.waitingElements.clear();
    this.textChildren = null;
    this.enabled = false;
  }

  removePointerInTextLayer(element: HTMLElement): void {
    if (!this.enabled) {
      this.waitingElements.delete(element);
      return;
    }
    const id = element.id;
    const children = this.textChildren;
    const nodeIndex = this.textNodes.get(id);
    if (!id || !children?.length || nodeIndex === undefined) return;

    const node = children[nodeIndex];
    this.textNodes.delete(id);
    const ownedIds = (node.getAttribute("aria-owns") ?? "")
      .split(/\s+/)
      .filter((candidate) => candidate && candidate !== id);
    if (ownedIds.length) {
      node.setAttribute("aria-owns", ownedIds.join(" "));
    } else {
      node.removeAttribute("aria-owns");
      node.setAttribute("role", "presentation");
    }
  }

  addPointerInTextLayer(element: HTMLElement, isRemovable: boolean): string | null {
    const id = element.id;
    if (!id) return null;
    if (!this.enabled) {
      this.waitingElements.set(element, isRemovable);
      return null;
    }
    if (isRemovable) this.removePointerInTextLayer(element);

    const children = this.textChildren;
    if (!children?.length) return null;
    const insertion = firstIndex(
      children,
      (node) => compareElementPositions(element, node) < 0,
    );
    const nodeIndex = Math.max(0, insertion - 1);
    const child = children[nodeIndex];
    addAriaOwner(id, child);
    this.textNodes.set(id, nodeIndex);
    const parent = child.parentNode;
    return parent instanceof Element && parent.classList.contains("markedContent")
      ? parent.id || null
      : null;
  }

  moveElementInDOM(
    container: HTMLElement,
    element: HTMLDivElement,
    contentElement: HTMLElement,
    isRemovable: boolean,
  ): string | null {
    const markedContentId = this.addPointerInTextLayer(contentElement, isRemovable);
    if (!container.hasChildNodes()) {
      container.append(element);
      return markedContentId;
    }
    const children = Array.from(container.children).filter((node) => node !== element);
    if (!children.length) return markedContentId;
    const insertion = firstIndex(
      children,
      (node) => compareElementPositions(element, node) < 0,
    );
    if (insertion === 0) {
      children[0].before(element);
    } else {
      children[insertion - 1].after(element);
    }
    return markedContentId;
  }
}

function addAriaOwner(id: string, node: Element): void {
  const ownedIds = (node.getAttribute("aria-owns") ?? "").split(/\s+/).filter(Boolean);
  if (!ownedIds.includes(id)) {
    node.setAttribute("aria-owns", [...ownedIds, id].join(" "));
  }
  node.removeAttribute("role");
}

function compareElementPositions(first: Element, second: Element): number {
  const a = first.getBoundingClientRect();
  const b = second.getBoundingClientRect();
  if (a.width === 0 && a.height === 0) return 1;
  if (b.width === 0 && b.height === 0) return -1;
  const aMid = a.y + a.height / 2;
  const bMid = b.y + b.height / 2;
  if (aMid <= b.y && bMid >= a.bottom) return -1;
  if (bMid <= a.y && aMid >= b.bottom) return 1;
  return a.x + a.width / 2 - (b.x + b.width / 2);
}

function firstIndex<T>(values: T[], predicate: (value: T) => boolean): number {
  let minimum = 0;
  let maximum = values.length;
  while (minimum < maximum) {
    const middle = (minimum + maximum) >> 1;
    if (predicate(values[middle])) maximum = middle;
    else minimum = middle + 1;
  }
  return minimum;
}
