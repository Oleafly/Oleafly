// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { artifactIcon, LINE_ICON_PREFIX, LINE_ICONS, NoteIcon } from "./note-icons";
import type { ArtifactKind } from "./types";

function svgClass(container: HTMLElement): string {
  return container.querySelector("svg")?.getAttribute("class") ?? "";
}

describe("note icons", () => {
  it("shows an emoji as text in both sizes", () => {
    const small = render(<NoteIcon icon="🧪" />);
    const smallSpan = small.container.querySelector("span");
    expect(smallSpan?.textContent).toBe("🧪");
    expect(smallSpan).toHaveClass("text-sm");
    expect(smallSpan).toHaveAttribute("aria-hidden");
    expect(small.container.querySelector("svg")).toBeNull();

    const large = render(<NoteIcon icon="🧪" size="lg" />);
    expect(large.container.querySelector("span")).toHaveClass("text-[2.5rem]");
  });

  it("draws a known line icon", () => {
    const { container } = render(<NoteIcon icon={`${LINE_ICON_PREFIX}rocket`} />);
    expect(svgClass(container)).toContain("lucide-rocket");
    expect(svgClass(container)).toContain("text-muted-foreground");
  });

  it("falls back to the notebook icon for an unknown line icon", () => {
    const { container } = render(<NoteIcon icon={`${LINE_ICON_PREFIX}does-not-exist`} />);
    expect(svgClass(container)).toContain("lucide-notebook-pen");
  });

  it("does not treat an inherited property name as a known line icon", () => {
    const { container } = render(<NoteIcon icon={`${LINE_ICON_PREFIX}toString`} />);
    expect(svgClass(container)).toContain("lucide-notebook-pen");
  });

  it("uses the notebook icon when there is no icon and grows it in the large size", () => {
    const small = render(<NoteIcon />);
    expect(svgClass(small.container)).toContain("lucide-notebook-pen");
    expect(svgClass(small.container)).toContain("size-3.5");

    const large = render(<NoteIcon size="lg" />);
    expect(svgClass(large.container)).toContain("size-10");
    expect(svgClass(large.container)).toContain("text-foreground");
  });

  it("names every line icon in the English catalog", () => {
    for (const entry of Object.values(LINE_ICONS)) {
      expect(enNotes.icons.names).toHaveProperty(entry.name);
    }
  });

  it.each<[ArtifactKind, string]>([
    ["figure", "lucide-image"],
    ["run", "lucide-flask-conical"],
    ["html", "lucide-braces"],
    ["report", "lucide-file-text"],
  ])("gives a %s artifact its own icon", (kind, className) => {
    const { container } = render(<span>{artifactIcon(kind)}</span>);
    expect(svgClass(container)).toContain(className);
  });
});
