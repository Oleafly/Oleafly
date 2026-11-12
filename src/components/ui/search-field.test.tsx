// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import enWorkspace from "@/i18n/locales/en/workspace.json" with { type: "json" };
import { SearchField } from "./search-field";

const copy = enWorkspace.tree;
const LABEL = "Filter structure";
const FIND = "Find";
const CLEAR = "Clear search";

describe("SearchField", () => {
  it("reports typing, offers a clear button only with a value and refocuses the field after clearing", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<SearchField value="" onChange={onChange} label={LABEL} />);
    const input = screen.getByRole("searchbox", { name: LABEL });
    expect(input).toHaveAttribute("placeholder", copy.filterPlaceholder);
    await user.type(input, "a");
    expect(onChange).toHaveBeenCalledWith("a");
    expect(screen.queryByRole("button", { name: copy.clearFilter })).toBeNull();

    rerender(<SearchField value="a" onChange={onChange} label={LABEL} placeholder={FIND} clearLabel={CLEAR} />);
    expect(input).toHaveAttribute("placeholder", FIND);
    await user.click(screen.getByRole("button", { name: CLEAR }));
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(document.activeElement).toBe(input);
  });

  it("empties the field on Escape only when asked to, and lets Escape through while it is empty", () => {
    const onChange = vi.fn();
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    try {
      const { rerender } = render(<SearchField value="a" onChange={onChange} label={LABEL} />);
      const input = screen.getByRole("searchbox", { name: LABEL });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(onChange).not.toHaveBeenCalled();
      expect(outer).toHaveBeenCalledTimes(1);

      rerender(<SearchField value="a" onChange={onChange} label={LABEL} clearOnEscape />);
      fireEvent.keyDown(input, { key: "Escape", keyCode: 229 });
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.keyDown(input, { key: "Escape" });
      expect(onChange).toHaveBeenCalledWith("");
      expect(outer).toHaveBeenCalledTimes(2);

      rerender(<SearchField value="" onChange={onChange} label={LABEL} clearOnEscape />);
      fireEvent.keyDown(input, { key: "Escape" });
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(outer).toHaveBeenCalledTimes(3);
    } finally {
      document.removeEventListener("keydown", outer);
    }
  });
});
