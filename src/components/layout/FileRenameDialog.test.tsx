// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { useFileRenameStore } from "@/store/file-rename";

const mocks = vi.hoisted(() => ({
  renameFromPrompt: vi.fn(),
}));

vi.mock("@/lib/file-references/rename-at-cursor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/file-references/rename-at-cursor")>()),
  renameFromPrompt: mocks.renameFromPrompt,
}));

import { FileRenameDialog } from "./FileRenameDialog";

const copy = enShell.fileRenameDialog;

beforeEach(() => {
  mocks.renameFromPrompt.mockResolvedValue({ status: "renamed" });
  useFileRenameStore.getState().open({ path: "figures/plot.png", directory: false });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useFileRenameStore.getState().close();
});

function input(): HTMLInputElement {
  return screen.getByRole("textbox", { name: copy.newPath });
}

describe("FileRenameDialog", () => {
  it("opens prefilled with the project path and the name selected", async () => {
    render(<FileRenameDialog />);
    expect(screen.getByText(copy.title)).toBeInTheDocument();
    const field = input();
    expect(field.value).toBe("figures/plot.png");
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect([field.selectionStart, field.selectionEnd]).toEqual([8, 12]);
    expect(screen.getByText(copy.hint)).toBeInTheDocument();
  });

  it("titles folders as folders", () => {
    useFileRenameStore.getState().open({ path: "figures", directory: true });
    render(<FileRenameDialog />);
    expect(screen.getByText(copy.titleFolder)).toBeInTheDocument();
  });

  it("renames through the files store path and closes", async () => {
    render(<FileRenameDialog />);
    await userEvent.clear(input());
    await userEvent.type(input(), "images/plot.png{Enter}");
    expect(mocks.renameFromPrompt).toHaveBeenCalledWith("figures/plot.png", "images/plot.png");
    expect(useFileRenameStore.getState().target).toBeNull();
  });

  it("keeps the prompt open when the destination exists", async () => {
    mocks.renameFromPrompt.mockResolvedValue({ status: "exists", path: "images/plot.png" });
    render(<FileRenameDialog />);
    await userEvent.clear(input());
    await userEvent.type(input(), "images/plot.png");
    await userEvent.click(screen.getByRole("button", { name: enCommon.actions.rename }));
    expect(screen.getByText(copy.exists.replace("{{path}}", "images/plot.png"))).toBeInTheDocument();
    expect(useFileRenameStore.getState().target).not.toBeNull();
  });

  it("refuses paths outside the project and unchanged paths", async () => {
    render(<FileRenameDialog />);
    const rename = screen.getByRole("button", { name: enCommon.actions.rename });
    expect(rename).toBeDisabled();
    await userEvent.clear(input());
    await userEvent.type(input(), "../plot.png");
    expect(screen.getByText(copy.invalid)).toBeInTheDocument();
    expect(rename).toBeDisabled();
    await userEvent.type(input(), "{Enter}");
    expect(mocks.renameFromPrompt).not.toHaveBeenCalled();
  });

  it("cancels without renaming", async () => {
    render(<FileRenameDialog />);
    await userEvent.click(screen.getByRole("button", { name: enCommon.actions.cancel }));
    expect(useFileRenameStore.getState().target).toBeNull();
    expect(mocks.renameFromPrompt).not.toHaveBeenCalled();
  });
});
