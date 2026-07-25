// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
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
