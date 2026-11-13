// @vitest-environment jsdom
import { act, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { allowRemoteImage, resetRemoteImagesForTest, trustRemoteImageHost } from "@/lib/remote-image";
import { paintStillBlock } from "./block-views";
import { bookmarkBlock, bookmarkFromPreview, loadBookmark, parseBookmark, serializeBookmark } from "./bookmark-block";
import { noteBlockName } from "./note-blocks";
import { notePaperText } from "./note-to-paper";
import { destroyKbEditors, kbNote } from "./tests/kb-editor-fixtures";
import "./tests/setup";

const bridge = vi.hoisted(() => ({ preview: vi.fn(), open: vi.fn(async (_url: string) => true) }));

vi.mock("@/lib/tauri", async (importOriginal) => ({ ...(await importOriginal<object>()), noteLinkPreview: bridge.preview }));
vi.mock("@/lib/system-browser", async (importOriginal) => ({ ...(await importOriginal<object>()), openInSystemBrowser: bridge.open }));
vi.mock("@/lib/log", async (importOriginal) => ({ ...(await importOriginal<object>()), logError: vi.fn(async () => undefined) }));

const copy = enNotes.blocks.bookmark;
const FENCE = "```";
const PAGE = "https://example.org/article";
const FULL = [
  `url: ${PAGE}`,
  "title: Example article",
  "description: One line of text",
  "image: https://cdn.example.org/og.png",
  "site: Example",
  "favicon: https://example.org/favicon.ico",
].join("\n");

const hosts: HTMLElement[] = [];
const disposers: (() => void)[] = [];

beforeEach(() => {
  bridge.preview.mockReset();
  bridge.open.mockClear();
});

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  for (const host of hosts.splice(0)) host.remove();
  destroyKbEditors();
  resetRemoteImagesForTest();
  localStorage.clear();
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
  const dispose = bookmarkBlock.paint(preview, source, { still: false });
  if (dispose) disposers.push(dispose);
  await settle();
  return preview;
}

function card(preview: HTMLElement): HTMLAnchorElement {
  const found = preview.querySelector<HTMLAnchorElement>("a[data-bookmark]");
  if (!found) throw new Error("no bookmark card");
  return found;
}

function imageSources(preview: HTMLElement): string[] {
  return [...preview.querySelectorAll("img")].map((image) => image.getAttribute("src") ?? "");
}

describe("bookmark source", () => {
  it("reads every field and writes them back in the same order", () => {
    expect(parseBookmark(FULL)).toEqual({
      url: PAGE,
      title: "Example article",
      description: "One line of text",
      image: "https://cdn.example.org/og.png",
      site: "Example",
      favicon: "https://example.org/favicon.ico",
    });
    expect(serializeBookmark(parseBookmark(FULL) ?? { url: "" })).toBe(FULL);
  });

  it("writes only the fields that have values, each on one line", () => {
    expect(serializeBookmark({ url: PAGE })).toBe(`url: ${PAGE}`);
    expect(serializeBookmark({ url: PAGE, title: "  Two\nlines  ", description: "", site: "Example" })).toBe(
      `url: ${PAGE}\ntitle: Two lines\nsite: Example`,
    );
  });

  it("needs a web address", () => {
    expect(parseBookmark("title: No address")).toBeNull();
    expect(parseBookmark("url: javascript:alert(1)")).toBeNull();
    expect(parseBookmark("url: example.org")).toBeNull();
    expect(parseBookmark(`URL: ${PAGE}`)).toEqual({ url: PAGE });
  });

  it("keeps only web addresses for pictures from a page preview", () => {
    expect(
      bookmarkFromPreview(PAGE, {
        url: "https://example.org/redirected",
        title: "Title\n  here",
        description: null,
        siteName: "Example",
        image: "data:image/png;base64,AAAA",
        favicon: "https://example.org/icon.png",
      }),
    ).toEqual({ url: PAGE, title: "Title here", description: "", image: "", site: "Example", favicon: "https://example.org/icon.png" });
  });

  it("is a drawn block named by its fence", () => {
    expect(noteBlockName("bookmark")).toBe("bookmark");
    expect(bookmarkBlock.label()).toBe(copy.label);
  });

  it("saves a note with a bookmark exactly as it was opened", () => {
    const source = `---\ntitle: Reading\n---\n\nTo read:\n\n${FENCE}bookmark\n${FULL}\n${FENCE}\n\nMore text.\n`;
    const first = kbNote(source).save();
    expect(first).toBe(source);
    expect(kbNote(first).save()).toBe(source);
  });
});

