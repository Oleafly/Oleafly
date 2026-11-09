// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import type { LinkableNote } from "./note-links";
import { NoteProperties } from "./NoteProperties";

const NOTES: LinkableNote[] = [
  { noteId: "n2", projectId: "lib-2", title: "Baseline", icon: "🧪" },
  { noteId: "n3", projectId: "lib-3", title: "Ablation" },
];
const P = enNotes.kb.properties;

function Harness({ initial, editable, onOpenNote }: Readonly<{ initial: string; editable?: boolean; onOpenNote?: (note: LinkableNote) => void }>) {
  const [text, setText] = useState(initial);
  return (
    <div className="group/header">
      <NoteProperties frontMatter={text} onChange={(update) => setText(update)} notes={NOTES} onOpenNote={onOpenNote} editable={editable} />
      <output data-testid="front-matter">{text}</output>
    </div>
  );
}

function frontMatter(): string {
  return screen.getByTestId("front-matter").textContent ?? "";
}

function openMenu(name: string | RegExp) {
  fireEvent.pointerDown(screen.getByRole("button", { name }), { button: 0, ctrlKey: false, pointerType: "mouse" });
}

beforeAll(async () => {
  await loadNamespace("notes");
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("adding properties", () => {
  it("shows only an add button until a property exists, then adds one", () => {
    render(<Harness initial={"---\ntitle: A\nid: n1\n---"} />);
    expect(screen.queryByRole("region")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: P.add }));
    const name = screen.getByRole("textbox", { name: P.newName });
    expect(document.activeElement).toBe(name);
    fireEvent.change(name, { target: { value: "id" } });
    expect(screen.getByText(P.taken)).toBeTruthy();
    fireEvent.keyDown(name, { key: "Enter" });
    fireEvent.change(name, { target: { value: "status" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(frontMatter()).toBe("---\ntitle: A\nid: n1\nstatus: null\n---");
    expect(screen.getByRole("region", { name: P.title })).toBeTruthy();
  });

  it("cancels an empty or escaped name", () => {
    render(<Harness initial={"---\na: 1\n---"} />);
    fireEvent.click(screen.getByRole("button", { name: P.add }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: P.newName }), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: P.newName })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: P.add }));
    fireEvent.blur(screen.getByRole("textbox", { name: P.newName }));
    expect(screen.queryByRole("textbox", { name: P.newName })).toBeNull();
    expect(frontMatter()).toBe("---\na: 1\n---");
  });

  it("uses the remembered type for a new property", () => {
    localStorage.setItem("oleafly.notes.propertyTypes", JSON.stringify({ reviewed: "checkbox" }));
    render(<Harness initial={""} />);
    fireEvent.click(screen.getByRole("button", { name: P.add }));
    const name = screen.getByRole("textbox", { name: P.newName });
    fireEvent.change(name, { target: { value: "reviewed" } });
    fireEvent.blur(name);
    expect(frontMatter()).toBe("---\nreviewed: false\n---");
    expect(screen.getByRole("checkbox", { name: "Value of reviewed" })).toBeTruthy();
  });
});

describe("editing values", () => {
  it("edits text, numbers, dates and checkboxes", () => {
    render(<Harness initial={"---\nstatus: draft\nscore: 2\nwhen: 2024-01-01\ndone: false\n---"} />);
    const status = screen.getByRole("textbox", { name: "Value of status" });
    fireEvent.change(status, { target: { value: "final" } });
    fireEvent.keyDown(status, { key: "Escape" });
    expect((status as HTMLInputElement).value).toBe("draft");
    fireEvent.change(status, { target: { value: "final" } });
    fireEvent.keyDown(status, { key: "Enter" });
    fireEvent.blur(status);
    const score = screen.getByRole("spinbutton", { name: "Value of score" });
    fireEvent.change(score, { target: { value: "4.5" } });
    fireEvent.blur(score);
    const when = screen.getByLabelText("Value of when");
    fireEvent.change(when, { target: { value: "" } });
    fireEvent.blur(when);
    fireEvent.click(screen.getByRole("checkbox", { name: "Value of done" }));
    expect(frontMatter()).toBe("---\nstatus: final\nscore: 4.5\nwhen: null\ndone: true\n---");
    fireEvent.change(status, { target: { value: "" } });
    fireEvent.blur(status);
    expect(frontMatter()).toContain("status: null");
  });

  it("adds, removes and pops list items", () => {
    render(<Harness initial={"---\ntags: [a]\n---"} />);
    const input = screen.getByRole("textbox", { name: "Value of tags" });
    fireEvent.change(input, { target: { value: "b, a" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(frontMatter()).toBe("---\ntags: [a, b]\n---");
    fireEvent.change(input, { target: { value: "c" } });
    fireEvent.keyDown(input, { key: "," });
    fireEvent.click(screen.getByRole("button", { name: "Remove a" }));
    expect(frontMatter()).toBe("---\ntags: [b, c]\n---");
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(frontMatter()).toBe("---\ntags: [b]\n---");
    fireEvent.change(input, { target: { value: "d" } });
    fireEvent.blur(input);
    fireEvent.keyDown(input, { key: "x" });
    expect(frontMatter()).toBe("---\ntags: [b, d]\n---");
  });

  it("links to a note, opens it and clears the link", () => {
    const onOpenNote = vi.fn();
    localStorage.setItem("oleafly.notes.propertyTypes", JSON.stringify({ source: "link" }));
    render(<Harness initial={"---\nsource:\n---"} onOpenNote={onOpenNote} />);
    expect(screen.getByRole("button", { name: "Value of source" }).textContent).toBe(P.chooseNote);
    openMenu("Value of source");
    fireEvent.click(screen.getByRole("menuitem", { name: /Baseline/u }));
    expect(frontMatter()).toBe("---\nsource: oleafly://note/n2\n---");
    expect(screen.getByRole("button", { name: "Value of source" }).textContent).toBe(P.changeNote);
    fireEvent.click(screen.getByRole("button", { name: "Open Baseline" }));
    expect(onOpenNote).toHaveBeenCalledWith(NOTES[0]);
    openMenu("Value of source");
    fireEvent.click(screen.getByRole("menuitem", { name: P.clearLink }));
    expect(frontMatter()).toBe("---\nsource: null\n---");
  });

  it("names a link to a missing note", () => {
    render(<Harness initial={"---\nsource: oleafly://note/gone\n---"} />);
    expect(screen.getByText(enNotes.links.missingNote)).toBeTruthy();
  });

  it("shows nested values read only", () => {
    render(<Harness initial={"---\nmeta:\n  a: 1\n---"} />);
    expect(screen.getByText('{"a":1}')).toBeTruthy();
    openMenu("meta type: Text");
    expect(screen.queryByRole("menuitemradio")).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: P.remove }));
    expect(frontMatter()).toBe("---\n---");
  });
});

