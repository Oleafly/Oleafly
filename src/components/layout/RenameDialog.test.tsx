// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEditorView: vi.fn(() => ({}) as unknown),
  applyRename: vi.fn(async () => {}),
  renamePlan: vi.fn(),
}));

vi.mock("@/components/editor/cm/controller", () => ({
  getEditorView: mocks.getEditorView,
}));
vi.mock("@/lib/index/nav", () => ({ applyRename: mocks.applyRename }));

import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { useIndexStore } from "@/store/project-index";
import { useRenameStore } from "@/store/rename";
import type { Sym } from "@/lib/index/types";
import { RenameDialog } from "./RenameDialog";

const copy = enShell.renameDialog;

const SYMBOL: Sym = {
  kind: "label",
  name: "sec:intro",
  file: "main.tex",
  line: 3,
  from: 10,
  to: 24,
  nameFrom: 17,
  nameTo: 26,
};

beforeEach(() => {
  mocks.getEditorView.mockReturnValue({});
  mocks.applyRename.mockClear();
  mocks.renamePlan.mockReset();
  mocks.renamePlan.mockReturnValue({
    edits: [{}, {}, {}],
    fileCount: 2,
    collision: false,
  });
  useIndexStore.setState({
    index: { renamePlan: mocks.renamePlan },
  } as unknown as ReturnType<typeof useIndexStore.getState>);
  useRenameStore.setState({ sym: SYMBOL });
});

describe("RenameDialog", () => {
  it("renders nothing without a symbol", () => {
    useRenameStore.setState({ sym: null });
    const { container } = render(<RenameDialog />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens on the current symbol name with the rename disabled", () => {
    render(<RenameDialog />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(copy.newName)).toHaveValue("sec:intro");
    expect(screen.getByLabelText(copy.commit)).toBeDisabled();
  });

  it("summarizes the edits the new name would make", async () => {
    render(<RenameDialog />);
    const user = userEvent.setup();
    const field = screen.getByLabelText(copy.newName);
    await user.clear(field);
    await user.type(field, "sec:overview");
    expect(
      await screen.findByText(
        copy.planSummary_other
          .replace("{{count}}", "3")
          .replace(
            /\$t\(shell:renameDialog\.planFiles.*\)/,
            copy.planFiles_other.replace("{{count}}", "2"),
          ),
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(copy.commit)).toBeEnabled();
  });

  it("refuses a name that already exists", async () => {
    mocks.renamePlan.mockReturnValue({ edits: [], fileCount: 0, collision: true });
    render(<RenameDialog />);
    const user = userEvent.setup();
    const field = screen.getByLabelText(copy.newName);
    await user.clear(field);
    await user.type(field, "sec:taken");
    expect(
      await screen.findByText(
        copy.collision
          .replace("{{kind}}", copy.symbolKinds.label)
          .replace("{{name}}", "sec:taken"),
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(copy.commit)).toBeDisabled();
  });

  it("applies the rename on enter", async () => {
    render(<RenameDialog />);
    const user = userEvent.setup();
    const field = screen.getByLabelText(copy.newName);
    await user.clear(field);
    await user.type(field, "sec:overview{Enter}");
    await waitFor(() =>
      expect(mocks.applyRename).toHaveBeenCalledWith(
        expect.anything(),
        SYMBOL,
        "sec:overview",
      ),
    );
    expect(useRenameStore.getState().sym).toBeNull();
  });

  it("applies the rename from the commit button", async () => {
    render(<RenameDialog />);
    const user = userEvent.setup();
    const field = screen.getByLabelText(copy.newName);
    await user.clear(field);
    await user.type(field, "sec:another");
    await user.click(screen.getByLabelText(copy.commit));
    await waitFor(() => expect(mocks.applyRename).toHaveBeenCalled());
  });

  it("closes on escape, on cancel and on the backdrop", async () => {
    render(<RenameDialog />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(copy.newName), "{Escape}");
    await waitFor(() => expect(useRenameStore.getState().sym).toBeNull());

    useRenameStore.setState({ sym: SYMBOL });
    render(<RenameDialog />);
    await user.click(
      screen.getAllByRole("button", { name: enCommon.actions.cancel })[0],
    );
    await waitFor(() => expect(useRenameStore.getState().sym).toBeNull());
  });

  it("does nothing without an editor view", async () => {
    mocks.getEditorView.mockReturnValue(null);
    render(<RenameDialog />);
    const user = userEvent.setup();
    const field = screen.getByLabelText(copy.newName);
    await user.clear(field);
    await user.type(field, "sec:overview{Enter}");
    await waitFor(() => expect(useRenameStore.getState().sym).toBeNull());
    expect(mocks.applyRename).not.toHaveBeenCalled();
  });
});
