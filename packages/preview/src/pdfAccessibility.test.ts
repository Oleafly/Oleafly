// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { PdfTextAccessibilityManager } from "./pdfAccessibility";

function rect(x: number, y: number, width = 40, height = 10): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x,
    toJSON: () => ({}),
  };
}

function textRun(label: string, box: DOMRect): HTMLSpanElement {
  const span = document.createElement("span");
  span.textContent = label;
  span.setAttribute("role", "presentation");
  span.getBoundingClientRect = () => box;
  return span;
}

function annotation(id: string, box: DOMRect): HTMLAnchorElement {
  const link = document.createElement("a");
  link.id = id;
  link.getBoundingClientRect = () => box;
  document.body.append(link);
  return link;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("PdfTextAccessibilityManager", () => {
  it("orders text visually and associates an annotation with the preceding run", () => {
    const manager = new PdfTextAccessibilityManager();
    const lower = document.createElement("span");
    lower.textContent = "second";
    lower.setAttribute("role", "presentation");
    lower.getBoundingClientRect = () => rect(10, 40);
    const upper = document.createElement("span");
    upper.textContent = "first";
    upper.setAttribute("role", "presentation");
    upper.getBoundingClientRect = () => rect(10, 10);
    manager.setTextMapping([lower, upper]);
    manager.enable();

    const annotation = document.createElement("a");
    annotation.id = "pdf-link-1";
    annotation.getBoundingClientRect = () => rect(12, 24, 20, 8);
    document.body.append(annotation);

    expect(manager.addPointerInTextLayer(annotation, false)).toBeNull();
    expect(upper).toHaveAttribute("aria-owns", "pdf-link-1");
    expect(upper).not.toHaveAttribute("role");
    expect(lower).not.toHaveAttribute("aria-owns");

    manager.removePointerInTextLayer(annotation);
    expect(upper).not.toHaveAttribute("aria-owns");
    expect(upper).toHaveAttribute("role", "presentation");
    manager.disable();
  });

  it("queues annotation associations until the text mapping becomes active", () => {
    const manager = new PdfTextAccessibilityManager();
    const text = document.createElement("span");
    text.textContent = "tagged reading order";
    text.getBoundingClientRect = () => rect(10, 10);
    const annotation = document.createElement("a");
    annotation.id = "queued-link";
    annotation.getBoundingClientRect = () => rect(12, 20);
    document.body.append(annotation);

    manager.addPointerInTextLayer(annotation, false);
    expect(text).not.toHaveAttribute("aria-owns");
    manager.setTextMapping([text]);
    manager.enable();
    expect(text).toHaveAttribute("aria-owns", "queued-link");
    manager.disable();
  });
});

describe("PdfTextAccessibilityManager lifecycle", () => {
  it("refuses to enable twice or without a text mapping", () => {
    const manager = new PdfTextAccessibilityManager();
    expect(() => manager.enable()).toThrow("PDF text mapping has not been set");

    manager.setTextMapping([textRun("only", rect(0, 0))]);
    manager.enable();
    expect(() => manager.enable()).toThrow("PDF text accessibility is already enabled");
  });

  it("restores owners for annotations that survive a re-enable and forgets removed ones", () => {
    const manager = new PdfTextAccessibilityManager();
    const first = textRun("first", rect(10, 10));
    const second = textRun("second", rect(10, 40));
    manager.setTextMapping([first, second]);
    manager.enable();
    const kept = annotation("kept-link", rect(12, 12));
    const removed = annotation("removed-link", rect(12, 42));
    manager.addPointerInTextLayer(kept, false);
    manager.addPointerInTextLayer(removed, false);
    manager.disable();
    removed.remove();

    const freshFirst = textRun("first", rect(10, 10));
    const freshSecond = textRun("second", rect(10, 40));
    manager.setTextMapping([freshFirst, freshSecond]);
    manager.enable();

    expect(freshFirst).toHaveAttribute("aria-owns", "kept-link");
    expect(freshFirst).not.toHaveAttribute("role");
    expect(freshSecond).not.toHaveAttribute("aria-owns");
    expect(freshSecond).toHaveAttribute("role", "presentation");
  });

  it("drops a queued annotation removed before the mapping activates", () => {
    const manager = new PdfTextAccessibilityManager();
    const run = textRun("text", rect(10, 10));
    const link = annotation("queued", rect(12, 12));
    manager.addPointerInTextLayer(link, false);

    manager.removePointerInTextLayer(link);
    manager.setTextMapping([run]);
    manager.enable();

    expect(run).not.toHaveAttribute("aria-owns");
  });

  it("ignores annotations without an id and pages without text", () => {
    const manager = new PdfTextAccessibilityManager();
    manager.setTextMapping([]);
    manager.enable();
    const anonymous = document.createElement("a");

    expect(manager.addPointerInTextLayer(anonymous, false)).toBeNull();
    expect(manager.addPointerInTextLayer(annotation("lonely", rect(0, 0)), false)).toBeNull();
    manager.removePointerInTextLayer(anonymous);
    manager.disable();
    manager.disable();
  });

  it("keeps the other owners when one annotation is removed", () => {
    const manager = new PdfTextAccessibilityManager();
    const run = textRun("shared", rect(10, 10, 200));
    manager.setTextMapping([run]);
    manager.enable();
    const left = annotation("left-link", rect(20, 12));
    const right = annotation("right-link", rect(120, 12));
    manager.addPointerInTextLayer(left, false);
    manager.addPointerInTextLayer(right, false);
    expect(run).toHaveAttribute("aria-owns", "left-link right-link");

    manager.addPointerInTextLayer(left, true);
    expect(run).toHaveAttribute("aria-owns", "right-link left-link");

    manager.removePointerInTextLayer(right);
    expect(run).toHaveAttribute("aria-owns", "left-link");
    expect(run).not.toHaveAttribute("role");
  });

  it("reports the marked-content id that owns the associated text run", () => {
    const manager = new PdfTextAccessibilityManager();
    const tagged = document.createElement("span");
    tagged.className = "markedContent";
    tagged.id = "mc-12";
    const run = textRun("tagged", rect(10, 10));
    tagged.append(run);
    const untagged = document.createElement("span");
    untagged.className = "markedContent";
    const anonymousRun = textRun("untagged", rect(10, 40));
    untagged.append(anonymousRun);
    manager.setTextMapping([run, anonymousRun]);
    manager.enable();

    expect(manager.addPointerInTextLayer(annotation("tagged-link", rect(12, 12)), false)).toBe(
      "mc-12",
    );
    expect(manager.addPointerInTextLayer(annotation("untagged-link", rect(12, 42)), false)).toBeNull();
  });

  it("orders text runs by vertical position, then horizontally, with empty boxes last", () => {
    const manager = new PdfTextAccessibilityManager();
    const right = textRun("right", rect(100, 10));
    const left = textRun("left", rect(10, 10));
    const below = textRun("below", rect(10, 60));
    const empty = textRun("empty", rect(0, 0, 0, 0));
    manager.setTextMapping([empty, below, right, left]);
    manager.enable();

    manager.addPointerInTextLayer(annotation("after-right", rect(150, 10)), false);
    manager.addPointerInTextLayer(annotation("boxless-link", rect(0, 0, 0, 0)), false);

    expect(right).toHaveAttribute("aria-owns", "after-right");
    expect(empty).toHaveAttribute("aria-owns", "boxless-link");
  });
});

describe("PdfTextAccessibilityManager.moveElementInDOM", () => {
  function annotationLayer(...boxes: DOMRect[]): HTMLDivElement {
    const container = document.createElement("div");
    for (const [index, box] of boxes.entries()) {
      const child = document.createElement("section");
      child.id = `existing-${index}`;
      child.getBoundingClientRect = () => box;
      container.append(child);
    }
    return container;
  }

  function movable(box: DOMRect): HTMLDivElement {
    const element = document.createElement("div");
    element.id = "moving";
    element.getBoundingClientRect = () => box;
    return element;
  }

  function enabledManager(): PdfTextAccessibilityManager {
    const manager = new PdfTextAccessibilityManager();
    manager.setTextMapping([textRun("run", rect(0, 0))]);
    manager.enable();
    return manager;
  }

  it("appends into an empty container", () => {
    const container = annotationLayer();
    const element = movable(rect(10, 10));

    enabledManager().moveElementInDOM(container, element, annotation("content", rect(10, 10)), false);

    expect([...container.children]).toEqual([element]);
  });

  it("leaves a container that only holds the element", () => {
    const container = annotationLayer();
    const element = movable(rect(10, 10));
    container.append(element);

    enabledManager().moveElementInDOM(container, element, annotation("content", rect(10, 10)), false);

    expect([...container.children]).toEqual([element]);
  });

  it("inserts before the first sibling that follows it visually", () => {
    const container = annotationLayer(rect(10, 50), rect(10, 90));
    const element = movable(rect(10, 10));

    enabledManager().moveElementInDOM(container, element, annotation("content", rect(10, 10)), false);

    expect([...container.children].map((child) => child.id)).toEqual([
      "moving",
      "existing-0",
      "existing-1",
    ]);
  });

  it("inserts after the last sibling that precedes it visually", () => {
    const container = annotationLayer(rect(10, 10), rect(10, 90));
    const element = movable(rect(10, 50));

    enabledManager().moveElementInDOM(container, element, annotation("content", rect(10, 50)), false);

    expect([...container.children].map((child) => child.id)).toEqual([
      "existing-0",
      "moving",
      "existing-1",
    ]);
  });
});

describe("PdfTextAccessibilityManager ordering cost", () => {
  it("reads each text run's box once while ordering a large layer", () => {
    const manager = new PdfTextAccessibilityManager();
    let reads = 0;
    const runs = Array.from({ length: 400 }, (_, index) => {
      const span = document.createElement("span");
      span.textContent = `run ${index}`;
      const box = rect((index * 37) % 500, Math.floor(((index * 53) % 400) / 10) * 12);
      span.getBoundingClientRect = () => {
        reads++;
        return box;
      };
      return span;
    });
    manager.setTextMapping(runs);
    manager.enable();
    expect(reads).toBe(0);

    const link = annotation("ordered-link", rect(120, 60, 20, 8));
    manager.addPointerInTextLayer(link, false);
    expect(reads).toBeLessThanOrEqual(runs.length + 20);
    const owner = runs.find((run) => run.getAttribute("aria-owns") === "ordered-link");
    expect(owner).toBeDefined();
    manager.disable();
  });

  it("orders runs exactly as reading each box on demand would", () => {
    const boxes = [rect(300, 10), rect(10, 10), rect(10, 40), rect(200, 40), rect(0, 0, 0, 0), rect(100, 10)];
    const runs = boxes.map((box, index) => textRun(`r${index}`, box));
    const manager = new PdfTextAccessibilityManager();
    manager.setTextMapping(runs);
    manager.enable();
    const link = annotation("tail-link", rect(250, 41, 10, 8));
    manager.addPointerInTextLayer(link, false);
    expect(runs[3]).toHaveAttribute("aria-owns", "tail-link");
    manager.disable();
  });
});
