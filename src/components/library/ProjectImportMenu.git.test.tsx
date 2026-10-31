// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ForgeAccount, ForgeRepo, ForgeRepoPage } from "@/lib/tauri";

const forgeListRepos = vi.fn(async (_base: string, _page: number, _query: string | null) => page([]));
const importForgeRepository = vi.fn(async () => {});
const importSelectedFile = vi.fn(async () => true);
const pickOpenPath = vi.fn(async () => null as unknown);
const openExternal = vi.fn(async () => {});
const notifyError = vi.fn();

const forgeState = vi.hoisted(() => ({
  status: "ready" as "idle" | "loading" | "ready" | "error",
  accounts: [] as ForgeAccount[],
  error: null as string | null,
  ensureLoaded: vi.fn(async () => [] as ForgeAccount[]),
  reload: vi.fn(async () => [] as ForgeAccount[]),
}));

vi.mock("@/store/forge-accounts", () => ({
  useForgeAccountsStore: Object.assign(
    (selector: (state: typeof forgeState) => unknown) => selector(forgeState),
    { getState: () => forgeState },
  ),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  forgeListRepos: (...args: unknown[]) => forgeListRepos(...(args as [string, number, string | null])),
}));

vi.mock("@/features/project-import", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/project-import")>()),
  importForgeRepository: (...args: unknown[]) =>
    importForgeRepository(...(args as [])),
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
import { useSettingsStore } from "@/store/settings";

const GITHUB_ACCOUNT: ForgeAccount = {
  base: "https://github.com",
  kind: "github",
  login: "octocat",
  auth: "oauth",
  addedAt: 1,
};

const GITLAB_ACCOUNT: ForgeAccount = {
  base: "https://gitlab.com",
  kind: "gitlab",
  login: "zoe",
  auth: "token",
  addedAt: 2,
};

function repository(base: string, fullName: string, isPrivate = false): ForgeRepo {
  return {
    id: fullName,
    fullName,
    name: fullName.split("/").pop() ?? fullName,
    webUrl: `${base}/${fullName}`,
    cloneUrl: `${base}/${fullName}.git`,
    private: isPrivate,
    defaultBranch: "main",
  };
}

function page(repos: ForgeRepo[]): ForgeRepoPage {
  return { repos, nextPage: null, searched: false };
}

const PUBLIC_REPO = repository(GITHUB_ACCOUNT.base, "octocat/hello-world");
const PRIVATE_REPO = repository(GITHUB_ACCOUNT.base, "octocat/secret", true);
const NESTED_REPO = repository(GITLAB_ACCOUNT.base, "group/sub/paper", true);

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{{${name}}}`, value), template);
}

const openOnGitHub = (repo: ForgeRepo) =>
  fill(enLibrary.import.openRepositoryOnHost, { name: repo.fullName, host: "GitHub" });

const onImportSelected = vi.fn();
const triggerLabel = "open-import";

function renderMenu() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProjectImportMenu
        onImportSelected={onImportSelected}
        trigger={(busy) => (
          <button type="button" aria-label={triggerLabel} data-busy={busy}>
            <span>{triggerLabel}</span>
          </button>
        )}
      />
    </QueryClientProvider>,
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

function openGitSubmenu() {
  openSubmenu("import-git");
}

beforeEach(() => {
  forgeState.status = "ready";
  forgeState.accounts = [GITHUB_ACCOUNT];
  forgeState.error = null;
  forgeState.ensureLoaded.mockClear();
  forgeState.reload.mockClear();
  forgeListRepos.mockReset();
  forgeListRepos.mockResolvedValue(page([]));
  importForgeRepository.mockReset();
  importSelectedFile.mockReset();
  importSelectedFile.mockResolvedValue(true);
  pickOpenPath.mockReset();
  pickOpenPath.mockResolvedValue(null);
  openExternal.mockReset();
  notifyError.mockReset();
  onImportSelected.mockReset();
  useSettingsStore.setState({ settingsOpen: false, settingsScrollTarget: null });
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

describe("ProjectImportMenu Git submenu", () => {
  it("names the submenu after Git, not a single host", () => {
    renderMenu();
    openMenu();
    expect(screen.getByTestId("import-git")).toHaveTextContent(enLibrary.import.menu.git);
  });

  it("lists repositories and imports the selected one", async () => {
    forgeListRepos.mockResolvedValue(page([PUBLIC_REPO, PRIVATE_REPO]));
    renderMenu();
    openGitSubmenu();
    expect(await screen.findByText(PUBLIC_REPO.fullName)).toBeInTheDocument();
    expect(screen.getByText("GitHub · octocat")).toBeInTheDocument();
    expect(
      screen.getByLabelText(enLibrary.import.privateRepository),
    ).toBeInTheDocument();
    expect(forgeState.ensureLoaded).toHaveBeenCalled();
    expect(forgeListRepos).toHaveBeenCalledWith(GITHUB_ACCOUNT.base, 1, null);

    fireEvent.click(screen.getByText(PUBLIC_REPO.fullName));
    await waitFor(() =>
      expect(importForgeRepository).toHaveBeenCalledWith(GITHUB_ACCOUNT.base, PUBLIC_REPO),
    );
    await waitFor(() => expect(onImportSelected).toHaveBeenCalledTimes(1));
  });

  it("lists repositories for every connected account", async () => {
    forgeState.accounts = [GITHUB_ACCOUNT, GITLAB_ACCOUNT];
    forgeListRepos.mockImplementation(async (base: string) =>
      page(base === GITLAB_ACCOUNT.base ? [NESTED_REPO] : [PUBLIC_REPO]),
    );
    renderMenu();
    openGitSubmenu();

    expect(await screen.findByText(PUBLIC_REPO.fullName)).toBeInTheDocument();
    expect(await screen.findByText(NESTED_REPO.fullName)).toBeInTheDocument();
    expect(screen.getByText("GitHub · octocat")).toBeInTheDocument();
    expect(screen.getByText("GitLab · zoe")).toBeInTheDocument();
    expect(forgeListRepos).toHaveBeenCalledWith(GITHUB_ACCOUNT.base, 1, null);
    expect(forgeListRepos).toHaveBeenCalledWith(GITLAB_ACCOUNT.base, 1, null);

    fireEvent.click(screen.getByTestId(`import-git-repository-${NESTED_REPO.fullName}`));
    await waitFor(() =>
      expect(importForgeRepository).toHaveBeenCalledWith(GITLAB_ACCOUNT.base, NESTED_REPO),
    );
  });

  it("keeps the menu to thirty repositories per account and leaves the rest to the dialog", async () => {
    const many = Array.from({ length: 35 }, (_, index) =>
      repository(GITHUB_ACCOUNT.base, `octocat/paper-${index + 1}`),
    );
    forgeListRepos.mockResolvedValue(page(many));
    renderMenu();
    openGitSubmenu();

    expect(await screen.findByText("octocat/paper-30")).toBeInTheDocument();
    expect(screen.queryByText("octocat/paper-31")).toBeNull();

    fireEvent.click(screen.getByTestId("import-git-more"));

    const dialog = await screen.findByTestId("project-import-dialog");
    expect(dialog).toHaveTextContent(enLibrary.import.gitTitle);
    expect(await within(dialog).findByText("octocat/paper-35")).toBeInTheDocument();
  });

  it("opens the clone view from the menu", async () => {
    renderMenu();
    openGitSubmenu();

    fireEvent.click(await screen.findByTestId("import-clone"));

    expect(await screen.findByTestId("project-import-clone-url")).toBeInTheDocument();
    expect(screen.getByTestId("project-import-dialog")).toHaveTextContent(enLibrary.import.gitTitle);
  });

  it("reports an empty repository list", async () => {
    renderMenu();
    openGitSubmenu();
    expect(
      await screen.findByText(enLibrary.import.noRepositories),
    ).toBeInTheDocument();
  });

  it("reports a failed repository listing", async () => {
    forgeListRepos.mockRejectedValue(new Error("rate limited"));
    renderMenu();
    openGitSubmenu();
    expect(
      await screen.findByText(enLibrary.import.menu.repositoriesRetry),
    ).toBeInTheDocument();
  });

  it("waits for the accounts before listing repositories", async () => {
    forgeState.status = "loading";
    forgeState.accounts = [];
    renderMenu();
    openGitSubmenu();
    expect(
      await screen.findByText(enLibrary.import.loadingRepositories),
    ).toBeInTheDocument();
    expect(forgeState.ensureLoaded).toHaveBeenCalled();
    expect(forgeListRepos).not.toHaveBeenCalled();
  });

  it("offers Git hosting settings and cloning when no account is connected", async () => {
    forgeState.accounts = [];
    renderMenu();
    openGitSubmenu();
    expect(await screen.findByTestId("import-clone")).toHaveTextContent(enLibrary.import.menu.clone);
    fireEvent.click(screen.getByTestId("import-git-connect"));
    await waitFor(() =>
      expect(useSettingsStore.getState().settingsOpen).toBe(true),
    );
    expect(useSettingsStore.getState().settingsInitialSection).toBe("integrations");
    expect(useSettingsStore.getState().settingsScrollTarget).toBe("git-hosting");
    expect(onImportSelected).toHaveBeenCalledTimes(1);
    expect(forgeListRepos).not.toHaveBeenCalled();
  });

  it("says the accounts couldn't load and offers to try again, instead of asking to connect one", async () => {
    forgeState.status = "error";
    forgeState.accounts = [];
    forgeState.error = "forge-accounts.json is locked.";
    renderMenu();
    openGitSubmenu();

    expect(await screen.findByRole("alert")).toHaveTextContent("forge-accounts.json is locked.");
    expect(screen.queryByTestId("import-git-connect")).toBeNull();
    expect(screen.getByTestId("import-clone")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("import-git-accounts-retry"));
    await waitFor(() => expect(forgeState.reload).toHaveBeenCalledTimes(1));
  });

  it("keeps the listed repositories for a few minutes instead of asking each time the menu opens", async () => {
    forgeState.accounts = [GITHUB_ACCOUNT, GITLAB_ACCOUNT];
    forgeListRepos.mockImplementation(async (base: string) =>
      page(base === GITLAB_ACCOUNT.base ? [NESTED_REPO] : [PUBLIC_REPO]),
    );
    renderMenu();
    const closeMenu = async () => {
      fireEvent.keyDown(document.body, { key: "Escape" });
      fireEvent.keyDown(document.body, { key: "Escape" });
      await waitFor(() => expect(screen.queryByText(PUBLIC_REPO.fullName)).toBeNull());
    };

    openGitSubmenu();
    expect(await screen.findByText(NESTED_REPO.fullName)).toBeInTheDocument();
    await closeMenu();
    openGitSubmenu();
    expect(await screen.findByText(PUBLIC_REPO.fullName)).toBeInTheDocument();
    expect(screen.getByText(NESTED_REPO.fullName)).toBeInTheDocument();
    expect(forgeListRepos).toHaveBeenCalledTimes(2);
    await closeMenu();

    const later = Date.now() + 5 * 60_000 + 1;
    const clock = vi.spyOn(Date, "now").mockReturnValue(later);
    try {
      openGitSubmenu();
      expect(await screen.findByText(PUBLIC_REPO.fullName)).toBeInTheDocument();
      await waitFor(() => expect(forgeListRepos).toHaveBeenCalledTimes(4));
    } finally {
      clock.mockRestore();
    }
  });

  it("tries the repository list again from the menu", async () => {
    forgeListRepos.mockRejectedValueOnce(new Error("rate limited")).mockResolvedValueOnce(page([PUBLIC_REPO]));
    renderMenu();
    openGitSubmenu();

    fireEvent.click(await screen.findByText(enLibrary.import.menu.repositoriesRetry));

    expect(await screen.findByText(PUBLIC_REPO.fullName)).toBeInTheDocument();
    expect(forgeListRepos).toHaveBeenCalledTimes(2);
  });

  it("reports a repository that could not be imported", async () => {
    forgeListRepos.mockResolvedValue(page([PUBLIC_REPO]));
    importForgeRepository.mockRejectedValue(new Error("clone failed"));
    renderMenu();
    openGitSubmenu();

    fireEvent.click(await screen.findByText(PUBLIC_REPO.fullName));

    await waitFor(() => expect(notifyError).toHaveBeenCalledWith("import Git repository", expect.any(Error)));
    expect(onImportSelected).not.toHaveBeenCalled();
  });

  it("keeps each repository row to the import action, which the keyboard reaches", async () => {
    forgeListRepos.mockResolvedValue(page([PUBLIC_REPO]));
    renderMenu();
    openGitSubmenu();

    const row = await screen.findByTestId(`import-git-repository-${PUBLIC_REPO.fullName}`);
    expect(within(row).queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByLabelText(openOnGitHub(PUBLIC_REPO))).toBeNull();

    fireEvent.click(row);
    await waitFor(() =>
      expect(importForgeRepository).toHaveBeenCalledWith(GITHUB_ACCOUNT.base, PUBLIC_REPO),
    );
    expect(openExternal).not.toHaveBeenCalled();
  });
});
