// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { FindBar } from "./find-bar";

const LABELS = { previous: "Previous", next: "Next", close: "Close" };
const PANEL = "Find and replace";

function Harness({ onReplace = vi.fn(), onClose = vi.fn() }: Readonly<{ onReplace?: () => void; onClose?: () => void }>) {
  const [value, setValue] = useState("");
  const [replacement, setReplacement] = useState("");
  const [open, setOpen] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  return (
    <FindBar
      aria-label={PANEL}
      value={value}
      onValueChange={setValue}
      inputLabel="Find"
      status={value ? "1 of 2" : ""}
      onStep={vi.fn()}
      onClose={onClose}
      labels={LABELS}
      toggles={[{ label: "Match case", glyph: "Aa", pressed: caseSensitive, onToggle: () => setCaseSensitive((on) => !on) }]}
      replace={{
        open,
        onOpenChange: setOpen,
        toggleLabel: "Toggle replace",
        value: replacement,
        onValueChange: setReplacement,
        label: "Replace",
        onEnter: onReplace,
        actions: [{ label: "Replace next", text: "Replace", onClick: onReplace }],
      }}
    />
  );
}

describe("FindBar", () => {
  it("steps with Enter and the buttons, announces the count and closes on Escape", async () => {
    const onStep = vi.fn();
    const onClose = vi.fn();
    render(
      <FindBar value="x" onValueChange={vi.fn()} inputLabel="Find" focusOnMount status="1 of 2" onStep={onStep} onClose={onClose} labels={LABELS} />,
    );
    const input = screen.getByRole("textbox", { name: "Find" });
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("status")).toHaveTextContent("1 of 2");

    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    await userEvent.click(screen.getByRole("button", { name: LABELS.next }));
    expect(onStep.mock.calls).toEqual([[true], [false], [true]]);
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("disables stepping when asked", () => {
    render(<FindBar value="" onValueChange={vi.fn()} inputLabel="Find" status="" stepDisabled onStep={vi.fn()} onClose={vi.fn()} labels={LABELS} />);
    expect(screen.getByRole("button", { name: LABELS.previous })).toBeDisabled();
    expect(screen.getByRole("button", { name: LABELS.next })).toBeDisabled();
    expect(screen.getByRole("button", { name: LABELS.close })).toBeEnabled();
  });

  it("presses toggles and opens a replace row that submits on Enter and closes on Escape", async () => {
    const onReplace = vi.fn();
    const onClose = vi.fn();
    render(<Harness onReplace={onReplace} onClose={onClose} />);
    expect(screen.getByRole("search", { name: PANEL })).toBeInTheDocument();

    const matchCase = screen.getByRole("button", { name: "Match case" });
    expect(matchCase).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(matchCase);
    expect(matchCase).toHaveAttribute("aria-pressed", "true");

    expect(screen.queryByRole("textbox", { name: "Replace" })).toBeNull();
    const toggle = screen.getByRole("button", { name: "Toggle replace" });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const replace = screen.getByRole("textbox", { name: "Replace" });
    expect(toggle).toHaveAttribute("aria-controls", replace.parentElement?.parentElement?.id);

    fireEvent.keyDown(replace, { key: "Enter" });
    await userEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(onReplace).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(replace, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
