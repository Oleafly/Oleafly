// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  installDesktopViewportGuard,
  resetDesktopDocumentScroll,
} from "./desktop-viewport";

describe("desktop viewport containment", () => {
  afterEach(() => {
    resetDesktopDocumentScroll();
    document.body.replaceChildren();
  });

  it("resets document scroll without changing application positioning", () => {
    document.documentElement.scrollTop = 362;
    document.documentElement.scrollLeft = 17;
    document.body.scrollTop = 362;
    document.body.scrollLeft = 17;

    resetDesktopDocumentScroll();

    expect(document.documentElement.scrollTop).toBe(0);
    expect(document.documentElement.scrollLeft).toBe(0);
    expect(document.body.scrollTop).toBe(0);
    expect(document.body.scrollLeft).toBe(0);
  });

  it("contains root scroll leaks but ignores inner panel scrolling", () => {
    const uninstall = installDesktopViewportGuard();
    const panel = document.createElement("div");
    document.body.append(panel);

    document.documentElement.scrollTop = 362;
    document.dispatchEvent(new Event("scroll"));
    expect(document.documentElement.scrollTop).toBe(0);

    document.documentElement.scrollTop = 120;
    panel.dispatchEvent(new Event("scroll"));
    expect(document.documentElement.scrollTop).toBe(120);

    uninstall();
  });
});
