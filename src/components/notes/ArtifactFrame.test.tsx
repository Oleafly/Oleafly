// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import {
  ArtifactFrame,
  BUILD_DELAY_MS,
  buildFrame,
  frameMessages,
  INITIAL_HEIGHT,
  loadArtifactRuntime,
  MAX_HEIGHT,
  MIN_HEIGHT,
  mountScriptedBlock,
  nextHeight,
  noteRunsBlocks,
  RUN_BLOCKS_KEY,
  resetArtifactRuntime,
  ScriptedBlock,
  type ScriptedBlockProps,
  START_GRACE_MS,
  setNoteRunsBlocks,
  staticHtml,
  tokenOf,
  WATCHDOG_MS,
} from "./ArtifactFrame";
import { framePolicy, STATIC_POLICY } from "./artifact-runtime/frame-document";

const tauri = vi.hoisted(() => ({
  open: vi.fn(async (_html: string) => "oleafly-artifact://localhost/0123456789abcdef0123456789abcdef"),
  close: vi.fn(async (_token: string) => true),
  runtime: vi.fn(async () => `oleafly-artifact://localhost/runtime/${"ab".repeat(32)}.js`),
}));

vi.mock("@/lib/tauri", () => ({
  artifactFrameOpen: tauri.open,
  artifactFrameClose: tauri.close,
  artifactFrameRuntimeUrl: tauri.runtime,
}));

const RUNTIME_URL = `oleafly-artifact://localhost/runtime/${"ab".repeat(32)}.js`;
const RUNTIME_TAG = `<script src="${RUNTIME_URL}"></script>`;

const TOKEN = "0123456789abcdef0123456789abcdef";
const HTML_LABEL = "HTML";
const REACT_LABEL = "React";
const SCRIPTED = "<p>Hi</p><script>document.body.dataset.ran = '1'</script>";

let observers: { callback: IntersectionObserverCallback; targets: Set<Element> }[] = [];
let visibleOnObserve = true;

function entry(target: Element, isIntersecting: boolean): IntersectionObserverEntry {
  return { target, isIntersecting } as IntersectionObserverEntry;
}

function setVisible(visible: boolean) {
  for (const observer of observers) {
    observer.callback([...observer.targets].map((target) => entry(target, visible)), {} as IntersectionObserver);
  }
}

function props(overrides: Partial<ScriptedBlockProps> = {}): ScriptedBlockProps {
  return {
    kind: "html",
    source: SCRIPTED,
    label: "HTML",
    noteId: "note-1",
    scripted: true,
    running: false,
    onRunningChange: vi.fn(),
    ...overrides,
  };
}

function frame(): HTMLIFrameElement {
  return document.querySelector("[data-artifact-frame] iframe") as HTMLIFrameElement;
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function channelOf(html: string): string {
  return /const channel = "([0-9a-f]+)"/u.exec(html)?.[1] ?? "";
}

function post(data: unknown, source: MessageEventSource | null = frame().contentWindow) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source }));
  });
}

beforeAll(async () => {
  await loadNamespace("notes");
});

beforeEach(() => {
  Object.assign(globalThis, { isTauri: true });
  localStorage.clear();
  setNoteRunsBlocks("note-1", false);
  tauri.open.mockClear();
  tauri.close.mockClear();
  tauri.runtime.mockClear();
  observers = [];
  visibleOnObserve = true;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      readonly record: { callback: IntersectionObserverCallback; targets: Set<Element> };
      constructor(callback: IntersectionObserverCallback) {
        this.record = { callback, targets: new Set() };
        observers.push(this.record);
      }
      observe(target: Element) {
        this.record.targets.add(target);
        this.record.callback([entry(target, visibleOnObserve)], {} as IntersectionObserver);
      }
      unobserve(target: Element) {
        this.record.targets.delete(target);
      }
      disconnect() {
        this.record.targets.clear();
      }
    },
  );
  vi.stubGlobal("fetch", vi.fn());
  resetArtifactRuntime();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, "isTauri");
  document.documentElement.classList.remove("dark");
});

