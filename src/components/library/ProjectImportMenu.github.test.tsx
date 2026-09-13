// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const githubListRepos = vi.fn(async () => [] as GitHubRepo[]);
const importGitHubRepository = vi.fn(async () => {});
const importSelectedFile = vi.fn(async () => true);
const pickOpenPath = vi.fn(async () => null as unknown);
const openExternal = vi.fn(async () => {});
const notifyError = vi.fn();
const refreshGithub = vi.fn(async () => {});

let githubStatus: "unknown" | "connected" | "disconnected" = "connected";

vi.mock("@/store/github", () => ({
  useGithubStore: (selector: (state: unknown) => unknown) =>
    selector({ status: githubStatus, refresh: refreshGithub }),
}));

vi.mock("@/lib/github", () => ({
  githubListRepos: () => githubListRepos(),
}));

vi.mock("@/features/project-import", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/project-import")>()),
  importGitHubRepository: (...args: unknown[]) =>
    importGitHubRepository(...(args as [])),
  importSelectedFile: (...args: unknown[]) =>
    importSelectedFile(...(args as [])),
}));

vi.mock("@/lib/native-file-dialog", () => ({
  pickOpenPath: (...args: unknown[]) => pickOpenPath(...(args as [])),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: (...args: unknown[]) => openExternal(...(args as [])),
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    update: vi.fn(),
    dismiss: vi.fn(),
  },
  notifyError: (...args: unknown[]) => notifyError(...args),
}));

import enLibrary from "@/i18n/locales/en/library.json" with { type: "json" };
import { ProjectImportMenu } from "@/components/library/ProjectImportMenu";
import type { GitHubRepo } from "@/lib/github";
import { useSettingsStore } from "@/store/settings";

const PUBLIC_REPO: GitHubRepo = {
  full_name: "octocat/hello-world",
  html_url: "https://github.com/octocat/hello-world",
  clone_url: "https://github.com/octocat/hello-world.git",
  private: false,
};

const PRIVATE_REPO: GitHubRepo = {
  full_name: "octocat/secret",
  html_url: "https://github.com/octocat/secret",
  clone_url: "https://github.com/octocat/secret.git",
  private: true,
};

const onImportSelected = vi.fn();
const triggerLabel = "open-import";

function renderMenu() {
  return render(
    <ProjectImportMenu
      onImportSelected={onImportSelected}
      trigger={(busy) => (
        <button type="button" aria-label={triggerLabel} data-busy={busy}>
          <span>{triggerLabel}</span>
        </button>
      )}
    />,
  );
}

function openMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: triggerLabel }), {
    button: 0,
    ctrlKey: false,
  });
}

function openSubmenu(testId: string) {
  openMenu();
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
}

async function openGithubSubmenu() {
  openMenu();
  fireEvent.pointerDown(screen.getByText("GitHub"), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(screen.getByText("GitHub"));
}

beforeEach(() => {
  githubStatus = "connected";
  githubListRepos.mockReset();
  githubListRepos.mockResolvedValue([]);
  importGitHubRepository.mockReset();
  importSelectedFile.mockReset();
  importSelectedFile.mockResolvedValue(true);
  pickOpenPath.mockReset();
  pickOpenPath.mockResolvedValue(null);
  openExternal.mockReset();
  notifyError.mockReset();
  refreshGithub.mockReset();
  onImportSelected.mockReset();
  useSettingsStore.setState({ settingsOpen: false });
});

describe("ProjectImportMenu local imports", () => {
  it("imports a chosen project archive", async () => {
    pickOpenPath.mockResolvedValue("/tmp/project.zip");
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByText(enLibrary.import.menu.project));
    await waitFor(() =>
      expect(importSelectedFile).toHaveBeenCalledWith("/tmp/project.zip", undefined),
    );
    expect(onImportSelected).toHaveBeenCalledTimes(1);
    expect(pickOpenPath).toHaveBeenCalledWith(
      expect.objectContaining({
        title: enLibrary.import.picker.projectTitle,
        filters: [expect.objectContaining({
          name: enLibrary.import.picker.projectFilter,
          extensions: ["zip"],
        })],
      }),
    );
  });

  it("imports a chosen Word document into the selected project type", async () => {
    pickOpenPath.mockResolvedValue("/tmp/paper.docx");
    renderMenu();
    openSubmenu("import-kind-word");
    fireEvent.click(screen.getByTestId("import-target-word-latex"));
    await waitFor(() =>
      expect(importSelectedFile).toHaveBeenCalledWith("/tmp/paper.docx", "latex"),
    );
    expect(pickOpenPath).toHaveBeenCalledWith(
      expect.objectContaining({
        title: enLibrary.import.picker.wordTitle,
        filters: [expect.objectContaining({
          name: enLibrary.import.picker.wordFilter,
          extensions: ["docx"],
        })],
      }),
    );
  });

  it("imports a chosen Markdown document into the selected project type", async () => {
    pickOpenPath.mockResolvedValue("/tmp/notes.md");
    renderMenu();
    openSubmenu("import-kind-markdown");
    fireEvent.click(screen.getByTestId("import-target-markdown-typst"));
    await waitFor(() =>
      expect(importSelectedFile).toHaveBeenCalledWith("/tmp/notes.md", "typst"),
    );
    expect(pickOpenPath).toHaveBeenCalledWith(
      expect.objectContaining({
        title: enLibrary.import.picker.markdownTitle,
        filters: [expect.objectContaining({
          name: enLibrary.import.picker.markdownFilter,
          extensions: ["md", "markdown"],
        })],
      }),
    );
  });

  it("does nothing when the picker is dismissed", async () => {
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByText(enLibrary.import.menu.project));
    await waitFor(() => expect(pickOpenPath).toHaveBeenCalledTimes(1));
    expect(importSelectedFile).not.toHaveBeenCalled();
    expect(onImportSelected).not.toHaveBeenCalled();
  });

  it("reports a failed import", async () => {
    pickOpenPath.mockResolvedValue("/tmp/project.zip");
    importSelectedFile.mockRejectedValue(new Error("bad archive"));
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByText(enLibrary.import.menu.project));
    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
  });
});

