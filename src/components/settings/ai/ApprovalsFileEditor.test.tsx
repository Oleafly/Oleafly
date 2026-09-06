// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { approvalsReadRaw, approvalsWriteRaw } from "@/lib/tauri";
import { createAppQueryClient } from "@/lib/query";
import { useFilesStore } from "@/store/files";
import { ApprovalsFileEditor, approvalsExample } from "./ApprovalsFileEditor";

vi.mock("@/lib/tauri", () => ({
  approvalsReadRaw: vi.fn(),
  approvalsWriteRaw: vi.fn(),
  approvalsModeGet: vi.fn(async () => "approve-for-me"),
  approvalsModeSet: vi.fn(),
}));

const mockRead = vi.mocked(approvalsReadRaw);
const mockWrite = vi.mocked(approvalsWriteRaw);

function renderEditor() {
  return render(
    <QueryClientProvider client={createAppQueryClient()}>
      <ApprovalsFileEditor />
    </QueryClientProvider>,
  );
}

function editorText(): string {
  const host = screen.getByTestId("approvals-file-source");
  return host.querySelector(".cm-content")?.textContent ?? "";
}

describe("ApprovalsFileEditor", () => {
  beforeEach(() => {
    mockRead.mockReset().mockResolvedValue('["$approval_modes"]\nproj-1 = "custom"\n');
    mockWrite.mockReset().mockResolvedValue(undefined);
    useFilesStore.setState({ projectId: "proj-1", projectName: "Grant proposal" });
  });

  it("loads the file into a highlighted editor and explains the project id", async () => {
    renderEditor();

    await waitFor(() => expect(editorText()).toContain("$approval_modes"));
    expect(screen.getByTestId("approvals-file-save")).toBeDisabled();
    fireEvent.click(screen.getByText("How the file works"));
    expect(screen.getByText("proj-1", { selector: "code" })).toBeInTheDocument();
  });

  it("inserts an example for the open project and saves it through the backend", async () => {
    renderEditor();
    await waitFor(() => expect(editorText()).toContain("$approval_modes"));

    fireEvent.click(screen.getByTestId("approvals-file-example"));
    await waitFor(() => expect(screen.getByTestId("approvals-file-save")).toBeEnabled());
    fireEvent.click(screen.getByTestId("approvals-file-save"));

    await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1));
    const saved = mockWrite.mock.calls[0][0];
    expect(saved).toContain(approvalsExample("proj-1"));
    await waitFor(() =>
      expect(screen.getByTestId("approvals-file-message").textContent).toContain("Saved"),
    );
  });

  it("shows the backend's validation error and keeps the text", async () => {
    mockWrite.mockRejectedValue("The file is not valid: expected newline at line 2");
    renderEditor();
    await waitFor(() => expect(editorText()).toContain("$approval_modes"));

    fireEvent.click(screen.getByTestId("approvals-file-example"));
    await waitFor(() => expect(screen.getByTestId("approvals-file-save")).toBeEnabled());
    fireEvent.click(screen.getByTestId("approvals-file-save"));

    await waitFor(() =>
      expect(screen.getByTestId("approvals-file-message").textContent).toContain("not valid"),
    );
    expect(editorText()).toContain("run_command");
  });
});