describe("helpers", () => {
  it("clamps reported heights and reads tokens from URLs", () => {
    expect(nextHeight(10)).toBe(MIN_HEIGHT);
    expect(nextHeight(320.2)).toBe(321);
    expect(nextHeight(1e9)).toBe(MAX_HEIGHT);
    expect(tokenOf(`http://oleafly-artifact.localhost/${TOKEN}`)).toBe(TOKEN);
  });

  it("strips scripts, handlers, frames and forms from static previews", () => {
    const clean = staticHtml(
      '<p onclick="x()">Hi</p><script>bad()</script><iframe src="x"></iframe><form action="/x"><input></form><img src="x" onerror="bad()">',
    );
    expect(clean).not.toMatch(/script|onclick|onerror|iframe|form/u);
    expect(clean).toContain("<p>Hi</p>");
  });

  it("passes the localized messages with the import placeholder intact", () => {
    expect(frameMessages().unknownImport).toBe(enNotes.blocks.artifact.unknownImport);
    expect(frameMessages().unknownImport).toContain("{{name}}");
  });

  it("asks the app for the runtime address once, and again after a failure", async () => {
    expect(await loadArtifactRuntime()).toBe(RUNTIME_URL);
    expect(await loadArtifactRuntime()).toBe(RUNTIME_URL);
    expect(tauri.runtime).toHaveBeenCalledOnce();
    resetArtifactRuntime();
    tauri.runtime.mockRejectedValueOnce(new Error("This block couldn't load its libraries."));
    await expect(loadArtifactRuntime()).rejects.toThrow("couldn't load its libraries");
    expect(await loadArtifactRuntime()).toBe(RUNTIME_URL);
    expect(tauri.runtime).toHaveBeenCalledTimes(3);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps a newer runtime request when an older one fails late", async () => {
    let fail: (error: Error) => void = () => undefined;
    tauri.runtime.mockImplementationOnce(() => new Promise<string>((_done, reject) => (fail = reject)));
    const stale = loadArtifactRuntime();
    resetArtifactRuntime();
    const fresh = loadArtifactRuntime();
    fail(new Error("late"));
    await expect(stale).rejects.toThrow("late");
    expect(loadArtifactRuntime()).toBe(fresh);
    await expect(fresh).resolves.toBe(RUNTIME_URL);
    expect(tauri.runtime).toHaveBeenCalledTimes(2);
  });

  it("builds HTML frames without the runtime unless a library needs it", async () => {
    const plain = await buildFrame("html", "<p>x</p><img src='https://a.example/i.png'>", "light", "c");
    expect(plain.removed).toEqual(["https://a.example/i.png"]);
    expect(plain.html).not.toContain("/runtime/");
    expect(plain.html).toContain(framePolicy(null));
    expect(tauri.runtime).not.toHaveBeenCalled();
    const swapped = await buildFrame("html", '<script src="https://d3js.org/d3.v7.min.js"></script>', "dark", "c");
    expect(swapped.html).toContain(RUNTIME_TAG);
    expect(swapped.html).toContain(framePolicy(RUNTIME_URL));
    expect(swapped.html).not.toContain("d3js.org");
    const react = await buildFrame("react", "export default () => null", "light", "c");
    expect(react.html).toContain("__oleaflyArtifact.runReact");
    expect(react.html).toContain(RUNTIME_TAG);
    expect(react.html).toContain(framePolicy(RUNTIME_URL));
    expect(react.removed).toEqual([]);
    expect(tauri.runtime).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("trust setting", () => {
  it("remembers notes that always run their blocks on this computer", () => {
    setNoteRunsBlocks("note-a", true);
    setNoteRunsBlocks("note-b", true);
    expect(noteRunsBlocks("note-a")).toBe(true);
    expect(JSON.parse(localStorage.getItem(RUN_BLOCKS_KEY) ?? "[]")).toEqual(["note-a", "note-b"]);
    setNoteRunsBlocks("note-a", false);
    expect(noteRunsBlocks("note-a")).toBe(false);
  });

  it("keeps working in memory when storage refuses writes, and rereads after a storage event", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    setNoteRunsBlocks("note-c", true);
    expect(noteRunsBlocks("note-c")).toBe(true);
    setItem.mockRestore();
    render(<ScriptedBlock {...props({ noteId: "note-d" })} />);
    localStorage.setItem(RUN_BLOCKS_KEY, '["note-d"]');
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: RUN_BLOCKS_KEY }));
    });
    expect(screen.getByRole("checkbox")).toBeChecked();
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
    });
    localStorage.setItem(RUN_BLOCKS_KEY, "not json");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(noteRunsBlocks("note-d")).toBe(false);
    localStorage.setItem(RUN_BLOCKS_KEY, '{"a":1}');
    window.dispatchEvent(new StorageEvent("storage", { key: RUN_BLOCKS_KEY }));
    expect(noteRunsBlocks("note-d")).toBe(false);
  });
});

