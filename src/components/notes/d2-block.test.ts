// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { D2_TEMPLATE, d2Block, d2Error } from "./d2-block";
import "./tests/setup";

const d2 = vi.hoisted(() => ({
  render: vi.fn(async (_source: string, _theme: string) => '<svg xmlns="http://www.w3.org/2000/svg"/>'),
  cached: vi.fn((_source: string, _theme: string): string | undefined => undefined),
}));

vi.mock("./d2-render", async (load) => ({
  ...(await load<typeof import("./d2-render")>()),
  renderD2: d2.render,
  cachedD2: d2.cached,
}));

beforeEach(() => {
  d2.render.mockClear();
  d2.cached.mockReset();
  d2.cached.mockReturnValue(undefined);
});

afterEach(() => {
  document.documentElement.classList.remove("dark");
  document.documentElement.style.removeProperty("--background");
});

describe("D2 block", () => {
  it("registers a d2 fence with a starter diagram", () => {
    expect(d2Block.label()).toBe("D2");
    expect(d2Block.template?.()).toEqual({ info: "d2", source: D2_TEMPLATE });
  });

  it("draws the diagram for the current theme and canvas colour without inverting it", async () => {
    document.documentElement.classList.add("dark");
    document.documentElement.style.setProperty("--background", "#0a0a0a");
    const preview = document.createElement("div");
    d2Block.paint(preview, " a -> b ", { still: false });
    expect(preview.textContent).toBe(enNotes.blocks.d2.loading);
    await vi.waitFor(() => expect(preview.querySelector("img.note-d2")).not.toBeNull());
    expect(d2.render).toHaveBeenCalledWith("a -> b", "dark", "#0a0a0a");
    const image = preview.querySelector("img") as HTMLImageElement;
    expect(image.alt).toBe(enNotes.blocks.d2.alt);
    expect(image.className).not.toContain("invert");
  });

  it("keeps the old drawing while a change renders", async () => {
    const preview = document.createElement("div");
    d2Block.paint(preview, "a -> b", { still: false });
    await vi.waitFor(() => expect(preview.querySelector("img")).not.toBeNull());
    let finish: (svg: string) => void = () => undefined;
    d2.render.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    d2Block.paint(preview, "a -> c", { still: false });
    expect(preview.querySelector("img")).not.toBeNull();
    finish("<svg/>");
  });

  it("uses a cached drawing at once and on Home, and a card otherwise", () => {
    const card = document.createElement("div");
    const still = d2Block.still;
    if (typeof still === "function") still(card, "a -> b", { still: true });
    expect(card.querySelector("p")?.textContent).toBe("D2");
    d2.cached.mockReturnValue("<svg/>");
    const shown = document.createElement("div");
    expect(d2Block.paint(shown, "a -> b", { still: false })).toBeUndefined();
    expect(shown.querySelector("img")).not.toBeNull();
    if (typeof still === "function") still(card, "a -> b", { still: true });
    expect(card.querySelector("img")).not.toBeNull();
    expect(d2.render).not.toHaveBeenCalled();
  });

  it("explains empty blocks and D2's errors line by line", async () => {
    const preview = document.createElement("div");
    d2Block.paint(preview, "  ", { still: false });
    expect(preview.textContent).toBe(enNotes.blocks.d2.empty);
    d2.render.mockRejectedValueOnce(new Error(JSON.stringify([{ errmsg: "index:2:4: unexpected text" }, { errmsg: "index:3:1: second" }])));
    d2Block.paint(preview, "a ->\nb c d", { still: false });
    await vi.waitFor(() => expect(preview.textContent).toBe("D2 couldn't draw this diagram: Line 2: unexpected text"));
    expect(d2Error(new Error("x".repeat(400))).endsWith("…")).toBe(true);
    expect(d2Error(new Error("[]"))).toBe("[]");
  });
});