describe("property menu", () => {
  it("changes a type, converts the value and remembers the type", async () => {
    render(<Harness initial={"---\nrank: '3'\n---"} />);
    openMenu("rank type: Text");
    fireEvent.click(screen.getByRole("menuitemradio", { name: P.types.number }));
    await waitFor(() => expect(frontMatter()).toBe("---\nrank: 3\n---"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(JSON.parse(localStorage.getItem("oleafly.notes.propertyTypes") ?? "{}")).toEqual({ rank: "number" });
  });

  it("asks before a type change that would drop list items, and keeps them when cancelled", async () => {
    render(<Harness initial={"---\nauthors: [Ana, Bo]\n---"} />);
    openMenu("authors type: List");
    fireEvent.click(screen.getByRole("menuitemradio", { name: P.types.text }));
    const dialog = await screen.findByRole("alertdialog", {
      name: P.convert.title.replace("{{key}}", "authors").replace("{{type}}", P.types.text),
    });
    expect(dialog).toHaveTextContent(P.convert.list);
    expect(frontMatter()).toBe("---\nauthors: [Ana, Bo]\n---");
    fireEvent.click(within(dialog).getByRole("button", { name: /Cancel/u }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(frontMatter()).toBe("---\nauthors: [Ana, Bo]\n---");
    expect(localStorage.getItem("oleafly.notes.propertyTypes")).toBeNull();

    openMenu("authors type: List");
    fireEvent.click(screen.getByRole("menuitemradio", { name: P.types.text }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: new RegExp(P.convert.confirm, "u") }));
    expect(frontMatter()).toBe("---\nauthors: Ana\n---");
  });

  it("warns when a value can't survive the new type", async () => {
    render(<Harness initial={"---\nvenue: ICML\n---"} />);
    openMenu("venue type: Text");
    fireEvent.click(screen.getByRole("menuitemradio", { name: P.types.number }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(P.convert.value);
  });

  it("keeps tags as a list and renames other keys", () => {
    render(<Harness initial={"---\ntags: [a]\nstate: x\n---"} />);
    openMenu("tags type: List");
    expect(screen.queryByRole("menuitemradio")).toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    const key = screen.getByRole("textbox", { name: "Name of state" });
    fireEvent.change(key, { target: { value: "status" } });
    fireEvent.blur(key);
    expect(frontMatter()).toBe("---\ntags: [a]\nstatus: x\n---");
  });

  it("says when a new name is taken or reserved, and puts the old name back", () => {
    render(<Harness initial={"---\nstate: x\nphase: y\n---"} />);
    const key = screen.getByRole("textbox", { name: "Name of state" });
    fireEvent.change(key, { target: { value: "phase" } });
    expect(key).toHaveAttribute("aria-invalid", "true");
    expect(key).toHaveAccessibleDescription(P.taken);
    fireEvent.keyDown(key, { key: "Enter" });
    expect(key).toHaveValue("phase");
    fireEvent.change(key, { target: { value: "title" } });
    expect(screen.getByText(P.taken)).toBeTruthy();
    fireEvent.blur(key);
    expect(key).toHaveValue("state");
    expect(key).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(P.taken)).toBeNull();
    fireEvent.change(key, { target: { value: "   " } });
    fireEvent.blur(key);
    expect(key).toHaveValue("state");
    expect(frontMatter()).toBe("---\nstate: x\nphase: y\n---");
  });
});

describe("focus after removing a property", () => {
  function NoteHarness({ initial }: Readonly<{ initial: string }>) {
    return (
      <article>
        <Harness initial={initial} />
        <div className="ProseMirror" contentEditable suppressContentEditableWarning tabIndex={-1} data-testid="note-body" />
      </article>
    );
  }

  function removeFromMenu(key: string) {
    openMenu(`${key} type: Text`);
    fireEvent.click(screen.getByRole("menuitem", { name: P.remove }));
  }

  it("moves to the next property, then the one before, then the note body", async () => {
    render(<NoteHarness initial={"---\na: x\nb: y\nc: z\n---"} />);

    removeFromMenu("a");
    await waitFor(() => expect(screen.getByRole("button", { name: "b type: Text" })).toHaveFocus());
    expect(frontMatter()).toBe("---\nb: y\nc: z\n---");

    removeFromMenu("c");
    await waitFor(() => expect(screen.getByRole("button", { name: "b type: Text" })).toHaveFocus());

    removeFromMenu("b");
    await waitFor(() => expect(screen.getByTestId("note-body")).toHaveFocus());
    expect(frontMatter()).toBe("---\n---");
  });

  it("never leaves focus in a text field, where Cmd or Ctrl+Z would undo the field instead of the note", async () => {
    render(<NoteHarness initial={"---\na: x\nb: y\n---"} />);
    removeFromMenu("a");
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(document.activeElement?.closest("article")).not.toBeNull();
    expect(document.activeElement?.tagName).toBe("BUTTON");
  });
});

describe("panel state", () => {
  it("folds and remembers it", () => {
    const { unmount } = render(<Harness initial={"---\na: 1\n---"} />);
    const toggle = screen.getByRole("button", { name: new RegExp(P.title, "u") });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(screen.queryByRole("list")).toBeNull();
    expect(localStorage.getItem("oleafly.notes.propertiesOpen")).toBe("false");
    unmount();
    render(<Harness initial={"---\na: 1\n---"} />);
    expect(screen.getByRole("button", { name: new RegExp(P.title, "u") }).getAttribute("aria-expanded")).toBe("false");
  });

  it("opens when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<Harness initial={"---\na: 1\n---"} />);
    const toggle = screen.getByRole("button", { name: new RegExp(P.title, "u") });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows the new property field even while the list is folded", () => {
    localStorage.setItem("oleafly.notes.propertiesOpen", "false");
    render(<Harness initial={"---\ntitle: A\n---"} />);
    fireEvent.click(screen.getByRole("button", { name: P.add }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: P.newName }));
    expect(localStorage.getItem("oleafly.notes.propertiesOpen")).toBe("true");
  });

  it("leaves Enter and commas to the input method while it composes text", () => {
    render(<Harness initial={"---\ntags: [a]\nstatus: x\n---"} />);
    const tags = screen.getByRole("textbox", { name: "Value of tags" });
    fireEvent.change(tags, { target: { value: "b" } });
    fireEvent.keyDown(tags, { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(tags, { key: ",", isComposing: true });
    expect(frontMatter()).toBe("---\ntags: [a]\nstatus: x\n---");
    const status = screen.getByRole("textbox", { name: "Value of status" });
    fireEvent.change(status, { target: { value: "y" } });
    fireEvent.keyDown(status, { key: "Enter", keyCode: 229 });
    expect(frontMatter()).toBe("---\ntags: [a]\nstatus: x\n---");
    fireEvent.keyDown(status, { key: "Enter" });
    expect(frontMatter()).toBe("---\ntags: [a]\nstatus: y\n---");
  });

  it("explains broken YAML, offers the Markdown source, and shows nothing when read only and empty", () => {
    const onEditSource = vi.fn();
    const { unmount, rerender } = render(<NoteProperties frontMatter={"---\na: [\n---"} onChange={vi.fn()} onEditSource={onEditSource} />);
    expect(screen.getByText(P.invalid)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: P.editSource }));
    expect(onEditSource).toHaveBeenCalledOnce();
    rerender(<NoteProperties frontMatter={"---\na: [\n---"} onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: P.editSource })).toBeNull();
    unmount();
    const { container } = render(<NoteProperties frontMatter="" onChange={vi.fn()} editable={false} />);
    expect(container.textContent).toBe("");
  });

  it("locks every field when read only", () => {
    render(<Harness initial={"---\nstatus: x\ntags: [a]\nsource: oleafly://note/n2\n---"} editable={false} />);
    const list = screen.getByRole("list");
    expect(within(list).queryByRole("button", { name: /type/u })).toBeNull();
    expect((screen.getByRole("textbox", { name: "Value of status" }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Remove a" })).toBeNull();
    expect(screen.queryByRole("button", { name: P.add })).toBeNull();
    expect(screen.getByText("Baseline")).toBeTruthy();
  });
});
