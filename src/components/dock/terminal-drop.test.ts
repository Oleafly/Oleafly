import { describe, expect, it } from "vitest";
import { TREE_DRAG_TYPE } from "@/lib/tree-drag";
import { canDropOnTerminal, parseUriList, readTerminalDrop, terminalDropText } from "./terminal-drop";

function transfer(data: Record<string, string>, extraTypes: string[] = []) {
  return { types: [...Object.keys(data), ...extraTypes], getData: (type: string) => data[type] ?? "" };
}

describe("terminal drops", () => {
  it("turns a tree drag into a path relative to the terminal's start folder", () => {
    const drop = { kind: "tree" as const, paths: ["chapters/intro 1.tex"] };
    expect(terminalDropText(drop, "powershell", "windows", "")).toBe("'chapters\\intro 1.tex' ");
    expect(terminalDropText(drop, "posix", "linux", "chapters")).toBe("'intro 1.tex' ");
    expect(terminalDropText({ kind: "tree", paths: ["src/main.tex"] }, "posix", "mac", "")).toBe("src/main.tex ");
    expect(terminalDropText({ kind: "tree", paths: [] }, "posix", "linux", "")).toBe("");
  });

  it("quotes absolute Linux paths as they are", () => {
    const drop = { kind: "absolute" as const, paths: ["/home/u/My Paper/a.pdf", "/tmp/b.png"] };
    expect(terminalDropText(drop, "posix", "linux", "chapters")).toBe("'/home/u/My Paper/a.pdf' /tmp/b.png ");
  });

  it("reads Linux file URIs and skips comments and other schemes", () => {
    expect(
      parseUriList("# from Files\r\nfile:///home/u/My%20Paper/a.pdf\r\nhttps://x.org\r\nfile://localhost/tmp/b.png"),
    ).toEqual(["/home/u/My Paper/a.pdf", "/tmp/b.png"]);
    expect(parseUriList("file://otherhost/x\nnot a url\n")).toEqual([]);
  });

  it("reads a tree drag on every platform and a URI list only on Linux", () => {
    const tree = transfer({ [TREE_DRAG_TYPE]: "figures\\plot one.png" });
    expect(readTerminalDrop(tree, "windows")).toEqual({ kind: "tree", paths: ["figures/plot one.png"] });
    expect(canDropOnTerminal(tree, "mac")).toBe(true);

    const files = transfer({ "text/uri-list": "file:///tmp/a.pdf" }, ["Files"]);
    expect(readTerminalDrop(files, "linux")).toEqual({ kind: "absolute", paths: ["/tmp/a.pdf"] });
    expect(canDropOnTerminal(files, "linux")).toBe(true);
    expect(readTerminalDrop(files, "windows")).toBeNull();
    expect(canDropOnTerminal(files, "windows")).toBe(false);
  });

  it("ignores OS file drops on Windows and macOS", () => {
    const osDrop = transfer({}, ["Files"]);
    expect(readTerminalDrop(osDrop, "windows")).toBeNull();
    expect(readTerminalDrop(osDrop, "mac")).toBeNull();
    expect(readTerminalDrop(osDrop, "linux")).toBeNull();
    expect(canDropOnTerminal(osDrop, "mac")).toBe(false);
    expect(readTerminalDrop(null, "linux")).toBeNull();
  });
});
