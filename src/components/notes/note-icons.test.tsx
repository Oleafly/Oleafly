// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BOOK_COLOR_OPTIONS } from "@/components/library/Book";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import {
  artifactIcon,
  Byline,
  KIND_TONES,
  KindBadge,
  KindChip,
  LINE_ICON_PREFIX,
  LINE_ICONS,
  NOTE_COLOR_HEX,
  NOTE_COLOR_LABELS,
  NoteChip,
  NoteIcon,
  noteColorStyle,
  type ItemKind,
} from "./note-icons";
import { NOTE_COLORS } from "./note-file";
import type { ArtifactKind } from "./types";
import "./tests/setup";

function svgClass(container: HTMLElement): string {
  return container.querySelector("svg")?.getAttribute("class") ?? "";
}

describe("note icons", () => {
  it("shows an emoji as hidden text", () => {
    const { container } = render(<NoteIcon icon="🧪" />);
    const span = container.querySelector("span");
    expect(span?.textContent).toBe("🧪");
    expect(span).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("draws a known line icon", () => {
    const { container } = render(<NoteIcon icon={`${LINE_ICON_PREFIX}rocket`} />);
    expect(svgClass(container)).toContain("lucide-rocket");
  });

  it("falls back to the notebook icon for an unknown line icon", () => {
    const { container } = render(<NoteIcon icon={`${LINE_ICON_PREFIX}does-not-exist`} />);
    expect(svgClass(container)).toContain("lucide-notebook-pen");
  });

  it("does not treat an inherited property name as a known line icon", () => {
    const { container } = render(<NoteIcon icon={`${LINE_ICON_PREFIX}toString`} />);
    expect(svgClass(container)).toContain("lucide-notebook-pen");
  });

  it("uses the notebook icon when there is no icon", () => {
    expect(svgClass(render(<NoteIcon />).container)).toContain("lucide-notebook-pen");
  });

  it("names every line icon in the English catalog", () => {
    for (const entry of Object.values(LINE_ICONS)) {
      expect(enNotes.icons.names).toHaveProperty(entry.name);
    }
    expect(Object.keys(enNotes.icons.names).sort()).toEqual(Object.values(LINE_ICONS).map((entry) => entry.name).sort());
  });

  it("offers about a hundred and twenty research icons, each drawn once", () => {
    const icons = Object.values(LINE_ICONS);
    expect(icons.length).toBeGreaterThanOrEqual(110);
    expect(new Set(icons.map((entry) => entry.icon)).size).toBe(icons.length);
    expect(new Set(icons.map((entry) => entry.name)).size).toBe(icons.length);
  });

  it("gives every line icon a name that no other name contains, so a search for one never finds two", () => {
    const names = Object.values(enNotes.icons.names).map((name) => name.toLocaleLowerCase());
    const clashes = names.flatMap((name) => names.filter((other) => other !== name && other.includes(name)).map((other) => `${name} in ${other}`));
    expect(clashes).toEqual([]);
  });

  it.each<[ArtifactKind, string]>([
    ["figure", "lucide-image"],
    ["data", "lucide-database"],
    ["file", "lucide-file"],
    ["html", "lucide-braces"],
    ["report", "lucide-file-text"],
  ])("gives a %s artifact its own icon", (kind, className) => {
    const { container } = render(<span>{artifactIcon(kind)}</span>);
    expect(svgClass(container).split(" ")).toContain(className);
  });
});

describe("note chips", () => {
  function noteColorOf(element: HTMLElement): string {
    return element.style.getPropertyValue("--note-color");
  }

  it("tints a note's line icon with its colour", () => {
    const { container } = render(<NoteChip icon={`${LINE_ICON_PREFIX}atom`} color="mint" />);
    const chip = container.firstElementChild as HTMLElement;
    expect(chip).toHaveAttribute("data-note-color", "mint");
    expect(chip).toHaveAttribute("aria-hidden", "true");
    expect(noteColorOf(chip)).toBe("#98f5e1");
    expect(chip.querySelector("svg")).toHaveClass("lucide-atom");
  });

  it("fills about half of the large tile with its icon and leaves the small chips as they were", () => {
    const line = render(<NoteChip icon={`${LINE_ICON_PREFIX}atom`} size="lg" />).container.firstElementChild as HTMLElement;
    expect(line).toHaveClass("size-14");
    expect(line.querySelector("svg")).toHaveClass("size-7");
    const emoji = render(<NoteChip icon="🧪" size="lg" />).container.firstElementChild as HTMLElement;
    expect(emoji.firstElementChild).toHaveClass("text-[1.75rem]");
    const small = render(<NoteChip icon={`${LINE_ICON_PREFIX}atom`} size="sm" />).container.firstElementChild as HTMLElement;
    expect(small).toHaveClass("size-6");
    expect(small.querySelector("svg")).toHaveClass("size-3.5");
  });

  it("falls back to blue for a missing or unknown colour", () => {
    for (const color of [undefined, "crimson", "violet", "toString"]) {
      const chip = render(<NoteChip color={color} />).container.firstElementChild as HTMLElement;
      expect(chip).toHaveAttribute("data-note-color", "blue");
      expect(noteColorOf(chip)).toBe("#1982c4");
    }
    expect(noteColorStyle(undefined)).toEqual({ "--note-color": "#1982c4", "--note-tint": 1 });
    expect(noteColorStyle("toString")).toEqual({ "--note-color": "#1982c4", "--note-tint": 1 });
    expect(noteColorStyle("lilac")).toEqual({ "--note-color": "#cfbaf0", "--note-tint": 0 });
  });

  it("gives every note colour a hex and a tint strength, lighter mixes only for the saturated blue", () => {
    for (const color of NOTE_COLORS) {
      expect(noteColorStyle(color)).toEqual({ "--note-color": NOTE_COLOR_HEX[color], "--note-tint": color === "blue" ? 1 : 0 });
    }
    const chip = render(<NoteChip color="sky" />).container.firstElementChild as HTMLElement;
    expect(chip.style.getPropertyValue("--note-tint")).toBe("0");
  });

  it("keeps an emoji out of the name of the row that shows it", () => {
    render(
      <button type="button">
        <NoteChip icon="🧪" color="pink" />
        {"Masking strategy report"}
      </button>,
    );
    expect(screen.getByRole("button", { name: "Masking strategy report" })).toBeInTheDocument();
  });

  it("takes each of the 11 note colours from the project cover palette", () => {
    expect(Object.keys(NOTE_COLOR_HEX)).toEqual([...NOTE_COLORS]);
    expect(Object.keys(NOTE_COLOR_LABELS)).toEqual([...NOTE_COLORS]);
    BOOK_COLOR_OPTIONS.forEach(({ name, hex }, index) => {
      const color = NOTE_COLORS[index];
      expect(NOTE_COLOR_HEX[color]).toBe(hex);
      expect(NOTE_COLOR_LABELS[color]).toBe(name);
    });
    for (const color of NOTE_COLORS) {
      const chip = render(<NoteChip color={color} />).container.firstElementChild as HTMLElement;
      expect(chip).toHaveAttribute("data-note-color", color);
      expect(chip).toHaveClass("note-chip");
      expect(noteColorOf(chip)).toBe(NOTE_COLOR_HEX[color]);
    }
  });
});

describe("kind tones", () => {
  const kinds: ItemKind[] = ["note", "figure", "html", "data", "report", "file"];

  it("gives every kind its own colour that works in light and dark", () => {
    const families = kinds.map((kind) => /text-([a-z]+)-600/.exec(KIND_TONES[kind].icon)?.[1]);
    expect(new Set(families).size).toBe(kinds.length);
    for (const kind of kinds) {
      const tone = KIND_TONES[kind];
      expect(tone.icon).toMatch(/^text-[a-z]+-600 dark:text-[a-z]+-400$/);
      expect(tone.text).toMatch(/^text-[a-z]+-700 dark:text-[a-z]+-300$/);
      expect(tone.tint).toMatch(/^bg-[a-z]+-500\/10$/);
      expect(tone.dot).toMatch(/^bg-[a-z]+-500$/);
    }
  });

  it.each<[ArtifactKind, string]>([
    ["figure", "text-pink-600"],
    ["data", "text-emerald-600"],
    ["file", "text-slate-600"],
    ["html", "text-orange-600"],
    ["report", "text-sky-600"],
  ])("colours a %s artifact's icon", (kind, className) => {
    const { container } = render(<span>{artifactIcon(kind)}</span>);
    expect(svgClass(container).split(" ")).toContain(className);
  });

  it.each([
    ["data", "lucide-database"],
    ["note", "lucide-notebook-pen"],
  ] as const)("puts a %s item's icon in its kind chip", (kind, icon) => {
    const chip = render(<KindChip kind={kind} />).container.firstElementChild as HTMLElement;
    expect(chip).toHaveAttribute("data-kind", kind);
    expect(chip.querySelector("svg")).toHaveClass(icon);
  });

  it("holds a note's own icon when given one", () => {
    render(
      <KindChip kind="note">
        <NoteIcon icon="🧪" />
      </KindChip>,
    );
    expect(screen.getByText("🧪").closest("[data-kind]")).toHaveAttribute("data-kind", "note");
  });

  it("labels an artifact's kind in a tinted badge", () => {
    render(<KindBadge kind="figure" label={enNotes.artifacts.kind.figure} />);
    const badge = screen.getByText(enNotes.artifacts.kind.figure);
    expect(badge).toHaveAttribute("data-kind", "figure");
    expect(badge.querySelector("svg")).toHaveClass("lucide-image");
  });
});

describe("bylines", () => {
  it("shows an agent's tag before when it wrote", () => {
    const { container } = render(<Byline author="agent" agent="Codex" when="2 hours ago" />);
    expect(container).toHaveTextContent("Codex · 2 hours ago");
    expect(screen.getByText("Codex").closest("[data-agent-tag]")).toBeInTheDocument();
  });

  it("tags an unnamed agent as an agent", () => {
    render(<Byline author="agent" when="yesterday" />);
    expect(screen.getByText(enNotes.library.agentFallback).closest("[data-agent-tag]")).toBeInTheDocument();
  });

  it("keeps your own notes as plain text", () => {
    const { container } = render(<Byline author="you" agent="Codex" when="yesterday" className="mt-2" />);
    expect(container).toHaveTextContent(`${enNotes.library.author.you} · yesterday`);
    expect(container.querySelector("[data-agent-tag]")).toBeNull();
  });

  it("names nobody on a shared note that no agent wrote", () => {
    const { container } = render(<Byline author="you" when="now" shared />);
    expect(container).toHaveTextContent(/^now$/u);
    const agent = render(<Byline author="agent" agent="Codex" when="now" shared />);
    expect(agent.container).toHaveTextContent("Codex · now");
  });
});
