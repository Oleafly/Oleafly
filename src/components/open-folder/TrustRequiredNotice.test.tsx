// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { useFolderAccessStore } from "@/store/folder-access";
import { RestrictedTerminalBadge, TrustRequiredNotice } from "./TrustRequiredNotice";

const grant = vi.fn();

function access(trusted: boolean, projectId = "linked-a") {
  useFolderAccessStore.getState().reset(projectId);
  useFolderAccessStore.setState({
    loaded: true,
    trust: { trusted, source: trusted ? "folder" : null, parent: null, repository: null },
    grant,
  });
}

beforeEach(() => {
  grant.mockReset();
  grant.mockResolvedValue(true);
});

afterEach(() => {
  useFolderAccessStore.getState().reset(null);
});

describe("TrustRequiredNotice", () => {
  it("says why a feature is off where the user meets it and offers trust", () => {
    access(false);
    render(<TrustRequiredNotice projectId="linked-a" reason="Trust this folder to use external agents." />);
    expect(screen.getByText("Trust this folder to use external agents.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: enShell.openedFolder.trust.trustFolder }));
    expect(grant).toHaveBeenCalledWith("folder");
  });

  it("puts the trust action after the reason as the primary button", () => {
    access(false);
    render(<TrustRequiredNotice projectId="linked-a" reason="Trust this folder to compile with latexmk." />);
    const notice = screen.getByTestId("trust-required-notice");
    const button = screen.getByRole("button", { name: enShell.openedFolder.trust.trustFolder });
    const reason = screen.getByText("Trust this folder to compile with latexmk.");
    expect(button.parentElement).toBe(notice);
    expect(reason.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button).toHaveClass("bg-primary", "ml-auto");
  });

  it("renders nothing for a trusted folder or another project", () => {
    access(true);
    const { rerender } = render(<TrustRequiredNotice projectId="linked-a" reason="Off" />);
    expect(screen.queryByText("Off")).not.toBeInTheDocument();
    access(false, "linked-b");
    rerender(<TrustRequiredNotice projectId="linked-a" reason="Off" />);
    expect(screen.queryByText("Off")).not.toBeInTheDocument();
  });

  it("disables the button while a trust confirmation is open", () => {
    access(false);
    useFolderAccessStore.setState({ trusting: "folder" });
    render(<TrustRequiredNotice projectId="linked-a" reason="Off" />);
    expect(screen.getByRole("button", { name: enShell.openedFolder.trust.trustFolder })).toBeDisabled();
  });
});

describe("RestrictedTerminalBadge", () => {
  const trustLabels = enShell.openedFolder.trust;

  it("says what is off in the terminal and trusts the folder only from its menu", async () => {
    access(false);
    const user = userEvent.setup();
    render(<RestrictedTerminalBadge projectId="linked-a" terminalId="t1" onReopen={vi.fn()} />);
    const badge = screen.getByRole("button", { name: trustLabels.terminal });
    expect(badge.className).not.toMatch(/ring|outline/);
    await user.click(badge);
    expect(grant).not.toHaveBeenCalled();
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText(trustLabels.terminal)).toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitem", { name: trustLabels.trustFolder }));
    expect(grant).toHaveBeenCalledWith("folder");
  });

  it("asks to reopen a terminal that started before the folder was trusted", async () => {
    access(false);
    useFolderAccessStore.getState().noteTerminalStarted("linked-a", "t1");
    useFolderAccessStore.setState((state) => ({
      trust: { trusted: true, source: "folder", parent: null, repository: null },
      limitedTerminals: state.limitedTerminals,
    }));
    const onReopen = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <RestrictedTerminalBadge projectId="linked-a" terminalId="t1" onReopen={onReopen} />,
    );
    await user.click(screen.getByRole("button", { name: trustLabels.terminalReopen }));
    await user.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", {
        name: trustLabels.reopenTerminal,
      }),
    );
    expect(onReopen).toHaveBeenCalledTimes(1);
    expect(grant).not.toHaveBeenCalled();
    rerender(<RestrictedTerminalBadge projectId="linked-a" terminalId="t2" onReopen={onReopen} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("is absent once the folder is trusted", () => {
    access(true);
    render(<RestrictedTerminalBadge projectId="linked-a" terminalId="t1" onReopen={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