describe("bookmark card", () => {
  it("shows the title, description and site, and opens the page in the browser", async () => {
    const preview = await paint(FULL);
    const link = card(preview);
    expect(link.getAttribute("href")).toBe(PAGE);
    expect(within(link).getByText("Example article")).toBeInTheDocument();
    expect(within(link).getByText("One line of text")).toBeInTheDocument();
    expect(within(link).getByText("Example")).toBeInTheDocument();
    expect(link).not.toHaveAttribute("aria-busy");
    fireEvent.click(link);
    expect(bridge.open).toHaveBeenCalledWith(PAGE);
  });

  it("leaves the page's pictures out until remote images are allowed", async () => {
    const preview = await paint(FULL);
    expect(imageSources(preview)).toEqual([]);
    act(() => allowRemoteImage("https://cdn.example.org/og.png"));
    expect(imageSources(preview)).toEqual(["https://cdn.example.org/og.png"]);
    act(() => trustRemoteImageHost("example.org"));
    expect(imageSources(preview)).toEqual(["https://example.org/favicon.ico", "https://cdn.example.org/og.png"]);
  });

  it("shows the pictures at once from a site that is always allowed", async () => {
    trustRemoteImageHost("cdn.example.org");
    const preview = await paint(FULL);
    expect(imageSources(preview)).toEqual(["https://cdn.example.org/og.png"]);
  });

  it("shows the address and its host when the page told us nothing", async () => {
    const preview = await paint(`url: ${PAGE}`);
    const link = card(preview);
    expect(within(link).getByText(PAGE)).toBeInTheDocument();
    expect(within(link).getByText("example.org")).toBeInTheDocument();
  });

  it("is busy while the preview loads, then fills in, and keeps the link when it fails", async () => {
    let finish: (value: unknown) => void = () => undefined;
    bridge.preview.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const apply = vi.fn();
    const loading = loadBookmark(PAGE, apply);
    const preview = await paint(`url: ${PAGE}`);
    expect(card(preview)).toHaveAttribute("aria-busy", "true");
    expect(within(card(preview)).getByText(copy.loading)).toBeInTheDocument();
    expect(within(card(preview)).getByText(PAGE)).toBeInTheDocument();
    finish({ url: PAGE, title: "Example article", description: null, siteName: "Example", image: null, favicon: null });
    await act(async () => loading);
    expect(apply).toHaveBeenCalledWith(`url: ${PAGE}\ntitle: Example article\nsite: Example`);
    expect(card(preview)).not.toHaveAttribute("aria-busy");

    bridge.preview.mockRejectedValueOnce(new Error("offline"));
    const failed = vi.fn();
    await act(async () => loadBookmark(PAGE, failed));
    expect(failed).not.toHaveBeenCalled();
    expect(card(preview)).not.toHaveAttribute("aria-busy");
    expect(within(card(preview)).getByText("example.org")).toBeInTheDocument();
  });

  it("explains a block without an address", async () => {
    const preview = await paint("title: Lost");
    expect(preview.querySelector("a")).toBeNull();
    expect(preview).toHaveTextContent(copy.noUrl);
  });

  it("shows a plain link with no pictures in previews", () => {
    trustRemoteImageHost("cdn.example.org");
    const preview = document.createElement("div");
    paintStillBlock("bookmark", preview, FULL);
    expect(preview.querySelector("a, img, button")).toBeNull();
    expect([...preview.querySelectorAll("p")].map((line) => line.textContent)).toEqual(["Example article", "Example"]);
  });
});

describe("exporting a bookmark", () => {
  it("writes a link with the page title", async () => {
    const markdown = `Before\n\n${FENCE}bookmark\n${FULL}\n${FENCE}\n\n${FENCE}bookmark\nurl: ${PAGE}\n${FENCE}\n`;
    const paper = await notePaperText(markdown, async () => null, {
      format: "markdown",
      folder: "figures",
      from: "paper.md",
      taken: () => false,
      citations: { kind: "command" },
    });
    expect(paper.text).toBe(`Before\n\n[Example article](${PAGE})\n\n<${PAGE}>`);
    expect(paper.files).toEqual([]);
  });
});
