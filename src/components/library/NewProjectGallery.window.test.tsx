// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import type { ComponentPropsWithRef, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NewProjectDialog,
  type TemplateInfo,
  type TemplatesHost,
  type TemplatesKit,
} from "@oleafly/templates";
import { useRowWindow } from "@/hooks/use-row-window";

const kit: TemplatesKit = {
  Input: (props: ComponentPropsWithRef<"input">) => <input {...props} />,
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  Select: () => null,
  useRowWindow,
  t: (key) => key,
};

const template = (index: number, name = `Template ${index}`): TemplateInfo => ({
  id: `t-${index}`,
  name,
  description: "",
  category: "Letters",
  engine: "xetex",
  document_engine: "latex",
  ats_profile: null,
  default_color: null,
  license: null,
  has_preview: true,
  assets_ready: true,
  source: "pack",
});

const templates: TemplateInfo[] = Array.from({ length: 900 }, (_, index) => template(index));

const mixedScripts: TemplateInfo[] = Array.from({ length: 900 }, (_, index) =>
  index >= 300 && index < 600 ? template(index, `清华大学学位论文 ${index}`) : template(index),
);

const HAN = /\p{Script=Han}/u;

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, left: 0, right: 600, width: 600, height, x: 0, y: top, toJSON: () => ({}) };
}

function isScroller(element: Element) {
  return element.getAttribute("data-tour") === "project-template-list";
}

function laidOutGallery(cardHeight: (card: Element) => number) {
  let scrollTop = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) {
    return isScroller(this) ? 560 : 0;
  });
  vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (this: Element) {
    return isScroller(this) ? scrollTop : 0;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.hasAttribute("data-row-window-item")) return rect(0, cardHeight(this));
    if (this.getAttribute("data-testid") === "template-grid") return rect(-scrollTop, 0);
    return rect(0, 560);
  });
  return {
    scrollTo(top: number) {
      scrollTop = top;
      act(() => {
        document.querySelector('[data-tour="project-template-list"]')?.dispatchEvent(new Event("scroll"));
      });
    },
  };
}

function renderGallery(list: TemplateInfo[]) {
  const host: TemplatesHost = {
    loadPreview: vi.fn(async () => null),
    ensureAssets: vi.fn(async () => {}),
    logError: vi.fn(),
  };
  render(
    <NewProjectDialog
      open
      templates={list}
      onClose={() => {}}
      onCreate={() => {}}
      host={host}
      kit={kit}
      colorOptions={[{ name: "Slate", hex: "#334155" }]}
      defaultColor="#334155"
    />,
  );
  return host;
}

const cards = () => screen.getAllByTestId(/^template-card-/);

describe("New Project gallery windowing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mounts and previews only the cards near the viewport, and follows scrolling", () => {
    const layout = laidOutGallery(() => 260);
    const host = renderGallery(templates);

    expect(cards().length).toBeLessThanOrEqual(15);
    expect(host.loadPreview).toHaveBeenCalledTimes(cards().length);

    layout.scrollTo(26_000);

    expect(screen.queryByTestId("template-card-t-0")).not.toBeInTheDocument();
    expect(screen.getByTestId("template-card-t-300")).toBeInTheDocument();
    expect(cards().length).toBeLessThanOrEqual(21);
    expect(Number.parseFloat(screen.getByTestId("template-grid").style.paddingTop)).toBeGreaterThan(0);
    expect(vi.mocked(host.loadPreview).mock.calls.length).toBeLessThan(40);
  });

  it("keeps a steady window while scrolling past cards whose CJK names make their rows taller", () => {
    const layout = laidOutGallery((card) => (HAN.test(card.textContent ?? "") ? 280 : 260));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    renderGallery(mixedScripts);

    for (const [top, card] of [
      [13_000, "t-150"],
      [27_300, "t-315"],
      [39_000, "t-450"],
      [26_000, "t-300"],
      [62_400, "t-720"],
    ] as const) {
      expect(() => layout.scrollTo(top)).not.toThrow();
      expect(screen.getByTestId(`template-card-${card}`)).toBeInTheDocument();
      expect(cards().length).toBeLessThanOrEqual(21);
    }
    expect(errors.mock.calls.flat().map(String).join("\n")).not.toContain("Maximum update depth");
  });
});
