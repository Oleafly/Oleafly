// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { useGithubStore } from "@/store/github";
import { useSettingsStore } from "@/store/settings";
import { GithubMenu } from "./GithubMenu";

const copy = enShell.githubMenu;
const onOpenInGithub = vi.fn();
const onCopyLink = vi.fn();

function renderMenu(githubUrl: string | null = "https://github.com/o/p") {
  return render(
    <GithubMenu
      githubUrl={githubUrl}
      onOpenInGithub={onOpenInGithub}
      onCopyLink={onCopyLink}
    />,
  );
}

beforeEach(() => {
  onOpenInGithub.mockClear();
  onCopyLink.mockClear();
  useGithubStore.setState({ status: "disconnected", user: null });
  useSettingsStore.setState({
    settingsOpen: false,
    settingsInitialSection: null,
  } as unknown as ReturnType<typeof useSettingsStore.getState>);
});

describe("GithubMenu", () => {
  it("offers a connect entry while signed out", async () => {
    renderMenu(null);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(copy.actions));
    expect(
      await screen.findByRole("menuitem", { name: copy.connect }),
    ).toBeInTheDocument();
    expect(screen.getByText(copy.pushHint)).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: copy.openInGithub }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("names the signed-in account and opens the integration settings", async () => {
    useGithubStore.setState({
      status: "connected",
      user: { login: "octocat", avatar_url: "https://example.test/a.png" },
    } as unknown as ReturnType<typeof useGithubStore.getState>);
    renderMenu();
    const user = userEvent.setup();
    await user.click(
      screen.getByLabelText(copy.accountAriaLabel.replace("{{login}}", "octocat")),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: copy.settings }),
    );
    expect(useSettingsStore.getState().settingsOpen).toBe(true);
    expect(useSettingsStore.getState().settingsInitialSection).toBe(
      "integrations",
    );
  });

  it("falls back to a plain mark when the account has no avatar", async () => {
    useGithubStore.setState({
      status: "connected",
      user: { login: "octocat" },
    } as unknown as ReturnType<typeof useGithubStore.getState>);
    renderMenu();
    expect(
      screen.getByLabelText(copy.accountAriaLabel.replace("{{login}}", "octocat")),
    ).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("opens the repository and copies its link", async () => {
    renderMenu();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(copy.actions));
    await user.click(
      await screen.findByRole("menuitem", { name: copy.openInGithub }),
    );
    expect(onOpenInGithub).toHaveBeenCalled();

    await user.click(screen.getByLabelText(copy.actions));
    await user.click(
      await screen.findByRole("menuitem", { name: copy.copyRepositoryLink }),
    );
    expect(onCopyLink).toHaveBeenCalled();
  });
});
