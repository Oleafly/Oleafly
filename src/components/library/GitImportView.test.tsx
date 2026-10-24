// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ForgeAccount, ForgeRepo } from "@/lib/tauri";

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

const REPO: ForgeRepo = {
  id: "octocat/hello-world",
  fullName: "octocat/hello-world",
  name: "hello-world",
  webUrl: "https://github.com/octocat/hello-world",
  cloneUrl: "https://github.com/octocat/hello-world.git",
  private: false,
  defaultBranch: "main",
};

vi.mock("@/components/integrations/ForgeRepoList", () => ({
  ForgeRepoList: ({ renderTrailing }: { renderTrailing?: (repo: ForgeRepo) => unknown }) => (
    <div>{renderTrailing?.(REPO) as never}</div>
  ),
}));

import enLibrary from "@/i18n/locales/en/library.json" with { type: "json" };
import { GitImportView } from "./GitImportView";

const ACCOUNT: ForgeAccount = {
  base: "https://github.com",
  kind: "github",
  login: "octocat",
  auth: "oauth",
  addedAt: 1,
};

function renderView(busy = false) {
  return render(
    <GitImportView busy={busy} onImport={vi.fn()} onClone={vi.fn()} onOpenSettings={vi.fn()} />,
  );
}

beforeEach(() => {
  forgeState.status = "ready";
  forgeState.accounts = [];
  forgeState.error = null;
  forgeState.reload.mockClear();
});

describe("GitImportView", () => {
  it("says the accounts couldn't load and offers to try again, instead of asking to connect one", () => {
    forgeState.status = "error";
    forgeState.error = "forge-accounts.json is locked.";
    renderView();

    expect(screen.getByRole("alert")).toHaveTextContent("forge-accounts.json is locked.");
    expect(screen.queryByText(enLibrary.import.connectPromptGit)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: enLibrary.import.tryAgain }));
    expect(forgeState.reload).toHaveBeenCalledTimes(1);
  });

  it("asks to connect an account when none is connected", () => {
    renderView();
    expect(screen.getByText(enLibrary.import.connectPromptGit)).toBeInTheDocument();
  });

  it("turns off opening a repository on its host while an import runs", () => {
    forgeState.accounts = [ACCOUNT];
    const label = enLibrary.import.openRepositoryOnHost
      .replace("{{name}}", REPO.fullName)
      .replace("{{host}}", "GitHub");
    const view = renderView();
    expect(screen.getByRole("button", { name: label })).toBeEnabled();

    view.rerender(
      <GitImportView busy onImport={vi.fn()} onClone={vi.fn()} onOpenSettings={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: label })).toBeDisabled();
  });
});
