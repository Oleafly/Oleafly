// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readCompiledPdf: vi.fn(),
  listeners: new Map<string, (event: { payload?: unknown }) => void>(),
  gotoPage: vi.fn(),
  getFitScale: vi.fn(() => 1),
}));

vi.mock("@/lib/tauri", () => ({
  readCompiledPdf: mocks.readCompiledPdf,
  appendAppLog: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (
    name: string,
    listener: (event: { payload?: unknown }) => void,
  ) => {
    mocks.listeners.set(name, listener);
    return () => {
      if (mocks.listeners.get(name) === listener) mocks.listeners.delete(name);
    };
  }),
}));

vi.mock("@/components/pdf/PdfViewer", async () => {
  const React = await import("react");
  return {
    PdfViewer: React.forwardRef(function MockPdfViewer(
      {
        data,
        onPageChange,
      }: {
        data: Uint8Array;
        onPageChange?: (current: number, total: number) => void;
      },
      ref: React.ForwardedRef<{
        gotoPage: (page: number) => void;
        getFitScale: (mode: "width" | "height") => number;
      }>,
    ) {
      React.useImperativeHandle(ref, () => ({
        gotoPage: mocks.gotoPage,
        getFitScale: mocks.getFitScale,
      }));
      React.useEffect(() => onPageChange?.(1, 3), [onPageChange]);
      return (
        <div data-testid="detached-pdf-bytes">
          {Array.from(data).join(",")}
        </div>
      );
    }),
  };
});

import {
  COMPILE_CHECKPOINT_VERSION,
  fingerprintCompileOutput,
} from "@/lib/compile-checkpoint";
import {
  isPreviewWindowState,
  type PreviewWindowState,
} from "@/lib/preview-window";
import { PreviewWindow } from "./PreviewWindow";

/**
 * The detached window only displays output whose compile identity it can
 * verify, so every load starts from a `preview:refresh` state rather than the
 * project id alone. `outputRevision` orders the states the way the producing
 * window would.
 */
function successState(
  projectId: string,
  value: number,
  outputRevision: number,
  projectRevision = outputRevision,
  projectStateRevision = outputRevision,
): PreviewWindowState {
  const identity = {
    projectId,
    mainDocument: "main.tex",
    projectRevision,
    requestGeneration: projectRevision,
  };
  return {
    projectStateRevision,
    identity,
    status: "success",
    checkpoint: {
      ...identity,
      version: COMPILE_CHECKPOINT_VERSION,
      outputKind: "standard",
      producerId: "test-producer",
      outputRevision,
      outputId: fingerprintCompileOutput(new Uint8Array([value])),
      completedAt: outputRevision,
    },
  };
}

function emitRefresh(state: PreviewWindowState) {
  act(() => {
    mocks.listeners.get("preview:refresh")?.({ payload: state });
  });
}

function emitProject(projectId: string) {
  act(() => {
    mocks.listeners.get("preview:project")?.({ payload: { projectId } });
  });
}

