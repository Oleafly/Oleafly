// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

type Handler = (event: { payload: unknown }) => void;

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Set<(event: { payload: unknown }) => void>>(),
  isTauri: vi.fn(() => true),
  confirmQuitFlush: vi.fn(async (_restart: boolean) => {}),
  cancelQuitFlush: vi.fn(async () => {}),
  confirmQuitDuringInstall: vi.fn(async () => {}),
  appendAppLog: vi.fn(async () => {}),
  flushForQuit: vi.fn(async () => {}),
  logError: vi.fn(async () => {}),
  notifyError: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: Handler) => {
    const set = mocks.handlers.get(name) ?? new Set<Handler>();
    set.add(handler);
    mocks.handlers.set(name, set);
    return () => set.delete(handler);
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@/lib/tauri", () => ({
  confirmQuitFlush: mocks.confirmQuitFlush,
  cancelQuitFlush: mocks.cancelQuitFlush,
  confirmQuitDuringInstall: mocks.confirmQuitDuringInstall,
  appendAppLog: mocks.appendAppLog,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/toast", () => ({ notifyError: mocks.notifyError }));
vi.mock("@/lib/update-install-guard", () => ({
  registerUpdateInstallGuard: vi.fn(async () => () => {}),
}));
vi.mock("@/lib/crash-report", () => ({ reportCrashToGithub: vi.fn(async () => {}) }));
vi.mock("@/components/SpecimenIllustration", () => ({ SpecimenIllustration: () => null }));
vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => ({ flushForQuit: mocks.flushForQuit }) },
}));

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { QuitGuard } from "@/components/layout/QuitGuard";
import { TinytexGuards } from "@/components/layout/TinytexGuards";
import { useEngineStore } from "@/store/engine";
import {
  claimQuitRequests,
  INSTALL_QUIT_BLOCKED,
  installQuitFallback,
  QUIT_FLUSH_REQUESTED,
} from "./quit-flush";

function Workspace({ crash }: Readonly<{ crash: boolean }>) {
  if (crash) throw new Error("workspace exploded");
  return <p>{"workspace"}</p>;
}

function MainWindow({ crash }: Readonly<{ crash: boolean }>) {
  return (
    <ErrorBoundary>
      <TinytexGuards />
      <QuitGuard />
      <Workspace crash={crash} />
    </ErrorBoundary>
  );
}

function requestQuit(restart: boolean) {
  for (const handler of [...(mocks.handlers.get(QUIT_FLUSH_REQUESTED) ?? [])]) {
    handler({ payload: restart });
  }
}

