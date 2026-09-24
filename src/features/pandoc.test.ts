import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { fixRandomFraction } from "@/lib/test-utils";

type ProgressListener = (event: { payload: { received: number; total: number | null } }) => void;

const mocks = vi.hoisted(() => ({
  hasPandoc: vi.fn(),
  downloadPandoc: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
  open: vi.fn(),
  logError: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    infoUnique: vi.fn(() => 7),
    errorUnique: vi.fn(() => 7),
    update: vi.fn(),
    dismiss: vi.fn(),
  },
  listener: null as ProgressListener | null,
}));

vi.mock("@/lib/tauri", () => ({ hasPandoc: mocks.hasPandoc, downloadPandoc: mocks.downloadPandoc }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.open }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/toast", () => ({ toast: mocks.toast }));

const KEY = "pandoc-setup";
const ONE_MINUTE = 60_000;

async function loadPandoc() {
  vi.resetModules();
  return import("./pandoc");
}

function percent(progress: number): string {
  return i18n.t(($) => $.core.pandoc.downloadingPercent, { progress });
}

function anyToast(): boolean {
  return Object.values(mocks.toast).some((fn) => fn.mock.calls.length > 0);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-23T12:00:00Z"));
  fixRandomFraction(1);
  mocks.listener = null;
  mocks.hasPandoc.mockResolvedValue(false);
  mocks.downloadPandoc.mockResolvedValue(undefined);
  mocks.listen.mockImplementation(async (_event: string, handler: ProgressListener) => {
    mocks.listener = handler;
    return mocks.unlisten;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ensurePandoc", () => {
  it.each([{}, { notify: true }])("returns at once without a toast when pandoc is installed (%o)", async (options) => {
    mocks.hasPandoc.mockResolvedValue(true);
    const { ensurePandoc } = await loadPandoc();
    await expect(ensurePandoc(options)).resolves.toBe(true);
    expect(mocks.downloadPandoc).not.toHaveBeenCalled();
    expect(anyToast()).toBe(false);
  });

  it("downloads silently for background callers, including progress and success", async () => {
    const { ensurePandoc } = await loadPandoc();
    mocks.downloadPandoc.mockImplementation(async () => {
      mocks.listener?.({ payload: { received: 5, total: 10 } });
    });
    await expect(ensurePandoc()).resolves.toBe(true);
    expect(mocks.downloadPandoc).toHaveBeenCalledOnce();
    expect(anyToast()).toBe(false);
    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });

  it("logs a background download failure and never toasts it", async () => {
    const failure = new Error("offline");
    mocks.downloadPandoc.mockRejectedValue(failure);
    const { ensurePandoc } = await loadPandoc();
    await expect(ensurePandoc()).resolves.toBe(false);
    expect(mocks.logError).toHaveBeenCalledWith("download pandoc", failure);
    expect(anyToast()).toBe(false);
  });

  it("does not restart a failed download on every compile and backs off exponentially up to a cap", async () => {
    mocks.downloadPandoc.mockRejectedValue(new Error("offline"));
    const { ensurePandoc } = await loadPandoc();

    await ensurePandoc();
    for (let compile = 0; compile < 100; compile++) await expect(ensurePandoc()).resolves.toBe(false);
    expect(mocks.downloadPandoc).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(ONE_MINUTE - 1);
    await ensurePandoc();
    expect(mocks.downloadPandoc).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await ensurePandoc();
    expect(mocks.downloadPandoc).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(2 * ONE_MINUTE - 1);
    await ensurePandoc();
    expect(mocks.downloadPandoc).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    await ensurePandoc();
    expect(mocks.downloadPandoc).toHaveBeenCalledTimes(3);

    for (let attempt = 3; attempt < 12; attempt++) {
      vi.advanceTimersByTime(30 * ONE_MINUTE);
      await ensurePandoc();
    }
    expect(mocks.downloadPandoc).toHaveBeenCalledTimes(12);
    expect(anyToast()).toBe(false);
  });

  it("spreads background retries with jitter below the ceiling", async () => {
    fixRandomFraction(0);
    mocks.downloadPandoc.mockRejectedValue(new Error("offline"));
    const { ensurePandoc } = await loadPandoc();
    await ensurePandoc();
    vi.advanceTimersByTime(ONE_MINUTE / 2 - 1);
    await ensurePandoc();
    expect(mocks.downloadPandoc).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await ensurePandoc();
    expect(mocks.downloadPandoc).toHaveBeenCalledTimes(2);
  });

  it("notices a manual install during the backoff and resets it", async () => {
    mocks.downloadPandoc.mockRejectedValueOnce(new Error("offline"));
    const { ensurePandoc } = await loadPandoc();
    await ensurePandoc();
    mocks.hasPandoc.mockResolvedValueOnce(true);
    await expect(ensurePandoc()).resolves.toBe(true);
    mocks.downloadPandoc.mockResolvedValue(undefined);
    await expect(ensurePandoc()).resolves.toBe(true);
    expect(mocks.downloadPandoc).toHaveBeenCalledTimes(2);
  });

  it("lets a user action retry at once and reports progress and failure in one keyed slot", async () => {
    mocks.downloadPandoc.mockRejectedValue(new Error("offline"));
    const { ensurePandoc } = await loadPandoc();
    await ensurePandoc();
    await expect(ensurePandoc({ notify: true })).resolves.toBe(false);

    expect(mocks.downloadPandoc).toHaveBeenCalledTimes(2);
    expect(mocks.toast.infoUnique).toHaveBeenCalledExactlyOnceWith(KEY, percent(0), undefined, true);
    expect(mocks.toast.errorUnique).toHaveBeenCalledExactlyOnceWith(
      KEY,
      i18n.t(($) => $.core.pandoc.downloadFailed),
      expect.objectContaining({ label: i18n.t(($) => $.core.pandoc.installGuide) }),
      true,
    );
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(mocks.toast.dismiss).not.toHaveBeenCalled();

    const action = vi.mocked(mocks.toast.errorUnique).mock.calls[0] as unknown[];
    (action[2] as { onClick: () => void }).onClick();
    expect(mocks.open).toHaveBeenCalledWith("https://pandoc.org/installing.html");
  });

  it("updates the progress slot in place and dismisses it on success without an installed toast", async () => {
    const { ensurePandoc } = await loadPandoc();
    mocks.downloadPandoc.mockImplementation(async () => {
      mocks.listener?.({ payload: { received: 50, total: 100 } });
      mocks.listener?.({ payload: { received: 2_500_000, total: null } });
    });
    await expect(ensurePandoc({ notify: true })).resolves.toBe(true);

    expect(mocks.toast.infoUnique).toHaveBeenCalledOnce();
    expect(mocks.toast.update).toHaveBeenNthCalledWith(1, 7, percent(50));
    expect(mocks.toast.update).toHaveBeenNthCalledWith(
      2,
      7,
      i18n.t(($) => $.core.pandoc.downloadingSize, { megabytes: "2.5" }),
    );
    expect(mocks.toast.dismiss).toHaveBeenCalledExactlyOnceWith(7);
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(mocks.toast.info).not.toHaveBeenCalled();
  });

  it("shares one download between callers and attaches progress when a user action joins a background download", async () => {
    let finish!: () => void;
    mocks.downloadPandoc.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const { ensurePandoc } = await loadPandoc();

    const background = ensurePandoc();
    await vi.waitFor(() => expect(mocks.downloadPandoc).toHaveBeenCalledOnce());
    mocks.listener?.({ payload: { received: 30, total: 100 } });
    expect(anyToast()).toBe(false);

    const explicit = ensurePandoc({ notify: true });
    const second = ensurePandoc({ notify: true });
    expect(explicit).toBe(background);
    expect(second).toBe(background);
    expect(mocks.toast.infoUnique).toHaveBeenCalledExactlyOnceWith(KEY, percent(30), undefined, true);

    finish();
    await expect(background).resolves.toBe(true);
    expect(mocks.downloadPandoc).toHaveBeenCalledOnce();
    expect(mocks.toast.dismiss).toHaveBeenCalledExactlyOnceWith(7);
  });

  it("reports a failed shared download to the user action that joined it", async () => {
    let fail!: (error: Error) => void;
    mocks.downloadPandoc.mockReturnValue(new Promise<void>((_resolve, reject) => { fail = reject; }));
    const { ensurePandoc } = await loadPandoc();
    const background = ensurePandoc();
    await vi.waitFor(() => expect(mocks.downloadPandoc).toHaveBeenCalledOnce());
    void ensurePandoc({ notify: true });
    fail(new Error("offline"));
    await expect(background).resolves.toBe(false);
    expect(mocks.toast.errorUnique).toHaveBeenCalledOnce();
  });

  it("starts a fresh attempt after the previous one settled", async () => {
    const { ensurePandoc } = await loadPandoc();
    await ensurePandoc({ notify: true });
    await ensurePandoc({ notify: true });
    expect(mocks.downloadPandoc).toHaveBeenCalledTimes(2);
  });

  it("falls through to a download when the presence check fails", async () => {
    const failure = new Error("ipc down");
    mocks.hasPandoc.mockRejectedValue(failure);
    const { ensurePandoc } = await loadPandoc();
    await expect(ensurePandoc()).resolves.toBe(true);
    expect(mocks.logError).toHaveBeenCalledWith("check pandoc", failure);
    expect(mocks.downloadPandoc).toHaveBeenCalledOnce();
  });
});
