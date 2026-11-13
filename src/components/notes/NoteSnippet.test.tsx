// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NoteSnippet } from "./NoteSnippet";
import "./tests/setup";

function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

describe("NoteSnippet", () => {
  it("shows inline fields as the same chips the editor draws", () => {
    const today = iso(new Date());
    const { container } = render(<NoteSnippet text={`Ship it [due:: ${today}] [owner:: Ada]`} />);
    const chips = container.querySelectorAll(".note-field");
    expect(chips).toHaveLength(2);
    expect(chips[0]?.hasAttribute("data-match")).toBe(false);
    expect(chips[0]?.getAttribute("data-field-key")).toBe("due");
    expect(chips[0]?.getAttribute("data-when")).toBe("today");
    expect(chips[0]?.querySelector("svg.note-field-icon")).not.toBeNull();
    expect(chips[0]?.textContent).toContain("Today");
    expect(chips[1]?.querySelector(".note-field-key")?.textContent).toBe("owner");
    expect(container.textContent).not.toContain("::");
    expect(container.textContent).toContain("Ship it ");
  });

  it("keeps search highlights in the text around a field and marks a chip a match falls inside", () => {
    const text = "Plan [date:: 2026-11-12] for 2026-11";
    const { container } = render(
      <NoteSnippet
        text={text}
        ranges={[
          [0, 4],
          [13, 20],
          [29, 36],
        ]}
      />,
    );
    const marks = [...container.querySelectorAll("mark")];
    expect(marks.map((mark) => mark.textContent)).toEqual(["Plan", "2026-11"]);
    const chip = container.querySelector(".note-field");
    expect(chip?.classList.contains("note-field-inline")).toBe(true);
    expect(chip?.hasAttribute("data-match")).toBe(true);
    expect(chip?.closest("mark")).toBeNull();
  });

  it("leaves text without fields as plain highlighted text", () => {
    const { container } = render(<NoteSnippet text="No fields [[Here]]" ranges={[[3, 9]]} />);
    expect(container.querySelector(".note-field")).toBeNull();
    expect(container.querySelector("mark")?.textContent).toBe("fields");
  });

  it("keeps a field cut off by the snippet edge as text", () => {
    const { container } = render(<NoteSnippet text="ends with [date:: 2026-1" />);
    expect(container.querySelector(".note-field")).toBeNull();
    expect(container.textContent).toBe("ends with [date:: 2026-1");
  });
});
