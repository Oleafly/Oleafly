// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Pencil, Sigma } from "lucide-react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { destroyKbEditors, kbEditor, kbMarkdown } from "./tests/kb-editor-fixtures";
import { CalloutChrome, calloutIcon, calloutNodeView } from "./NoteCallout";
import { editableChanged } from "./note-editable";

beforeAll(async () => {
  await loadNamespace("notes");
});

afterEach(destroyKbEditors);

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("callout chrome", () => {
  it("picks an icon per type", () => {
    expect(calloutIcon("theorem")).toBe(Sigma);
    expect(calloutIcon("nonsense")).toBe(Pencil);
  });

  it("changes the type from the icon menu and folds", () => {
    const onType = vi.fn();
    const onFold = vi.fn();
    render(<CalloutChrome type="tip" folded={false} editable onFold={onFold} onType={onType} />);
    const trigger = screen.getByRole("button", { name: "Callout type: Tip" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Theorem" }));
    expect(onType).toHaveBeenCalledWith("theorem");
    fireEvent.click(screen.getByRole("button", { name: enNotes.kb.callouts.fold }));
    expect(onFold).toHaveBeenCalled();
  });

  it("explains the icon-only type and fold buttons on hover", async () => {
    render(<CalloutChrome type="tip" folded={false} editable onFold={vi.fn()} onType={vi.fn()} />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Callout type: Tip" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Callout type: Tip");
    fireEvent.mouseLeave(screen.getByRole("button", { name: "Callout type: Tip" }));
    fireEvent.mouseEnter(screen.getByRole("button", { name: enNotes.kb.callouts.fold }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(enNotes.kb.callouts.fold);
  });

  it("shows a plain icon when the note is read only and names the unfold action", () => {
    render(<CalloutChrome type="note" folded editable={false} onFold={vi.fn()} onType={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Callout type/u })).toBeNull();
    expect(screen.getByRole("button", { name: enNotes.kb.callouts.unfold }).getAttribute("aria-expanded")).toBe("false");
  });
});

describe("callout node view", () => {
  it("tints by type, folds without touching the file, and changes type", async () => {
    const editor = kbEditor("> [!warning]- Careful\n> Body", { callout: calloutNodeView() });
    await settle();
    const dom = editor.view.dom.querySelector<HTMLElement>(".note-callout");
    expect(dom?.dataset.tone).toBe("orange");
    expect(dom?.hasAttribute("data-folded")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: enNotes.kb.callouts.unfold }));
    await settle();
    expect(editor.view.dom.querySelector(".note-callout")).toBe(dom);
    expect(dom?.hasAttribute("data-folded")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: enNotes.kb.callouts.fold }));
    await settle();
    expect(editor.view.dom.querySelector(".note-callout")).toBe(dom);
    expect(dom?.hasAttribute("data-folded")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: enNotes.kb.callouts.unfold }));
    await settle();
    expect(kbMarkdown(editor)).toBe("> [!warning]- Careful\n> Body");
    fireEvent.pointerDown(screen.getByRole("button", { name: "Callout type: Warning" }), { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Danger" }));
    await settle();
    expect(kbMarkdown(editor)).toBe("> [!danger]- Careful\n> Body");
    expect(editor.view.dom.querySelector<HTMLElement>(".note-callout")?.dataset.tone).toBe("red");
  });

  it("drops the type menu while the note is read only", async () => {
    const editor = kbEditor("> [!note] T\n> B", { callout: calloutNodeView() });
    await settle();
    expect(screen.getByRole("button", { name: "Callout type: Note" })).toBeInTheDocument();
    act(() => {
      editor.setEditable(false, false);
      editableChanged(editor);
    });
    await settle();
    expect(screen.queryByRole("button", { name: "Callout type: Note" })).toBeNull();
    expect(screen.getByRole("button", { name: enNotes.kb.callouts.fold })).toBeInTheDocument();
  });

  it("ignores its own chrome and redraws only for callouts", async () => {
    const mount = vi.fn((host: HTMLElement) => ({ render: vi.fn(), unmount: vi.fn(), host }));
    const editor = kbEditor("> [!note] T\n> B", { callout: calloutNodeView(mount as never) });
    const root = mount.mock.results[0].value;
    const desc = (editor.view as unknown as { docView: { children: { children: unknown[] }[] } }).docView.children[0] as unknown as {
      update(node: unknown): boolean;
      spec: { stopEvent(event: Event): boolean; ignoreMutation(mutation: { type: string; target: Node }): boolean };
    };
    const chrome = root.host as HTMLElement;
    const inside = new Event("click");
    Object.defineProperty(inside, "target", { value: chrome });
    expect(desc.spec.stopEvent(inside)).toBe(true);
    expect(desc.spec.stopEvent(new Event("click"))).toBe(false);
    expect(desc.spec.ignoreMutation({ type: "childList", target: chrome })).toBe(true);
    expect(desc.spec.ignoreMutation({ type: "selection", target: chrome })).toBe(false);
    const view = ((editor.view as unknown as { docView: { children: { children: unknown[] }[] } }).docView.children[0] as unknown as { spec: { update(node: unknown): boolean } }).spec;
    expect(view.update(editor.schema.nodes.paragraph.create())).toBe(false);
    editor.setEditable(false);
    const onType = root.render.mock.calls.at(-1)?.[0].props.onType as (type: string) => void;
    onType("bug");
    expect(kbMarkdown(editor)).toBe("> [!note] T\n> B");
    editor.destroy();
    await settle();
    expect(root.unmount).toHaveBeenCalled();
  });
});
