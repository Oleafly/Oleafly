// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { calloutNodeView } from "./NoteCallout";
import { nodeRoot } from "./node-root";
import { destroyKbEditors, kbEditor } from "./tests/kb-editor-fixtures";
import "./tests/setup";

afterEach(() => {
  destroyKbEditors();
  vi.restoreAllMocks();
});

async function settle() {
  await act(async () => {});
}

function Translated() {
  const { t } = useTranslation(["notes"]);
  return <p>{t(($) => $.notes.kb.callouts.fold)}</p>;
}

describe("a React tree inside an editor node", () => {
  it("draws without a React error when the editor is built while a component renders", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    function Host() {
      useState(() => kbEditor("> [!note] Title\n> Body", { callout: calloutNodeView() }));
      return null;
    }
    render(<Host />);
    await settle();
    expect(screen.getByRole("button", { name: enNotes.kb.callouts.fold })).toBeInTheDocument();
    expect(error).not.toHaveBeenCalled();
  });

  it("shows the latest content asked for, with the app's translations", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    const root = nodeRoot(host);
    root.render(<p>{"first"}</p>);
    root.render(<Translated />);
    await settle();
    expect(host.textContent).toBe(enNotes.kb.callouts.fold);
    act(() => root.render(<p>{"later"}</p>));
    expect(host.textContent).toBe("later");
    root.unmount();
    await settle();
    expect(host.textContent).toBe("");
    host.remove();
  });

  it("draws nothing for a node removed before its first paint", async () => {
    const drawn = { render: vi.fn(), unmount: vi.fn() };
    const root = nodeRoot(document.createElement("div"), () => drawn);
    root.render(<p>{"gone"}</p>);
    root.unmount();
    root.render(<p>{"too late"}</p>);
    await settle();
    expect(drawn.render).not.toHaveBeenCalled();
    expect(drawn.unmount).toHaveBeenCalledOnce();
  });
});
