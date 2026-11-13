import { describe, expect, it } from "vitest";
import {
  isNotebookPath,
  NOTEBOOK_MAX_BYTES,
  NotebookTooLargeError,
  notebookFence,
  notebookText,
  parseNotebookBlock,
} from "./notebook-block";
import { imageSource, notePath } from "./note-path";

describe("notebook blocks", () => {
  it("reads the path from the first line and shows every cell with code", () => {
    expect(parseNotebookBlock("assets/analysis-1a2b3c4d.ipynb\n")).toEqual({
      ok: true,
      block: { path: "assets/analysis-1a2b3c4d.ipynb", cells: null, hideCode: false },
    });
  });

  it("reads a cell range and hides the code when asked", () => {
    expect(parseNotebookBlock("\n  ./assets/run.ipynb  \r\ncells: 3-8\r\ncode: hide\n")).toEqual({
      ok: true,
      block: { path: "assets/run.ipynb", cells: { from: 3, to: 8 }, hideCode: true },
    });
  });

  it.each([
    ["cells: 5", { from: 5, to: 5 }],
    ["Cells : 2 - 4", { from: 2, to: 4 }],
    ["CELLS:7-7", { from: 7, to: 7 }],
  ])("reads %j as a range", (line, cells) => {
    expect(parseNotebookBlock(`run.ipynb\n${line}`)).toEqual({ ok: true, block: { path: "run.ipynb", cells, hideCode: false } });
  });

  it("keeps the code for any other code setting and skips lines it does not know", () => {
    expect(parseNotebookBlock("run.ipynb\ncode: show\ntheme: dark\njust words")).toEqual({
      ok: true,
      block: { path: "run.ipynb", cells: null, hideCode: false },
    });
    expect(parseNotebookBlock("run.ipynb\ncode: HIDE ")).toMatchObject({ block: { hideCode: true } });
  });

  it.each(["cells: 8-3", "cells: 0", "cells: 0-2", "cells: x", "cells: 3-", "cells:"])("refuses %j", (line) => {
    expect(parseNotebookBlock(`run.ipynb\n${line}`)).toEqual({ ok: false, problem: "cells" });
  });

  it.each([
    "",
    "   \n  ",
    "/Users/me/run.ipynb",
    "C:/runs/run.ipynb",
    "\\\\server\\share\\run.ipynb",
    "../shared/run.ipynb",
    "assets/../../secret.ipynb",
    "%2E%2E/run.ipynb",
    "https://example.org/run.ipynb",
    "file:///Users/me/run.ipynb",
    "data:image/png;base64,AAAA",
  ])("refuses the path %j", (source) => {
    expect(parseNotebookBlock(source)).toEqual({ ok: false, problem: "path" });
  });

  it("writes a fenced block that reads back as the same path", () => {
    const fence = notebookFence("assets/run-1a2b3c4d.ipynb");
    expect(fence).toBe("```notebook\nassets/run-1a2b3c4d.ipynb\n```");
    expect(parseNotebookBlock(fence.split("\n")[1])).toMatchObject({ ok: true, block: { path: "assets/run-1a2b3c4d.ipynb" } });
  });

  it("knows a notebook by its extension", () => {
    expect(isNotebookPath("assets/Run.IPYNB")).toBe(true);
    expect(isNotebookPath("assets/run.ipynb.json")).toBe(false);
  });
});

describe("note paths", () => {
  it("gives a relative path and nothing for web or embedded sources", () => {
    expect(notePath("./figures/a.png")).toBe("figures/a.png");
    expect(notePath("https://example.org/a.png")).toBeNull();
    expect(notePath("../a.png")).toBeNull();
    expect(imageSource("data:image/png;base64,AA")).toEqual({ url: "data:image/png;base64,AA" });
  });
});

function base64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

describe("notebook text", () => {
  it("decodes a base64 data address as UTF-8", () => {
    expect(notebookText(`data:application/x-ipynb+json;base64,${base64('{"title":"Résumé ✓"}')}`)).toBe('{"title":"Résumé ✓"}');
  });

  it("ignores line breaks inside the base64", () => {
    const encoded = base64('{"nbformat":4}');
    expect(notebookText(`data:application/json;BASE64,${encoded.slice(0, 4)}\n${encoded.slice(4)}`)).toBe('{"nbformat":4}');
  });

  it("decodes a percent-encoded data address", () => {
    expect(notebookText(`data:application/json;charset=utf-8,${encodeURIComponent('{"a": "b c"}')}`)).toBe('{"a": "b c"}');
  });

  it("gives nothing for an address that is not a data address", () => {
    expect(notebookText("blob:abc")).toBeNull();
    expect(notebookText("https://example.org/run.ipynb")).toBeNull();
  });

  it("refuses a notebook over 64 MiB", () => {
    const tooLong = "A".repeat(Math.ceil(((NOTEBOOK_MAX_BYTES + 8) * 4) / 3));
    expect(() => notebookText(`data:application/json;base64,${tooLong}`)).toThrow(NotebookTooLargeError);
    const error = new NotebookTooLargeError();
    expect(error.name).toBe("NotebookTooLargeError");
    expect(error.message).toContain("64 MiB");
  });

  it("refuses percent-encoded text over 64 MiB", () => {
    const body = "a".repeat(NOTEBOOK_MAX_BYTES + 1);
    expect(() => notebookText(`data:text/plain,${body}`)).toThrow(NotebookTooLargeError);
  });
});
