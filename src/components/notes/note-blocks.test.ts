// @vitest-environment jsdom
import { Box } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import {
  BlockFileTooLargeError,
  blockMessage,
  blockSummary,
  currentTheme,
  dataUrlBytes,
  dataUrlText,
  noteBlock,
  noteBlockKinds,
  noteBlockName,
  paintBlockCard,
  registerNoteBlock,
  splitBlockOptions,
} from "./note-blocks";

afterEach(() => {
  document.documentElement.classList.remove("dark");
});

describe("note block registry", () => {
  it("finds kinds by name and alias, ignoring case, raw braces and spaces", () => {
    const kind = { name: "probe-kind", aliases: ["probe-alias"], label: () => "Probe", icon: Box, paint: () => undefined };
    registerNoteBlock(kind);
    expect(noteBlockName("probe-kind")).toBe("probe-kind");
    expect(noteBlockName(" {=PROBE-ALIAS} ")).toBe("probe-kind");
    expect(noteBlock("probe-alias")).toBe(kind);
    expect(noteBlock("probe-kind")).toBe(kind);
    expect(noteBlock("missing")).toBeUndefined();
    expect(noteBlockName("missing")).toBeUndefined();
    expect(noteBlockKinds()).toContain(kind);
  });
});

describe("block drawing helpers", () => {
  it("reads the theme from the root class", () => {
    expect(currentTheme()).toBe("light");
    document.documentElement.classList.add("dark");
    expect(currentTheme()).toBe("dark");
  });

  it("draws a message in place of the preview", () => {
    const preview = document.createElement("div");
    preview.append(document.createElement("span"));
    blockMessage(preview, "Nothing to show");
    expect(preview.children).toHaveLength(1);
    expect(preview.querySelector("p.note-drawn-empty")?.textContent).toBe("Nothing to show");
  });

  it("summarises a block by its first non-empty line, cut long", () => {
    expect(blockSummary("\n\n  first line  \nsecond")).toBe("first line");
    expect(blockSummary("  \n ")).toBe("");
    const long = "x".repeat(200);
    expect(blockSummary(long)).toBe(`${"x".repeat(120)}…`);
  });

  it("paints a labelled card with the summary when there is one", () => {
    const preview = document.createElement("div");
    paintBlockCard(preview, "HTML", "<p>Hello</p>");
    expect(preview.querySelector(".note-block-card-title")?.textContent).toBe("HTML");
    expect(preview.querySelector(".note-block-card-text")?.textContent).toBe("<p>Hello</p>");
    paintBlockCard(preview, "React", "");
    expect(preview.querySelector(".note-block-card-title")?.textContent).toBe("React");
    expect(preview.querySelector(".note-block-card-text")).toBeNull();
  });
});

describe("data URLs", () => {
  it("decodes base64 and percent-encoded bodies", () => {
    expect(dataUrlText(`data:text/csv;base64,${btoa("a,b\n1,2")}`, 100)).toBe("a,b\n1,2");
    expect(dataUrlText("data:text/plain,hello%20world", 100)).toBe("hello world");
    expect([...(dataUrlBytes("data:;base64,AAEC", 10) ?? [])]).toEqual([0, 1, 2]);
  });

  it("returns null for other URLs and broken bodies", () => {
    expect(dataUrlBytes("https://example.org/a.csv", 10)).toBeNull();
    expect(dataUrlBytes("data:text/plain;base64,@@@", 10)).toBeNull();
    expect(dataUrlBytes("data:text/plain,%E0%A4%A", 10)).toBeNull();
    expect(dataUrlText("blob:abc", 10)).toBeNull();
  });

  it("refuses bodies over the byte limit", () => {
    expect(() => dataUrlBytes(`data:;base64,${btoa("x".repeat(64))}`, 8)).toThrow(BlockFileTooLargeError);
    expect(() => dataUrlBytes(`data:,${"x".repeat(20)}`, 8)).toThrow(BlockFileTooLargeError);
  });
});

describe("block options", () => {
  it("reads known option lines at the top and leaves the body", () => {
    const keys = new Set(["path", "style"]);
    const { options, body } = splitBlockOptions("\nPath: assets/a.pdb\nstyle:  stick \nATOM 1\nstyle: late", keys);
    expect([...options]).toEqual([
      ["path", "assets/a.pdb"],
      ["style", "stick"],
    ]);
    expect(body).toBe("ATOM 1\nstyle: late");
  });

  it("stops at the first unknown key or plain line", () => {
    const keys = new Set(["path"]);
    expect(splitBlockOptions("title: x\npath: a", keys).options.size).toBe(0);
    expect(splitBlockOptions("plain\npath: a", keys).body).toBe("plain\npath: a");
    expect(splitBlockOptions("", keys)).toEqual({ options: new Map(), body: "" });
  });
});
