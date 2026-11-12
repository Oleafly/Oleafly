// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { SEARCH_MODES_KEY, useSearchModeStore } from "@/store/search-modes";
import { SearchModeMenu } from "./search-mode-menu";

const copy = enCommon.searchModes;

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  localStorage.clear();
  useSearchModeStore.setState({ notes: "ranked", files: "ranked" });
});

describe("SearchModeMenu", () => {
  it("names the current mode and picks another one", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<SearchModeMenu value="ranked" onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: copy.label.replace("{{mode}}", copy.ranked.label) });
    expect(trigger).toHaveAttribute("data-search-mode", "ranked");
    await user.click(trigger);
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(4);
    expect(screen.getByRole("menuitemradio", { name: new RegExp(copy.ranked.label) })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("menuitemradio", { name: new RegExp(copy.regex.label) }));
    expect(onChange).toHaveBeenCalledWith("regex");
    rerender(<SearchModeMenu value="regex" onChange={onChange} />);
    expect(screen.getByRole("button", { name: copy.label.replace("{{mode}}", copy.regex.label) })).toHaveClass("text-primary");
  });
});

describe("search mode store", () => {
  it("keeps one mode per scope and remembers it", () => {
    useSearchModeStore.getState().setMode("notes", "fuzzy");
    expect(useSearchModeStore.getState()).toMatchObject({ notes: "fuzzy", files: "ranked" });
    expect(JSON.parse(localStorage.getItem(SEARCH_MODES_KEY) ?? "{}")).toEqual({ notes: "fuzzy", files: "ranked" });
  });

  it("reads back stored modes and ignores ones it doesn't know", async () => {
    localStorage.setItem(SEARCH_MODES_KEY, JSON.stringify({ notes: "exact", files: "grep" }));
    vi.resetModules();
    const fresh = await import("@/store/search-modes");
    expect(fresh.useSearchModeStore.getState()).toMatchObject({ notes: "exact", files: "ranked" });
    localStorage.setItem(SEARCH_MODES_KEY, "[]");
    vi.resetModules();
    const empty = await import("@/store/search-modes");
    expect(empty.useSearchModeStore.getState()).toMatchObject({ notes: "ranked", files: "ranked" });
  });
});
