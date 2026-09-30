// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri, invoke: mocks.invoke }));

import {
  displayPath,
  displayText,
  homeRelativePath,
  homeRelativeText,
  loadDisplayHomes,
  outsideCodeFences,
  resetDisplayHomes,
  setDisplayHomes,
  useDisplayPath,
  useDisplayText,
} from "@/lib/display-path";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isTauri.mockReturnValue(true);
  resetDisplayHomes();
});

afterEach(() => resetDisplayHomes());

describe("homeRelativePath", () => {
  it("abbreviates the home folder the way the Rust helper does", () => {
    expect(homeRelativePath("/Users/ada/Desktop/x", "/Users/ada")).toBe("~/Desktop/x");
    expect(homeRelativePath("/Users/ada", "/Users/ada")).toBe("~");
    expect(homeRelativePath("/Users/ada/", "/Users/ada")).toBe("~");
    expect(homeRelativePath("/Users/ada/x", "/Users/ada/")).toBe("~/x");
  });

  it("leaves other folders and look-alike names alone", () => {
    expect(homeRelativePath("/Users/adam/paper", "/Users/ada")).toBe("/Users/adam/paper");
    expect(homeRelativePath("/Volumes/USB/paper", "/Users/ada")).toBe("/Volumes/USB/paper");
    expect(homeRelativePath("relative/path", "/Users/ada")).toBe("relative/path");
  });

  it("returns the input when the home folder is unknown", () => {
    expect(homeRelativePath("/Users/ada/x", null)).toBe("/Users/ada/x");
    expect(homeRelativePath("/Users/ada/x", undefined)).toBe("/Users/ada/x");
    expect(homeRelativePath("/Users/ada/x", "")).toBe("/Users/ada/x");
  });

  it("drops the Windows verbatim prefix on both sides and keeps backslashes", () => {
    expect(homeRelativePath(String.raw`\\?\C:\Users\ada\x`, String.raw`C:\Users\ada`)).toBe(
      String.raw`~\x`,
    );
    expect(homeRelativePath(String.raw`C:\Users\ada\thesis`, String.raw`\\?\C:\Users\ada`)).toBe(
      String.raw`~\thesis`,
    );
    expect(homeRelativePath(String.raw`\\?\UNC\server\share\paper`, String.raw`C:\Users\ada`)).toBe(
      String.raw`\\server\share\paper`,
    );
  });

  it("ignores case and separator style on Windows only", () => {
    expect(homeRelativePath(String.raw`c:\users\ada\x`, String.raw`C:\Users\ada`)).toBe(String.raw`~\x`);
    expect(homeRelativePath("C:/Users/ada/x", String.raw`C:\Users\ada`)).toBe("~/x");
    expect(homeRelativePath("/users/ada/x", "/Users/ada")).toBe("/users/ada/x");
  });
});

describe("homeRelativeText", () => {
  it("replaces the home folder wherever it starts a path in free text", () => {
    expect(homeRelativeText("Read /Users/ada/.oleafly/projects/p/main.tex", "/Users/ada")).toBe(
      "Read ~/.oleafly/projects/p/main.tex",
    );
    expect(
      homeRelativeText("(/Users/ada/tex/article.cls) and '/Users/ada/b.tex'", "/Users/ada"),
    ).toBe("(~/tex/article.cls) and '~/b.tex'");
    expect(homeRelativeText("--out=/Users/ada/build", "/Users/ada")).toBe("--out=~/build");
    expect(homeRelativeText("saved in /Users/ada.", "/Users/ada")).toBe("saved in ~.");
  });

  it("only matches at a path boundary", () => {
    expect(homeRelativeText("/Users/adam/x and /data/Users/ada/x", "/Users/ada")).toBe(
      "/Users/adam/x and /data/Users/ada/x",
    );
    expect(homeRelativeText("/Users/ada.bak/x", "/Users/ada")).toBe("/Users/ada.bak/x");
  });

  it("handles Windows spellings, including forward slashes and the verbatim prefix", () => {
    const home = String.raw`C:\Users\ada`;
    expect(homeRelativeText(String.raw`Open \\?\C:\Users\ada\x failed`, home)).toBe(
      String.raw`Open ~\x failed`,
    );
    expect(homeRelativeText("(c:/users/ada/tex/a.sty)", home)).toBe("(~/tex/a.sty)");
    // Rust's `{path:?}` doubles every backslash.
    expect(homeRelativeText(String.raw`failed "C:\\Users\\ada\\x"`, home)).toBe(
      String.raw`failed "~\\x"`,
    );
  });

  it("never rewrites text for an empty or root home", () => {
    expect(homeRelativeText("/usr/bin and /tmp", "/")).toBe("/usr/bin and /tmp");
    expect(homeRelativeText("/usr/bin", null)).toBe("/usr/bin");
  });
});

