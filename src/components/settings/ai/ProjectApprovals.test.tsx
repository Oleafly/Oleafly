// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { approvalsList, approvalsSet } from "@/lib/tauri";
import { createAppQueryClient } from "@/lib/query";
import { useFilesStore } from "@/store/files";
import { ProjectApprovals } from "./ProjectApprovals";

vi.mock("@/lib/tauri", () => ({
  approvalsList: vi.fn(),
  approvalsSet: vi.fn(() => Promise.resolve()),
  listProjects: vi.fn(),
}));

const mockList = vi.mocked(approvalsList);
const mockSet = vi.mocked(approvalsSet);

function renderCard() {
  render(
    <QueryClientProvider client={createAppQueryClient()}>
      <ProjectApprovals />
    </QueryClientProvider>,
  );
}

describe("ProjectApprovals", () => {
  beforeEach(() => {
    mockList.mockReset();
    mockSet.mockClear();
    useFilesStore.setState({ projectId: "proj-1", projectName: "Thesis" });
  });

  it("lists the persisted decisions for the open project", async () => {
    mockList.mockResolvedValue({ write_file: "allow", delete_file: "deny" });
    renderCard();

    expect(await screen.findByText("write_file")).toBeInTheDocument();
    expect(screen.getByText("delete_file")).toBeInTheDocument();
    expect(screen.getByText("Always allowed")).toBeInTheDocument();
    expect(screen.getByText("Always denied")).toBeInTheDocument();
  });

  it("removes a decision so the tool prompts again", async () => {
    mockList.mockResolvedValue({ write_file: "allow" });
    renderCard();
    await screen.findByText("write_file");

    fireEvent.click(
      screen.getByRole("button", { name: "Remove rule for write_file" }),
    );

    await vi.waitFor(() =>
      expect(mockSet).toHaveBeenCalledWith("proj-1", "write_file", null),
    );
  });

  it("renders nothing without an open project", () => {
    useFilesStore.setState({ projectId: null });
    renderCard();
    expect(screen.queryByText("Tool approvals")).not.toBeInTheDocument();
  });
});