describe("ProjectImportMenu GitHub submenu", () => {
  it("lists repositories and imports the selected one", async () => {
    githubListRepos.mockResolvedValue([PUBLIC_REPO, PRIVATE_REPO]);
    renderMenu();
    await openGithubSubmenu();
    expect(
      await screen.findByText(PUBLIC_REPO.full_name),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(enLibrary.import.privateRepository),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText(PUBLIC_REPO.full_name));
    await waitFor(() =>
      expect(importGitHubRepository).toHaveBeenCalledWith(PUBLIC_REPO),
    );
  });

  it("opens a repository in the browser without importing it", async () => {
    githubListRepos.mockResolvedValue([PUBLIC_REPO]);
    renderMenu();
    await openGithubSubmenu();
    const link = await screen.findByLabelText(
      enLibrary.import.openRepository.replace(
        "{{name}}",
        PUBLIC_REPO.full_name,
      ),
    );
    fireEvent.pointerDown(link, { button: 0, ctrlKey: false });
    expect(openExternal).toHaveBeenCalledWith(PUBLIC_REPO.html_url);
    expect(importGitHubRepository).not.toHaveBeenCalled();
  });

  it("reports an empty repository list", async () => {
    renderMenu();
    await openGithubSubmenu();
    expect(
      await screen.findByText(enLibrary.import.noRepositories),
    ).toBeInTheDocument();
  });

  it("reports a failed repository listing", async () => {
    githubListRepos.mockRejectedValue(new Error("rate limited"));
    renderMenu();
    await openGithubSubmenu();
    expect(
      await screen.findByText("Could not load repositories. Try again"),
    ).toBeInTheDocument();
  });

  it("refreshes the connection when its status is unknown", async () => {
    githubStatus = "unknown";
    renderMenu();
    await openGithubSubmenu();
    await waitFor(() => expect(refreshGithub).toHaveBeenCalledTimes(1));
    expect(
      screen.getByText(enLibrary.import.loadingRepositories),
    ).toBeInTheDocument();
    expect(githubListRepos).not.toHaveBeenCalled();
  });

  it("offers the settings shortcut when GitHub is disconnected", async () => {
    githubStatus = "disconnected";
    renderMenu();
    await openGithubSubmenu();
    fireEvent.click(
      await screen.findByText(enLibrary.import.menu.connect),
    );
    await waitFor(() =>
      expect(useSettingsStore.getState().settingsOpen).toBe(true),
    );
    expect(useSettingsStore.getState().settingsScrollTarget).toBe("github");
    expect(onImportSelected).toHaveBeenCalledTimes(1);
  });

  it("reports a failure to open a repository page", async () => {
    githubListRepos.mockResolvedValue([PUBLIC_REPO]);
    openExternal.mockRejectedValue(new Error("no browser"));
    renderMenu();
    await openGithubSubmenu();
    const link = await screen.findByLabelText(
      enLibrary.import.openRepository.replace(
        "{{name}}",
        PUBLIC_REPO.full_name,
      ),
    );
    fireEvent.pointerDown(link, { button: 0, ctrlKey: false });
    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
  });
});
