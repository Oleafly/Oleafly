// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReleaseNotesMarkdown } from "./release-notes-renderer";

const NOTES = [
  "# Release 1.2",
  "## Added",
  "#### Details",
  "1. **Bold** and *italic* and ~~gone~~",
  "2. Second",
  "",
  "---",
  "",
  "| Area | Change |",
  "| --- | --- |",
  "| Editor | Faster |",
  "",
  "![Screenshot](https://example.com/shot.png)",
  "![Bad](javascript:alert(1))",
  "![](https://example.com/plain.png)",
].join("\n");

describe("ReleaseNotesMarkdown", () => {
  it("renders headings, ordered lists, emphasis, rules and tables", () => {
    const { container } = render(<ReleaseNotesMarkdown source={NOTES} onOpenLink={vi.fn()} />);

    expect(screen.getByRole("heading", { level: 2, name: "Release 1.2" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Added" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 4, name: "Details" })).toBeInTheDocument();
    const list = container.querySelector("ol");
    expect(list && within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(container.querySelector("strong")).toHaveTextContent("Bold");
    expect(container.querySelector("em")).toHaveTextContent("italic");
    expect(container.querySelector("del")).toHaveTextContent("gone");
    expect(container.querySelector("hr")).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "Area" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Faster" })).toBeInTheDocument();
  });

  it("opens release images through the link handler and drops unsafe ones", () => {
    const onOpenLink = vi.fn();
    const { container } = render(<ReleaseNotesMarkdown source={NOTES} onOpenLink={onOpenLink} />);

    const images = [...container.querySelectorAll("img")];
    expect(images.map((image) => [image.getAttribute("alt"), image.getAttribute("src")])).toEqual([
      ["Screenshot", "https://example.com/shot.png"],
      ["", "https://example.com/plain.png"],
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Screenshot" }));
    expect(onOpenLink).toHaveBeenCalledWith("https://example.com/shot.png");
  });
});
