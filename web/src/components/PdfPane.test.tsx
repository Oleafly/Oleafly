import type { CompileOutput } from "@oleafly/compile-port";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { forwardRef } from "react";
import { describe, expect, it, vi } from "vitest";
import type { WebApi } from "../api";
import { outputKey } from "../compile/outputs";
import type { ProjectActions } from "../controller";
import type { CollabOutputInfo } from "../protocol";
import { initialCompileState, resetWebState, useWeb } from "../store";
import { ActionsContext } from "./context";
import { dateTime } from "./format";
import { PdfPane } from "./PdfPane";

vi.mock("@oleafly/preview", () => ({
  PdfViewer: forwardRef<
    unknown,
    { data: Uint8Array; documentIdentity: string; onInverse?: (page: number, x: number, y: number, word?: string) => void }
  >(function PdfViewer(props, _ref) {
    return (
      <button
        type="button"
        data-testid="pdf-viewer"
        data-identity={props.documentIdentity}
        onClick={() => props.onInverse?.(1, 80, 90, "body")}
      >
        {props.data.length}
      </button>
    );
  }),
}));

function stubActions() {
  return {
    compile: vi.fn(),
    toggleLog: vi.fn(() => useWeb.setState((state) => ({ compile: { ...state.compile, logOpen: !state.compile.logOpen } }))),
    openFromPdf: vi.fn(async () => undefined),
    openLocation: vi.fn(),
  };
}

function renderPane(pane: { api: WebApi; projectId: string }, actions = stubActions()) {
  render(
    <ActionsContext.Provider value={actions as unknown as ProjectActions}>
      <PdfPane api={pane.api} projectId={pane.projectId} />
    </ActionsContext.Provider>,
  );
  return actions;
}

function api(output: WebApi["output"]): WebApi {
  return {
    me: vi.fn(),
    projects: vi.fn(),
    project: vi.fn(),
    blob: vi.fn(),
    output,
    signOut: vi.fn(),
  } as unknown as WebApi;
}

const COMPILED: CollabOutputInfo = {
  kind: "pdf",
  size: 3,
  compiledBy: "ana",
  compiledAt: Date.UTC(2026, 9, 24, 15, 30),
  mainFile: "main.tex",
};

function people() {
  return { ana: { accountId: "ana", name: "Ana Ruiz", avatarUrl: null, login: null } };
}

