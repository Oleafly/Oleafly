// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ForgeAccount, ForgeRepo, ForgeRepoPage } from "@/lib/tauri";

const tauriMocks = vi.hoisted(() => ({
  forgeListRepos: vi.fn(),
  forgeImportRepo: vi.fn(),
  gitCloneProject: vi.fn(),
}));

const forgeState = vi.hoisted(() => ({
  status: "ready" as "idle" | "loading" | "ready" | "error",
  accounts: [] as ForgeAccount[],
  ensureLoaded: vi.fn(async () => [] as ForgeAccount[]),
}));

vi.mock("@/store/forge-accounts", () => ({
  useForgeAccountsStore: Object.assign(
    (selector: (state: typeof forgeState) => unknown) => selector(forgeState),
    { getState: () => forgeState },
  ),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  forgeListRepos: tauriMocks.forgeListRepos,
  forgeImportRepo: tauriMocks.forgeImportRepo,
  gitCloneProject: tauriMocks.gitCloneProject,
}));

vi.mock("@/features/project-import", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/project-import")>(),
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

vi.mock("@/lib/system-browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/system-browser")>()),
  openInSystemBrowser: vi.fn(async () => true),
}));
vi.mock("@tauri-apps/api/event", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/event")>()),
  emit: vi.fn(async () => {}),
}));
vi.mock("@/lib/overleaf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf")>()),
  overleafStatus: vi.fn(async () => ({ server: "https://www.overleaf.com", signedIn: false, email: null })),
}));
vi.mock("@/lib/toast", () => ({ notifyError: vi.fn(), toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/features/custom-templates", () => ({
  saveProjectTemplate: vi.fn(async () => "imported-template"),
  announceSavedTemplate: vi.fn(),
}));

import {
  importArxivPaper,
  importSelectedFile,
} from "@/features/project-import";
import { allowRadixSelect, chooseOption } from "@/features/collab/tests/select";
import { pickOpenPath } from "@/lib/native-file-dialog";
import { notifyError, toast } from "@/lib/toast";
import { openInSystemBrowser as openExternal } from "@/lib/system-browser";
import { emit } from "@tauri-apps/api/event";
import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };
import enLibrary from "@/i18n/locales/en/library.json" with { type: "json" };
import { useSettingsStore } from "@/store/settings";
import { CHOICE_ART } from "./choice-art";
import { ProjectImportDialog } from "./ProjectImportDialog";
import { announceSavedTemplate, saveProjectTemplate } from "@/features/custom-templates";
import { useFilesStore } from "@/store/files";

const githubAccount: ForgeAccount = {
  base: "https://github.com",
  kind: "github",
  login: "oleafly",
  auth: "oauth",
  addedAt: 1,
};

