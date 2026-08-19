// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

const mocks = vi.hoisted(() => ({
  gitLog: vi.fn(),
  gitReadVersionLabels: vi.fn(),
  gitSetVersionLabel: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  gitLog: mocks.gitLog,
  gitReadVersionLabels: mocks.gitReadVersionLabels,
  gitSetVersionLabel: mocks.gitSetVersionLabel,
}));

import { HistoryModal } from "./HistoryModal";

const commits = [
  {
    oid: "6138cce111111111111111111111111111111111",
    short: "6138cce",
    time: 1_776_000_100,
    message: "Update: project.json",
  },
  {
    oid: "5e37911222222222222222222222222222222222",
    short: "5e37911",
    time: 1_776_000_000,
    message: "Update: .gitignore, main.tex, project.json",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gitLog.mockResolvedValue(commits);
  mocks.gitReadVersionLabels.mockResolvedValue({
    [commits[0].oid]: "Stable one",
  });
  mocks.gitSetVersionLabel.mockResolvedValue(undefined);
  useSettingsStore.setState({ historyOpen: true });
  useFilesStore.setState({
    projectId: "project",
    restoreFromGit: vi.fn().mockResolvedValue(undefined),
  });
});

describe("HistoryModal", () => {
  it("shows a primary history rail and filters Labels to manual labels", async () => {
    const user = userEvent.setup();
    render(<HistoryModal />);

    expect(await screen.findByText("Stable one")).toBeInTheDocument();
    expect(screen.getByTestId("history-graph-rail")).toHaveClass(
      "bg-primary/40",
    );
    expect(screen.getByLabelText("Copy commit ID 6138cce")).toBeInTheDocument();
    expect(screen.getByLabelText("Labeled Stable one")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Labels" }));

    expect(screen.getByText("Update: project.json")).toBeInTheDocument();
    expect(
      screen.queryByText("Update: .gitignore, main.tex, project.json"),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove label Stable one" }),
    );

    await waitFor(() => {
      expect(mocks.gitSetVersionLabel).toHaveBeenCalledWith(
        "project",
        commits[0].oid,
        "",
      );
    });
    expect(
      await screen.findByText(
        "No labeled versions yet. Add a label from All History.",
      ),
    ).toBeInTheDocument();
  });

  it("creates or edits a label from All History", async () => {
    mocks.gitReadVersionLabels.mockResolvedValue({});
    render(<HistoryModal />);

    await screen.findByText("Compile V2");
    fireEvent.click(
      screen.getByRole("button", { name: "Edit label for 6138cce" }),
    );

    const input = screen.getByRole("textbox", { name: "Version label" });
    fireEvent.change(input, { target: { value: "Ready to submit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save label" }));

    await waitFor(() => {
      expect(mocks.gitSetVersionLabel).toHaveBeenCalledWith(
        "project",
        commits[0].oid,
        "Ready to submit",
      );
    });
    expect(await screen.findByText("Ready to submit")).toBeInTheDocument();
  });

  it("copies commit IDs and supports keyboard label editing", async () => {
    mocks.gitReadVersionLabels.mockResolvedValue({});
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    render(<HistoryModal />);

    await user.click(
      await screen.findByRole("button", { name: "Copy commit ID 6138cce" }),
    );
    expect(writeText).toHaveBeenCalledWith(commits[0].oid);

    await user.click(screen.getByRole("button", { name: "Edit label for 6138cce" }));
    let input = screen.getByRole("textbox", { name: "Version label" });
    await user.type(input, "Temporary");
    await user.click(screen.getByRole("button", { name: "Cancel label editing" }));
    expect(screen.queryByRole("textbox", { name: "Version label" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Edit label for 6138cce" }));
    input = screen.getByRole("textbox", { name: "Version label" });
    await user.clear(input);
    await user.type(input, "Camera ready");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(mocks.gitSetVersionLabel).toHaveBeenCalledWith(
        "project",
        commits[0].oid,
        "Camera ready",
      ),
    );
  });
});
