// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { importCompatFinding } from "@oleafly/latex";
import { LATEX_ENGINE } from "@/lib/document-engine";
import type { CompileError } from "@/lib/tauri";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useFolderAccessStore } from "@/store/folder-access";
import { useSettingsStore } from "@/store/settings";
import { useToastStore } from "@/store/toast";
import { ShellCommandsBanner } from "./ShellCommandsBanner";

const copy = enShell.shellCommands;
const recompile = vi.fn(async () => undefined);
const setShellEscape = vi.fn(async (_allow: boolean) => {});
const SYSTEM_TEX = { ...LATEX_ENGINE, id: "latexmk", tex_flavor: "pdflatex" };

const blocked: CompileError = {
  line: null,
  file: null,
  message: "a LaTeX shell command needs to run an outside program, which this project does not allow.",
  kind: "error",
  explanation: "blocked",
  code: "tex.shell_escape_denied_command",
};

function project(engine: typeof SYSTEM_TEX | typeof LATEX_ENGINE, errors: CompileError[]) {
  useFilesStore.setState({
    projectId: "p1",
    engine,
    engineLoaded: true,
    setShellEscape,
  } as unknown as ReturnType<typeof useFilesStore.getState>);
  useCompileStore.setState({
    status: "error",
    errors,
    offer: null,
    recompile,
  } as unknown as ReturnType<typeof useCompileStore.getState>);
}

beforeEach(() => {
  recompile.mockClear();
  setShellEscape.mockReset().mockResolvedValue(undefined);
  useToastStore.getState().reset();
  useFolderAccessStore.getState().reset(null);
  useSettingsStore.setState({ viewMode: "editor" });
});

afterEach(() => {
  useFolderAccessStore.getState().reset(null);
});

describe("ShellCommandsBanner", () => {
  it("says the compile was blocked and offers to allow external commands", () => {
    project(SYSTEM_TEX, [blocked]);
    render(<ShellCommandsBanner />);
    expect(screen.getByTestId("shell-commands-banner")).toHaveTextContent(copy.banner);
    expect(screen.getByRole("button", { name: copy.allow })).toBeEnabled();
  });

  it("allows external commands, shows the preview and compiles again", async () => {
    project(SYSTEM_TEX, [blocked]);
    render(<ShellCommandsBanner />);
    await userEvent.setup().click(screen.getByRole("button", { name: copy.allow }));
    await waitFor(() => expect(recompile).toHaveBeenCalledOnce());
    expect(setShellEscape).toHaveBeenCalledExactlyOnceWith(true);
    expect(useSettingsStore.getState().viewMode).toBe("split");
  });

  it("tells the user once and skips the compile when allowing fails", async () => {
    setShellEscape.mockRejectedValue(new Error("trust record is not a regular file"));
    project(SYSTEM_TEX, [blocked]);
    render(<ShellCommandsBanner />);
    await userEvent.setup().click(screen.getByRole("button", { name: copy.allow }));
    await waitFor(() =>
      expect(useToastStore.getState().toasts).toEqual([
        expect.objectContaining({
          key: "engine-switch:p1",
          kind: "error",
          message: enShell.enginePicker.shellEscapeFailed,
        }),
      ]),
    );
    expect(recompile).not.toHaveBeenCalled();
  });

  it("stays away unless the last system LaTeX compile was blocked", () => {
    project(SYSTEM_TEX, []);
    const { rerender } = render(<ShellCommandsBanner />);
    expect(screen.queryByTestId("shell-commands-banner")).toBeNull();

    project({ ...SYSTEM_TEX, allow_shell_escape: true }, [blocked]);
    rerender(<ShellCommandsBanner />);
    expect(screen.queryByTestId("shell-commands-banner")).toBeNull();

    project(LATEX_ENGINE, [blocked]);
    rerender(<ShellCommandsBanner />);
    expect(screen.queryByTestId("shell-commands-banner")).toBeNull();
  });

  it("shows right away when the failed compile's findings need shell commands", () => {
    project(SYSTEM_TEX, []);
    useCompileStore.setState({
      offer: { kind: "engine-gap", projectId: "p1", findings: [importCompatFinding("minted")] },
    });
    render(<ShellCommandsBanner />);
    expect(screen.getByTestId("shell-commands-banner")).toHaveTextContent(copy.banner);
  });

  it("ignores findings that need no shell commands or belong to another project", () => {
    project(SYSTEM_TEX, []);
    useCompileStore.setState({
      offer: { kind: "engine-gap", projectId: "p1", findings: [importCompatFinding("pdftex-only")] },
    });
    const { rerender } = render(<ShellCommandsBanner />);
    expect(screen.queryByTestId("shell-commands-banner")).toBeNull();

    useCompileStore.setState({
      offer: { kind: "engine-gap", projectId: "p2", findings: [importCompatFinding("minted")] },
    });
    rerender(<ShellCommandsBanner />);
    expect(screen.queryByTestId("shell-commands-banner")).toBeNull();
  });

  it("leaves an untrusted folder to the trust banner", () => {
    useFolderAccessStore.getState().reset("p1");
    useFolderAccessStore.setState({
      loaded: true,
      trust: { trusted: false, source: null, parent: null, repository: null },
    });
    project(SYSTEM_TEX, [blocked]);
    render(<ShellCommandsBanner />);
    expect(screen.queryByTestId("shell-commands-banner")).toBeNull();
  });
});
