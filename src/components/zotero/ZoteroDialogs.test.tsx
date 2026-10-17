// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/zotero-actions", () => ({
  useZoteroStaleStore: { getState: () => ({ refresh: vi.fn() }) },
}));

import enReferences from "@/i18n/locales/en/references.json" with { type: "json" };
import { useZoteroDialogStore } from "@/store/zotero-dialogs";
import { ZoteroDialogs } from "./ZoteroDialogs";

const text = enReferences.zotero.handList;

function ask() {
  let answer: Promise<boolean> = Promise.resolve(false);
  act(() => {
    answer = useZoteroDialogStore.getState().confirmHandList({ file: "main.tex", bib: "refs/references.bib", count: 3 });
  });
  return answer;
}

beforeEach(() => {
  useZoteroDialogStore.setState({ handList: null, handEdits: null, bibliographyChoice: null, bulk: null });
});

describe("moving a hand-written reference list", () => {
  it("names the target .bib and moves the list on confirm", async () => {
    render(<ZoteroDialogs />);
    const answer = ask();
    const dialog = await screen.findByRole("alertdialog", { name: text.title });
    expect(dialog).toHaveAccessibleDescription(text.description.replace("{{path}}", "refs/references.bib"));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(text.confirm) }));
    await expect(answer).resolves.toBe(true);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("answers no when the user cancels", async () => {
    render(<ZoteroDialogs />);
    const answer = ask();
    await screen.findByRole("alertdialog", { name: text.title });
    const cancel = screen.getAllByRole("button", { name: /Cancel/ }).find((button) => button.textContent?.startsWith("Cancel"));
    expect(cancel).toBeDefined();
    if (cancel) fireEvent.click(cancel);
    await expect(answer).resolves.toBe(false);
    expect(useZoteroDialogStore.getState().handList).toBeNull();
  });

  it("drops an older question when a new one arrives", async () => {
    const first = useZoteroDialogStore.getState().confirmHandList({ file: "a.tex", bib: "a.bib", count: 1 });
    const second = useZoteroDialogStore.getState().confirmHandList({ file: "b.tex", bib: "b.bib", count: 1 });
    await expect(first).resolves.toBe(false);
    expect(useZoteroDialogStore.getState().handList?.value.bib).toBe("b.bib");
    useZoteroDialogStore.getState().handList?.resolve(true);
    await expect(second).resolves.toBe(true);
  });
});