function blockQuitForInstall() {
  for (const handler of [...(mocks.handlers.get(INSTALL_QUIT_BLOCKED) ?? [])]) {
    handler({ payload: null });
  }
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let uninstall: (() => void) | undefined;

beforeEach(() => {
  mocks.handlers.clear();
  mocks.isTauri.mockReturnValue(true);
  mocks.confirmQuitFlush.mockReset().mockResolvedValue(undefined);
  mocks.cancelQuitFlush.mockReset().mockResolvedValue(undefined);
  mocks.confirmQuitDuringInstall.mockReset().mockResolvedValue(undefined);
  mocks.flushForQuit.mockReset().mockResolvedValue(undefined);
  mocks.logError.mockClear();
  mocks.notifyError.mockClear();
  useEngineStore.setState({ installing: false });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  vi.restoreAllMocks();
});

describe("quit requests after a UI crash", () => {
  it("flushes, then confirms the quit once the crash screen replaced the tree", async () => {
    uninstall = await installQuitFallback();
    const view = render(<MainWindow crash={false} />);
    await settle();

    view.rerender(<MainWindow crash />);
    expect(screen.getByTestId("error-boundary")).toBeInTheDocument();

    requestQuit(false);
    await waitFor(() => expect(mocks.confirmQuitFlush).toHaveBeenCalledTimes(1));
    await settle();

    expect(mocks.confirmQuitFlush).toHaveBeenCalledTimes(1);
    expect(mocks.confirmQuitFlush).toHaveBeenCalledWith(false);
    expect(mocks.flushForQuit).toHaveBeenCalledTimes(1);
    expect(mocks.flushForQuit.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.confirmQuitFlush.mock.invocationCallOrder[0],
    );
  });

  it("keeps the restart intent of the request", async () => {
    uninstall = await installQuitFallback();
    const view = render(<MainWindow crash={false} />);
    await settle();
    view.rerender(<MainWindow crash />);

    requestQuit(true);

    await waitFor(() => expect(mocks.confirmQuitFlush).toHaveBeenCalledWith(true));
    expect(mocks.confirmQuitFlush).toHaveBeenCalledTimes(1);
  });

  it("still confirms when the flush fails, because no dialog is left to ask", async () => {
    const failure = new Error("disk full");
    mocks.flushForQuit.mockRejectedValue(failure);
    uninstall = await installQuitFallback();
    const view = render(<MainWindow crash={false} />);
    await settle();
    view.rerender(<MainWindow crash />);

    requestQuit(false);

    await waitFor(() => expect(mocks.confirmQuitFlush).toHaveBeenCalledWith(false));
    expect(mocks.flushForQuit).toHaveBeenCalledTimes(1);
    expect(mocks.logError).toHaveBeenCalledWith(expect.any(String), failure);
    expect(mocks.cancelQuitFlush).not.toHaveBeenCalled();
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("runs one flush for repeated requests while it is still saving", async () => {
    const flush = deferred<void>();
    mocks.flushForQuit.mockImplementation(() => flush.promise);
    uninstall = await installQuitFallback();
    const view = render(<MainWindow crash={false} />);
    await settle();
    view.rerender(<MainWindow crash />);

    requestQuit(false);
    requestQuit(false);
    flush.resolve();

    await waitFor(() => expect(mocks.confirmQuitFlush).toHaveBeenCalledTimes(1));
    await settle();
    expect(mocks.confirmQuitFlush).toHaveBeenCalledTimes(1);
    expect(mocks.flushForQuit).toHaveBeenCalledTimes(1);
  });

  it("does not start a second save when the workspace crashes in the middle of one", async () => {
    const flush = deferred<void>();
    mocks.flushForQuit.mockImplementationOnce(() => flush.promise);
    uninstall = await installQuitFallback();
    const view = render(<MainWindow crash={false} />);
    await settle();

    requestQuit(true);
    await waitFor(() => expect(mocks.flushForQuit).toHaveBeenCalledTimes(1));
    view.rerender(<MainWindow crash />);
    requestQuit(true);
    await settle();
    expect(mocks.flushForQuit).toHaveBeenCalledTimes(1);

    flush.resolve();
    await waitFor(() => expect(mocks.confirmQuitFlush).toHaveBeenCalledTimes(1));
    await settle();
    expect(mocks.confirmQuitFlush).toHaveBeenCalledTimes(1);
    expect(mocks.confirmQuitFlush).toHaveBeenCalledWith(true);
    expect(mocks.flushForQuit).toHaveBeenCalledTimes(1);
  });

  it("never confirms over a save that failed after the crash, and answers the next close", async () => {
    const flush = deferred<void>();
    mocks.flushForQuit.mockImplementationOnce(() => flush.promise);
    uninstall = await installQuitFallback();
    const view = render(<MainWindow crash={false} />);
    await settle();

    requestQuit(false);
    await waitFor(() => expect(mocks.flushForQuit).toHaveBeenCalledTimes(1));
    view.rerender(<MainWindow crash />);
    requestQuit(false);
    flush.reject(new Error("disk full"));
    await waitFor(() => expect(mocks.cancelQuitFlush).toHaveBeenCalledTimes(1));
    await settle();
    expect(mocks.confirmQuitFlush).not.toHaveBeenCalled();
    expect(mocks.flushForQuit).toHaveBeenCalledTimes(1);

    requestQuit(false);
    await waitFor(() => expect(mocks.confirmQuitFlush).toHaveBeenCalledTimes(1));
    expect(mocks.flushForQuit).toHaveBeenCalledTimes(2);
  });

  it("quits a crashed window through a running TinyTeX install", async () => {
    useEngineStore.setState({ installing: true });
    mocks.confirmQuitFlush.mockImplementation(async () => blockQuitForInstall());
    uninstall = await installQuitFallback();
    const view = render(<MainWindow crash={false} />);
    await settle();
    view.rerender(<MainWindow crash />);

    requestQuit(false);

    await waitFor(() => expect(mocks.confirmQuitDuringInstall).toHaveBeenCalledTimes(1));
    expect(mocks.confirmQuitFlush).toHaveBeenCalledTimes(1);
    expect(mocks.cancelQuitFlush).not.toHaveBeenCalled();
  });

  it("answers every later close that waits on the install once the tree is gone", async () => {
    useEngineStore.setState({ installing: true });
    uninstall = await installQuitFallback();
    const view = render(<MainWindow crash={false} />);
    await settle();
    view.rerender(<MainWindow crash />);

    blockQuitForInstall();
    await waitFor(() => expect(mocks.confirmQuitDuringInstall).toHaveBeenCalledTimes(1));
    blockQuitForInstall();
    await waitFor(() => expect(mocks.confirmQuitDuringInstall).toHaveBeenCalledTimes(2));
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("logs a failed install quit without a toast", async () => {
    const failure = new Error("ipc closed");
    mocks.confirmQuitDuringInstall.mockRejectedValue(failure);
    uninstall = await installQuitFallback();

    blockQuitForInstall();

    await waitFor(() => expect(mocks.logError).toHaveBeenCalledWith(expect.any(String), failure));
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("answers when the whole tree is gone without a crash screen", async () => {
    uninstall = await installQuitFallback();
    const view = render(<MainWindow crash={false} />);
    await settle();
    view.unmount();

    requestQuit(false);

    await waitFor(() => expect(mocks.confirmQuitFlush).toHaveBeenCalledTimes(1));
  });

  it("stops answering once it is uninstalled", async () => {
    const stop = await installQuitFallback();
    stop();

    requestQuit(false);
    blockQuitForInstall();
    await settle();

    expect(mocks.confirmQuitFlush).not.toHaveBeenCalled();
    expect(mocks.flushForQuit).not.toHaveBeenCalled();
    expect(mocks.confirmQuitDuringInstall).not.toHaveBeenCalled();
  });

  it("stays out of the way outside the desktop app", async () => {
    mocks.isTauri.mockReturnValue(false);
    uninstall = await installQuitFallback();

    expect(mocks.handlers.get(QUIT_FLUSH_REQUESTED)?.size ?? 0).toBe(0);
    expect(mocks.handlers.get(INSTALL_QUIT_BLOCKED)?.size ?? 0).toBe(0);
  });
});

describe("quit requests while the app is healthy", () => {
  it("lets only the quit guard confirm", async () => {
    uninstall = await installQuitFallback();
    render(<MainWindow crash={false} />);
    await settle();

    requestQuit(false);
    await waitFor(() => expect(mocks.confirmQuitFlush).toHaveBeenCalledTimes(1));
    await settle();

    expect(mocks.confirmQuitFlush).toHaveBeenCalledTimes(1);
    expect(mocks.confirmQuitFlush).toHaveBeenCalledWith(false);
    expect(mocks.flushForQuit).toHaveBeenCalledTimes(1);
  });

  it("lets only the quit guard confirm under strict mode remounts", async () => {
    uninstall = await installQuitFallback();
    render(
      <StrictMode>
        <MainWindow crash={false} />
      </StrictMode>,
    );
    await settle();

    requestQuit(true);
    await waitFor(() => expect(mocks.confirmQuitFlush).toHaveBeenCalledTimes(1));
    await settle();

    expect(mocks.confirmQuitFlush).toHaveBeenCalledTimes(1);
    expect(mocks.confirmQuitFlush).toHaveBeenCalledWith(true);
    expect(mocks.flushForQuit).toHaveBeenCalledTimes(1);
  });

  it("keeps a claim when another guard releases twice", async () => {
    uninstall = await installQuitFallback();
    const first = claimQuitRequests();
    const second = claimQuitRequests();
    first();
    first();

    requestQuit(false);
    await settle();
    expect(mocks.confirmQuitFlush).not.toHaveBeenCalled();

    second();
    requestQuit(false);
    await waitFor(() => expect(mocks.confirmQuitFlush).toHaveBeenCalledTimes(1));
  });

  it("leaves a running install to the TinyTeX dialog", async () => {
    useEngineStore.setState({ installing: true });
    uninstall = await installQuitFallback();
    render(<MainWindow crash={false} />);
    await settle();

    blockQuitForInstall();

    await screen.findByText(/still installing/i);
    await settle();
    expect(mocks.confirmQuitDuringInstall).not.toHaveBeenCalled();
  });

  it("leaves a running install to the TinyTeX dialog under strict mode remounts", async () => {
    useEngineStore.setState({ installing: true });
    uninstall = await installQuitFallback();
    render(
      <StrictMode>
        <MainWindow crash={false} />
      </StrictMode>,
    );
    await settle();

    blockQuitForInstall();

    await screen.findByText(/still installing/i);
    await settle();
    expect(mocks.confirmQuitDuringInstall).not.toHaveBeenCalled();
  });

  it("leaves a failed flush to the quit guard dialog", async () => {
    mocks.flushForQuit.mockRejectedValue(new Error("disk full"));
    uninstall = await installQuitFallback();
    render(<MainWindow crash={false} />);
    await settle();

    requestQuit(false);

    await screen.findByText(/could not be saved/i);
    await settle();
    expect(mocks.confirmQuitFlush).not.toHaveBeenCalled();
    expect(mocks.flushForQuit).toHaveBeenCalledTimes(1);
  });
});
