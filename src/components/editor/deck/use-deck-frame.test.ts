// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { frameMessages, resetArtifactRuntime } from "@/components/notes/ArtifactFrame";
import { inlineJson } from "@/components/notes/artifact-runtime/frame-document";
import { loadNamespace } from "@/i18n";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import { describeError } from "@/lib/app-error";
import { DECK_UPDATE_DELAY_MS, type DeckFrame, type DeckFrameOptions, readDeckMessage, useDeckFrame } from "./use-deck-frame";

const tauri = vi.hoisted(() => ({
  open: vi.fn<(html: string) => Promise<string>>(),
  close: vi.fn<(token: string) => Promise<boolean>>(),
  runtime: vi.fn<() => Promise<string>>(),
  read: vi.fn<(projectId: string, path: string) => Promise<string>>(),
}));

vi.mock("@/lib/tauri", () => ({
  artifactFrameOpen: tauri.open,
  artifactFrameClose: tauri.close,
  artifactFrameRuntimeUrl: tauri.runtime,
  readFileBase64: tauri.read,
}));

const RUNTIME_URL = `oleafly-artifact://localhost/runtime/${"ab".repeat(32)}.js`;
const FIRST = "oleafly-artifact://localhost/first-token";
const SECOND = "oleafly-artifact://localhost/second-token";
const DECK = "slides/talk/index.tsx";
const CODE = 'import hero from "./hero.png";\nexport default [() => <img src={hero} />];';
const WITH_LOGO = `${CODE}\nimport logo from "@assets/logo.png";`;
const BASE: DeckFrameOptions = { projectId: "p1", path: DECK, code: CODE, mode: "edit", startPage: 0 };

interface FramePort {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage: Mock;
  close: Mock;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function dataUrl(path: string): string {
  return `data:image/png;base64,${btoa(path)}`;
}

function openDeck(overrides: Partial<DeckFrameOptions> = {}) {
  return renderHook((props: DeckFrameOptions) => useDeckFrame(props), { initialProps: { ...BASE, ...overrides } });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function htmlOf(call: number): string {
  return tauri.open.mock.calls[call][0];
}

function channelOf(html: string): string {
  return /const channel = "([0-9a-f]+)"/u.exec(html)?.[1] ?? "";
}

function attachFrame(deck: DeckFrame): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  deck.frameRef.current = iframe;
  return iframe;
}

function offerPort(
  channel: string,
  {
    source,
    origin = "null",
    withPort = true,
  }: { source: MessageEventSource | null; origin?: string; withPort?: boolean },
): FramePort {
  const port: FramePort = { onmessage: null, postMessage: vi.fn(), close: vi.fn() };
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { channel, type: "port" },
        origin,
        source,
        ports: withPort ? [port as unknown as MessagePort] : [],
      }),
    );
  });
  return port;
}

function post(port: FramePort, data: unknown) {
  act(() => {
    port.onmessage?.({ data });
  });
}

beforeAll(async () => {
  await loadNamespace("notes");
});

beforeEach(() => {
  vi.useFakeTimers();
  resetArtifactRuntime();
  tauri.open.mockResolvedValueOnce(FIRST).mockResolvedValueOnce(SECOND);
  tauri.close.mockResolvedValue(true);
  tauri.runtime.mockResolvedValue(RUNTIME_URL);
  tauri.read.mockImplementation(async (_projectId, path) => btoa(path));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
  document.documentElement.classList.remove("dark");
  document.body.replaceChildren();
});

describe("readDeckMessage", () => {
  it("reads deck, position and error messages on its own channel", () => {
    expect(readDeckMessage({ channel: "c", type: "deck", pages: 2, notes: ["Say hello", 4], title: "Talk" }, "c")).toEqual({
      type: "deck",
      info: { pages: 2, notes: ["Say hello", null], title: "Talk" },
    });
    expect(readDeckMessage({ channel: "c", type: "deck", pages: 1, notes: [], title: 7 }, "c")).toEqual({
      type: "deck",
      info: { pages: 1, notes: [], title: null },
    });
    expect(readDeckMessage({ channel: "c", type: "position", page: 1, revealed: 2, steps: 3 }, "c")).toEqual({
      type: "position",
      position: { page: 1, revealed: 2, steps: 3 },
    });
    expect(readDeckMessage({ channel: "c", type: "position", page: 0 }, "c")).toEqual({
      type: "position",
      position: { page: 0, revealed: 0, steps: 0 },
    });
    expect(readDeckMessage({ channel: "c", type: "error", title: "Broken", detail: 5 }, "c")).toEqual({
      type: "error",
      error: { title: "Broken", detail: "" },
    });
    expect(readDeckMessage({ channel: "c", type: "error", title: "Broken", detail: "line 3" }, "c")).toEqual({
      type: "error",
      error: { title: "Broken", detail: "line 3" },
    });
  });

  it("ignores other channels and malformed messages", () => {
    expect(readDeckMessage({ channel: "other", type: "deck", pages: 1, notes: [] }, "c")).toBeNull();
    expect(readDeckMessage({ channel: "c", type: "deck", pages: "1", notes: [] }, "c")).toBeNull();
    expect(readDeckMessage({ channel: "c", type: "deck", pages: 1, notes: "none" }, "c")).toBeNull();
    expect(readDeckMessage({ channel: "c", type: "position" }, "c")).toBeNull();
    expect(readDeckMessage({ channel: "c", type: "error", title: 4 }, "c")).toBeNull();
    expect(readDeckMessage({ channel: "c", type: "theme" }, "c")).toBeNull();
    expect(readDeckMessage("deck", "c")).toBeNull();
    expect(readDeckMessage(null, "c")).toBeNull();
  });
});