describe("ScriptedBlock", () => {
  it("shows a static preview and explains that running needs the desktop app outside Tauri", () => {
    Reflect.deleteProperty(globalThis, "isTauri");
    render(<ScriptedBlock {...props()} />);
    expect(screen.getByText(enNotes.blocks.artifact.desktopOnly)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: enNotes.blocks.artifact.run })).toBeNull();
    const preview = screen.getByTitle("HTML preview") as HTMLIFrameElement;
    expect(preview.getAttribute("sandbox")).toBe("");
    expect(preview.getAttribute("srcdoc")).toContain(STATIC_POLICY);
    expect(preview.getAttribute("srcdoc")).not.toContain("<script");
    expect(tauri.open).not.toHaveBeenCalled();
  });

  it("says the same under a static block outside Tauri", () => {
    Reflect.deleteProperty(globalThis, "isTauri");
    render(<ScriptedBlock {...props({ source: "<p>static</p>", scripted: false })} />);
    expect(screen.getByText(enNotes.blocks.artifact.desktopOnly)).toBeInTheDocument();
    expect(screen.getByTitle("HTML preview")).toBeInTheDocument();
  });

  it("asks to run a scripted block and shows its source for React", () => {
    const onRunningChange = vi.fn();
    render(<ScriptedBlock {...props({ kind: "react", label: "React", source: "export default () => <p />;\n".repeat(14), onRunningChange })} />);
    expect(document.querySelector("[data-artifact-source]")?.textContent).toContain("export default");
    expect(document.querySelector("[data-artifact-source]")?.textContent).toContain("…");
    fireEvent.click(screen.getByRole("button", { name: enNotes.blocks.artifact.run }));
    expect(onRunningChange).toHaveBeenCalledWith(true);
    expect(tauri.open).not.toHaveBeenCalled();
  });

  it("runs a static block at once without the Run controls", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
    render(<ScriptedBlock {...props({ source: "<p>static</p>", scripted: false })} />);
    expect(screen.queryByRole("button", { name: enNotes.blocks.artifact.run })).toBeNull();
    await advance(BUILD_DELAY_MS);
    expect(tauri.open).toHaveBeenCalledOnce();
  });

  it("runs, stops and trusts blocks in a note", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
    const onRunningChange = vi.fn();
    const view = render(<ScriptedBlock {...props({ running: true, onRunningChange })} />);
    expect(screen.getByText(enNotes.blocks.artifact.starting)).toBeInTheDocument();
    await advance(BUILD_DELAY_MS);
    expect(frame().getAttribute("src")).toBe(`oleafly-artifact://localhost/${TOKEN}`);
    fireEvent.click(screen.getByRole("button", { name: enNotes.blocks.artifact.stop }));
    expect(onRunningChange).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("checkbox", { name: enNotes.blocks.artifact.alwaysRun }));
    expect(noteRunsBlocks("note-1")).toBe(true);
    expect(screen.queryByRole("button", { name: enNotes.blocks.artifact.stop })).toBeNull();
    view.rerender(<ScriptedBlock {...props({ running: false, onRunningChange })} />);
    expect(frame()).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: enNotes.blocks.artifact.alwaysRun }));
    expect(noteRunsBlocks("note-1")).toBe(false);
    expect(screen.getByRole("button", { name: enNotes.blocks.artifact.run })).toBeInTheDocument();
  });

  it("hides the trust setting when the note is unknown", () => {
    render(<ScriptedBlock {...props({ noteId: null })} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("ArtifactFrame", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
  });

  it("opens a sandboxed frame without same-origin or permissions and closes its token", async () => {
    const view = render(<ArtifactFrame kind="html" source={SCRIPTED} label={HTML_LABEL} />);
    await advance(BUILD_DELAY_MS);
    const html = tauri.open.mock.calls[0][0];
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("RTCPeerConnection");
    const element = frame();
    expect(element.getAttribute("sandbox")).toBe("allow-scripts");
    expect(element.getAttribute("allow")).toBe("");
    expect(element.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(element.getAttribute("loading")).toBe("lazy");
    expect(element.getAttribute("title")).toBe("HTML output");
    expect(element.style.height).toBe(`${INITIAL_HEIGHT}px`);
    view.unmount();
    expect(tauri.close).toHaveBeenCalledWith(TOKEN);
  });

  it("debounces rebuilds while the source changes and closes replaced tokens", async () => {
    const view = render(<ArtifactFrame kind="html" source="<p>1</p>" label={HTML_LABEL} />);
    await advance(BUILD_DELAY_MS / 2);
    view.rerender(<ArtifactFrame kind="html" source="<p>2</p>" label={HTML_LABEL} />);
    await advance(BUILD_DELAY_MS);
    expect(tauri.open).toHaveBeenCalledOnce();
    expect(tauri.open.mock.calls[0][0]).toContain("<p>2</p>");
    view.rerender(<ArtifactFrame kind="html" source="<p>3</p>" label={HTML_LABEL} />);
    expect(tauri.close).toHaveBeenCalledWith(TOKEN);
    await advance(BUILD_DELAY_MS);
    expect(tauri.open).toHaveBeenCalledTimes(2);
  });

  it("closes a token that arrives after the frame went away", async () => {
    let resolve: (url: string) => void = () => undefined;
    tauri.open.mockImplementationOnce(() => new Promise<string>((done) => (resolve = done)));
    const view = render(<ArtifactFrame kind="html" source="<p>1</p>" label={HTML_LABEL} />);
    await advance(BUILD_DELAY_MS);
    view.unmount();
    await act(async () => resolve(`oleafly-artifact://localhost/${TOKEN}`));
    expect(tauri.close).toHaveBeenCalledWith(TOKEN);
  });

  it("explains when the frame cannot start", async () => {
    tauri.open.mockRejectedValueOnce(new Error("This block is too large to run."));
    render(<ArtifactFrame kind="html" source="<p>1</p>" label={HTML_LABEL} />);
    await advance(BUILD_DELAY_MS);
    expect(screen.getByRole("alert")).toHaveTextContent("This block is too large to run.");
    tauri.open.mockRejectedValueOnce("plain failure");
    render(<ArtifactFrame kind="html" source="<p>2</p>" label={HTML_LABEL} />);
    await advance(BUILD_DELAY_MS);
    expect(screen.getAllByRole("alert")[1]).toHaveTextContent("plain failure");
  });

  it("sizes itself only from well-formed messages of its own frame", async () => {
    render(<ArtifactFrame kind="html" source={SCRIPTED} label={HTML_LABEL} />);
    await advance(BUILD_DELAY_MS);
    const channel = channelOf(tauri.open.mock.calls[0][0]);
    post({ channel, type: "size", height: 300 });
    expect(frame().style.height).toBe("300px");
    post({ channel, type: "size", height: 900 }, window);
    post({ channel: "other", type: "size", height: 900 });
    post({ channel, type: "size", height: "900" });
    post({ channel, type: "resize", height: 900 });
    expect(frame().style.height).toBe("300px");
    post({ channel, type: "size", height: 99_999 });
    expect(frame().style.height).toBe(`${MAX_HEIGHT}px`);
  });

  it("stops growing when the content grows with the frame itself", async () => {
    render(<ArtifactFrame kind="react" source="export default () => null" label={REACT_LABEL} />);
    await advance(BUILD_DELAY_MS);
    const channel = channelOf(tauri.open.mock.calls[0][0]);
    for (const height of [200, 232, 264, 296, 328, 360]) post({ channel, type: "size", height });
    expect(frame().style.height).toBe("296px");
    post({ channel, type: "size", height: 900 });
    expect(frame().style.height).toBe("296px");
    post({ channel, type: "size", height: 120 });
    expect(frame().style.height).toBe("120px");
    post({ channel, type: "size", height: 400 });
    expect(frame().style.height).toBe("400px");
  });

  it("lists the remote files it left out", async () => {
    const urls = Array.from({ length: 6 }, (_, index) => `<img src="https://a.example/${index}.png">`).join("");
    render(<ArtifactFrame kind="html" source={urls} label={HTML_LABEL} />);
    await advance(BUILD_DELAY_MS);
    const notice = document.querySelector("[data-artifact-offline]");
    expect(notice).toHaveTextContent(enNotes.blocks.artifact.offline);
    expect(notice?.querySelectorAll("li")).toHaveLength(5);
    expect(notice).toHaveTextContent("and 2 more");
  });

  it("passes theme changes to the running frame", async () => {
    render(<ArtifactFrame kind="react" source="export default () => null" label={REACT_LABEL} />);
    await advance(BUILD_DELAY_MS);
    const channel = channelOf(tauri.open.mock.calls[0][0]);
    const target = frame().contentWindow as Window;
    const posted = vi.spyOn(target, "postMessage");
    await act(async () => {
      document.documentElement.classList.add("dark");
      await Promise.resolve();
    });
    expect(posted).toHaveBeenCalledWith({ channel, type: "theme", theme: "dark" }, "*");
    expect(frame().style.colorScheme).toBe("dark");
  });

  it("removes a frame that stops beating while visible and reloads it", async () => {
    render(<ArtifactFrame kind="html" source={SCRIPTED} label={HTML_LABEL} />);
    await advance(BUILD_DELAY_MS);
    const channel = channelOf(tauri.open.mock.calls[0][0]);
    post({ channel, type: "beat" });
    await advance(WATCHDOG_MS - 1000);
    post({ channel, type: "beat" });
    await advance(WATCHDOG_MS - 1000);
    expect(frame()).toBeTruthy();
    await advance(2000);
    expect(screen.getByText(enNotes.blocks.artifact.stopped)).toBeInTheDocument();
    expect(frame()).toBeNull();
    expect(tauri.close).toHaveBeenCalledWith(TOKEN);
    fireEvent.click(screen.getByRole("button", { name: enNotes.blocks.artifact.reload }));
    await advance(BUILD_DELAY_MS);
    expect(tauri.open).toHaveBeenCalledTimes(2);
    expect(channelOf(tauri.open.mock.calls[1][0])).not.toBe(channel);
    expect(frame()).toBeTruthy();
  });

  it("gives a starting frame a grace period and pauses the watchdog while hidden", async () => {
    render(<ArtifactFrame kind="html" source={SCRIPTED} label={HTML_LABEL} />);
    await advance(BUILD_DELAY_MS);
    await advance(START_GRACE_MS);
    expect(frame()).toBeTruthy();
    act(() => setVisible(false));
    await advance(WATCHDOG_MS * 3);
    expect(frame()).toBeTruthy();
    act(() => setVisible(true));
    act(() => setVisible(true));
    await advance(WATCHDOG_MS - 1000);
    expect(frame()).toBeTruthy();
    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await advance(WATCHDOG_MS * 2);
    expect(frame()).toBeTruthy();
    hidden.mockRestore();
    await advance(WATCHDOG_MS + 1000);
    expect(frame()).toBeNull();
  });

  it("works without IntersectionObserver", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<ArtifactFrame kind="html" source="<p>x</p>" label={HTML_LABEL} />);
    await advance(BUILD_DELAY_MS);
    expect(frame()).toBeTruthy();
  });

  it("waits to build until the frame first scrolls into view", async () => {
    visibleOnObserve = false;
    render(<ArtifactFrame kind="html" source="<p>x</p>" label={HTML_LABEL} />);
    await advance(BUILD_DELAY_MS * 3);
    expect(tauri.open).not.toHaveBeenCalled();
    expect(screen.getByText(enNotes.blocks.artifact.starting)).toBeInTheDocument();
    act(() => setVisible(true));
    await advance(BUILD_DELAY_MS);
    expect(tauri.open).toHaveBeenCalledOnce();
    act(() => setVisible(false));
    act(() => setVisible(true));
    await advance(BUILD_DELAY_MS);
    expect(tauri.open).toHaveBeenCalledOnce();
    expect(frame()).toBeTruthy();
  });

  it("loads the runtime by address, so each edit sends only the block's own document", async () => {
    const view = render(<ArtifactFrame kind="react" source="export default () => 1" label={REACT_LABEL} />);
    await advance(BUILD_DELAY_MS);
    view.rerender(<ArtifactFrame kind="react" source="export default () => 2" label={REACT_LABEL} />);
    await advance(BUILD_DELAY_MS);
    expect(tauri.open).toHaveBeenCalledTimes(2);
    expect(tauri.runtime).toHaveBeenCalledOnce();
    for (const [html] of tauri.open.mock.calls) {
      expect(html).toContain(RUNTIME_TAG);
      expect(html).not.toContain("(0, eval)");
      expect(html.length).toBeLessThan(64 * 1024);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("releases its document once loaded and registers a new one when the frame reloads", async () => {
    const next = "fedcba9876543210fedcba9876543210";
    const view = render(<ArtifactFrame kind="html" source="<p>x</p>" label={HTML_LABEL} />);
    await advance(BUILD_DELAY_MS);
    tauri.close.mockRejectedValueOnce(new Error("gone"));
    fireEvent.load(frame());
    expect(tauri.close).toHaveBeenCalledOnce();
    expect(tauri.close).toHaveBeenCalledWith(TOKEN);
    tauri.open.mockResolvedValueOnce(`oleafly-artifact://localhost/${next}`);
    fireEvent.load(frame());
    await advance(0);
    expect(tauri.open).toHaveBeenCalledTimes(2);
    expect(tauri.open.mock.calls[1][0]).toBe(tauri.open.mock.calls[0][0]);
    expect(frame().getAttribute("src")).toBe(`oleafly-artifact://localhost/${next}`);
    expect(tauri.close).toHaveBeenCalledOnce();
    fireEvent.load(frame());
    expect(tauri.close).toHaveBeenLastCalledWith(next);
    view.unmount();
    expect(tauri.close).toHaveBeenCalledTimes(2);
  });

  it("opens nothing for a frame that went away while the runtime was loading", async () => {
    let finish: (url: string) => void = () => undefined;
    tauri.runtime.mockImplementationOnce(() => new Promise<string>((done) => (finish = done)));
    const view = render(<ArtifactFrame kind="react" source="export default () => null" label={REACT_LABEL} />);
    await advance(BUILD_DELAY_MS);
    view.unmount();
    await act(async () => finish(RUNTIME_URL));
    expect(tauri.runtime).toHaveBeenCalledOnce();
    expect(tauri.open).not.toHaveBeenCalled();
  });

  it("explains the failure when the app has no runtime to give", async () => {
    tauri.runtime.mockRejectedValueOnce(new Error("This block couldn't load its libraries."));
    render(<ArtifactFrame kind="react" source="export default () => null" label={REACT_LABEL} />);
    await advance(BUILD_DELAY_MS);
    expect(screen.getByRole("alert")).toHaveTextContent("This block couldn't load its libraries.");
    expect(tauri.open).not.toHaveBeenCalled();
  });

  it("explains the failure when a React frame cannot start, without reopening it", async () => {
    tauri.open.mockRejectedValueOnce(new Error("first"));
    render(<ArtifactFrame kind="react" source="export default () => null" label={REACT_LABEL} />);
    await advance(BUILD_DELAY_MS);
    expect(tauri.open).toHaveBeenCalledOnce();
    expect(tauri.runtime).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent("first");
  });
});

describe("mountScriptedBlock", () => {
  it("renders into a host and unmounts later", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const mount = mountScriptedBlock(host);
    await act(async () => mount.render(props({ scripted: false, source: "<p>x</p>" })));
    expect(host.querySelector("[data-scripted-block]")).not.toBeNull();
    mount.unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.childElementCount).toBe(0);
    host.remove();
  });
});
