// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { BOOK_COLOR_OPTIONS } from "@/components/library/Book";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import {
  AgentTag,
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

beforeAll(async () => {
  await loadNamespace("notes");
});

function svgClass(container: HTMLElement): string {
  return container.querySelector("svg")?.getAttribute("class") ?? "";
}

describe("note icons", () => {
  it("shows an emoji as hidden text in every size", () => {
    const small = render(<NoteIcon icon="🧪" />);
    const smallSpan = small.container.querySelector("span");
    expect(smallSpan?.textContent).toBe("🧪");
    expect(smallSpan).toHaveClass("text-sm");
    expect(smallSpan).toHaveAttribute("aria-hidden", "true");
    expect(small.container.querySelector("svg")).toBeNull();

    expect(render(<NoteIcon icon="🧪" size="md" />).container.querySelector("span")).toHaveClass("text-base");
    expect(render(<NoteIcon icon="🧪" size="lg" />).container.querySelector("span")).toHaveClass("text-[2rem]");
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

    const medium = render(<NoteIcon size="md" />);
    expect(svgClass(medium.container)).toContain("size-4");
    expect(svgClass(medium.container)).toContain("text-muted-foreground");

    const large = render(<NoteIcon size="lg" />);
    expect(svgClass(large.container)).toContain("size-8");
    expect(svgClass(large.container)).toContain("text-foreground");
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

  it("lets a caller tint a line icon", () => {
    const { container } = render(<NoteIcon icon={`${LINE_ICON_PREFIX}rocket`} className={KIND_TONES.note.icon} />);
    const classes = svgClass(container).split(" ");
    expect(classes).toContain("text-violet-600");
    expect(classes).not.toContain("text-muted-foreground");
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
    expect(chip).toHaveClass("note-chip", "size-6", "rounded-md");
    expect(noteColorOf(chip)).toBe("#98f5e1");
    expect(chip.querySelector("svg")).toHaveClass("lucide-atom", "text-current", "size-3.5");
    expect(chip.querySelector("svg")).not.toHaveClass("text-muted-foreground");
  });

  it.each([
    ["md", "size-8", "size-4", "text-base"],
    ["lg", "size-14", "size-8", "text-[2rem]"],
  ] as const)("grows to the %s size", (size, chipSize, iconSize, emojiSize) => {
    const line = render(<NoteChip color="rose" size={size} className="mb-3" />).container.firstElementChild as HTMLElement;
    expect(line).toHaveClass("note-chip", chipSize, "mb-3");
    expect(noteColorOf(line)).toBe("#ffcfd2");
    expect(line.querySelector("svg")).toHaveClass("lucide-notebook-pen", iconSize, "text-current");
    const emoji = render(<NoteChip icon="🧪" color="rose" size={size} />).container.firstElementChild as HTMLElement;
    expect(emoji.querySelector("span")).toHaveClass(emojiSize);
  });

  it("falls back to blue for a missing or unknown colour", () => {
    for (const color of [undefined, "crimson", "violet", "toString"]) {
      const chip = render(<NoteChip color={color} />).container.firstElementChild as HTMLElement;
      expect(chip).toHaveAttribute("data-note-color", "blue");
      expect(noteColorOf(chip)).toBe("#1982c4");
    }
    expect(noteColorStyle(undefined)).toEqual({ "--note-color": "#1982c4" });
    expect(noteColorStyle("toString")).toEqual({ "--note-color": "#1982c4" });
    expect(noteColorStyle("lilac")).toEqual({ "--note-color": "#cfbaf0" });
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

  it("puts an artifact's icon in a chip tinted with its kind", () => {
    const { container } = render(<KindChip kind="data" />);
    const chip = container.firstElementChild as HTMLElement;
    expect(chip).toHaveAttribute("data-kind", "data");
    expect(chip).toHaveClass("bg-emerald-500/10", "rounded-md", "size-6");
    expect(chip.querySelector("svg")).toHaveClass("lucide-database", "text-emerald-600");
  });

  it("draws a violet notebook for a note chip and can be round and larger", () => {
    const { container } = render(<KindChip kind="note" shape="circle" className="size-7" />);
    const chip = container.firstElementChild as HTMLElement;
    expect(chip).toHaveClass("bg-violet-500/10", "rounded-full", "size-7");
    expect(chip).not.toHaveClass("rounded-md");
    expect(chip).not.toHaveClass("size-6");
    expect(chip.querySelector("svg")).toHaveClass("lucide-notebook-pen", "text-violet-600");
  });

  it("holds a note's own icon when given one", () => {
    render(
      <KindChip kind="note">
        <NoteIcon icon="🧪" />
      </KindChip>,
    );
    expect(screen.getByText("🧪").parentElement).toHaveClass("bg-violet-500/10");
  });

  it("labels an artifact's kind in a tinted badge", () => {
    render(<KindBadge kind="figure" label={enNotes.artifacts.kind.figure} />);
    const badge = screen.getByText(enNotes.artifacts.kind.figure);
    expect(badge).toHaveAttribute("data-kind", "figure");
    expect(badge).toHaveClass("bg-pink-500/10", "text-pink-700", "rounded-full");
    expect(badge).not.toHaveClass("bg-muted");
    expect(badge.querySelector("svg")).toHaveClass("lucide-image");
  });
});

describe("bylines", () => {
  it("tags an agent by name in the primary colour", () => {
    render(<AgentTag name="Claude Code" />);
    const tag = screen.getByText("Claude Code").closest("[data-agent-tag]");
    expect(tag).toHaveClass("bg-primary/10", "text-primary");
  });

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
    expect(container.firstElementChild).toHaveClass("mt-2", "truncate");
  });

  it("names nobody on a shared note that no agent wrote", () => {
    const { container } = render(<Byline author="you" when="now" shared />);
    expect(container).toHaveTextContent(/^now$/u);
    const agent = render(<Byline author="agent" agent="Codex" when="now" shared />);
    expect(agent.container).toHaveTextContent("Codex · now");
  });
});
