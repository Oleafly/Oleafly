// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

// jsdom has no canvas, and xterm probes one for glyph measuring as it loads.
vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

import { Terminal, type ILink, type ILinkProvider } from "@xterm/xterm";
import { terminalPathResolver } from "@/lib/terminal-links";
import {
  createTerminalLinkHandler,
  createTerminalLinkProvider,
  isOpenLinkClick,
  type TerminalLinkActions,
} from "./terminal-link-provider";

const PROJECT_FILES = new Set([
  "main.tex",
  "scripts/deep/nested/folder/plot.py",
  "图表/说明",
  "图表/说明书.tex",
]);

let terminal: Terminal | null = null;

afterEach(() => {
  terminal?.dispose();
  terminal = null;
});

function actions() {
  return {
    resolve: vi.fn((path: string) => {
      const clean = path.replace(/^\.\//, "");
      return PROJECT_FILES.has(clean) ? clean : null;
    }),
    openFile: vi.fn<TerminalLinkActions["openFile"]>(),
    openUrl: vi.fn<TerminalLinkActions["openUrl"]>(),
    hover: vi.fn<TerminalLinkActions["hover"]>(),
    leave: vi.fn<TerminalLinkActions["leave"]>(),
  } satisfies TerminalLinkActions;
}

async function termWith(text: string, cols = 20): Promise<Terminal> {
  terminal = new Terminal({ cols, rows: 10, allowProposedApi: true });
  await new Promise<void>((resolve) => terminal?.write(text, resolve));
  return terminal;
}

function linksAt(provider: ILinkProvider, y: number): Promise<ILink[] | undefined> {
  return new Promise((resolve) => provider.provideLinks(y, resolve));
}

function click(modifier: boolean): MouseEvent {
  return new MouseEvent("mouseup", { button: 0, metaKey: modifier, ctrlKey: modifier });
}

describe("createTerminalLinkProvider", () => {
  it("links a Python path wrapped over three rows once, from each of its rows", async () => {
    const term = await termWith('  File "scripts/deep/nested/folder/plot.py", line 4, in <module>');
    const handlers = actions();
    const provider = createTerminalLinkProvider(term, handlers);

    const expected = { start: { x: 9, y: 1 }, end: { x: 2, y: 3 } };
    for (const y of [1, 2, 3]) {
      const links = await linksAt(provider, y);
      expect(links).toHaveLength(1);
      expect(links?.[0].range).toEqual(expected);
      expect(links?.[0].text).toBe("scripts/deep/nested/folder/plot.py");
    }
    expect(await linksAt(provider, 4)).toBeUndefined();

    const [link] = (await linksAt(provider, 2)) ?? [];
    link.activate(click(true), link.text);
    expect(handlers.openFile).toHaveBeenCalledExactlyOnceWith({
      path: "scripts/deep/nested/folder/plot.py",
      line: 4,
    });
  });

  it("maps wide characters to their exact cells", async () => {
    const term = await termWith("中文 main.tex:3:1", 40);
    const [link] = (await linksAt(createTerminalLinkProvider(term, actions()), 1)) ?? [];
    expect(link.range).toEqual({ start: { x: 6, y: 1 }, end: { x: 17, y: 1 } });
    expect(link.text).toBe("main.tex:3:1");

    const cjk = await termWith("ok 图表/说明", 40);
    const [wide] = (await linksAt(createTerminalLinkProvider(cjk, actions()), 1)) ?? [];
    expect(wide.range).toEqual({ start: { x: 4, y: 1 }, end: { x: 12, y: 1 } });
  });

  it("joins a wide glyph that wrapped early without the empty cell it left", async () => {
    // At 10 columns 明 does not fit in the last cell, so xterm leaves it empty
    // and wraps: "a 图表/说 " + "明书.tex:3" + ":".
    const term = await termWith("a 图表/说明书.tex:3:", 10);
    const provider = createTerminalLinkProvider(term, actions());
    for (const y of [1, 2]) {
      const links = await linksAt(provider, y);
      expect(links).toHaveLength(1);
      expect(links?.[0].range).toEqual({ start: { x: 3, y: 1 }, end: { x: 10, y: 2 } });
      expect(links?.[0].text).toBe("图表/说明书.tex:3");
    }
  });

  it("keeps a real space printed in the last column of a wrapped row", async () => {
    const term = await termWith("ab main.tex:3", 3);
    const [link] = (await linksAt(createTerminalLinkProvider(term, actions()), 2)) ?? [];
    expect(link.text).toBe("main.tex:3");
    expect(link.range).toEqual({ start: { x: 1, y: 2 }, end: { x: 1, y: 5 } });
  });

  it("links the project path after prose on an error: line", async () => {
    const term = await termWith("error: Failed to parse main.tex:3:5: Simple statements", 80);
    const handlers = actions();
    const links = (await linksAt(createTerminalLinkProvider(term, handlers), 1)) ?? [];
    expect(links.map((link) => link.text)).toEqual(["main.tex:3:5"]);

    links[0].activate(click(true), links[0].text);
    expect(handlers.openFile).toHaveBeenCalledExactlyOnceWith({ path: "main.tex", line: 3, column: 5 });
  });

  it("links grep results and Windows paths spelled in another case", async () => {
    const handlers = { ...actions(), resolve: vi.fn(terminalPathResolver(["main.tex", "chapters/intro.tex"])) };
    const term = await termWith(
      "chapters/intro.tex:3:\\section{Intro}\r\n.\\Chapters\\Intro.tex:5: Undefined control sequence.\r\n",
      80,
    );
    const provider = createTerminalLinkProvider(term, handlers);

    const [grep] = (await linksAt(provider, 1)) ?? [];
    expect(grep.text).toBe("chapters/intro.tex:3");
    grep.activate(click(true), grep.text);
    expect(handlers.openFile).toHaveBeenLastCalledWith({ path: "chapters/intro.tex", line: 3 });

    const [windows] = (await linksAt(provider, 2)) ?? [];
    expect(windows.text).toBe(".\\Chapters\\Intro.tex:5");
    windows.activate(click(true), windows.text);
    expect(handlers.openFile).toHaveBeenLastCalledWith({ path: "chapters/intro.tex", line: 5 });
  });

  it("gives no link to a path that is not a project file", async () => {
    const term = await termWith("see other.tex and /etc/hosts:3", 40);
    expect(await linksAt(createTerminalLinkProvider(term, actions()), 1)).toBeUndefined();
  });

  it("opens a file only on a modifier click, at its line and column", async () => {
    const term = await termWith("main.tex:3:7: oops", 40);
    const handlers = actions();
    const [link] = (await linksAt(createTerminalLinkProvider(term, handlers), 1)) ?? [];
    expect(link.decorations).toEqual({ underline: true, pointerCursor: true });

    link.activate(click(false), link.text);
    expect(handlers.openFile).not.toHaveBeenCalled();

    link.activate(click(true), link.text);
    expect(handlers.openFile).toHaveBeenCalledExactlyOnceWith({ path: "main.tex", line: 3, column: 7 });
  });

  it("reports hover and leave with the project path and location", async () => {
    const term = await termWith("./main.tex:12:4: x", 40);
    const handlers = actions();
    const [link] = (await linksAt(createTerminalLinkProvider(term, handlers), 1)) ?? [];
    const move = new MouseEvent("mousemove", { clientX: 30, clientY: 40 });

    link.hover?.(move, link.text);
    expect(handlers.hover).toHaveBeenCalledWith({ label: "main.tex:12:4", kind: "file" }, move);
    link.leave?.(move, link.text);
    expect(handlers.leave).toHaveBeenCalled();
  });

  it("opens a web URL through the app on a modifier click", async () => {
    const term = await termWith("docs: https://typst.app/docs.", 60);
    const handlers = actions();
    const [link] = (await linksAt(createTerminalLinkProvider(term, handlers), 1)) ?? [];
    expect(link.text).toBe("https://typst.app/docs");

    link.hover?.(new MouseEvent("mousemove"), link.text);
    expect(handlers.hover).toHaveBeenCalledWith(
      { label: "https://typst.app/docs", kind: "url" },
      expect.any(MouseEvent),
    );
    link.activate(click(false), link.text);
    expect(handlers.openUrl).not.toHaveBeenCalled();
    link.activate(click(true), link.text);
    expect(handlers.openUrl).toHaveBeenCalledExactlyOnceWith("https://typst.app/docs");
    expect(handlers.resolve).not.toHaveBeenCalled();
  });
});

describe("createTerminalLinkHandler (OSC 8)", () => {
  it("opens http links through the app and never falls back to confirm or window.open", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const handlers = actions();
    const handler = createTerminalLinkHandler(handlers);
    const range = { start: { x: 1, y: 1 }, end: { x: 4, y: 1 } };

    expect(handler.allowNonHttpProtocols).toBe(false);
    handler.activate(click(false), "https://example.org/", range);
    expect(handlers.openUrl).not.toHaveBeenCalled();
    handler.activate(click(true), "https://example.org/", range);
    expect(handlers.openUrl).toHaveBeenCalledExactlyOnceWith("https://example.org/");
    handler.activate(click(true), "https://user:pw@example.org/", range);
    expect(handlers.openUrl).toHaveBeenCalledTimes(1);

    handler.hover?.(new MouseEvent("mousemove"), "https://example.org/", range);
    expect(handlers.hover).toHaveBeenCalledWith(
      { label: "https://example.org/", kind: "url" },
      expect.any(MouseEvent),
    );
    handler.leave?.(new MouseEvent("mouseleave"), "https://example.org/", range);
    expect(handlers.leave).toHaveBeenCalled();

    expect(confirm).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});

describe("isOpenLinkClick", () => {
  it("wants Cmd on macOS, where Ctrl-click is a right click", () => {
    expect(isOpenLinkClick(new MouseEvent("mouseup", { metaKey: true }), true)).toBe(true);
    expect(isOpenLinkClick(new MouseEvent("mouseup", { ctrlKey: true }), true)).toBe(false);
    expect(isOpenLinkClick(new MouseEvent("mouseup"), true)).toBe(false);
  });

  it("wants Ctrl elsewhere", () => {
    expect(isOpenLinkClick(new MouseEvent("mouseup", { ctrlKey: true }), false)).toBe(true);
    expect(isOpenLinkClick(new MouseEvent("mouseup", { metaKey: true }), false)).toBe(false);
  });

  it("ignores buttons other than the main one", () => {
    expect(isOpenLinkClick(new MouseEvent("mouseup", { ctrlKey: true, button: 2 }), false)).toBe(false);
  });
});