describe("PdfPane", () => {
  it("explains that nobody has compiled yet and does not fetch", () => {
    resetWebState({ projectId: "p1" });
    const output = vi.fn();
    renderPane({ api: api(output), projectId: "p1" });
    expect(screen.getByTestId("pdf-empty")).toHaveTextContent("No PDF yet");
    expect(screen.getByTestId("pdf-empty")).toHaveTextContent(
      "The PDF appears here after someone compiles the project in the Oleafly app.",
    );
    expect(screen.getByTestId("pdf-label")).toBeEmptyDOMElement();
    expect(output).not.toHaveBeenCalled();
  });

  it("shows who compiled the PDF and when, then the PDF", async () => {
    resetWebState({ projectId: "p1", output: [COMPILED], people: people() });
    const output = vi.fn(async () => new Uint8Array([1, 2, 3]));
    renderPane({ api: api(output), projectId: "p1" });
    expect(screen.getByTestId("pdf-label")).toHaveTextContent(`Compiled by Ana Ruiz, ${dateTime(COMPILED.compiledAt)}`);
    expect(await screen.findByTestId("pdf-viewer")).toHaveTextContent("3");
    expect(output).toHaveBeenCalledWith("p1", "pdf");
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute("href", "/web/api/projects/p1/output/pdf");
  });

  it("loads the new PDF when an output frame reports a newer compile", async () => {
    resetWebState({ projectId: "p1", output: [COMPILED], people: people() });
    const output = vi
      .fn<WebApi["output"]>()
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3]))
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3, 4, 5]));
    renderPane({ api: api(output), projectId: "p1" });
    expect(await screen.findByTestId("pdf-viewer")).toHaveTextContent("3");
    await act(async () => {
      useWeb.setState({ output: [{ ...COMPILED, compiledAt: COMPILED.compiledAt + 60_000, size: 5 }] });
    });
    expect(await screen.findByText("5")).toBeInTheDocument();
    expect(output).toHaveBeenCalledTimes(2);
  });

  it("offers a retry when the PDF cannot be fetched", async () => {
    resetWebState({ projectId: "p1", output: [COMPILED], people: people() });
    const output = vi
      .fn<WebApi["output"]>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(new Uint8Array([9]));
    renderPane({ api: api(output), projectId: "p1" });
    expect(await screen.findByText("The PDF could not be loaded.")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(await screen.findByTestId("pdf-viewer")).toHaveTextContent("1");
  });

  it("goes back to the empty state when the server has no PDF after all", async () => {
    resetWebState({ projectId: "p1", output: [COMPILED], people: people() });
    renderPane({ api: api(vi.fn(async () => null)), projectId: "p1" });
    expect(await screen.findByTestId("pdf-empty")).toHaveTextContent("No PDF yet");
    expect(screen.queryByTestId("pdf-viewer")).toBeNull();
  });

  it("keys a compile by its time, size and author", () => {
    expect(outputKey(undefined)).toBeNull();
    expect(outputKey(COMPILED)).toBe(`${COMPILED.compiledAt}:3:ana`);
  });

  it("shows this browser's compile with its time, its log and click-to-source", async () => {
    const local: CompileOutput = {
      target: { mainDocument: "main.tex", engine: "latex", texFlavor: null },
      ok: false,
      pdf: new Uint8Array([1, 2, 3, 4]),
      synctex: null,
      log: "raw log text",
      diagnostics: [
        { severity: "error", message: "Undefined control sequence.", file: "./intro.tex", line: 4, category: "error" },
        { severity: "warning", message: "Reference undefined", file: null, line: 9, category: "undefined-reference" },
      ],
      timeMs: 420,
    };
    resetWebState({
      projectId: "p1",
      output: [COMPILED],
      people: people(),
      compile: { ...initialCompileState(), ready: true, status: "failed", output: local, finishedAt: 5, shown: "local" },
    });
    const output = vi.fn();
    const actions = renderPane({ api: api(output), projectId: "p1" });
    expect(screen.getByTestId("pdf-label")).toHaveTextContent("Compiled in your browser in 0.4 s");
    expect(screen.getByTestId("pdf-viewer")).toHaveTextContent("4");
    expect(screen.getByTestId("pdf-viewer")).toHaveAttribute("data-identity", "web-compile:5");
    expect(output).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("pdf-viewer"));
    expect(actions.openFromPdf).toHaveBeenCalledWith(1, 80, 90, "body", undefined);
    fireEvent.click(screen.getByTestId("compile"));
    expect(actions.compile).toHaveBeenCalledOnce();
    await act(async () => {
      fireEvent.click(screen.getByTestId("compile-log-toggle"));
    });
    const log = screen.getByTestId("compile-log");
    expect(log).toHaveTextContent("Errors: 1 · Warnings: 1");
    fireEvent.click(screen.getByRole("button", { name: /Undefined control sequence/u }));
    expect(actions.openLocation).toHaveBeenCalledWith("./intro.tex", 4);
    fireEvent.click(screen.getByRole("button", { name: /Reference undefined/u }));
    expect(actions.openLocation).toHaveBeenCalledWith("main.tex", 9);
    fireEvent.click(screen.getByRole("button", { name: "Full log" }));
    expect(log).toHaveTextContent("raw log text");
  });

  it("invites a compile when this browser can compile and nothing is shared yet", () => {
    resetWebState({ projectId: "p1", compile: { ...initialCompileState(), ready: true } });
    renderPane({ api: api(vi.fn()), projectId: "p1" });
    expect(screen.getByTestId("pdf-empty")).toHaveTextContent("Compile the project to see its PDF here.");
    expect(screen.getByTestId("compile")).toBeEnabled();
  });

  it("has no compile button without an engine", () => {
    resetWebState({ projectId: "p1" });
    renderPane({ api: api(vi.fn()), projectId: "p1" });
    expect(screen.queryByTestId("compile")).toBeNull();
  });

  it("says when a compile couldn't run, with the reason on hover", () => {
    resetWebState({
      projectId: "p1",
      compile: { ...initialCompileState(), ready: true, status: "failed", error: "offline", shown: "local" },
    });
    renderPane({ api: api(vi.fn()), projectId: "p1" });
    expect(screen.getByTestId("pdf-label")).toHaveTextContent("The compile couldn't run.");
    expect(screen.getByTestId("pdf-label")).toHaveAttribute("title", "offline");
  });
});

