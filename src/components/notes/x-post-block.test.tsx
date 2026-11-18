// @vitest-environment jsdom
import { act, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { useSettingsStore } from "@/store/settings";
import { paintStillBlock } from "./block-views";
import { noteBlockName } from "./note-blocks";
import { notePaperText } from "./note-to-paper";
import { destroyKbEditors, kbNote } from "./tests/kb-editor-fixtures";
import { loadXPost, parseXPost, serializeXPost, X_POST_INFO, xPostBlock, xPostFromFetch, xPostLink } from "./x-post-block";
import "./tests/setup";

const bridge = vi.hoisted(() => ({
  post: vi.fn(),
  origin: vi.fn(async () => "http://127.0.0.1:4321"),
  open: vi.fn(async (_url: string) => true),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  noteXPost: bridge.post,
  noteVideoFrameOrigin: bridge.origin,
}));
vi.mock("@/lib/system-browser", async (importOriginal) => ({ ...(await importOriginal<object>()), openInSystemBrowser: bridge.open }));
vi.mock("@/lib/log", async (importOriginal) => ({ ...(await importOriginal<object>()), logError: vi.fn(async () => undefined) }));

const copy = enNotes.blocks.xPost;
const FENCE = "```";
const POST = "https://x.com/jack/status/20";
const SAVED = [`url: ${POST}`, "author: jack", "handle: jack", "date: March 21, 2006", "", "just setting up my twttr", "second line"].join("\n");

const hosts: HTMLElement[] = [];
const disposers: (() => void)[] = [];

beforeEach(() => {
  bridge.post.mockReset();
  bridge.open.mockClear();
  useSettingsStore.setState({ notesXPostsLive: false });
});

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  for (const host of hosts.splice(0)) host.remove();
  destroyKbEditors();
  useSettingsStore.setState({ notesXPostsLive: false });
});

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function paint(source: string): Promise<HTMLElement> {
  const preview = document.createElement("div");
  document.body.append(preview);
  hosts.push(preview);
  const dispose = xPostBlock.paint(preview, source, { still: false });
  if (dispose) disposers.push(dispose);
  await settle();
  return preview;
}

describe("the x-post block", () => {
  it("knows links to posts on X and Twitter and writes them as x.com", () => {
    expect(xPostLink("https://twitter.com/jack/status/20?s=46")).toEqual({ url: POST, id: "20" });
    expect(xPostLink("https://mobile.twitter.com/jack/statuses/20/photo/1")).toEqual({ url: POST, id: "20" });
    for (const other of ["http://x.com/jack/status/20", "https://x.com/jack", "https://x.com.evil.com/jack/status/20", "https://x.com/ja-ck/status/20", "nope"]) {
      expect(xPostLink(other), other).toBeNull();
    }
  });

  it("reads the fields and the text, and writes them back the same way", () => {
    expect(parseXPost(SAVED)).toEqual({
      url: POST,
      id: "20",
      author: "jack",
      handle: "jack",
      date: "March 21, 2006",
      text: "just setting up my twttr\nsecond line",
    });
    expect(serializeXPost(parseXPost(SAVED) ?? { url: "" })).toBe(SAVED);
    expect(serializeXPost({ url: POST })).toBe(`url: ${POST}`);
    expect(parseXPost("author: jack")).toBeNull();
    expect(xPostFromFetch({ url: POST, id: "20", author: "jack", handle: "jack", date: "March 21, 2006", text: "a\nb" })).toBe(
      [`url: ${POST}`, "author: jack", "handle: jack", "date: March 21, 2006", "", "a\nb"].join("\n"),
    );
  });

  it("is a drawn block named by its fence, saved exactly as it was opened", () => {
    expect(noteBlockName(X_POST_INFO)).toBe(X_POST_INFO);
    const source = `Before\n\n${FENCE}${X_POST_INFO}\n${SAVED}\n${FENCE}\n`;
    expect(kbNote(source).save()).toBe(source);
  });

  it("shows the saved post and opens it on X", async () => {
    const preview = await paint(SAVED);
    const card = preview.querySelector<HTMLElement>("[data-x-post='20']");
    expect(card).not.toBeNull();
    const view = within(card as HTMLElement);
    expect(view.getByText("@jack")).toBeInTheDocument();
    expect(view.getByText("March 21, 2006")).toBeInTheDocument();
    expect(view.getByText(/just setting up my twttr/u)).toBeInTheDocument();
    expect(preview.querySelector("iframe")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: copy.open }));
    expect(bridge.open).toHaveBeenCalledWith(POST);
  });

  it("shows the live post in the isolated page on request, and the saved one again", async () => {
    const preview = await paint(SAVED);
    const view = within(preview);
    fireEvent.click(view.getByRole("button", { name: copy.showLive }));
    await settle();
    const frame = preview.querySelector<HTMLIFrameElement>("iframe[data-x-post-live]");
    expect(frame?.getAttribute("src")).toBe("http://127.0.0.1:4321/video#x/20?theme=light");
    expect(frame?.title).toBe(copy.liveTitle);
    fireEvent.click(view.getByRole("button", { name: copy.showSaved }));
    expect(preview.querySelector("iframe")).toBeNull();
  });

  it("starts with the live post when the setting asks for it, in the dark theme when the app is dark", async () => {
    useSettingsStore.setState({ notesXPostsLive: true });
    document.documentElement.classList.add("dark");
    try {
      const preview = await paint(SAVED);
      expect(preview.querySelector("iframe")?.getAttribute("src")).toBe("http://127.0.0.1:4321/video#x/20?theme=dark");
    } finally {
      document.documentElement.classList.remove("dark");
    }
  });

  it("says when X would not give the post, and keeps the card", async () => {
    bridge.post.mockRejectedValue(new Error("offline"));
    const preview = await paint(`url: ${POST}`);
    const apply = vi.fn();
    await act(() => loadXPost(POST, apply));
    expect(apply).not.toHaveBeenCalled();
    expect(within(preview).getByText(copy.failed)).toBeInTheDocument();
  });

  it("asks for a link to a post when the block has none", async () => {
    const preview = await paint("author: jack");
    expect(preview.textContent).toBe(copy.noUrl);
  });

  it("draws a still card for previews", () => {
    const preview = document.createElement("div");
    paintStillBlock(X_POST_INFO, preview, SAVED);
    expect(preview.querySelector("button, iframe")).toBeNull();
    expect([...preview.querySelectorAll("p")].map((line) => line.textContent)).toEqual([
      "jack @jack",
      "just setting up my twttr\nsecond line",
    ]);
  });
});

describe("sending a post to the paper", () => {
  it("writes the post as a quote with a linked attribution", async () => {
    const markdown = `Before\n\n${FENCE}${X_POST_INFO}\n${SAVED}\n${FENCE}\n`;
    const paper = await notePaperText(markdown, async () => null, {
      format: "markdown",
      folder: "figures",
      from: "paper.md",
      taken: () => false,
      citations: { kind: "command" },
    });
    expect(paper.text).toBe(`Before\n\n> just setting up my twttr\n>\n> second line\n>\n> [jack, @jack, March 21, 2006](${POST})`);
  });
});
