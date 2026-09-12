// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const githubState = { status: "connected" as string, refresh: vi.fn() };

vi.mock("@/store/github", () => ({
  useGithubStore: (selector: (state: unknown) => unknown) => selector(githubState),
}));

vi.mock("@/lib/github", () => ({
  githubListRepos: vi.fn(async () => [
    { full_name: "oleafly/paper", html_url: "https://github.com/oleafly/paper", private: false },
    { full_name: "oleafly/notes", html_url: "https://github.com/oleafly/notes", private: true },
  ]),
}));

vi.mock("@/features/project-import", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/project-import")>(),
  importGitHubRepository: vi.fn(async () => {}),
  importSelectedFile: vi.fn(async () => {}),
  importArxivPaper: vi.fn(async () => true),
  importFileKind: (path: string) => {
    if (path.endsWith(".zip")) return "project";
    if (path.endsWith(".docx")) return "word";
    if (path.endsWith(".md")) return "markdown";
    if (path.endsWith(".html")) return "html";
    if (path.endsWith(".typ")) return "typst";
    return null;
  },
  importTargetsForKind: (kind: string) => {
    if (kind === "html") {
      return [
        { target: "latex", label: "LaTeX project", recommended: true },
        { target: "markdown", label: "Markdown project" },
        { target: "typst", label: "Typst project" },
      ];
    }
    return [];
  },
}));

vi.mock("@/lib/native-file-dialog", () => ({
  pickOpenPath: vi.fn(async () => "/tmp/paper.zip"),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn(async () => {}) }));

import {
  importArxivPaper,
  importGitHubRepository,
  importSelectedFile,
} from "@/features/project-import";
import { pickOpenPath } from "@/lib/native-file-dialog";
import { ProjectImportDialog } from "./ProjectImportDialog";

beforeEach(() => {
  vi.clearAllMocks();
  githubState.status = "connected";
  vi.mocked(pickOpenPath).mockResolvedValue("/tmp/paper.zip");
  vi.mocked(importArxivPaper).mockResolvedValue(true);
});

describe("ProjectImportDialog", () => {
  it("imports a chosen file and closes only after the import finishes", async () => {
    const onImported = vi.fn();
    render(<ProjectImportDialog open onClose={vi.fn()} onImported={onImported} />);

    expect(screen.getByTestId("project-import-dialog")).toHaveTextContent("Import a project");
    fireEvent.click(screen.getByTestId("project-import-project"));

    await waitFor(() => expect(importSelectedFile).toHaveBeenCalledWith("/tmp/paper.zip"));
    expect(pickOpenPath).toHaveBeenCalledOnce();
    expect(onImported).toHaveBeenCalledOnce();
  });

  it("lists repositories behind the GitHub step and imports the chosen one", async () => {
    render(<ProjectImportDialog open onClose={vi.fn()} />);
    expect(screen.queryByText("oleafly/paper")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("project-import-github"));

    expect(await screen.findByText("oleafly/paper")).toBeInTheDocument();
    expect(screen.getByLabelText("Private repository")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("project-import-repository-oleafly/paper"));
    await waitFor(() =>
      expect(importGitHubRepository).toHaveBeenCalledWith(
        expect.objectContaining({ full_name: "oleafly/paper" }),
      ),
    );
  });

  it("returns from the GitHub step to the sources", async () => {
    render(<ProjectImportDialog open onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("project-import-github"));
    await screen.findByText("oleafly/paper");

    fireEvent.click(screen.getByTestId("project-import-back"));

    expect(screen.getByTestId("project-import-word")).toBeInTheDocument();
    expect(screen.queryByText("oleafly/paper")).not.toBeInTheDocument();
  });

  it("asks for the project type when the registry offers several targets", async () => {
    vi.mocked(pickOpenPath).mockResolvedValue("/tmp/paper.html");
    render(<ProjectImportDialog open onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("project-import-html"));

    expect(await screen.findByTestId("project-import-target-latex")).toBeInTheDocument();
    expect(screen.getByTestId("project-import-target-typst")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("project-import-target-typst"));

    await waitFor(() =>
      expect(importSelectedFile).toHaveBeenCalledWith("/tmp/paper.html", "typst"),
    );
  });

  it("imports an arXiv paper by id", async () => {
    render(<ProjectImportDialog open onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("project-import-arxiv"));
    fireEvent.change(screen.getByTestId("project-import-arxiv-id"), {
      target: { value: "2301.01234" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Import/ }));

    await waitFor(() => expect(importArxivPaper).toHaveBeenCalledWith("2301.01234"));
  });

  it("offers the Settings route when GitHub is not connected", () => {
    githubState.status = "disconnected";
    render(<ProjectImportDialog open onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("project-import-github"));

    expect(screen.getByRole("button", { name: /Connect GitHub/ })).toBeInTheDocument();
    expect(importGitHubRepository).not.toHaveBeenCalled();
  });
});


describe("import recovery", () => {
  it("keeps an arXiv error and input available for retry", async () => {
    vi.mocked(importArxivPaper).mockRejectedValueOnce(new Error("Source download failed"));
    const onClose = vi.fn();
    render(<ProjectImportDialog open initialView="arxiv" onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("arXiv id or paper link"), { target: { value: "2301.01234" } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Source download failed");
    expect(screen.getByLabelText("arXiv id or paper link")).toHaveValue("2301.01234");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
  it("ignores repeated Enter submissions while an import is running", async () => {
    let finish!: (value: boolean) => void;
    vi.mocked(importArxivPaper).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const onClose = vi.fn();
    render(<ProjectImportDialog open initialView="arxiv" onClose={onClose} />);
    const input = screen.getByLabelText("arXiv id or paper link");
    fireEvent.change(input, { target: { value: "2301.01234" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(importArxivPaper).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    finish(true);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
  it("reports file-picker failure and allows another attempt", async () => {
    vi.mocked(pickOpenPath).mockRejectedValueOnce(new Error("File picker unavailable"));
    render(<ProjectImportDialog open onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("project-import-project"));
    expect(await screen.findByRole("alert")).toHaveTextContent("File picker unavailable");
    expect(importSelectedFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("project-import-project"));
    await waitFor(() => expect(importSelectedFile).toHaveBeenCalledOnce());
  });
  it("keeps the selected file and target choices when conversion cannot start", async () => {
    vi.mocked(pickOpenPath).mockResolvedValueOnce("/tmp/paper.html");
    vi.mocked(importSelectedFile).mockResolvedValueOnce(false);
    const onClose = vi.fn();
    render(<ProjectImportDialog open onClose={onClose} />);
    fireEvent.click(screen.getByTestId("project-import-html"));
    fireEvent.click(await screen.findByTestId("project-import-target-typst"));
    expect(await screen.findByRole("alert")).toHaveTextContent("converter is unavailable");
    expect(screen.getByText("paper.html")).toBeInTheDocument();
    expect(screen.getByTestId("project-import-target-typst")).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
