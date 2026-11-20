// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LogEntry } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  readLogEntries: vi.fn(),
  clearLogs: vi.fn(async () => undefined),
  revealAppLog: vi.fn(async () => undefined),
  exportLogArchive: vi.fn(async (_dest: string) => undefined),
  pickSavePath: vi.fn(),
  logError: vi.fn(async (_scope: string, _error: unknown) => undefined),
  logWarning: vi.fn(async (_scope: string, _error: unknown) => undefined),
  writeText: vi.fn(async (_text: string) => undefined),
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
  highlighted: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  readLogEntries: mocks.readLogEntries,
  clearLogs: mocks.clearLogs,
  revealAppLog: mocks.revealAppLog,
  exportLogArchive: mocks.exportLogArchive,
}));
vi.mock("@/lib/native-file-dialog", () => ({ pickSavePath: mocks.pickSavePath }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError, logWarning: mocks.logWarning }));
vi.mock("@/lib/toast", () => ({ toast: mocks.toast }));
vi.mock("@/components/ui/highlighted", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/highlighted")>();
  return {
    ...actual,
    Highlighted: (props: Parameters<typeof actual.Highlighted>[0]) => {
      mocks.highlighted(props.text);
      return actual.Highlighted(props);
    },
  };
});

import { loadNamespace } from "@/i18n";
import { UNMEASURED_ROW_COUNT } from "@/hooks/use-row-window";
import { LogsSection } from "./LogsSection";

const NOW = new Date(2026, 10, 15, 12, 0, 0);
const TODAY = new Date(2026, 10, 15).getTime();
const HOUR = 3_600_000;

function entry(overrides: Partial<LogEntry> & Pick<LogEntry, "ts_ms" | "message">): LogEntry {
  return { level: "info", safe: null, sensitive: null, ...overrides };
}

const ENTRIES: LogEntry[] = [
  entry({ ts_ms: TODAY - 5 * 24 * HOUR, message: "subagent hook", safe: { agentType: "reviewer" } }),
  entry({
    ts_ms: TODAY - 2 * HOUR,
    level: "warning",
    message: "compiled output not shared",
    safe: { reason: "unreachable" },
    sensitive: { project_id: "8f2c41d0", error: "connection refused" },
  }),
  entry({ ts_ms: TODAY + HOUR, message: "build succeeded", safe: { engine: "tectonic", duration_ms: 1812 } }),
  entry({
    ts_ms: TODAY + 2 * HOUR,
    level: "error",
    message: "build failed",
    safe: { engine: "tectonic", errors: 3 },
    sensitive: { main_file: "main.tex" },
  }),
  entry({ ts_ms: TODAY + 3 * HOUR, level: "error", message: "pdf preview: undefined is not an object", safe: "raw" }),
];

function renderSection(entries: LogEntry[] = ENTRIES) {
  mocks.readLogEntries.mockResolvedValue(entries);
  const user = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.writeText },
  });
  const view = render(<LogsSection />);
  return { user, view };
}

