// @vitest-environment jsdom
import { Box } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BlockFileTooLargeError,
  blockMessage,
  blockSummary,
  currentTheme,
  dataUrlBytes,
  dataUrlText,
  noteBlock,
  noteBlockName,
  paintAsync,
  paintBlockCard,
  parseOptionLine,
  registerNoteBlock,
  splitBlockOptions,
} from "./note-blocks";

afterEach(() => {
  document.documentElement.classList.remove("dark");
});

function texts(preview: HTMLElement): (string | null)[] {
  return [...preview.querySelectorAll("p")].map((paragraph) => paragraph.textContent);
}

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
    expect(preview.querySelector("p")?.textContent).toBe("Nothing to show");
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
    expect(texts(preview)).toEqual(["HTML", "<p>Hello</p>"]);
    paintBlockCard(preview, "React", "");
    expect(texts(preview)).toEqual(["React"]);
  });
});

describe("async painting", () => {
  it("shows the loading text, then the result, and disposes what it mounted", async () => {
    const preview = document.createElement("div");
    const unmount = vi.fn();
    const dispose = paintAsync(preview, {
      loading: "Loading",
      load: () => Promise.resolve("Ready"),
      show: (text) => {
        preview.textContent = text;
        return unmount;
      },
      error: () => "Failed",
    });
    expect(preview.textContent).toBe("Loading");
    await vi.waitFor(() => expect(preview.textContent).toBe("Ready"));
    dispose();
    expect(unmount).toHaveBeenCalledOnce();
  });

  it("explains a failure, and ignores everything after dispose", async () => {
    const failed = document.createElement("div");
    paintAsync(failed, { load: () => Promise.reject(new Error("x")), show: () => undefined, error: () => "Failed" });
    await vi.waitFor(() => expect(failed.textContent).toBe("Failed"));
    const gone = document.createElement("div");
    const show = vi.fn(() => undefined);
    paintAsync(gone, { loading: "Loading", load: () => Promise.resolve("Ready"), show, error: () => "Failed" })();
    await Promise.resolve();
    await Promise.resolve();
    expect(show).not.toHaveBeenCalled();
    expect(gone.textContent).toBe("Loading");
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

  it("reads one option line: a name, a colon and the value after any spaces", () => {
    expect(parseOptionLine("Style :  stick model")).toEqual({ name: "Style", value: "stick model" });
    expect(parseOptionLine("path: a:b")).toEqual({ name: "path", value: "a:b" });
    expect(parseOptionLine("color:")).toEqual({ name: "color", value: "" });
    expect(parseOptionLine("x-1_y:\n z")).toEqual({ name: "x-1_y", value: "z" });
  });

  it("rejects lines that are not an option", () => {
    expect(parseOptionLine("no colon")).toBeNull();
    expect(parseOptionLine("1st: x")).toBeNull();
    expect(parseOptionLine(" style: x")).toBeNull();
    expect(parseOptionLine("two words: x")).toBeNull();
    expect(parseOptionLine("style: a\rb")).toBeNull();
  });
});
