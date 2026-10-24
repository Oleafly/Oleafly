// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import type { ForgeAccount } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";
import { RemoteMenu } from "./RemoteMenu";

const copy = enShell.remoteMenu;
const onOpen = vi.fn();
const onCopyLink = vi.fn();

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{{${name}}}`, value), template);
}

const labAccount: ForgeAccount = {
  base: "https://gitlab.example.org",
  kind: "gitlab",
  login: "zoe",
  avatarUrl: "https://example.test/zoe.png",
  auth: "token",
  addedAt: 1,
};

function renderMenu(
  props: Partial<{ webUrl: string | null; host: string; account: ForgeAccount | null }> = {},
) {
  return render(
    <RemoteMenu
      webUrl={props.webUrl === undefined ? "https://gitlab.example.org/lab/paper" : props.webUrl}
      host={props.host ?? "gitlab.example.org"}
      account={props.account ?? null}
      onOpen={onOpen}
      onCopyLink={onCopyLink}
    />,
  );
}

beforeEach(() => {
  onOpen.mockClear();
  onCopyLink.mockClear();
  useSettingsStore.setState({
    settingsOpen: false,
    settingsInitialSection: null,
    settingsScrollTarget: null,
  } as unknown as ReturnType<typeof useSettingsStore.getState>);
});

describe("RemoteMenu", () => {
  it("opens the repository on a self-hosted GitLab", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByLabelText(copy.actions));
    await user.click(
      await screen.findByRole("menuitem", { name: fill(copy.openOnHost, { host: "gitlab.example.org" }) }),
    );
    expect(onOpen).toHaveBeenCalled();
  });

  it("shows the avatar only for an account that matches the remote", () => {
    const view = renderMenu({ account: labAccount });
    expect(
      screen.getByLabelText(fill(copy.accountLabel, { login: "zoe", host: "gitlab.example.org" })),
    ).toBeInTheDocument();
    expect(document.querySelector('img[data-slot="avatar"]')).toHaveAttribute("src", "https://example.test/zoe.png");
    view.unmount();

    renderMenu({ account: null });
    expect(screen.queryByTestId("remote-menu-account")).toBeNull();
    expect(document.querySelector('[data-slot="avatar"]')).toBeNull();
    expect(screen.getByLabelText(copy.actions)).toBeInTheDocument();
  });

  it("copies the repository link", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByLabelText(copy.actions));
    await user.click(await screen.findByRole("menuitem", { name: copy.copyRepositoryLink }));
    expect(onCopyLink).toHaveBeenCalled();
  });

  it("disables the repository actions without a web address", async () => {
    const user = userEvent.setup();
    renderMenu({ webUrl: null });

    await user.click(screen.getByLabelText(copy.actions));
    expect(
      await screen.findByRole("menuitem", { name: fill(copy.openOnHost, { host: "gitlab.example.org" }) }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("opens the Git hosting settings", async () => {
    const user = userEvent.setup();
    renderMenu({ account: labAccount });

    await user.click(screen.getByTestId("remote-menu-account"));
    await user.click(await screen.findByRole("menuitem", { name: copy.settings }));
    expect(useSettingsStore.getState().settingsOpen).toBe(true);
    expect(useSettingsStore.getState().settingsInitialSection).toBe("integrations");
    expect(useSettingsStore.getState().settingsScrollTarget).toBe("git-hosting");
  });
});
