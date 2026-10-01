// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import type { ShellCommandChange, ShellCommandStatus } from "@/lib/shell-command";

const mocks = vi.hoisted(() => ({
  shellCommandStatus: vi.fn(),
  installShellCommand: vi.fn(),
  removeShellCommand: vi.fn(),
}));

vi.mock("@/lib/shell-command", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/shell-command")>()),
  shellCommandStatus: mocks.shellCommandStatus,
  installShellCommand: mocks.installShellCommand,
  removeShellCommand: mocks.removeShellCommand,
}));

import { ShellCommandRow } from "./ShellCommandRow";

const copy = enSettings.shellCommand;

const notInstalled: ShellCommandStatus = {
  state: "not_installed",
  path: "~/.local/bin/oleafly",
  directory: "~/.local/bin",
  method: "link",
  on_path: false,
  hint: null,
};

const installed: ShellCommandStatus = {
  ...notInstalled,
  state: "installed",
  on_path: true,
};

const offPath: ShellCommandStatus = {
  ...installed,
  on_path: false,
  hint: { file: "~/.zshrc", line: 'export PATH="$HOME/.local/bin:$PATH"' },
};

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name] ?? "");
}

// Settings blurs the paths in these sentences, which splits each into runs.
async function expectState(text: string) {
  await waitFor(() => expect(screen.getByTestId("shell-command-state").textContent).toBe(text));
}

async function hintSentence() {
  return (await screen.findByTestId("shell-command-hint")).querySelector("p")?.textContent;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.shellCommandStatus.mockResolvedValue(notInstalled);
});

