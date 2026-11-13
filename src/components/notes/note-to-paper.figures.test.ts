// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./tests/setup";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };

const mocks = vi.hoisted(() => ({ typstSvg: vi.fn(), moleculeSnapshot: vi.fn() }));

vi.mock("./typst-block", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./typst-block")>()),
  typstSvg: mocks.typstSvg,
}));
vi.mock("./molecule-block", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./molecule-block")>()),
  moleculeSnapshot: mocks.moleculeSnapshot,
}));

import { notePaperText, type PaperPlace } from "./note-to-paper";

const TYPST_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 4"><path d="M0 0h10v4H0z"/></svg>';
const PDB = new TextEncoder().encode("ATOM      1  N   ALA A   1      11.104   6.134  -6.504  1.00  0.00           N\n");

function place(overrides: Partial<PaperPlace> = {}): PaperPlace {
  return {
    format: "markdown",
    folder: "figures",
    from: "note.html",
    taken: () => false,
    citations: { kind: "keys", known: () => true },
    inline: true,
    raster: false,
    ...overrides,
  };
}

const read = async (path: string) => (path === "protein.pdb" ? PDB : null);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("drawn blocks that need the app's renderers", () => {
  it("embeds a Typst block as its rendered SVG, and leaves it out when Typst fails", async () => {
    mocks.typstSvg.mockResolvedValue(TYPST_SVG);
    const { text } = await notePaperText("```typst\n$ x^2 $\n```", read, place());
    expect(mocks.typstSvg).toHaveBeenCalledWith("$ x^2 $");
    expect(text).toContain(`data:image/svg+xml;base64,${btoa(TYPST_SVG)}`);

    mocks.typstSvg.mockRejectedValue(new Error("unknown variable"));
    const failed = await notePaperText("```typst\n#broken\n```", read, place());
    expect(failed.text).toContain(enNotes.sendToPaper.leftOut.replace("{{block}}", "Typst"));
  });

  it("embeds a picture of a molecule, reading its file and keeping the fence as the format hint", async () => {
    mocks.moleculeSnapshot.mockImplementation(async (_source: string, fence: string, readFile: (path: string) => Promise<string | null>) => {
      const url = await readFile("protein.pdb");
      return fence === "pdb" && url?.startsWith("data:application/octet-stream;base64,") ? "iVBORw0KGgo=" : null;
    });
    const { text } = await notePaperText("```pdb\npath: protein.pdb\n```", read, place());
    expect(text).toContain("data:image/png;base64,iVBORw0KGgo=");

    const { files } = await notePaperText("```molecule\npath: protein.pdb\n```", read, place({ inline: false, raster: true }));
    expect(files).toEqual([]);

    mocks.moleculeSnapshot.mockResolvedValue("iVBORw0KGgo=");
    const saved = await notePaperText("```molecule\npath: protein.pdb\n```", read, place({ inline: false, raster: false }));
    expect(saved.files.map((file) => file.path)).toEqual(["figures/molecule.png"]);
  });

  it("leaves a molecule out when there is no WebGL to draw it", async () => {
    mocks.moleculeSnapshot.mockResolvedValue(null);
    const { text } = await notePaperText("```molecule\nformat: xyz\n1\n\nC 0 0 0\n```", read, place());
    expect(text).toContain(enNotes.sendToPaper.leftOut.replace("{{block}}", enNotes.blocks.molecule.label));
  });
});