describe("outsideCodeFences", () => {
  const upper = (text: string) => text.toUpperCase();

  it("formats prose and inline code but leaves fenced code as written", () => {
    const markdown = [
      "Run `this`:",
      "",
      "```bash",
      'cp "/Users/ada/My Docs/a.tex" .',
      "```",
      "then more.",
    ].join("\n");
    expect(outsideCodeFences(markdown, upper)).toBe(
      ["RUN `THIS`:", "", "```bash", 'cp "/Users/ada/My Docs/a.tex" .', "```", "THEN MORE."].join("\n"),
    );
  });

  it("handles tilde fences, longer closers, indented fences and an unclosed fence", () => {
    expect(outsideCodeFences("a\n~~~\nb\n~~~~\nc", upper)).toBe("A\n~~~\nb\n~~~~\nC");
    expect(outsideCodeFences("1. a\n\n    ```\n    b\n    ```\nc", upper)).toBe(
      "1. A\n\n    ```\n    b\n    ```\nC",
    );
    // A shorter or different run does not close the fence.
    expect(outsideCodeFences("````\nb\n```\n~~~~\nc", upper)).toBe("````\nb\n```\n~~~~\nc");
    // Still streaming: everything after the opening fence stays as written.
    expect(outsideCodeFences("a\n```sh\nb", upper)).toBe("A\n```sh\nb");
  });

  it("recognises fences in text with Windows line endings", () => {
    const home = (text: string) => homeRelativeText(text, "/Users/ada");
    expect(
      outsideCodeFences("x /Users/ada/before\r\n```\r\n/Users/ada/crlf\r\n```\r\n/Users/ada/after", home),
    ).toBe("x ~/before\r\n```\r\n/Users/ada/crlf\r\n```\r\n~/after");
    expect(outsideCodeFences("a\r\n~~~ sh\r\nb\r\n~~~~\r\nc", upper)).toBe("A\r\n~~~ sh\r\nb\r\n~~~~\r\nC");
  });

  it("formats lines the Markdown renderer shows as prose, even when they look like fences", () => {
    // Four spaces at the top level is an indented code line, not a fence.
    expect(outsideCodeFences("a\n\n    ```\nb", upper)).toBe("A\n\n    ```\nB");
  });
});

describe("loaded home folders", () => {
  it("formats with every spelling the backend reports, longest first", () => {
    setDisplayHomes(["/Users/ada", "/Volumes/Data/Users/ada"]);
    expect(displayPath("/Volumes/Data/Users/ada/x")).toBe("~/x");
    expect(displayPath("/Users/ada/y")).toBe("~/y");
    expect(displayText("a /Volumes/Data/Users/ada/x b /Users/ada/y")).toBe("a ~/x b ~/y");
  });

  it("asks the backend once and reuses the answer", async () => {
    mocks.invoke.mockResolvedValue(["/Users/ada"]);
    await loadDisplayHomes();
    await loadDisplayHomes();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("display_homes");
    expect(displayPath("/Users/ada/x")).toBe("~/x");
  });

  it("does not remember a failed or empty answer", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("no backend"));
    await loadDisplayHomes();
    expect(displayPath("/Users/ada/x")).toBe("/Users/ada/x");
    mocks.invoke.mockResolvedValueOnce(null);
    await loadDisplayHomes();
    mocks.invoke.mockResolvedValueOnce(["/Users/ada"]);
    await loadDisplayHomes();
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
    expect(displayPath("/Users/ada/x")).toBe("~/x");
  });

  it("skips the backend outside the desktop app", async () => {
    mocks.isTauri.mockReturnValue(false);
    await loadDisplayHomes();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("re-renders hook users once the home folder arrives", async () => {
    mocks.invoke.mockResolvedValue(["/Users/ada"]);
    const path = renderHook(() => useDisplayPath());
    const text = renderHook(() => useDisplayText());
    await waitFor(() => expect(path.result.current("/Users/ada/x")).toBe("~/x"));
    expect(text.result.current("at /Users/ada/y")).toBe("at ~/y");
    act(() => setDisplayHomes(["/home/bo"]));
    expect(path.result.current("/home/bo/x")).toBe("~/x");
  });
});
