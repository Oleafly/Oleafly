import { describe, expect, it } from "vitest";
import { testCatalogTranslator } from "@oleafly/i18n-contract/testing";
import type { PreviewMessageKey } from "./messages";
import { normalizePdfOutline } from "./pdfOutline";

const t = testCatalogTranslator<PreviewMessageKey>("preview");

type RawOutline = Parameters<typeof normalizePdfOutline>[0];

function outline(items: unknown[]): RawOutline {
  return items as RawOutline;
}

describe("normalizePdfOutline", () => {
  it("returns an empty outline when the PDF has none", () => {
    const normalized = normalizePdfOutline(null, t);

    expect(normalized.items).toEqual([]);
    expect(normalized.targets.size).toBe(0);
  });

  it("assigns path ids to nested items and records their destinations", () => {
    const destination = [{ num: 4, gen: 0 }, { name: "XYZ" }, 0, 700, null];
    const normalized = normalizePdfOutline(
      outline([
        {
          title: "  Introduction ",
          dest: "intro",
          items: [{ title: "Background", dest: destination, items: [] }],
        },
        { title: "Methods", dest: "methods" },
      ]),
      t,
    );

    expect(normalized.items).toEqual([
      {
        id: "pdf-outline-0",
        title: "Introduction",
        external: false,
        children: [
          {
            id: "pdf-outline-0-0",
            title: "Background",
            external: false,
            children: [],
          },
        ],
      },
      { id: "pdf-outline-1", title: "Methods", external: false, children: [] },
    ]);
    expect(normalized.targets.get("pdf-outline-0")).toEqual({
      destination: "intro",
      externalUrl: null,
    });
    expect(normalized.targets.get("pdf-outline-0-0")).toEqual({
      destination,
      externalUrl: null,
    });
  });

  it("marks safe web links as external and normalizes their URL", () => {
    const normalized = normalizePdfOutline(
      outline([{ title: "Project site", url: " https://example.org/docs ", items: [] }]),
      t,
    );

    expect(normalized.items[0]).toEqual({
      id: "pdf-outline-0",
      title: "Project site",
      external: true,
      children: [],
    });
    expect(normalized.targets.get("pdf-outline-0")).toEqual({
      destination: null,
      externalUrl: "https://example.org/docs",
    });
  });

  it("disables links that use a blocked scheme", () => {
    const normalized = normalizePdfOutline(
      outline([{ title: "Run me", url: "javascript:alert(1)", items: [] }]),
      t,
    );

    expect(normalized.items[0]).toMatchObject({
      external: false,
      disabledReason: "This link uses a blocked URL scheme.",
    });
    expect(normalized.targets.get("pdf-outline-0")).toEqual({
      destination: null,
      externalUrl: null,
    });
  });

  it("disables items without a usable destination and names untitled ones", () => {
    const normalized = normalizePdfOutline(
      outline([
        { title: "   ", dest: { not: "a destination" }, items: [] },
        { title: undefined, url: 42, items: [] },
      ]),
      t,
    );

    expect(normalized.items).toEqual([
      {
        id: "pdf-outline-0",
        title: "Untitled section",
        external: false,
        children: [],
        disabledReason: "This outline item has no destination.",
      },
      {
        id: "pdf-outline-1",
        title: "Untitled section",
        external: false,
        children: [],
        disabledReason: "This outline item has no destination.",
      },
    ]);
  });
});