describe("ShellCommandRow", () => {
  it("renders nothing where the command is not offered", async () => {
    mocks.shellCommandStatus.mockResolvedValue({ state: "unsupported" });
    const { container } = render(<ShellCommandRow />);
    await waitFor(() => expect(mocks.shellCommandStatus).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("installs the command and says what it did", async () => {
    const user = userEvent.setup();
    const change: ShellCommandChange = { action: "linked", status: installed };
    mocks.installShellCommand.mockResolvedValue(change);
    render(<ShellCommandRow />);

    await expectState(fill(copy.state.notInstalled, { directory: "~/.local/bin" }));
    expect(screen.getByText(copy.title)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: copy.install }));

    expect(mocks.installShellCommand).toHaveBeenCalledTimes(1);
    expect(
      (await screen.findByRole("status")).textContent,
    ).toBe(fill(copy.result.linked, { path: "~/.local/bin/oleafly" }));
    await expectState(fill(copy.state.installed, { path: "~/.local/bin/oleafly" }));
    // Like every path in Settings, it stays blurred until hovered or focused.
    const shown = within(screen.getByTestId("shell-command-state")).getByText("~/.local/bin/oleafly");
    expect(shown).toHaveAttribute("data-settings-path");
    expect(shown).toHaveAttribute("tabindex", "0");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: enCommon.actions.remove }),
      ),
    );
    expect(screen.queryByRole("button", { name: copy.install })).toBeNull();
    expect(screen.queryByText(/PATH/)).toBeNull();
  });

  it("shows the line to add when the folder is not on PATH and copies it", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mocks.shellCommandStatus.mockResolvedValue(offPath);
    render(<ShellCommandRow />);

    expect(await hintSentence()).toBe(
      fill(copy.notOnPath.file, { directory: "~/.local/bin", file: "~/.zshrc" }),
    );
    expect(screen.getByText('export PATH="$HOME/.local/bin:$PATH"')).toBeTruthy();
    const announcement = screen.getByTestId("shell-command-copied");
    expect(announcement.getAttribute("aria-live")).toBe("polite");
    expect(announcement.textContent).toBe("");
    await user.click(screen.getByRole("button", { name: enCommon.actions.copy }));
    expect(writeText).toHaveBeenCalledWith('export PATH="$HOME/.local/bin:$PATH"');
    expect(await screen.findByRole("button", { name: enCommon.actions.copied })).toBeTruthy();
    expect(announcement.textContent).toBe(enCommon.actions.copied);
    expect(screen.queryByTestId("shell-command-sign-in")).toBeNull();
  });

  it("says when the folder reaches PATH only after the next sign-in", async () => {
    mocks.shellCommandStatus.mockResolvedValue({
      ...installed,
      on_path: false,
      after_sign_in: true,
      hint: null,
    });
    render(<ShellCommandRow />);
    expect(
      (await screen.findByTestId("shell-command-sign-in")).textContent,
    ).toBe(fill(copy.afterSignIn, { directory: "~/.local/bin" }));
    expect(screen.queryByTestId("shell-command-hint")).toBeNull();
    expect(screen.queryByRole("button", { name: enCommon.actions.copy })).toBeNull();
  });

  it("gives fish users a command to run instead of a file to edit", async () => {
    mocks.shellCommandStatus.mockResolvedValue({
      ...offPath,
      hint: { file: null, line: "fish_add_path ~/.local/bin" },
    });
    render(<ShellCommandRow />);
    expect(await hintSentence()).toBe(fill(copy.notOnPath.run, { directory: "~/.local/bin" }));
    const line = screen.getByTestId("shell-command-hint").querySelector("code");
    expect(line?.textContent).toBe("fish_add_path ~/.local/bin");
    expect(within(line as HTMLElement).getByText("~/.local/bin")).toHaveAttribute("data-settings-path");
  });

  it("offers an update for an outdated command and removes it on request", async () => {
    const user = userEvent.setup();
    mocks.shellCommandStatus.mockResolvedValue({ ...installed, state: "outdated" });
    mocks.removeShellCommand.mockResolvedValue({ action: "removed", status: notInstalled });
    render(<ShellCommandRow />);

    await expectState(fill(copy.state.outdated, { path: "~/.local/bin/oleafly" }));
    expect(screen.getByRole("button", { name: copy.update })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: enCommon.actions.remove }));

    expect(mocks.removeShellCommand).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole("status")).textContent).toBe(
      fill(copy.result.removed, { path: "~/.local/bin/oleafly" }),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: copy.install })),
    );
  });

  it("leaves someone else's command alone and offers no action", async () => {
    mocks.shellCommandStatus.mockResolvedValue({ ...notInstalled, state: "occupied" });
    render(<ShellCommandRow />);
    await expectState(fill(copy.state.occupied, { path: "~/.local/bin/oleafly" }));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says when the Linux package already installed the command", async () => {
    mocks.shellCommandStatus.mockResolvedValue({
      state: "packaged",
      path: "/usr/bin/oleafly",
      directory: "/usr/bin",
      method: null,
      on_path: true,
      after_sign_in: false,
      hint: null,
    });
    render(<ShellCommandRow />);
    await expectState(fill(copy.state.packaged, { path: "/usr/bin/oleafly" }));
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByTestId("shell-command-hint")).toBeNull();
  });

  it.each([
    ["unavailable", copy.state.unavailable],
    ["move_app", copy.state.moveApp],
  ] as const)("explains why %s has no action", async (state, text) => {
    mocks.shellCommandStatus.mockResolvedValue({ state });
    render(<ShellCommandRow />);
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps the button busy while installing and reports a failure inline", async () => {
    const user = userEvent.setup();
    let reject: (reason: unknown) => void = () => {};
    mocks.installShellCommand.mockReturnValue(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    render(<ShellCommandRow />);
    await user.click(await screen.findByRole("button", { name: copy.install }));

    const busy = screen.getByRole("button", { name: copy.installing });
    expect(busy).toHaveProperty("disabled", true);
    reject(
      `@oleafly/error:${JSON.stringify({
        code: "shell_command.occupied",
        params: { path: "~/.local/bin/oleafly" },
        detail: null,
      })}`,
    );

    expect((await screen.findByRole("alert")).textContent).toBe(
      fill(enErrors.shell_command.occupied, { path: "~/.local/bin/oleafly" }),
    );
    await waitFor(() => expect(mocks.shellCommandStatus).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("treats a reply it does not understand as a failed check", async () => {
    mocks.shellCommandStatus.mockResolvedValue([]);
    render(<ShellCommandRow />);
    expect((await screen.findByRole("alert")).textContent).toBe(copy.loadFailed);
    expect(screen.queryByText(copy.checking)).toBeNull();
  });

  it("reports a status call that throws before it returns as a failed check", async () => {
    mocks.shellCommandStatus.mockImplementationOnce(() => {
      throw new Error("no backend");
    });
    render(<ShellCommandRow />);
    expect((await screen.findByRole("alert")).textContent).toBe(copy.loadFailed);
  });

  it("says when the status cannot be read and retries on request", async () => {
    const user = userEvent.setup();
    mocks.shellCommandStatus.mockRejectedValueOnce(new Error("boom"));
    render(<ShellCommandRow />);
    expect((await screen.findByRole("alert")).textContent).toBe(copy.loadFailed);
    await user.click(screen.getByRole("button", { name: enCommon.actions.retry }));
    await expectState(fill(copy.state.notInstalled, { directory: "~/.local/bin" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