async function rowButton(message: string) {
  const text = await screen.findByText(message, { selector: "span" });
  const button = text.closest("button");
  if (!button) throw new Error(`no row for ${message}`);
  return button;
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await Promise.all([loadNamespace("settings"), loadNamespace("common"), loadNamespace("workspace")]);
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LogsSection", () => {
  it("shows a loading state, then the entries newest first under day headings", async () => {
    let resolve: (entries: LogEntry[]) => void = () => {};
    mocks.readLogEntries.mockReturnValue(new Promise<LogEntry[]>((done) => (resolve = done)));
    render(<LogsSection />);
    expect(screen.getByText("Reading the logs")).toBeInTheDocument();
    resolve(ENTRIES);

    const groups = await screen.findAllByRole("region");
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
      "Today",
      "Yesterday",
      expect.not.stringMatching(/Today|Yesterday/),
    ]);
    const today = within(groups[0]).getAllByRole("button");
    expect(today[0]).toHaveTextContent("pdf preview: undefined is not an object");
    expect(today[0]).toHaveTextContent("value=raw");
    expect(today[1]).toHaveTextContent("build failed");
    expect(today[1]).toHaveTextContent("Error");
    expect(within(groups[1]).getByRole("button")).toHaveTextContent("Warning");
    expect(within(groups[1]).getByRole("button")).toHaveTextContent("reason=unreachable");
    expect(screen.getByText("5 entries")).toBeInTheDocument();
    expect(screen.getByText("Newest first")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /All/ })).toHaveTextContent("5");
    expect(screen.getByRole("tab", { name: /Warnings/ })).toHaveTextContent("1");
    expect(screen.getByRole("tab", { name: /Errors/ })).toHaveTextContent("2");
  });

  it("leaves out the inline fields of an entry that has none", async () => {
    renderSection([entry({ ts_ms: TODAY + HOUR, message: "quiet entry" })]);
    const button = await rowButton("quiet entry");
    expect(button.textContent).not.toContain("=");
    expect(screen.getByText("1 entry")).toBeInTheDocument();
  });

  it("filters by level with the tabs", async () => {
    const { user } = renderSection();
    await screen.findByText("build failed");

    await user.click(screen.getByRole("tab", { name: /Errors/ }));
    expect(screen.queryByText("build succeeded")).not.toBeInTheDocument();
    expect(screen.getByText("build failed")).toBeInTheDocument();
    expect(screen.getByText("2 of 5 entries")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Warnings/ }));
    expect(screen.getByText("compiled output not shared")).toBeInTheDocument();
    expect(screen.queryByText("build failed")).not.toBeInTheDocument();
  });

  it("searches messages and fields, highlights matches and updates the counts", async () => {
    const { user } = renderSection();
    await screen.findByText("build failed");

    await user.type(screen.getByRole("searchbox", { name: "Search logs" }), "BUILD");
    expect(await screen.findByText("2 of 5 entries")).toBeInTheDocument();
    const marks = document.querySelectorAll("mark");
    expect([...marks].map((mark) => mark.textContent)).toEqual(["build", "build"]);
    expect(screen.getByRole("tab", { name: /All/ })).toHaveTextContent("2");

    await user.clear(screen.getByRole("searchbox", { name: "Search logs" }));
    await user.type(screen.getByRole("searchbox", { name: "Search logs" }), "8f2c");
    expect(await screen.findByText("1 of 5 entries")).toBeInTheDocument();
    expect(screen.getByText("compiled output not shared")).toBeInTheDocument();
    expect(document.querySelectorAll("mark")).toHaveLength(0);
  });

  it("offers a way back when the search matches nothing", async () => {
    const { user } = renderSection();
    await screen.findByText("build failed");

    await user.type(screen.getByRole("searchbox", { name: "Search logs" }), "zotero");
    expect(await screen.findByText('No entries match "zotero"')).toBeInTheDocument();
    expect(screen.getByText("0 of 5 entries")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("searchbox", { name: "Search logs" })).toHaveValue("");
    expect(screen.getByText("5 entries")).toBeInTheDocument();
  });

  it("offers all levels when a level has no entries", async () => {
    const { user } = renderSection([entry({ ts_ms: TODAY + HOUR, message: "only info" })]);
    await screen.findByText("only info");

    await user.click(screen.getByRole("tab", { name: /Errors/ }));
    expect(screen.getByText("No entries at this level")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show all levels" }));
    expect(screen.getByText("only info")).toBeInTheDocument();
  });

  it("expands an entry to show its fields, private details and a copy button", async () => {
    const { user } = renderSection();
    const button = await rowButton("build failed");

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Private, left out when you export")).toBeInTheDocument();
    expect(screen.getByText("main_file")).toBeInTheDocument();
    expect(screen.getByText("main.tex")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy entry" }));
    expect(mocks.writeText).toHaveBeenCalledWith(
      `${new Date(TODAY + 2 * HOUR).toISOString()} error build failed\nengine=tectonic\nerrors=3`,
    );
    expect(mocks.writeText.mock.calls.flat().join("\n")).not.toContain("main.tex");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Private, left out when you export")).not.toBeInTheDocument();
  });

  it("shows no private group for an entry without private details", async () => {
    const { user } = renderSection();
    await user.click(await rowButton("build succeeded"));
    expect(screen.getByText("duration_ms")).toBeInTheDocument();
    expect(screen.getByText("1812")).toBeInTheDocument();
    expect(screen.queryByText("Private, left out when you export")).not.toBeInTheDocument();
  });

  it("exports the logs to a chosen zip file", async () => {
    const { user } = renderSection();
    await screen.findByText("build failed");

    mocks.pickSavePath.mockResolvedValueOnce(null);
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(mocks.pickSavePath).toHaveBeenCalledWith({
      defaultPath: "oleafly-logs-2026-11-15.zip",
      filters: [{ name: "Zip archive", extensions: ["zip"] }],
    });
    expect(mocks.exportLogArchive).not.toHaveBeenCalled();

    mocks.pickSavePath.mockResolvedValueOnce("/Users/ada/Desktop/oleafly-logs.zip");
    await user.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith("Saved the logs to oleafly-logs.zip."));
    expect(mocks.exportLogArchive).toHaveBeenCalledWith("/Users/ada/Desktop/oleafly-logs.zip");
  });

  it("reports an export that fails", async () => {
    const { user } = renderSection();
    await screen.findByText("build failed");
    mocks.pickSavePath.mockResolvedValueOnce("/tmp/logs.zip");
    mocks.exportLogArchive.mockRejectedValueOnce(new Error("disk full"));

    await user.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Couldn't export the logs."));
    expect(mocks.logError).toHaveBeenCalledWith("export logs", expect.any(Error));
  });

  it("opens the log folder and reports when it cannot", async () => {
    const { user } = renderSection();
    await screen.findByText("build failed");

    await user.click(screen.getByRole("button", { name: "Open log folder" }));
    expect(mocks.revealAppLog).toHaveBeenCalledTimes(1);
    expect(mocks.toast.error).not.toHaveBeenCalled();

    mocks.revealAppLog.mockRejectedValueOnce(new Error("no finder"));
    await user.click(screen.getByRole("button", { name: "Open log folder" }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Couldn't open the log folder."));
    expect(mocks.logError).toHaveBeenCalledWith("reveal app log", expect.any(Error));
  });

  it("clears the logs after a confirmation", async () => {
    const { user } = renderSection();
    await screen.findByText("build failed");

    await user.click(screen.getByRole("button", { name: "Clear" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Clear all logs?")).toBeInTheDocument();
    expect(within(dialog).getByText(/This deletes all 5 entries/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /Cancel/ }));
    expect(mocks.clearLogs).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Clear" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /Clear logs/ }));
    expect(await screen.findByText("No log entries")).toBeInTheDocument();
    expect(mocks.clearLogs).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
    expect(screen.queryByText("Newest first")).not.toBeInTheDocument();
  });

  it("keeps the entries when clearing fails", async () => {
    const { user } = renderSection();
    await screen.findByText("build failed");
    mocks.clearLogs.mockRejectedValueOnce(new Error("locked"));

    await user.click(screen.getByRole("button", { name: "Clear" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /Clear logs/ }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Couldn't clear the logs."));
    expect(screen.getByText("build failed")).toBeInTheDocument();
    expect(mocks.logError).toHaveBeenCalledWith("clear logs", expect.any(Error));
  });

  it("shows an empty state with the actions turned off when there are no entries", async () => {
    renderSection([]);
    expect(await screen.findByText("No log entries")).toBeInTheDocument();
    expect(screen.getByText("Builds and errors show up here as they happen.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Open log folder" })).toBeEnabled();
  });

  it("reports a failed read and reads again on request", async () => {
    mocks.readLogEntries.mockRejectedValueOnce(new Error("unreadable")).mockResolvedValueOnce(ENTRIES);
    const user = userEvent.setup();
    render(<LogsSection />);

    expect(await screen.findByText("Couldn't read the logs.")).toBeInTheDocument();
    expect(mocks.logError).toHaveBeenCalledWith("read log entries", expect.any(Error));
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("build failed")).toBeInTheDocument();
    expect(mocks.readLogEntries).toHaveBeenCalledTimes(2);
  });

  it("ignores a read that finishes after the section closed", async () => {
    let resolve: (entries: LogEntry[]) => void = () => {};
    let reject: (error: unknown) => void = () => {};
    mocks.readLogEntries
      .mockReturnValueOnce(new Promise<LogEntry[]>((done) => (resolve = done)))
      .mockReturnValueOnce(new Promise<LogEntry[]>((_, fail) => (reject = fail)));
    const first = render(<LogsSection />);
    first.unmount();
    resolve(ENTRIES);
    const second = render(<LogsSection />);
    second.unmount();
    reject(new Error("late"));
    await waitFor(() => expect(mocks.logError).toHaveBeenCalledWith("read log entries", expect.any(Error)));
  });
});

function manyEntries(count: number): LogEntry[] {
  return Array.from({ length: count }, (_, index) =>
    entry({ ts_ms: TODAY + index * 1_000, message: `step ${index}`, safe: { index } }),
  );
}

function withTimers(toFake: ("setTimeout" | "clearTimeout" | "setInterval" | "clearInterval")[]) {
  vi.useFakeTimers({ toFake: ["Date", ...toFake] });
  vi.setSystemTime(NOW);
  return () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  };
}

describe("LogsSection with a full log", () => {
  it("renders a bounded window of rows out of 2,000 entries", async () => {
    renderSection(manyEntries(2_000));
    expect(await screen.findByText(/^2,?000 entries$/)).toBeInTheDocument();
    const rows = screen.getAllByRole("button", { expanded: false });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(UNMEASURED_ROW_COUNT);
    expect(rows[0]).toHaveTextContent("step 1999");
  });

  it("leaves the rows alone while the search is typed and filters once it settles", async () => {
    const restore = withTimers(["setTimeout", "clearTimeout"]);
    try {
      mocks.readLogEntries.mockResolvedValue(manyEntries(2_000));
      render(<LogsSection />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText(/^2,?000 entries$/)).toBeInTheDocument();
      mocks.highlighted.mockClear();

      const search = screen.getByRole("searchbox", { name: "Search logs" });
      for (const end of [1, 2, 3, 4, 5, 6, 7]) {
        fireEvent.change(search, { target: { value: "step 19".slice(0, end) } });
      }
      expect(search).toHaveValue("step 19");
      expect(mocks.highlighted).not.toHaveBeenCalled();
      expect(screen.getByText(/^2,?000 entries$/)).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(screen.getByText(/^111 of 2,?000 entries$/)).toBeInTheDocument();
      expect(mocks.highlighted.mock.calls.length).toBeLessThanOrEqual(UNMEASURED_ROW_COUNT);
      expect(mocks.highlighted.mock.calls.every(([text]) => String(text).includes("step 19"))).toBe(true);
    } finally {
      restore();
    }
  });

  it("re-renders only the row that opens", async () => {
    const { user } = renderSection(manyEntries(50));
    const button = await rowButton("step 49");
    mocks.highlighted.mockClear();
    await user.click(button);
    expect(mocks.highlighted.mock.calls.map(([text]) => text)).toEqual(["step 49"]);
  });
});

describe("LogsSection refresh", () => {
  it("shows entries written while the section is open, and keeps the list when nothing changed", async () => {
    const restore = withTimers(["setInterval", "clearInterval"]);
    try {
      renderSection([entry({ ts_ms: TODAY + HOUR, message: "first entry" })]);
      expect(await screen.findByText("first entry")).toBeInTheDocument();

      mocks.highlighted.mockClear();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(mocks.readLogEntries).toHaveBeenCalledTimes(2);
      expect(mocks.highlighted).not.toHaveBeenCalled();

      mocks.readLogEntries.mockResolvedValue([
        entry({ ts_ms: TODAY + HOUR, message: "first entry" }),
        entry({ ts_ms: TODAY + 2 * HOUR, level: "error", message: "build failed" }),
      ]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(screen.getByText("build failed")).toBeInTheDocument();
      expect(screen.getByText("2 entries")).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("logs one warning for a run of failed refreshes and keeps the entries", async () => {
    const restore = withTimers(["setInterval", "clearInterval"]);
    try {
      renderSection();
      expect(await screen.findByText("build failed")).toBeInTheDocument();
      mocks.readLogEntries.mockRejectedValue(new Error("ring locked"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(mocks.logWarning).toHaveBeenCalledTimes(1);
      expect(mocks.logWarning).toHaveBeenCalledWith("refresh log entries", expect.any(Error));
      expect(screen.getByText("build failed")).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("does not bring back entries a refresh read before the logs were cleared", async () => {
    const restore = withTimers(["setInterval", "clearInterval"]);
    try {
      const { user } = renderSection();
      expect(await screen.findByText("build failed")).toBeInTheDocument();
      let finish: (entries: LogEntry[]) => void = () => {};
      mocks.readLogEntries.mockReturnValueOnce(new Promise<LogEntry[]>((done) => (finish = done)));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      await user.click(screen.getByRole("button", { name: "Clear" }));
      await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /Clear logs/ }));
      expect(await screen.findByText("No log entries")).toBeInTheDocument();
      await act(async () => {
        finish(ENTRIES);
      });
      expect(screen.getByText("No log entries")).toBeInTheDocument();
    } finally {
      restore();
    }
  });
});
