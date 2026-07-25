// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readCompiledPdf: vi.fn(),
  listeners: new Map<string, (event: { payload?: { projectId?: string } }) => void>(),
  gotoPage: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  readCompiledPdf: mocks.readCompiledPdf,
  appendAppLog: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (
    name: string,
    listener: (event: { payload?: { projectId?: string } }) => void,
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
      ref: React.ForwardedRef<{ gotoPage: (page: number) => void }>,
    ) {
      React.useImperativeHandle(ref, () => ({ gotoPage: mocks.gotoPage }));
      React.useEffect(() => onPageChange?.(1, 3), [onPageChange]);
      return (
        <div data-testid="detached-pdf-bytes">
          {Array.from(data).join(",")}
        </div>
      );
    }),
  };
});

import { PreviewWindow } from "./PreviewWindow";

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
});

describe("detached preview request identity", () => {
  it("clears the previous document immediately and ignores a stale project load", async () => {
    const alpha = deferred<ArrayBuffer>();
    const beta = deferred<ArrayBuffer>();
    mocks.readCompiledPdf.mockImplementation((projectId: string) =>
      projectId === "alpha" ? alpha.promise : beta.promise,
    );
    render(<PreviewWindow />);
    await vi.waitFor(() =>
      expect(mocks.readCompiledPdf).toHaveBeenCalledWith("alpha"),
    );
    alpha.resolve(buffer(1));
    await screen.findByText("1");

    act(() => {
      mocks.listeners.get("preview:project")?.({
        payload: { projectId: "beta" },
      });
    });
    expect(screen.queryByTestId("detached-pdf-bytes")).not.toBeInTheDocument();
    expect(screen.getByText("Loading preview…")).toBeInTheDocument();
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
    await vi.waitFor(() =>
      expect(mocks.readCompiledPdf).toHaveBeenCalledWith("alpha"),
    );
    act(() => {
      mocks.listeners.get("preview:project")?.({
        payload: { projectId: "beta" },
      });
    });
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
    await screen.findByText("1");

    act(() => {
      mocks.listeners.get("preview:project")?.({
        payload: { projectId: "beta" },
      });
    });
    expect(screen.queryByTestId("detached-pdf-bytes")).not.toBeInTheDocument();
    await screen.findByText(
      "No compiled PDF yet. Compile in the main window and it will appear here.",
    );
    expect(screen.queryByTestId("detached-pdf-bytes")).not.toBeInTheDocument();
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
