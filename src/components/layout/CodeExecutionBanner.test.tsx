// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { APP_ERROR_PREFIX } from "@/lib/app-error";
import { LATEX_ENGINE } from "@/lib/document-engine";
import type { CompileError, DocumentEngineDescriptor } from "@/lib/tauri";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useFolderAccessStore } from "@/store/folder-access";
import { useSettingsStore } from "@/store/settings";
import { useToastStore } from "@/store/toast";
import { CodeExecutionBanner, codeExecutionNeed } from "./CodeExecutionBanner";

const copy = enShell.codeExecution;
const recompile = vi.fn(async () => undefined);
const setShellEscape = vi.fn(async (_allow: boolean) => {});

function notebookEngine(id: "quarto" | "calepin", allow = false): DocumentEngineDescriptor {
  return {
    ...LATEX_ENGINE,
    id,
    label: id === "quarto" ? "Quarto" : "Calepin",
    source_format: id === "quarto" ? "markdown" : "typst",
    allow_shell_escape: allow,
  } as unknown as DocumentEngineDescriptor;
}

function coded(code: string, kind = "warning"): CompileError {
  return { line: null, file: null, message: code, kind, explanation: null, code };
}

function project(engine: DocumentEngineDescriptor, errors: CompileError[]) {
  useFilesStore.setState({
    projectId: "p1",
    engine,
    engineLoaded: true,
    setShellEscape,
  } as unknown as ReturnType<typeof useFilesStore.getState>);
  useCompileStore.setState({
    status: errors.some((error) => error.kind === "error") ? "error" : "success",
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

describe("CodeExecutionBanner", () => {
  it("says the code did not run when Quarto skipped it", () => {
    project(notebookEngine("quarto"), [coded("notebook.code_skipped")]);
    render(<CodeExecutionBanner />);
    expect(screen.getByTestId("code-execution-banner")).toHaveTextContent(copy.skipped);
    expect(screen.getByRole("button", { name: copy.allow })).toBeEnabled();
  });

  it("says the code must run when the compile was refused for it", () => {
    project(notebookEngine("quarto"), [coded("notebook.code_needed", "error")]);
    render(<CodeExecutionBanner />);
    expect(screen.getByTestId("code-execution-banner")).toHaveTextContent(copy.needed);
  });

  it("says Calepin showed stored results", () => {
    project(notebookEngine("calepin"), [coded("notebook.stored_results")]);
    render(<CodeExecutionBanner />);
    expect(screen.getByTestId("code-execution-banner")).toHaveTextContent(copy.storedResults);
  });

  it("allows code, shows the preview and compiles again in one click", async () => {
    project(notebookEngine("calepin"), [coded("notebook.code_needed", "error")]);
    render(<CodeExecutionBanner />);
    await userEvent.setup().click(screen.getByRole("button", { name: copy.allow }));
    await waitFor(() => expect(recompile).toHaveBeenCalledOnce());
    expect(setShellEscape).toHaveBeenCalledExactlyOnceWith(true);
    expect(useSettingsStore.getState().viewMode).toBe("split");
  });

  it("stays put without a toast or a compile when the person cancels the shared project warning", async () => {
    setShellEscape.mockRejectedValue(
      `${APP_ERROR_PREFIX}${JSON.stringify({ code: "project.shell_escape_declined", params: {}, detail: null })}`,
    );
    project(notebookEngine("quarto"), [coded("notebook.code_skipped")]);
    render(<CodeExecutionBanner />);
    await userEvent.setup().click(screen.getByRole("button", { name: copy.allow }));
    await waitFor(() => expect(screen.getByRole("button", { name: copy.allow })).toBeEnabled());
    expect(useToastStore.getState().toasts).toEqual([]);
    expect(recompile).not.toHaveBeenCalled();
  });

  it("stays away once code is allowed, for other engines and without a code finding", () => {
    project(notebookEngine("quarto", true), [coded("notebook.code_skipped")]);
    const { rerender } = render(<CodeExecutionBanner />);
    expect(screen.queryByTestId("code-execution-banner")).toBeNull();

    project(LATEX_ENGINE, [coded("notebook.code_skipped")]);
    rerender(<CodeExecutionBanner />);
    expect(screen.queryByTestId("code-execution-banner")).toBeNull();

    project(notebookEngine("quarto"), [coded("tex.shell_escape_denied_command", "error")]);
    rerender(<CodeExecutionBanner />);
    expect(screen.queryByTestId("code-execution-banner")).toBeNull();
  });

  it("leaves an untrusted folder to the trust banner", () => {
    useFolderAccessStore.getState().reset("p1");
    useFolderAccessStore.setState({
      loaded: true,
      trust: { trusted: false, source: null, parent: null, repository: null },
    });
    project(notebookEngine("quarto"), [coded("notebook.code_needed", "error")]);
    render(<CodeExecutionBanner />);
    expect(screen.queryByTestId("code-execution-banner")).toBeNull();
  });
});

describe("codeExecutionNeed", () => {
  it("puts a refused compile before skipped code and skipped code before stored results", () => {
    expect(codeExecutionNeed([coded("notebook.stored_results"), coded("notebook.code_needed", "error")])).toBe("needed");
    expect(codeExecutionNeed([coded("notebook.stored_results"), coded("notebook.code_skipped")])).toBe("skipped");
    expect(codeExecutionNeed([coded("notebook.stored_results")])).toBe("storedResults");
    expect(codeExecutionNeed([{ ...coded("x"), code: null }])).toBeNull();
    expect(codeExecutionNeed([])).toBeNull();
  });
});