function emitProjectState(projectId: string, revision: number) {
  act(() => {
    mocks.listeners.get("project-state-changed")?.({
      payload: { projectId, revision },
    });
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function buffer(value: number): ArrayBuffer {
  return new Uint8Array([value]).buffer;
}

beforeEach(() => {
  window.history.replaceState({}, "", "/?view=preview&project=alpha");
  mocks.readCompiledPdf.mockReset();
  mocks.listeners.clear();
  mocks.gotoPage.mockReset();
  mocks.getFitScale.mockClear();
});

describe("detached preview request identity", () => {
  it("requires checkpoints to match the advertised request identity", () => {
    const accepted = successState("alpha", 1, 10, 10);
    expect(isPreviewWindowState(accepted)).toBe(true);
    expect(
      isPreviewWindowState({
        ...accepted,
        status: "compiling",
        checkpoint: null,
      }),
    ).toBe(true);
    expect(
      isPreviewWindowState({
        ...accepted,
        status: "compiling",
        identity: {
          ...accepted.identity,
          projectRevision: 11,
          requestGeneration: 11,
        },
      }),
    ).toBe(false);
    expect(
      isPreviewWindowState({
        ...accepted,
        checkpoint: null,
      }),
    ).toBe(false);
  });

  it("clears the previous document immediately when the project is retargeted", async () => {
    const alpha = deferred<ArrayBuffer>();
    const beta = deferred<ArrayBuffer>();
    mocks.readCompiledPdf.mockImplementation((projectId: string) =>
      projectId === "alpha" ? alpha.promise : beta.promise,
    );
    render(<PreviewWindow />);
    emitRefresh(successState("alpha", 1, 1));
    await vi.waitFor(() =>
      expect(mocks.readCompiledPdf).toHaveBeenCalledWith("alpha"),
    );
    alpha.resolve(buffer(1));
    await screen.findByText("1");

    emitProject("beta");
    // The old project's PDF must not linger while the new one is unverified.
    expect(screen.queryByTestId("detached-pdf-bytes")).not.toBeInTheDocument();
    expect(screen.getByText("No verified PDF")).toBeInTheDocument();

    emitRefresh(successState("beta", 2, 2));
    await vi.waitFor(() =>
      expect(mocks.readCompiledPdf).toHaveBeenCalledWith("beta"),
    );
    beta.resolve(buffer(2));
    await screen.findByText("2");
  });

  it("keeps project B when its load finishes before the older project A request", async () => {
    const alpha = deferred<ArrayBuffer>();
    const beta = deferred<ArrayBuffer>();
    mocks.readCompiledPdf.mockImplementation((projectId: string) =>
      projectId === "alpha" ? alpha.promise : beta.promise,
    );
    render(<PreviewWindow />);
    emitRefresh(successState("alpha", 1, 1));
    await vi.waitFor(() =>
      expect(mocks.readCompiledPdf).toHaveBeenCalledWith("alpha"),
    );
    emitProject("beta");
    emitRefresh(successState("beta", 2, 2));
    await vi.waitFor(() =>
      expect(mocks.readCompiledPdf).toHaveBeenCalledWith("beta"),
    );
    beta.resolve(buffer(2));
    await screen.findByText("2");

    alpha.resolve(buffer(1));
    await act(async () => {
      await alpha.promise;
      await Promise.resolve();
    });
    expect(screen.getByTestId("detached-pdf-bytes")).toHaveTextContent("2");
  });

  it("fails closed when the replacement project has no compiled PDF", async () => {
    mocks.readCompiledPdf
      .mockResolvedValueOnce(buffer(1))
      .mockRejectedValueOnce(new Error("missing"));
    render(<PreviewWindow />);
    emitRefresh(successState("alpha", 1, 1));
    await screen.findByText("1");

    emitProject("beta");
    expect(screen.queryByTestId("detached-pdf-bytes")).not.toBeInTheDocument();

    emitRefresh(successState("beta", 2, 2));
    await screen.findByText("PDF unavailable");
    expect(screen.queryByTestId("detached-pdf-bytes")).not.toBeInTheDocument();
  });

  it("clears output on a project-state mutation but ignores a delayed older event", async () => {
    mocks.readCompiledPdf
      .mockResolvedValueOnce(buffer(1))
      .mockResolvedValueOnce(buffer(2));
    render(<PreviewWindow />);
    emitRefresh(successState("alpha", 1, 1));
    await screen.findByText("1");

    emitProjectState("alpha", 10);
    expect(screen.queryByTestId("detached-pdf-bytes")).not.toBeInTheDocument();
    expect(screen.getByText("No verified PDF")).toBeInTheDocument();

    emitRefresh(successState("alpha", 2, 2));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.readCompiledPdf).toHaveBeenCalledTimes(1);
    expect(screen.getByText("No verified PDF")).toBeInTheDocument();

    emitRefresh(successState("alpha", 2, 2, 2, 10));
    await screen.findByText("2");
    emitProjectState("alpha", 9);
    expect(screen.getByTestId("detached-pdf-bytes")).toHaveTextContent("2");
  });

  it("rejects a delayed success after a newer project revision is announced", async () => {
    mocks.readCompiledPdf.mockResolvedValue(buffer(1));
    render(<PreviewWindow />);
    const accepted = successState("alpha", 1, 10, 10);
    emitRefresh(accepted);
    await screen.findByText("1");

    emitRefresh({
      projectStateRevision: 10,
      identity: {
        projectId: "alpha",
        mainDocument: "main.tex",
        projectRevision: 12,
        requestGeneration: 12,
      },
      status: "compiling",
      // In-progress identities never claim an older success checkpoint.
      // The viewer retains the old bytes independently and marks them stale.
      checkpoint: null,
    });

    emitRefresh(successState("alpha", 2, 20, 11));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.readCompiledPdf).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("detached-pdf-bytes")).toHaveTextContent("1");
    expect(
      screen.getByText("Stale · non-current preview"),
    ).toBeInTheDocument();
  });
});

it("navigates by a full spread after layout changes", async () => {
  render(
    <PreviewWindow
      disableNativeBridge
      harnessBytes={new Uint8Array([7])}
    />,
  );
  await vi.waitFor(() =>
    expect(screen.getByLabelText("Two-page view")).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByLabelText("Two-page view"));
  fireEvent.click(screen.getByLabelText("Next page"));
  expect(mocks.gotoPage).toHaveBeenCalledWith(3);
});
