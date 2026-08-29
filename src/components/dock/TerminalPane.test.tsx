// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalPane } from "./TerminalPane";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: ((data: string) => void) | null = null;
  },
  invoke,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options = {};
    loadAddon = vi.fn();
    open = vi.fn();
    write = vi.fn();
    writeln = vi.fn();
    dispose = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme: "light" }),
}));

describe("TerminalPane", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation((command: string) =>
      Promise.resolve(command === "term_open" ? "term-1" : undefined),
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  it("keeps the PTY alive across title and visibility changes", async () => {
    const { rerender, unmount } = render(
      <TerminalPane projectId="project-1" visible />,
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "term_open",
        expect.objectContaining({ projectId: "project-1" }),
      );
    });

    rerender(
      <TerminalPane projectId="project-1" projectName="Paper" visible={false} />,
    );
    rerender(<TerminalPane projectId="project-1" projectName="Paper" visible />);

    expect(invoke.mock.calls.filter(([command]) => command === "term_open")).toHaveLength(1);
    expect(invoke.mock.calls.filter(([command]) => command === "term_kill")).toHaveLength(0);

    unmount();

    await waitFor(() => {
      expect(invoke.mock.calls.filter(([command]) => command === "term_kill")).toHaveLength(1);
    });
  });
});