describe("useDeckFrame", () => {
  it("opens the deck in a sandboxed frame with its images, theme, mode and start page", async () => {
    document.documentElement.classList.add("dark");
    const { result } = openDeck({ mode: "present", startPage: 2 });
    expect(result.current).toMatchObject({ url: null, failure: null, info: null, error: null });
    expect(result.current.position).toEqual({ page: 2, revealed: 0, steps: 0 });

    await advance(0);
    expect(result.current.url).toBe(FIRST);
    expect(tauri.read).toHaveBeenCalledExactlyOnceWith("p1", "slides/talk/hero.png");
    const html = htmlOf(0);
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain(RUNTIME_URL);
    expect(html).toContain(inlineJson(CODE));
    expect(html).toContain(inlineJson({ ...frameMessages(), noSlides: enEditor.deck.noSlides }));
    expect(html).toContain(
      JSON.stringify({ mode: "present", page: 2, assets: { "./hero.png": dataUrl("slides/talk/hero.png") }, file: DECK }),
    );
    expect(channelOf(html)).toMatch(/^[0-9a-f]{24}$/u);
  });

  it("closes the one-time frame address once the frame has loaded it, and reopens when the frame reloads", async () => {
    tauri.close.mockRejectedValue(new Error("already closed"));
    const { result, unmount } = openDeck();
    await advance(0);
    expect(htmlOf(0)).toContain('data-theme="light"');
    attachFrame(result.current);

    act(() => result.current.onLoad(FIRST));
    expect(tauri.close).toHaveBeenCalledExactlyOnceWith("first-token");
    act(() => result.current.onLoad(FIRST));
    expect(tauri.open).toHaveBeenCalledOnce();

    attachFrame(result.current);
    act(() => result.current.onLoad(FIRST));
    expect(result.current.url).toBeNull();
    await advance(0);
    expect(tauri.open).toHaveBeenCalledTimes(2);
    expect(result.current.url).toBe(SECOND);
    expect(channelOf(htmlOf(1))).toBe(channelOf(htmlOf(0)));
    expect(tauri.close).toHaveBeenCalledOnce();

    act(() => result.current.onLoad(SECOND));
    expect(tauri.close).toHaveBeenLastCalledWith("second-token");
    unmount();
    expect(tauri.close).toHaveBeenCalledTimes(2);
  });

  it("treats a load with no frame element as the same frame", async () => {
    const { result } = openDeck();
    await advance(0);
    act(() => result.current.onLoad(FIRST));
    act(() => result.current.onLoad(FIRST));
    expect(tauri.close).toHaveBeenCalledExactlyOnceWith("first-token");
    expect(tauri.open).toHaveBeenCalledOnce();
    expect(result.current.url).toBe(FIRST);
  });

  it("closes an address the frame never loaded when the deck unmounts or reopens in another mode", async () => {
    tauri.close.mockRejectedValue(new Error("already closed"));
    const { result, rerender, unmount } = openDeck();
    await advance(0);

    rerender({ ...BASE, mode: "page" });
    expect(tauri.close).toHaveBeenCalledExactlyOnceWith("first-token");
    expect(result.current.url).toBeNull();
    await advance(0);
    expect(result.current.url).toBe(SECOND);
    expect(htmlOf(1)).toContain(
      JSON.stringify({ mode: "page", page: 0, assets: { "./hero.png": dataUrl("slides/talk/hero.png") }, file: DECK }),
    );

    unmount();
    expect(tauri.close).toHaveBeenLastCalledWith("second-token");
  });

  it("closes a frame that finishes opening after the deck unmounted", async () => {
    tauri.close.mockRejectedValue(new Error("already closed"));
    const opening = deferred<string>();
    tauri.open.mockReset().mockReturnValueOnce(opening.promise);
    const { result, unmount } = openDeck();
    await advance(0);
    expect(tauri.open).toHaveBeenCalledOnce();
    unmount();
    expect(tauri.close).not.toHaveBeenCalled();

    opening.resolve(FIRST);
    await advance(0);
    expect(tauri.close).toHaveBeenCalledExactlyOnceWith("first-token");
    expect(result.current.url).toBeNull();
  });

  it("says why the deck could not open", async () => {
    const cause = new Error("The runtime is missing");
    tauri.runtime.mockReset().mockRejectedValue(cause);
    const { result } = openDeck();
    await advance(0);
    expect(result.current.failure).toBe(describeError(cause));
    expect(result.current.failure).toContain("The runtime is missing");
    expect(result.current.url).toBeNull();
    expect(tauri.open).not.toHaveBeenCalled();
  });

  it("keeps quiet about a failure that arrives after the deck unmounted", async () => {
    const opening = deferred<string>();
    tauri.open.mockReset().mockReturnValueOnce(opening.promise);
    const { result, unmount } = openDeck();
    await advance(0);
    unmount();
    opening.reject(new Error("Refused"));
    await advance(0);
    expect(result.current.failure).toBeNull();
    expect(tauri.close).not.toHaveBeenCalled();
  });

  it("takes the deck's port only from its own sandboxed frame and on its own channel", async () => {
    const { result } = openDeck();
    await advance(0);
    const channel = channelOf(htmlOf(0));

    const early = offerPort(channel, { source: window });
    expect(early.onmessage).toBeNull();
    act(() => result.current.send({ type: "next" }));

    const view = attachFrame(result.current).contentWindow;
    expect(offerPort(channel, { source: view, origin: "https://example.com" }).onmessage).toBeNull();
    expect(offerPort(channel, { source: window }).onmessage).toBeNull();
    expect(offerPort("other", { source: view }).onmessage).toBeNull();
    expect(() => offerPort(channel, { source: view, withPort: false })).not.toThrow();

    const first = offerPort(channel, { source: view });
    expect(first.onmessage).toBeTypeOf("function");
    act(() => result.current.send({ type: "goto", page: 2 }));
    expect(first.postMessage).toHaveBeenCalledExactlyOnceWith({ channel, type: "goto", page: 2 });

    const second = offerPort(channel, { source: view });
    expect(first.close).toHaveBeenCalledOnce();
    act(() => result.current.send({ type: "previous" }));
    expect(second.postMessage).toHaveBeenCalledExactlyOnceWith({ channel, type: "previous" });
    expect(first.postMessage).toHaveBeenCalledOnce();
  });

  it("follows the slides, position and errors the deck reports, and reopens on the slide and step it reached", async () => {
    const { result } = openDeck();
    await advance(0);
    const channel = channelOf(htmlOf(0));
    const view = attachFrame(result.current).contentWindow;
    act(() => result.current.onLoad(FIRST));
    const port = offerPort(channel, { source: view });

    post(port, { channel, type: "error", title: "Broken slide", detail: "line 3" });
    expect(result.current.error).toEqual({ title: "Broken slide", detail: "line 3" });

    post(port, { channel, type: "deck", pages: 3, notes: ["Open", null, 7], title: "Talk" });
    expect(result.current.info).toEqual({ pages: 3, notes: ["Open", null, null], title: "Talk" });
    expect(result.current.error).toBeNull();

    post(port, { channel, type: "position", page: 1, revealed: 1, steps: 2 });
    expect(result.current.position).toEqual({ page: 1, revealed: 1, steps: 2 });

    post(port, { channel: "other", type: "deck", pages: 9, notes: [] });
    post(port, { channel, type: "theme" });
    expect(result.current.info?.pages).toBe(3);

    attachFrame(result.current);
    act(() => result.current.onLoad(FIRST));
    expect(port.close).toHaveBeenCalledOnce();
    expect(result.current.info).toBeNull();
    await advance(0);
    expect(htmlOf(1)).toContain(
      JSON.stringify({ mode: "edit", page: 1, revealed: 1, assets: { "./hero.png": dataUrl("slides/talk/hero.png") }, file: DECK }),
    );
  });

  it("starts partway through a slide when asked to", async () => {
    const { result } = openDeck({ startPage: 2, startRevealed: 1 });
    expect(result.current.position).toEqual({ page: 2, revealed: 1, steps: 0 });
    await advance(0);
    expect(htmlOf(0)).toContain(
      JSON.stringify({ mode: "edit", page: 2, revealed: 1, assets: { "./hero.png": dataUrl("slides/talk/hero.png") }, file: DECK }),
    );
  });

  it("closes the port and stops listening once the deck unmounts", async () => {
    const { result, unmount } = openDeck();
    await advance(0);
    const channel = channelOf(htmlOf(0));
    const iframe = attachFrame(result.current);
    const port = offerPort(channel, { source: iframe.contentWindow });
    act(() => result.current.onLoad(FIRST));

    unmount();
    expect(port.close).toHaveBeenCalledOnce();
    result.current.frameRef.current = iframe;
    expect(offerPort(channel, { source: iframe.contentWindow }).onmessage).toBeNull();
  });

  it("sends edited source after a pause, with only the images the deck has not had yet", async () => {
    const { result, rerender } = openDeck();
    await advance(0);
    const channel = channelOf(htmlOf(0));
    const port = offerPort(channel, { source: attachFrame(result.current).contentWindow });
    tauri.read.mockClear();

    rerender({ ...BASE, code: WITH_LOGO });
    await advance(DECK_UPDATE_DELAY_MS - 1);
    expect(port.postMessage).not.toHaveBeenCalled();
    await advance(1);
    expect(tauri.read).toHaveBeenCalledExactlyOnceWith("p1", "assets/logo.png");
    expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({
      channel,
      type: "source",
      code: WITH_LOGO,
      assets: { "@assets/logo.png": dataUrl("assets/logo.png") },
    });

    const restyled = `${WITH_LOGO}\nexport const theme = "night";`;
    rerender({ ...BASE, code: restyled });
    await advance(DECK_UPDATE_DELAY_MS);
    expect(tauri.read).toHaveBeenCalledOnce();
    expect(port.postMessage).toHaveBeenLastCalledWith({ channel, type: "source", code: restyled, assets: {} });
    expect(tauri.open).toHaveBeenCalledOnce();
  });

  it("sends only the last of several quick edits, and nothing for an edit undone within the pause", async () => {
    const { result, rerender } = openDeck();
    await advance(0);
    const channel = channelOf(htmlOf(0));
    const port = offerPort(channel, { source: attachFrame(result.current).contentWindow });

    rerender({ ...BASE, code: `${CODE}\n1` });
    await advance(DECK_UPDATE_DELAY_MS / 2);
    rerender({ ...BASE, code: `${CODE}\n12` });
    await advance(DECK_UPDATE_DELAY_MS);
    expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ channel, type: "source", code: `${CODE}\n12`, assets: {} });

    rerender({ ...BASE, code: `${CODE}\n123` });
    rerender({ ...BASE, code: `${CODE}\n12` });
    await advance(DECK_UPDATE_DELAY_MS * 2);
    expect(port.postMessage).toHaveBeenCalledOnce();
  });

  it("sends an edit made while the frame was opening once the frame offers its port", async () => {
    const opening = deferred<string>();
    tauri.open.mockReset().mockReturnValueOnce(opening.promise);
    const { result, rerender } = openDeck();
    await advance(0);
    rerender({ ...BASE, code: `${CODE}\n1` });
    await advance(DECK_UPDATE_DELAY_MS);
    expect(tauri.read).toHaveBeenCalledOnce();

    opening.resolve(FIRST);
    await advance(0);
    expect(result.current.url).toBe(FIRST);
    expect(htmlOf(0)).toContain(inlineJson(CODE));

    const channel = channelOf(htmlOf(0));
    const port = offerPort(channel, { source: attachFrame(result.current).contentWindow });
    expect(port.postMessage).not.toHaveBeenCalled();
    await advance(DECK_UPDATE_DELAY_MS);
    expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ channel, type: "source", code: `${CODE}\n1`, assets: {} });
  });

  it("sends an edit made before the frame offered its port, with the images it needs, when the port arrives", async () => {
    const { result, rerender } = openDeck();
    await advance(0);
    rerender({ ...BASE, code: WITH_LOGO });
    await advance(DECK_UPDATE_DELAY_MS);
    expect(tauri.read).toHaveBeenLastCalledWith("p1", "assets/logo.png");

    const channel = channelOf(htmlOf(0));
    const port = offerPort(channel, { source: attachFrame(result.current).contentWindow });
    await advance(DECK_UPDATE_DELAY_MS);
    expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({
      channel,
      type: "source",
      code: WITH_LOGO,
      assets: { "@assets/logo.png": dataUrl("assets/logo.png") },
    });
  });

  it("drops an edit whose images are still being read when the deck unmounts", async () => {
    const { result, rerender, unmount } = openDeck();
    await advance(0);
    const channel = channelOf(htmlOf(0));
    const port = offerPort(channel, { source: attachFrame(result.current).contentWindow });
    const reading = deferred<string>();
    tauri.read.mockReturnValueOnce(reading.promise);

    rerender({ ...BASE, code: WITH_LOGO });
    await advance(DECK_UPDATE_DELAY_MS);
    expect(tauri.read).toHaveBeenLastCalledWith("p1", "assets/logo.png");
    unmount();
    reading.resolve("bG9nbw==");
    await advance(0);
    expect(port.postMessage).not.toHaveBeenCalled();
  });
});