const gitlabAccount: ForgeAccount = {
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

const GITHUB_REPOS = [
  repository(githubAccount.base, "oleafly/paper"),
  repository(githubAccount.base, "oleafly/notes", true),
];
const GITLAB_REPOS = [repository(gitlabAccount.base, "group/sub/paper", true)];

const filesActions = {
  refreshProjects: vi.fn(async () => {}),
  openProject: vi.fn(async (_projectId: string) => {}),
};

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{{${name}}}`, value), template);
}

const LOCAL_CARDS = [
  ["project-import-project", CHOICE_ART.importArchive, "Existing project", "A .zip archive of a project folder."],
  ["project-import-word", CHOICE_ART.importWord, "Word document", "A .docx file, converted on the way in."],
  ["project-import-markdown", CHOICE_ART.importMarkdown, "Markdown document", "A .md file, converted to LaTeX or Typst."],
  ["project-import-html", CHOICE_ART.importHtml, "HTML page", "Convert HTML to LaTeX, Markdown, or Typst."],
  ["project-import-typst", CHOICE_ART.importTypst, "Typst document", "Convert Typst to LaTeX or Markdown."],
] as const;
const CLOUD_CARDS = [
  ["project-import-arxiv", CHOICE_ART.importArxiv, "arXiv paper", "Download a paper's LaTeX source by its arXiv id."],
  ["project-import-git", CHOICE_ART.importGithub, "Git repository", "Pick from your repositories or clone one by address."],
  ["project-import-overleaf", CHOICE_ART.importOverleaf, "Overleaf", "Pick projects from your Overleaf account"],
] as const;
const ALL_CARDS = [...LOCAL_CARDS, ...CLOUD_CARDS];

function section(heading: string): HTMLElement {
  const element = screen.getByRole("heading", { name: heading }).closest("section");
  if (!element) throw new Error(`no section for ${heading}`);
  return element;
}

beforeEach(() => {
  vi.clearAllMocks();
  forgeState.status = "ready";
  forgeState.accounts = [githubAccount];
  tauriMocks.forgeListRepos
    .mockReset()
    .mockImplementation(async (base: string) => page(base === gitlabAccount.base ? GITLAB_REPOS : GITHUB_REPOS));
  tauriMocks.forgeImportRepo.mockReset().mockResolvedValue("imported-repository");
  tauriMocks.gitCloneProject.mockReset().mockResolvedValue("cloned-repository");
  useFilesStore.setState({
    refreshProjects: filesActions.refreshProjects,
    openProject: filesActions.openProject,
  });
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

  it("lists repositories behind the Git step and imports the chosen one", async () => {
    const onClose = vi.fn();
    render(<ProjectImportDialog open onClose={onClose} />);
    expect(screen.queryByText("oleafly/paper")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("project-import-git"));

    expect(await screen.findByText("oleafly/paper")).toBeInTheDocument();
    expect(screen.getByLabelText("Private repository")).toBeInTheDocument();
    expect(tauriMocks.forgeListRepos).toHaveBeenCalledWith("https://github.com", 1, null);
    expect(screen.queryByTestId("project-import-account")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("project-import-repository-oleafly/paper"));
    await waitFor(() =>
      expect(tauriMocks.forgeImportRepo).toHaveBeenCalledWith("https://github.com", "oleafly/paper"),
    );
    await waitFor(() => expect(filesActions.openProject).toHaveBeenCalledWith("imported-repository"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("imports a nested GitLab repository from the picked account", async () => {
    allowRadixSelect();
    forgeState.accounts = [githubAccount, gitlabAccount];
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ProjectImportDialog open onClose={onClose} />);

    await user.click(screen.getByTestId("project-import-git"));
    expect(await screen.findByText("oleafly/paper")).toBeInTheDocument();
    await chooseOption(user, enLibrary.import.accountLabel, "GitLab · zoe");

    await user.click(await screen.findByTestId("project-import-repository-group/sub/paper"));

    await waitFor(() =>
      expect(tauriMocks.forgeImportRepo).toHaveBeenCalledWith("https://gitlab.com", "group/sub/paper"),
    );
    expect(tauriMocks.forgeListRepos).toHaveBeenCalledWith("https://gitlab.com", 1, null);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("clones a repository by its address", async () => {
    const onClose = vi.fn();
    render(<ProjectImportDialog open onClose={onClose} />);
    fireEvent.click(screen.getByTestId("project-import-git"));

    const address = await screen.findByTestId("project-import-clone-url");
    expect(screen.getByTestId("project-import-clone")).toBeDisabled();
    fireEvent.change(address, { target: { value: "git@gitlab.com:g/sub/paper.git" } });
    fireEvent.click(screen.getByTestId("project-import-clone"));

    await waitFor(() =>
      expect(tauriMocks.gitCloneProject).toHaveBeenCalledWith("git@gitlab.com:g/sub/paper.git"),
    );
    await waitFor(() => expect(filesActions.openProject).toHaveBeenCalledWith("cloned-repository"));
    expect(filesActions.refreshProjects).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("refuses an address that carries a password", async () => {
    render(<ProjectImportDialog open onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("project-import-git"));

    fireEvent.change(await screen.findByTestId("project-import-clone-url"), {
      target: { value: "https://me:hunter22@gitlab.com/g/paper.git" },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(enErrors.git.remote_has_password);
    expect(screen.getByTestId("project-import-clone")).toBeDisabled();
    fireEvent.keyDown(screen.getByTestId("project-import-clone-url"), { key: "Enter" });
    expect(tauriMocks.gitCloneProject).not.toHaveBeenCalled();
  });

  it("opens the Overleaf step from its card and from the menu's initial view", async () => {
    const { unmount } = render(<ProjectImportDialog open onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("project-import-overleaf"));
    expect(await screen.findByTestId("overleaf-sign-in-panel")).toBeInTheDocument();
    expect(screen.getByTestId("project-import-dialog")).toHaveTextContent("Import from Overleaf");
    unmount();

    render(<ProjectImportDialog open initialView="overleaf" onClose={vi.fn()} />);
    expect(await screen.findByTestId("overleaf-sign-in-panel")).toBeInTheDocument();
  });

  it("returns from the Git step to the sources", async () => {
    render(<ProjectImportDialog open onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("project-import-git"));
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
});


describe("ProjectImportDialog source cards", () => {
  it("lists the local sources, then the cloud ones, in keyboard order", () => {
    render(<ProjectImportDialog open onClose={vi.fn()} />);

    const testIds = (container: HTMLElement) =>
      within(container).getAllByRole("button").map((button) => button.dataset.testid);
    expect(testIds(section("On this computer"))).toEqual(LOCAL_CARDS.map(([testId]) => testId));
    expect(testIds(section("From the cloud"))).toEqual(CLOUD_CARDS.map(([testId]) => testId));
    expect(
      testIds(screen.getByTestId("project-import-dialog")).filter((testId) => testId !== undefined),
    ).toEqual(ALL_CARDS.map(([testId]) => testId));
  });

  it("gives every source its own decorative picture", () => {
    render(<ProjectImportDialog open onClose={vi.fn()} />);

    for (const [testId, picture] of ALL_CARDS) {
      const image = screen.getByTestId(testId).querySelector("img");
      expect(image).toHaveAttribute("src", picture);
      expect(image).toHaveAttribute("alt", "");
      expect(image).toHaveAttribute("aria-hidden", "true");
    }
    expect(new Set(ALL_CARDS.map(([, picture]) => picture)).size).toBe(ALL_CARDS.length);
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("names each card by its title and describes it by its description", () => {
    render(<ProjectImportDialog open onClose={vi.fn()} />);

    for (const [testId, , title, description] of ALL_CARDS) {
      const card = screen.getByTestId(testId);
      expect(card).toHaveAccessibleName(expect.stringContaining(title));
      expect(card).toHaveAccessibleDescription(description);
    }
  });

  it("tells a user without accounts that cloning still works", () => {
    forgeState.accounts = [];
    render(<ProjectImportDialog open onClose={vi.fn()} />);

    const git = screen.getByTestId("project-import-git");
    expect(git).toBeEnabled();
    expect(git).toHaveAccessibleDescription(enLibrary.import.gitDisconnected);
    expect(forgeState.ensureLoaded).toHaveBeenCalled();
  });

  it("disables every card while the file picker is open and spins only on the chosen card", async () => {
    let answer!: (path: string | null) => void;
    vi.mocked(pickOpenPath).mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    render(<ProjectImportDialog open onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("project-import-word"));

    expect(await screen.findByRole("status")).toHaveTextContent("Importing your project");
    for (const [testId] of ALL_CARDS) {
      expect(screen.getByTestId(testId)).toBeDisabled();
      if (testId === "project-import-word") {
        expect(screen.getByTestId(testId)).toHaveAttribute("aria-busy", "true");
      } else {
        expect(screen.getByTestId(testId)).not.toHaveAttribute("aria-busy");
      }
    }

    answer(null);

    await waitFor(() => expect(screen.getByTestId("project-import-word")).toBeEnabled());
    expect(screen.getByTestId("project-import-word")).not.toHaveAttribute("aria-busy");
    expect(importSelectedFile).not.toHaveBeenCalled();
  });

  it("keeps the chosen card spinning while its file imports", async () => {
    let finish!: () => void;
    vi.mocked(pickOpenPath).mockResolvedValueOnce("/tmp/paper.docx");
    vi.mocked(importSelectedFile).mockReturnValueOnce(new Promise((resolve) => { finish = () => resolve(true); }));
    const onClose = vi.fn();
    render(<ProjectImportDialog open onClose={onClose} />);

    fireEvent.click(screen.getByTestId("project-import-word"));

    await waitFor(() => expect(importSelectedFile).toHaveBeenCalledWith("/tmp/paper.docx"));
    expect(screen.getByTestId("project-import-word")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("project-import-git")).not.toHaveAttribute("aria-busy");

    finish();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.getByTestId("project-import-word")).not.toHaveAttribute("aria-busy");
  });

  it("opens straight on the arXiv step and goes back to the cards", () => {
    render(<ProjectImportDialog open initialView="arxiv" onClose={vi.fn()} />);

    expect(screen.getByTestId("project-import-arxiv-id")).toBeInTheDocument();
    expect(screen.queryByTestId("project-import-project")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("project-import-back"));

    expect(screen.queryByTestId("project-import-arxiv-id")).not.toBeInTheDocument();
    for (const [testId] of ALL_CARDS) expect(screen.getByTestId(testId)).toBeEnabled();
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
  it("explains a refused repository import instead of showing the raw error", async () => {
    tauriMocks.forgeImportRepo.mockRejectedValueOnce(
      '@oleafly/error:{"code":"git.nested_repository","params":{}}',
    );
    const onClose = vi.fn();
    render(<ProjectImportDialog open onClose={onClose} />);
    fireEvent.click(screen.getByTestId("project-import-git"));
    fireEvent.click(await screen.findByTestId("project-import-repository-oleafly/paper"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("inside another Git repository");
    expect(alert).not.toHaveTextContent("@oleafly/error");
    expect(onClose).not.toHaveBeenCalled();
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

describe("ProjectImportDialog Git step", () => {
  const copy = enLibrary.import;

  it("waits for the accounts before listing repositories", async () => {
    forgeState.status = "loading";
    forgeState.accounts = [];
    render(<ProjectImportDialog open onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("project-import-git"));

    expect(await screen.findByText(copy.loadingRepositories)).toBeInTheDocument();
    expect(forgeState.ensureLoaded).toHaveBeenCalled();
    expect(tauriMocks.forgeListRepos).not.toHaveBeenCalled();
    expect(screen.getByTestId("project-import-clone-url")).toBeEnabled();
  });

  it("explains a failed repository list and loads it again", async () => {
    tauriMocks.forgeListRepos.mockRejectedValueOnce(new Error("rate limited"));
    render(<ProjectImportDialog open onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("project-import-git"));

    expect(await screen.findByRole("alert")).toHaveTextContent(copy.repositoriesFailed);
    fireEvent.click(screen.getByRole("button", { name: copy.tryAgain }));

    expect(await screen.findByText("oleafly/paper")).toBeInTheDocument();
    expect(tauriMocks.forgeListRepos).toHaveBeenCalledTimes(2);
  });

  it("says when the account has no repositories", async () => {
    tauriMocks.forgeListRepos.mockResolvedValueOnce(page([]));
    render(<ProjectImportDialog open onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("project-import-git"));

    expect(await screen.findByText(enLibrary.github.noRepositories)).toBeInTheDocument();
  });

  it("opens a repository on its host and reports a failure to open it", async () => {
    vi.mocked(openExternal).mockResolvedValueOnce(false);
    render(<ProjectImportDialog open onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("project-import-git"));

    fireEvent.click(
      await screen.findByRole("button", {
        name: fill(copy.openRepositoryOnHost, { name: "oleafly/paper", host: "GitHub" }),
      }),
    );

    expect(openExternal).toHaveBeenCalledWith("https://github.com/oleafly/paper");
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(fill(copy.openFailed, { host: "GitHub" })),
    );
    expect(tauriMocks.forgeImportRepo).not.toHaveBeenCalled();
  });

  it("cancels a running clone from the dialog without reporting an error", async () => {
    let fail!: (error: unknown) => void;
    tauriMocks.gitCloneProject.mockReturnValueOnce(new Promise((_, reject) => { fail = reject; }));
    const onClose = vi.fn();
    render(<ProjectImportDialog open onClose={onClose} />);
    fireEvent.click(screen.getByTestId("project-import-git"));
    fireEvent.change(await screen.findByTestId("project-import-clone-url"), {
      target: { value: "https://gitlab.com/g/paper.git" },
    });
    fireEvent.click(screen.getByTestId("project-import-clone"));

    fireEvent.click(await screen.findByTestId("project-import-cancel"));
    expect(emit).toHaveBeenCalledWith("import-cancel");
    expect(onClose).not.toHaveBeenCalled();

    fail('@oleafly/error:{"code":"git.import_cancelled","params":{}}');
    await waitFor(() => expect(screen.queryByTestId("project-import-cancel")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("project-import-clone-url")).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closing the dialog during a repository import cancels it", async () => {
    tauriMocks.forgeImportRepo.mockReturnValueOnce(new Promise(() => {}));
    const onClose = vi.fn();
    render(<ProjectImportDialog open onClose={onClose} />);
    fireEvent.click(screen.getByTestId("project-import-git"));
    fireEvent.click(await screen.findByTestId("project-import-repository-oleafly/paper"));
    await screen.findByTestId("project-import-cancel");

    fireEvent.keyDown(screen.getByTestId("project-import-dialog"), { key: "Escape" });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(emit).toHaveBeenCalledWith("import-cancel");
  });

  it("keeps a file import open while it runs, with no way to cancel it", async () => {
    let finish!: () => void;
    vi.mocked(pickOpenPath).mockResolvedValueOnce("/tmp/paper.docx");
    vi.mocked(importSelectedFile).mockReturnValueOnce(new Promise((resolve) => { finish = () => resolve(true); }));
    const onClose = vi.fn();
    render(<ProjectImportDialog open onClose={onClose} />);
    fireEvent.click(screen.getByTestId("project-import-word"));
    await waitFor(() => expect(importSelectedFile).toHaveBeenCalled());

    expect(screen.queryByTestId("project-import-cancel")).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("project-import-dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();

    finish();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("points to Git hosting settings when no account is connected", async () => {
    forgeState.accounts = [];
    const onClose = vi.fn();
    render(<ProjectImportDialog open onClose={onClose} />);
    fireEvent.click(screen.getByTestId("project-import-git"));

    expect(await screen.findByText(copy.connectPromptGit)).toBeInTheDocument();
    expect(tauriMocks.forgeListRepos).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: copy.connectGitHosting }));

    expect(useSettingsStore.getState()).toMatchObject({
      settingsOpen: true,
      settingsInitialSection: "integrations",
      settingsScrollTarget: "git-hosting",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens straight on the Git step from the menu", async () => {
    render(<ProjectImportDialog open initialView="git" onClose={vi.fn()} />);

    expect(await screen.findByTestId("project-import-clone-url")).toBeInTheDocument();
    expect(screen.getByTestId("project-import-dialog")).toHaveTextContent(copy.gitTitle);
    expect(screen.queryByTestId("project-import-project")).not.toBeInTheDocument();
  });
});

describe("ProjectImportDialog file errors", () => {
  it("rejects a file type it cannot import", async () => {
    vi.mocked(pickOpenPath).mockResolvedValue("/tmp/picture.png");
    render(<ProjectImportDialog open onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("project-import-project"));

    expect(await screen.findByText(enLibrary.import.supportedTypes)).toBeInTheDocument();
    expect(importSelectedFile).not.toHaveBeenCalled();
  });

  it("shows the generic failure for an error without a message", async () => {
    vi.mocked(importSelectedFile).mockRejectedValueOnce({ code: 3 });
    render(<ProjectImportDialog open onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("project-import-project"));

    expect(await screen.findByText(enLibrary.import.failed)).toBeInTheDocument();
  });

  it("closes from Escape when nothing is importing", () => {
    const onClose = vi.fn();
    render(<ProjectImportDialog open onClose={onClose} />);

    fireEvent.keyDown(screen.getByTestId("project-import-dialog"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ProjectImportDialog also saves as a template", () => {
  const openImported = () => {
    useFilesStore.setState({ projectId: "imported-1", projectName: "Imported paper" });
  };

  beforeEach(() => {
    useFilesStore.setState({ projectId: null, projectName: "" });
  });

  it("is off each time the dialog opens and saves nothing then", async () => {
    vi.mocked(importSelectedFile).mockImplementation(async () => {
      openImported();
      return true;
    });
    render(<ProjectImportDialog open onClose={vi.fn()} />);

    expect(screen.getByTestId("project-import-also-template")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(enLibrary.customTemplates.alsoSaveHint)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("project-import-project"));

    await waitFor(() => expect(importSelectedFile).toHaveBeenCalled());
    expect(saveProjectTemplate).not.toHaveBeenCalled();
  });

  it("keeps the imported project as a template when ticked", async () => {
    vi.mocked(importSelectedFile).mockImplementation(async () => {
      openImported();
      return true;
    });
    const onClose = vi.fn();
    render(<ProjectImportDialog open onClose={onClose} />);

    fireEvent.click(screen.getByTestId("project-import-also-template"));
    expect(screen.getByTestId("project-import-also-template")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByTestId("project-import-project"));

    await waitFor(() =>
      expect(saveProjectTemplate).toHaveBeenCalledWith("imported-1", "Imported paper"),
    );
    expect(onClose).toHaveBeenCalled();
    await waitFor(() =>
      expect(announceSavedTemplate).toHaveBeenCalledWith("imported-template", "Imported paper"),
    );
  });

  it("reports a template that could not be saved without undoing the import", async () => {
    vi.mocked(importArxivPaper).mockImplementation(async () => {
      openImported();
      return true;
    });
    vi.mocked(saveProjectTemplate).mockRejectedValueOnce(new Error("disk full"));
    render(<ProjectImportDialog open onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("project-import-also-template"));
    fireEvent.click(screen.getByTestId("project-import-arxiv"));
    fireEvent.change(screen.getByTestId("project-import-arxiv-id"), {
      target: { value: "2301.01234" },
    });
    fireEvent.keyDown(screen.getByTestId("project-import-arxiv-id"), { key: "Enter" });

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith(
        "save the import as a template",
        expect.any(Error),
        enLibrary.customTemplates.saveFailed,
      ),
    );
    expect(announceSavedTemplate).not.toHaveBeenCalled();
  });

  it("saves nothing when the import did not open a new project", async () => {
    useFilesStore.setState({ projectId: "already-open", projectName: "Open one" });
    vi.mocked(importSelectedFile).mockResolvedValue(true);
    render(<ProjectImportDialog open onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("project-import-also-template"));
    fireEvent.click(screen.getByTestId("project-import-project"));

    await waitFor(() => expect(importSelectedFile).toHaveBeenCalled());
    await Promise.resolve();
    expect(saveProjectTemplate).not.toHaveBeenCalled();
  });
});
