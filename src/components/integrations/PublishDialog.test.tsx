// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };
import enLibrary from "@/i18n/locales/en/library.json" with { type: "json" };
import { allowRadixSelect, chooseOption } from "@/features/collab/tests/select";
import type { ForgeAccount, ForgeRepo, ForgeRepoPage } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { useForgeAccountsStore } from "@/store/forge-accounts";
import { useSettingsStore } from "@/store/settings";
import { PublishDialog } from "./PublishDialog";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const createdRepo: ForgeRepo = {
  id: "1",
  name: "research-notes",
  fullName: "prajwal/research-notes",
  private: true,
  webUrl: "https://github.com/prajwal/research-notes",
  cloneUrl: "https://github.com/prajwal/research-notes.git",
  defaultBranch: "main",
};

const githubAccount: ForgeAccount = {
  base: "https://github.com",
  kind: "github",
  login: "prajwal",
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

function page(repos: ForgeRepo[], nextPage: number | null = null, searched = false): ForgeRepoPage {
  return { repos, nextPage, searched };
}

const mocks = vi.hoisted(() => ({
  gitPreparePublish: vi.fn(),
  gitPublishPreflight: vi.fn(),
  gitPush: vi.fn(),
  gitSetRemote: vi.fn(),
  forgeCreateRepo: vi.fn(),
  forgeListRepos: vi.fn(),
  forgeAccountsList: vi.fn(),
  onForgeAccountsChanged: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

vi.mock("@/lib/tauri", () => ({
  gitPreparePublish: mocks.gitPreparePublish,
  gitPublishPreflight: mocks.gitPublishPreflight,
  gitPush: mocks.gitPush,
  gitSetRemote: mocks.gitSetRemote,
  forgeCreateRepo: mocks.forgeCreateRepo,
  forgeListRepos: mocks.forgeListRepos,
  forgeAccountsList: mocks.forgeAccountsList,
  onForgeAccountsChanged: mocks.onForgeAccountsChanged,
}));

function useAccounts(accounts: ForgeAccount[]) {
  useForgeAccountsStore.setState({ status: "ready", accounts, checks: {}, error: null });
}

beforeEach(() => {
  mocks.gitPreparePublish
    .mockReset()
    .mockResolvedValue({ committed: true, hasCommit: true, leftOut: [] });
  mocks.gitPublishPreflight.mockReset().mockResolvedValue({ trackedSecretFiles: [] });
  mocks.gitPush.mockReset().mockResolvedValue("Pushed");
  mocks.gitSetRemote.mockReset().mockResolvedValue(undefined);
  mocks.forgeCreateRepo.mockReset().mockResolvedValue(createdRepo);
  mocks.forgeListRepos.mockReset().mockResolvedValue(page([]));
  mocks.forgeAccountsList.mockReset().mockResolvedValue([]);
  mocks.onForgeAccountsChanged.mockReset().mockResolvedValue(() => {});
  mocks.logError.mockReset().mockResolvedValue(undefined);
  useAccounts([githubAccount]);
});

afterEach(() => {
  vi.useRealTimers();
});

function renderDialog(
  overrides: Partial<{
    projectId: string;
    projectName: string;
    currentRemote: string | null;
    onClose: () => void;
    onPublished: (remote: string) => void;
  }> = {},
) {
  return render(
    <PublishDialog
      open
      onClose={overrides.onClose ?? vi.fn()}
      projectId={overrides.projectId ?? "project-1"}
      projectName={overrides.projectName ?? "Research notes"}
      currentRemote={overrides.currentRemote ?? null}
      onPublished={overrides.onPublished ?? vi.fn()}
    />,
  );
}

/**
 * The dialog moves the focus to its first control on the next frame. Typing
 * sooner sends the rest of the text to that control.
 */
async function afterInitialFocus() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

describe("PublishDialog", () => {
  it("does not let project A's publish completion update project B's dialog", async () => {
    const projectACreation = deferred<ForgeRepo>();
    mocks.forgeCreateRepo.mockReturnValueOnce(projectACreation.promise);
    const onPublished = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <PublishDialog open onClose={onClose} projectId="project-a" projectName="Project A" onPublished={onPublished} />,
    );

    await user.click(screen.getByRole("button", { name: "Create and push" }));
    expect(screen.getByRole("button", { name: "Create and push" })).toBeDisabled();

    view.rerender(
      <PublishDialog open onClose={onClose} projectId="project-b" projectName="Project B" onPublished={onPublished} />,
    );

    expect(screen.getByRole("button", { name: "Create and push" })).toBeEnabled();

    await act(async () => {
      projectACreation.resolve(createdRepo);
      await projectACreation.promise;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.forgeCreateRepo).toHaveBeenCalledWith("https://github.com", "project-a", true);
    expect(mocks.gitPreparePublish).toHaveBeenCalledWith("project-a", "Initial commit", {
      allowTrackedSecrets: [],
    });
    expect(mocks.gitSetRemote).toHaveBeenCalledWith("project-a", createdRepo.cloneUrl);
    expect(mocks.gitPush).toHaveBeenCalledWith("project-a");
    expect(onPublished).not.toHaveBeenCalled();
    expect(screen.queryByText(/Published to prajwal\/research-notes/)).toBeNull();
  });

  it("does not run project A's delayed close after project B opens", async () => {
    vi.useFakeTimers();
    const publishFinished = deferred<string>();
    mocks.gitPush.mockReturnValueOnce(publishFinished.promise);
    const onClose = vi.fn();
    const view = render(
      <PublishDialog open onClose={onClose} projectId="project-a" projectName="Project A" onPublished={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create and push" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.gitPush).toHaveBeenCalledWith("project-a");

    await act(async () => {
      publishFinished.resolve("Pushed");
      await publishFinished.promise;
      await Promise.resolve();
    });

    view.rerender(
      <PublishDialog open onClose={onClose} projectId="project-b" projectName="Project B" onPublished={vi.fn()} />,
    );
    act(() => vi.advanceTimersByTime(900));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("names the close button", () => {
    const onClose = vi.fn();
    renderDialog({ onClose });

    fireEvent.click(screen.getByRole("button", { name: enCommon.actions.close }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("retries a failed push against the repository it already created", async () => {
    const user = userEvent.setup();
    mocks.gitPush.mockRejectedValueOnce(new Error("network down")).mockResolvedValue("Pushed");
    const onPublished = vi.fn();
    const props = { open: true, onClose: vi.fn(), projectId: "project-1", projectName: "Research notes", onPublished };
    const view = render(<PublishDialog {...props} currentRemote={null} />);

    await user.click(screen.getByRole("button", { name: "Create and push" }));

    expect(await screen.findByText(/network down/)).toBeInTheDocument();
    // The repository exists and is linked, so Source Control is told even
    // though the push failed.
    expect(onPublished).toHaveBeenCalledWith(createdRepo.cloneUrl);

    // Source Control refreshed: the remote is the repository just created.
    view.rerender(<PublishDialog {...props} currentRemote={createdRepo.cloneUrl} />);
    await user.click(screen.getByRole("button", { name: "Create and push" }));

    expect(await screen.findByText(/Published to prajwal\/research-notes/)).toBeInTheDocument();
    expect(mocks.forgeCreateRepo).toHaveBeenCalledTimes(1);
    expect(mocks.gitPush).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Replace that link/)).toBeNull();
  });

  it("still reports a publish that finishes after the dialog was closed", async () => {
    const pushed = deferred<string>();
    mocks.gitPush.mockReturnValueOnce(pushed.promise);
    const success = vi.spyOn(toast, "success").mockReturnValue(1);
    const onPublished = vi.fn();
    const props = { onClose: vi.fn(), projectId: "project-1", projectName: "Research notes", onPublished };
    try {
      const view = render(<PublishDialog open {...props} />);
      fireEvent.click(screen.getByRole("button", { name: "Create and push" }));
      await waitFor(() => expect(mocks.gitPush).toHaveBeenCalledWith("project-1"));

      view.rerender(<PublishDialog open={false} {...props} />);
      await act(async () => {
        pushed.resolve("Pushed");
        await pushed.promise;
      });

      await waitFor(() => expect(onPublished).toHaveBeenCalledWith(createdRepo.cloneUrl));
      expect(success).toHaveBeenCalledWith("Published to prajwal/research-notes.");
    } finally {
      success.mockRestore();
    }
  });

  it("right-aligns the create action at the bottom of the form", () => {
    renderDialog();

    const action = screen.getByRole("button", { name: "Create and push" });
    expect(action).toHaveClass("ml-auto");
    expect(action.parentElement).toHaveClass("mt-auto");
    expect(action).not.toHaveClass("w-full");

    const header = screen.getByRole("heading", { name: "Publish to GitHub" }).parentElement?.parentElement;
    expect(header).not.toHaveClass("border-b");
  });

  it("renders the repository search with a single outer border", async () => {
    const user = userEvent.setup();
    renderDialog();

    const tabs = screen.getByRole("tablist");
    expect(tabs).toHaveClass("rounded-lg", "bg-muted", "p-1");
    expect(tabs.parentElement).toHaveClass("py-2");

    await user.click(screen.getByRole("tab", { name: "Link existing" }));

    const search = screen.getByRole("textbox", { name: "Search repositories" });
    expect(search).toHaveClass("border-0");
    expect(search.parentElement).toHaveClass("border", "focus-within:border-ring");
  });

  it("shows a new search's results from the top of the list", async () => {
    const user = userEvent.setup();
    mocks.forgeListRepos.mockResolvedValue(
      page([createdRepo, { ...createdRepo, id: "2", name: "thesis", fullName: "prajwal/thesis" }]),
    );
    renderDialog();

    await user.click(screen.getByRole("tab", { name: "Link existing" }));
    const list = (await screen.findByText("prajwal/thesis")).closest(".overflow-auto") as HTMLElement;
    list.scrollTop = 240;

    fireEvent.change(screen.getByRole("textbox", { name: "Search repositories" }), {
      target: { value: "thesis" },
    });

    expect(screen.queryByText("prajwal/research-notes")).not.toBeInTheDocument();
    expect(list.scrollTop).toBe(0);
  });

  it("prepares Git only after the user chooses Create and push", async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(mocks.gitPreparePublish).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Create and push" }));

    expect(mocks.gitPreparePublish).toHaveBeenCalledWith("project-1", "Initial commit", {
      allowTrackedSecrets: [],
    });
  });

  it("links the selected repository, pushes, and dismisses itself", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.forgeListRepos.mockResolvedValue(page([createdRepo]));
    const onClose = vi.fn();
    const onPublished = vi.fn();
    renderDialog({ onClose, onPublished });

    await user.click(screen.getByRole("tab", { name: "Link existing" }));
    await user.click(await screen.findByText("prajwal/research-notes"));
    await user.click(screen.getByRole("button", { name: "Link and push" }));

    expect(await screen.findByText(/Linked and pushed to/)).toBeInTheDocument();
    expect(mocks.gitPreparePublish).toHaveBeenCalledWith("project-1", "Initial commit", {
      allowTrackedSecrets: [],
    });
    expect(mocks.gitSetRemote).toHaveBeenCalledWith("project-1", createdRepo.cloneUrl);
    expect(mocks.gitPush).toHaveBeenCalledWith("project-1");
    expect(onPublished).toHaveBeenCalledWith(createdRepo.cloneUrl);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("records the remote but asks for a pull when the first push is rejected", async () => {
    const user = userEvent.setup();
    mocks.forgeListRepos.mockResolvedValue(page([createdRepo]));
    mocks.gitPush.mockRejectedValue(new Error("fetch first"));
    const onClose = vi.fn();
    const onPublished = vi.fn();
    renderDialog({ onClose, onPublished });

    await user.click(screen.getByRole("tab", { name: "Link existing" }));
    await user.click(await screen.findByText("prajwal/research-notes"));
    await user.click(screen.getByRole("button", { name: "Link and push" }));

    expect(await screen.findByText(/push needs a pull first/)).toBeInTheDocument();
    expect(onPublished).toHaveBeenCalledWith(createdRepo.cloneUrl);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Link and push" })).toBeEnabled();
  });

  it("shows the translated push error when a pull is needed first", async () => {
    const user = userEvent.setup();
    mocks.forgeListRepos.mockResolvedValue(page([createdRepo]));
    mocks.gitPush.mockRejectedValue('@oleafly/error:{"code":"git.push_rejected","params":{"host":"GitHub"}}');
    renderDialog();

    await user.click(screen.getByRole("tab", { name: "Link existing" }));
    await user.click(await screen.findByText("prajwal/research-notes"));
    await user.click(screen.getByRole("button", { name: "Link and push" }));

    expect(await screen.findByText(/push needs a pull first/)).toHaveTextContent(enErrors.git.push_rejected);
    expect(screen.queryByText(/@oleafly\/error/)).toBeNull();
  });

  it("reports a remote that could not be set at all", async () => {
    const user = userEvent.setup();
    mocks.forgeListRepos.mockResolvedValue(page([createdRepo]));
    mocks.gitSetRemote.mockRejectedValue(new Error("not a git repository"));
    const onPublished = vi.fn();
    renderDialog({ onPublished });

    await user.click(screen.getByRole("tab", { name: "Link existing" }));
    await user.click(await screen.findByText("prajwal/research-notes"));
    await user.click(screen.getByRole("button", { name: "Link and push" }));

    expect(await screen.findByText(/not a git repository/)).toBeInTheDocument();
    expect(mocks.gitPush).not.toHaveBeenCalled();
    expect(onPublished).not.toHaveBeenCalled();
  });

  it("creates no repository for a project inside another repository", async () => {
    const user = userEvent.setup();
    mocks.gitPublishPreflight.mockRejectedValue('@oleafly/error:{"code":"git.nested_repository","params":{}}');
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Create and push" }));

    expect(await screen.findByText(/inside another Git repository/)).toBeInTheDocument();
    expect(mocks.gitPublishPreflight).toHaveBeenCalledWith("project-1");
    expect(mocks.forgeCreateRepo).not.toHaveBeenCalled();
    expect(mocks.gitPreparePublish).not.toHaveBeenCalled();
    expect(mocks.gitSetRemote).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create and push" })).toBeEnabled();
  });

  it("reports a repository the server refused to create", async () => {
    const user = userEvent.setup();
    mocks.forgeCreateRepo.mockRejectedValue(
      '@oleafly/error:{"code":"git.forge_repository_exists","params":{"host":"GitHub"}}',
    );
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Create and push" }));

    expect(
      await screen.findByText(enErrors.git.forge_repository_exists.replace("{{host}}", "GitHub")),
    ).toBeInTheDocument();
    expect(mocks.gitPreparePublish).not.toHaveBeenCalled();
  });

  it("asks before replacing the repository the project already pushes to", async () => {
    const user = userEvent.setup();
    mocks.forgeListRepos.mockResolvedValue(page([createdRepo]));
    renderDialog({ currentRemote: "https://github.com/prajwal/old-notes.git" });

    await user.click(screen.getByRole("tab", { name: "Link existing" }));
    await user.click(await screen.findByText("prajwal/research-notes"));
    await user.click(screen.getByRole("button", { name: "Link and push" }));

    expect(screen.getByText(/linked to https:\/\/github\.com\/prajwal\/old-notes\.git/)).toBeInTheDocument();
    expect(mocks.gitPreparePublish).not.toHaveBeenCalled();
    expect(mocks.gitSetRemote).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Replace link" }));

    await waitFor(() =>
      expect(mocks.gitSetRemote).toHaveBeenCalledWith("project-1", createdRepo.cloneUrl, {
        replace: true,
      }),
    );
    expect(mocks.gitPush).toHaveBeenCalledWith("project-1");
  });

  it("creates no repository until the user confirms replacing the current link", async () => {
    const user = userEvent.setup();
    renderDialog({ currentRemote: "https://github.com/prajwal/old-notes.git" });

    await user.click(screen.getByRole("button", { name: "Create and push" }));
    expect(mocks.forgeCreateRepo).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("button", { name: "Replace link" })).toBeNull();
    expect(mocks.forgeCreateRepo).not.toHaveBeenCalled();
    expect(mocks.gitSetRemote).not.toHaveBeenCalled();
  });

  it("relinks the same repository without asking", async () => {
    const user = userEvent.setup();
    mocks.forgeListRepos.mockResolvedValue(page([createdRepo]));
    renderDialog({ currentRemote: createdRepo.cloneUrl });

    await user.click(screen.getByRole("tab", { name: "Link existing" }));
    await user.click(await screen.findByText("prajwal/research-notes"));
    await user.click(screen.getByRole("button", { name: "Link and push" }));

    await waitFor(() => expect(mocks.gitSetRemote).toHaveBeenCalledWith("project-1", createdRepo.cloneUrl));
    expect(screen.queryByRole("button", { name: "Replace link" })).toBeNull();
  });

  it("shows the translated refusal instead of the raw backend envelope", async () => {
    const user = userEvent.setup();
    mocks.forgeListRepos.mockResolvedValue(page([createdRepo]));
    mocks.gitSetRemote.mockRejectedValue(
      '@oleafly/error:{"code":"git.remote_exists","params":{"remote":"https://gitlab.com/lab/paper.git"}}',
    );
    renderDialog();

    await user.click(screen.getByRole("tab", { name: "Link existing" }));
    await user.click(await screen.findByText("prajwal/research-notes"));
    await user.click(screen.getByRole("button", { name: "Link and push" }));

    expect(await screen.findByText(/already linked to https:\/\/gitlab\.com\/lab\/paper\.git/)).toBeInTheDocument();
    expect(screen.queryByText(/@oleafly\/error/)).toBeNull();
    expect(mocks.gitPush).not.toHaveBeenCalled();
  });

  it("offers a retry and logs when the repository read fails", async () => {
    const user = userEvent.setup();
    mocks.forgeListRepos.mockRejectedValueOnce(new Error("bad credentials")).mockResolvedValue(page([createdRepo]));
    renderDialog();

    await user.click(screen.getByRole("tab", { name: "Link existing" }));

    expect(await screen.findByText(enLibrary.import.repositoriesFailed)).toBeInTheDocument();
    expect(mocks.logError).toHaveBeenCalledWith("forge list repos", expect.any(Error));
    expect(screen.getByRole("button", { name: "Link and push" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: enLibrary.import.tryAgain }));
    expect(await screen.findByText("prajwal/research-notes")).toBeInTheDocument();
  });

  it("mounts the overlay on the document body so it covers the whole window", () => {
    const view = renderDialog();

    const overlay = screen.getByRole("dialog").parentElement as HTMLElement;
    expect(overlay).toHaveClass("fixed", "inset-0", "z-[80]");
    expect(overlay.parentElement).toBe(document.body);
    expect(view.container.contains(overlay)).toBe(false);
  });

  it("leaves the document body untouched while it is closed", () => {
    const view = render(
      <PublishDialog open={false} onClose={vi.fn()} projectId="project-1" projectName="Research notes" onPublished={vi.fn()} />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(view.container).toBeEmptyDOMElement();
  });

  it("names secret-looking files in the history before creating a repository", async () => {
    const user = userEvent.setup();
    mocks.gitPublishPreflight.mockResolvedValue({
      trackedSecretFiles: [".env", "deploy/server.pem"],
    });
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Create and push" }));

    expect(await screen.findByText(/Git history: \.env and deploy\/server\.pem\./)).toBeInTheDocument();
    expect(mocks.forgeCreateRepo).not.toHaveBeenCalled();
    expect(mocks.gitPreparePublish).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create and push" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("button", { name: "Publish anyway" })).toBeNull();
    expect(screen.queryByText(/Git history/)).toBeNull();
    expect(mocks.forgeCreateRepo).not.toHaveBeenCalled();
  });

  it("publishes the listed history files only after Publish anyway", async () => {
    const user = userEvent.setup();
    mocks.gitPublishPreflight.mockResolvedValue({ trackedSecretFiles: [".env"] });
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Create and push" }));
    expect(
      await screen.findByText(
        "This file may hold keys or passwords, and it is already in this project's Git history: .env. Publishing uploads that history, so GitHub would get it too.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Publish anyway" }));

    await waitFor(() => expect(mocks.gitPush).toHaveBeenCalledWith("project-1"));
    expect(mocks.forgeCreateRepo).toHaveBeenCalledTimes(1);
    expect(mocks.gitPreparePublish).toHaveBeenCalledWith("project-1", "Initial commit", {
      allowTrackedSecrets: [".env"],
    });
    expect(screen.queryByRole("button", { name: "Publish anyway" })).toBeNull();
  });

  it("names the files it left out and stays open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.gitPreparePublish.mockResolvedValue({
      committed: true,
      hasCommit: true,
      leftOut: [".env", "keys/server.pem"],
    });
    const onClose = vi.fn();
    const onPublished = vi.fn();
    renderDialog({ onClose, onPublished });

    await user.click(screen.getByRole("button", { name: "Create and push" }));

    expect(await screen.findByText(/Published to prajwal\/research-notes/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Left out because they may hold keys or passwords: .env and keys/server.pem.",
    );
    expect(onPublished).toHaveBeenCalledWith(createdRepo.cloneUrl);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shortens a long list of left-out files", async () => {
    const user = userEvent.setup();
    mocks.gitPreparePublish.mockResolvedValue({
      committed: true,
      hasCommit: true,
      leftOut: [".env", "a.pem", "b.pem", "c.pem", "d.pem", "e.pem", "f.pem"],
    });
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Create and push" }));

    const note = await screen.findByRole("status");
    expect(note).toHaveTextContent(".env, a.pem, b.pem, c.pem, d.pem and 2 more.");
    expect(note).not.toHaveTextContent("e.pem");
  });

  it("checks the history before linking an existing repository", async () => {
    const user = userEvent.setup();
    mocks.forgeListRepos.mockResolvedValue(page([createdRepo]));
    mocks.gitPublishPreflight.mockResolvedValue({ trackedSecretFiles: [".env"] });
    renderDialog();

    await user.click(screen.getByRole("tab", { name: "Link existing" }));
    await user.click(await screen.findByText("prajwal/research-notes"));
    await user.click(screen.getByRole("button", { name: "Link and push" }));

    expect(await screen.findByRole("button", { name: "Publish anyway" })).toBeInTheDocument();
    expect(mocks.gitPublishPreflight).toHaveBeenCalledWith("project-1");
    expect(mocks.gitPreparePublish).not.toHaveBeenCalled();
    expect(mocks.gitSetRemote).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Publish anyway" }));

    await waitFor(() => expect(mocks.gitSetRemote).toHaveBeenCalledWith("project-1", createdRepo.cloneUrl));
    expect(mocks.gitPreparePublish).toHaveBeenCalledWith("project-1", "Initial commit", {
      allowTrackedSecrets: [".env"],
    });
  });

  it("drops the history question when another project opens", async () => {
    const user = userEvent.setup();
    mocks.gitPublishPreflight.mockResolvedValue({ trackedSecretFiles: [".env"] });
    const view = renderDialog();

    await user.click(screen.getByRole("button", { name: "Create and push" }));
    expect(await screen.findByRole("button", { name: "Publish anyway" })).toBeInTheDocument();

    view.rerender(
      <PublishDialog open onClose={vi.fn()} projectId="project-2" projectName="Other notes" onPublished={vi.fn()} />,
    );

    expect(screen.queryByRole("button", { name: "Publish anyway" })).toBeNull();
    expect(screen.queryByText(/Git history/)).toBeNull();
  });

  it("pushes nothing when every file was left out", async () => {
    const user = userEvent.setup();
    mocks.gitPreparePublish.mockResolvedValue({
      committed: false,
      hasCommit: false,
      leftOut: [".env"],
    });
    const onPublished = vi.fn();
    renderDialog({ onPublished });

    await user.click(screen.getByRole("button", { name: "Create and push" }));

    expect(await screen.findByText("Nothing was pushed because this project has no commits yet.")).toBeInTheDocument();
    expect(mocks.gitSetRemote).toHaveBeenCalledWith("project-1", createdRepo.cloneUrl);
    expect(mocks.gitPush).not.toHaveBeenCalled();
    expect(onPublished).toHaveBeenCalledWith(createdRepo.cloneUrl);
    expect(screen.getByRole("status")).toHaveTextContent(".env");
  });

  it("clears the left-out note from an earlier attempt", async () => {
    const user = userEvent.setup();
    mocks.gitPreparePublish.mockResolvedValueOnce({
      committed: true,
      hasCommit: true,
      leftOut: [".env"],
    });
    mocks.gitPush.mockRejectedValueOnce(new Error("network is down"));
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Create and push" }));
    expect(await screen.findByText(/network is down/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(".env");

    await user.click(screen.getByRole("button", { name: "Create and push" }));

    expect(await screen.findByText(/Published to prajwal\/research-notes/)).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps the left-out note when the push needs a pull first", async () => {
    const user = userEvent.setup();
    mocks.forgeListRepos.mockResolvedValue(page([createdRepo]));
    mocks.gitPreparePublish.mockResolvedValue({
      committed: true,
      hasCommit: true,
      leftOut: [".env"],
    });
    mocks.gitPush.mockRejectedValue(new Error("fetch first"));
    renderDialog();

    await user.click(screen.getByRole("tab", { name: "Link existing" }));
    await user.click(await screen.findByText("prajwal/research-notes"));
    await user.click(screen.getByRole("button", { name: "Link and push" }));

    expect(await screen.findByText(/push needs a pull first/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(".env");
  });

  describe("form controls", () => {
    it("creates a public repository under the name the user typed", async () => {
      const user = userEvent.setup();
      renderDialog();
      const name = screen.getByRole("textbox", { name: enLibrary.github.repositoryName });
      expect(name).toHaveValue("research-notes");

      fireEvent.change(name, { target: { value: "Thesis Draft 2" } });
      await user.click(screen.getByRole("checkbox"));
      await user.click(screen.getByRole("button", { name: "Create and push" }));

      await waitFor(() =>
        expect(mocks.forgeCreateRepo).toHaveBeenCalledWith("https://github.com", "thesis-draft-2", false),
      );
    });

    it("asks for a name that survives cleaning", async () => {
      const user = userEvent.setup();
      renderDialog();
      const name = screen.getByRole("textbox", { name: enLibrary.github.repositoryName });

      fireEvent.change(name, { target: { value: "" } });
      expect(screen.getByRole("button", { name: "Create and push" })).toBeDisabled();
      fireEvent.change(name, { target: { value: "!!!" } });
      await user.click(screen.getByRole("button", { name: "Create and push" }));

      expect(await screen.findByText(enLibrary.github.nameRequired)).toBeInTheDocument();
      expect(mocks.forgeCreateRepo).not.toHaveBeenCalled();
    });

    it("suggests a default name for an unnamed project", () => {
      renderDialog({ projectName: "" });

      expect(screen.getByRole("textbox", { name: enLibrary.github.repositoryName })).toHaveValue("oleafly-project");
    });

    it("shows progress while repositories load and filters them by search", async () => {
      const repos = deferred<ForgeRepoPage>();
      mocks.forgeListRepos.mockReturnValue(repos.promise);
      const user = userEvent.setup();
      renderDialog();

      await user.click(screen.getByRole("tab", { name: "Link existing" }));
      expect(screen.getByText(enCommon.state.loading)).toBeInTheDocument();
      await act(async () => {
        repos.resolve(
          page([createdRepo, { ...createdRepo, id: "2", name: "slides", fullName: "prajwal/slides", private: false }]),
        );
      });

      expect(screen.getByText("prajwal/slides")).toBeInTheDocument();
      await user.type(screen.getByRole("textbox", { name: enLibrary.github.searchRepositories }), "SLIDE");
      expect(screen.queryByText("prajwal/research-notes")).toBeNull();
      expect(screen.getByText("prajwal/slides")).toBeInTheDocument();
      await user.type(screen.getByRole("textbox", { name: enLibrary.github.searchRepositories }), "zzz");
      expect(screen.getByText(enLibrary.github.noRepositories)).toBeInTheDocument();
    });
  });
});

describe("PublishDialog accounts and addresses", () => {
  it("names the account's host in the title", () => {
    useAccounts([gitlabAccount]);
    const view = renderDialog();
    expect(screen.getByRole("heading", { name: "Publish to GitLab" })).toBeInTheDocument();
    view.unmount();

    useAccounts([{ ...gitlabAccount, base: "https://gitlab.example.org" }]);
    renderDialog();
    expect(screen.getByRole("heading", { name: "Publish to gitlab.example.org" })).toBeInTheDocument();
  });

  it("creates the repository on the account the user picked", async () => {
    allowRadixSelect();
    useAccounts([githubAccount, gitlabAccount]);
    const user = userEvent.setup();
    renderDialog();

    expect(screen.getByRole("heading", { name: "Publish to GitHub" })).toBeInTheDocument();
    // The picker sits beside the action at the bottom, labelled for screen
    // readers only.
    const picker = screen.getByRole("combobox", { name: enLibrary.github.accountLabel });
    expect(picker.parentElement).toBe(screen.getByRole("button", { name: "Create and push" }).parentElement);
    expect(screen.queryByText(enLibrary.github.accountLabel)).not.toBeInTheDocument();
    await chooseOption(user, enLibrary.github.accountLabel, "GitLab · zoe");
    expect(screen.getByRole("heading", { name: "Publish to GitLab" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create and push" }));

    await waitFor(() =>
      expect(mocks.forgeCreateRepo).toHaveBeenCalledWith("https://gitlab.com", "research-notes", true),
    );
  });

  it("starts on the account the current remote belongs to", () => {
    useAccounts([githubAccount, gitlabAccount]);
    renderDialog({ currentRemote: "git@gitlab.com:zoe/paper.git" });
    expect(screen.getByRole("heading", { name: "Publish to GitLab" })).toBeInTheDocument();
  });

  it("lists the picked account's repositories and loads more", async () => {
    const user = userEvent.setup();
    mocks.forgeListRepos
      .mockResolvedValueOnce(page([createdRepo], 2))
      .mockResolvedValueOnce(page([{ ...createdRepo, id: "9", name: "older", fullName: "prajwal/older" }]));
    renderDialog();

    await user.click(screen.getByRole("tab", { name: "Link existing" }));
    expect(await screen.findByText("prajwal/research-notes")).toBeInTheDocument();
    expect(mocks.forgeListRepos).toHaveBeenCalledWith("https://github.com", 1, null);

    await user.click(screen.getByRole("button", { name: enLibrary.import.loadMore }));
    expect(await screen.findByText("prajwal/older")).toBeInTheDocument();
    expect(screen.getByText("prajwal/research-notes")).toBeInTheDocument();
    expect(mocks.forgeListRepos).toHaveBeenLastCalledWith("https://github.com", 2, null);
    expect(screen.queryByRole("button", { name: enLibrary.import.loadMore })).toBeNull();
  });

  it("searches GitLab on the server and filters GitHub locally", async () => {
    const user = userEvent.setup();
    useAccounts([gitlabAccount]);
    mocks.forgeListRepos.mockResolvedValue(page([], null, true));
    const view = renderDialog();

    await user.click(screen.getByRole("tab", { name: "Link existing" }));
    await user.type(screen.getByRole("textbox", { name: enLibrary.github.searchRepositories }), "thesis");
    // Typing six letters and the 300 ms search debounce take close to the
    // default second on a busy machine.
    await waitFor(() => expect(mocks.forgeListRepos).toHaveBeenLastCalledWith("https://gitlab.com", 1, "thesis"), {
      timeout: 3_000,
    });
    view.unmount();

    mocks.forgeListRepos.mockClear();
    useAccounts([githubAccount]);
    mocks.forgeListRepos.mockResolvedValue(page([createdRepo]));
    renderDialog();
    await user.click(screen.getByRole("tab", { name: "Link existing" }));
    await screen.findByText("prajwal/research-notes");
    await user.type(screen.getByRole("textbox", { name: enLibrary.github.searchRepositories }), "zzz");
    expect(screen.getByText(enLibrary.github.noRepositories)).toBeInTheDocument();
    expect(mocks.forgeListRepos).toHaveBeenCalledTimes(1);
  });

  it("opens on Link by address when no account is connected", async () => {
    useAccounts([]);
    useSettingsStore.setState({ settingsOpen: false, settingsInitialSection: "general", settingsScrollTarget: null });
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onClose });

    expect(screen.getByRole("heading", { name: enLibrary.github.titleAny })).toBeInTheDocument();
    expect(screen.getByTestId("publish-url-input")).toBeInTheDocument();
    expect(mocks.forgeListRepos).not.toHaveBeenCalled();

    await user.click(screen.getByRole("tab", { name: enLibrary.github.tabNew }));
    expect(screen.getByText(enLibrary.github.connectPromptAny)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: enLibrary.github.openSettings }));

    expect(onClose).toHaveBeenCalled();
    expect(useSettingsStore.getState().settingsOpen).toBe(true);
    expect(useSettingsStore.getState().settingsInitialSection).toBe("integrations");
    expect(useSettingsStore.getState().settingsScrollTarget).toBe("git-hosting");
  });

  it("links and pushes a typed SSH address", async () => {
    useAccounts([]);
    const user = userEvent.setup();
    const onPublished = vi.fn();
    renderDialog({ onPublished });
    await afterInitialFocus();

    const submit = screen.getByTestId("publish-url-submit");
    expect(submit).toBeDisabled();
    await user.type(screen.getByTestId("publish-url-input"), "git@codeberg.org:me/paper.git");
    await user.click(submit);

    await waitFor(() => expect(mocks.gitPush).toHaveBeenCalledWith("project-1"));
    expect(mocks.gitSetRemote).toHaveBeenCalledWith("project-1", "git@codeberg.org:me/paper.git");
    expect(onPublished).toHaveBeenCalledWith("git@codeberg.org:me/paper.git");
  });

  it("refuses an address that carries a password", async () => {
    useAccounts([]);
    const user = userEvent.setup();
    renderDialog();
    await afterInitialFocus();

    await user.type(screen.getByTestId("publish-url-input"), "https://u:pw@h.org/x.git");

    expect(screen.getByRole("alert")).toHaveTextContent(enErrors.git.remote_has_password);
    expect(screen.getByTestId("publish-url-submit")).toBeDisabled();
    expect(mocks.gitSetRemote).not.toHaveBeenCalled();
  });

  it("names the host in the history question", async () => {
    useAccounts([]);
    mocks.gitPublishPreflight.mockResolvedValue({ trackedSecretFiles: [".env"] });
    const user = userEvent.setup();
    renderDialog();
    await afterInitialFocus();

    await user.type(screen.getByTestId("publish-url-input"), "https://gitlab.example.org/lab/paper.git");
    await user.click(screen.getByTestId("publish-url-submit"));

    expect(await screen.findByText(/so gitlab\.example\.org would get it too/)).toBeInTheDocument();
    expect(mocks.gitSetRemote).not.toHaveBeenCalled();
  });

  it("keeps an earlier project's repository list out of the next project's dialog", async () => {
    const first = deferred<ForgeRepoPage>();
    mocks.forgeListRepos.mockReturnValueOnce(first.promise).mockResolvedValueOnce(page([]));
    const user = userEvent.setup();
    const view = renderDialog({ projectId: "project-a", projectName: "Project A" });
    await user.click(screen.getByRole("tab", { name: "Link existing" }));

    view.rerender(
      <PublishDialog open onClose={vi.fn()} projectId="project-b" projectName="Project B" onPublished={vi.fn()} />,
    );
    await act(async () => {
      first.resolve(page([createdRepo]));
      await first.promise;
    });
    await user.click(screen.getByRole("tab", { name: "Link existing" }));

    expect(await screen.findByText(enLibrary.github.noRepositories)).toBeInTheDocument();
    expect(screen.queryByText("prajwal/research-notes")).toBeNull();
  });

  it("does not log a repository read that failed for a project no longer shown", async () => {
    const first = deferred<ForgeRepoPage>();
    mocks.forgeListRepos.mockReturnValueOnce(first.promise);
    const user = userEvent.setup();
    const view = renderDialog({ projectId: "project-a", projectName: "Project A" });
    await user.click(screen.getByRole("tab", { name: "Link existing" }));

    view.rerender(
      <PublishDialog open onClose={vi.fn()} projectId="project-b" projectName="Project B" onPublished={vi.fn()} />,
    );
    await act(async () => {
      first.reject(new Error("rate limited"));
      await Promise.resolve();
    });

    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("links an existing repository but pushes nothing when the project has no commits", async () => {
    const user = userEvent.setup();
    mocks.forgeListRepos.mockResolvedValue(page([createdRepo]));
    mocks.gitPreparePublish.mockResolvedValue({ committed: false, hasCommit: false, leftOut: [] });
    const onPublished = vi.fn();
    renderDialog({ onPublished });

    await user.click(screen.getByRole("tab", { name: "Link existing" }));
    await user.click(await screen.findByText("prajwal/research-notes"));
    await user.click(screen.getByRole("button", { name: "Link and push" }));

    expect(await screen.findByText("Nothing was pushed because this project has no commits yet.")).toBeInTheDocument();
    expect(mocks.gitSetRemote).toHaveBeenCalledWith("project-1", createdRepo.cloneUrl);
    expect(mocks.gitPush).not.toHaveBeenCalled();
    expect(onPublished).toHaveBeenCalledWith(createdRepo.cloneUrl);
  });

  it("creates the new repository and replaces the old link once the user confirms", async () => {
    const user = userEvent.setup();
    renderDialog({ currentRemote: "https://github.com/prajwal/old-notes.git" });

    await user.click(screen.getByRole("button", { name: "Create and push" }));
    await user.click(screen.getByRole("button", { name: "Replace link" }));

    await waitFor(() =>
      expect(mocks.gitSetRemote).toHaveBeenCalledWith("project-1", createdRepo.cloneUrl, { replace: true }),
    );
    expect(mocks.forgeCreateRepo).toHaveBeenCalledWith("https://github.com", "research-notes", true);
    expect(mocks.gitPush).toHaveBeenCalledWith("project-1");
  });
});
