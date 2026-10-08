// @vitest-environment jsdom

import { cleanup, act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

const mocks = vi.hoisted(() => ({
  checkpointList: vi.fn(),
  checkpointStats: vi.fn(),
  checkpointFiles: vi.fn(),
  tooltipRenders: new Map<string, number>(),
}));

vi.mock("@/lib/checkpoints", () => ({
  checkpointDelete: vi.fn(),
  checkpointEngineLabel: (engine: string) => engine,
  checkpointExport: vi.fn(),
  checkpointFiles: mocks.checkpointFiles,
  checkpointImport: vi.fn(),
  checkpointInspect: vi.fn(),
  checkpointKeepLatest: vi.fn(),
  checkpointList: mocks.checkpointList,
  checkpointReset: vi.fn(),
  checkpointRestore: vi.fn(),
  checkpointRevealStore: vi.fn(),
  checkpointSetLabel: vi.fn(),
  checkpointStats: mocks.checkpointStats,
}));
vi.mock("@/lib/native-file-dialog", () => ({ pickOpenPath: vi.fn(), pickSavePath: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/toast", () => ({ notifyError: vi.fn(), toast: { success: vi.fn() } }));
vi.mock("@/components/ui/tooltip", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/ui/tooltip")>();
  return {
    ...original,
    Tooltip: ({ label, children }: { label: string; children: ReactNode }) => {
      mocks.tooltipRenders.set(label, (mocks.tooltipRenders.get(label) ?? 0) + 1);
      return <>{children}</>;
    },
  };
});

import { CheckpointsPanel } from "./CheckpointsPanel";

const NOW = 1_777_000_220_000;
const COUNT = 100;
const history = Array.from({ length: COUNT }, (_, index) => ({
  snapshot_root: `root-${String(index).padStart(32, "0")}`,
  completed_at_unix_ms: NOW - (index + 1) * 60_000,
  engine: "Tectonic",
  toolchain_identity: "tectonic@0.15.0",
  main_document: "main.tex",
  output_hash: `output-${index}`,
  file_count: 4,
  logical_bytes: 4096,
  label: null,
}));

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly targets = new Set<Element>();
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
  }
  takeRecords() {
    return [];
  }
  static observing() {
    return FakeIntersectionObserver.instances.some((observer) => observer.targets.size > 0);
  }
  static reveal() {
    for (const observer of [...FakeIntersectionObserver.instances]) {
      const entries = [...observer.targets].map(
        (target) => ({ target, isIntersecting: true }) as unknown as IntersectionObserverEntry,
      );
      if (entries.length) observer.callback(entries, observer as unknown as IntersectionObserver);
    }
  }
}

beforeEach(() => {
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  mocks.tooltipRenders.clear();
  mocks.checkpointList.mockResolvedValue(history);
  mocks.checkpointStats.mockResolvedValue({
    checkpoint_count: COUNT,
    stored_pack_bytes: 2048,
    logical_bytes: 6144,
    reclaimable_bytes: 0,
  });
  mocks.checkpointFiles.mockResolvedValue([]);
  useSettingsStore.setState({ versioningOpen: true });
  useFilesStore.setState({ projectId: "project", projectName: "Research draft" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("checkpoint timeline with a long history", () => {
  it("renders the newest entries first and reveals the rest as the list scrolls", async () => {
    render(<CheckpointsPanel />);
    const timeline = await screen.findByTestId("checkpoint-timeline");
    const first = within(timeline).getAllByTestId("checkpoint-entry");
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThan(COUNT);
    expect(first[0]).toHaveAttribute("data-version", `V${COUNT}`);

    for (let step = 0; step < COUNT; step += 1) {
      const shown = within(timeline).getAllByTestId("checkpoint-entry").length;
      if (shown === COUNT) break;
      await waitFor(() => expect(FakeIntersectionObserver.observing()).toBe(true));
      act(() => FakeIntersectionObserver.reveal());
      await waitFor(() =>
        expect(within(timeline).getAllByTestId("checkpoint-entry").length).toBeGreaterThan(shown),
      );
    }

    const all = within(timeline).getAllByTestId("checkpoint-entry");
    expect(all).toHaveLength(COUNT);
    expect(all.at(-1)).toHaveAttribute("data-version", "V1");
  });

  it("re-renders only the entry whose files are toggled", async () => {
    render(<CheckpointsPanel />);
    const timeline = await screen.findByTestId("checkpoint-timeline");
    const entry = within(timeline).getAllByTestId("checkpoint-entry")[3];
    mocks.tooltipRenders.clear();

    const user = userEvent.setup();
    await user.click(within(entry).getByRole("button", { name: /files/i }));

    const rendered = [...mocks.tooltipRenders.values()].reduce((sum, count) => sum + count, 0);
    expect(rendered).toBeLessThanOrEqual(6);
  });
});
