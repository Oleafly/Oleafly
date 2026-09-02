// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalDock } from "./TerminalDock";
import { TERMINAL_LIMIT, useTerminalsStore } from "@/store/terminals";

const mocks = vi.hoisted(() => ({
  panes: [] as Array<Record<string, unknown>>,
  setOpen: null as ((open: boolean) => void) | null,
  settings: {
    setTerminalOpen: vi.fn(),
    terminalBackground: "#1e1e1e",
    terminalStartWithProject: true,
  },
}));

vi.mock("@/store/settings", () => ({
  useSettingsStore: (selector: (settings: typeof mocks.settings) => unknown) =>
    selector(mocks.settings),
}));

vi.mock("./TerminalPane", () => ({
  TerminalPane: (props: {
    projectId: string;
    visible?: boolean;
    active?: boolean;
    autoStart?: boolean;
    onExit?: () => void;
  }) => {
    mocks.panes.push(props);
    return (
      <div
        data-testid={props.active ? "dock-terminal" : "dock-terminal-inactive"}
        data-project={props.projectId}
        data-visible={props.visible ? "true" : "false"}
        data-auto-start={props.autoStart ? "true" : "false"}
      >
        <button type="button" data-testid="pane-exit" onClick={() => props.onExit?.()}>
          exit
        </button>
      </div>
    );
  },
}));

function tabs() {
  return screen.getAllByTestId("dock-terminal-tab");
}

function DockHarness({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(true);
  mocks.setOpen = setOpen;
  return <TerminalDock projectId={projectId} visible={open} />;
}

function exitActivePane() {
  const exit = screen.getByTestId("dock-terminal").querySelector('[data-testid="pane-exit"]');
  if (!exit) throw new Error("active pane has no exit control");
  fireEvent.click(exit);
}

describe("TerminalDock", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.panes.length = 0;
    mocks.setOpen = null;
    mocks.settings.setTerminalOpen.mockReset();
    mocks.settings.setTerminalOpen.mockImplementation((open: boolean) => mocks.setOpen?.(open));
    mocks.settings.terminalStartWithProject = true;
    useTerminalsStore.setState({ projectId: null, tabs: [], activeId: null, counters: {} });
  });

  it("opens with one active terminal tab that starts per the project setting", () => {
    render(<TerminalDock projectId="project-1" visible={false} />);

    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]).toHaveTextContent("Terminal 1");
    expect(tabs()[0]).toHaveAttribute("data-active", "true");
    expect(tabs()[0]).toHaveAttribute("data-session-index", "1");
    expect(screen.getByTestId("dock-terminal")).toHaveAttribute("data-auto-start", "false");
    expect(screen.getByLabelText("New terminal")).toBeEnabled();
  });

  it("adds, activates, and switches terminals, keeping the inactive pane hidden", () => {
    render(<TerminalDock projectId="project-1" visible />);

    fireEvent.click(screen.getByLabelText("New terminal"));

    expect(tabs()).toHaveLength(2);
    expect(tabs()[1]).toHaveTextContent("Terminal 2");
    expect(tabs()[1]).toHaveAttribute("data-active", "true");
    expect(tabs()[0]).toHaveAttribute("data-active", "false");
    expect(screen.getByTestId("dock-terminal")).toHaveAttribute("data-auto-start", "true");
    expect(screen.getByTestId("dock-terminal")).toHaveAttribute("data-visible", "true");
    expect(screen.getByTestId("dock-terminal-inactive")).toHaveAttribute("data-visible", "false");

    fireEvent.click(tabs()[0]);

    expect(tabs()[0]).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("dock-terminal")).toHaveAttribute("data-auto-start", "false");
  });

  it("renames a terminal from the rename control and persists the title", () => {
    render(<TerminalDock projectId="project-1" visible />);

    fireEvent.click(screen.getByLabelText("Rename Terminal 1"));
    const input = screen.getByLabelText("Terminal title");
    expect(input).toHaveAttribute("maxlength", "40");
    fireEvent.change(input, { target: { value: "Build" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.queryByLabelText("Terminal title")).toBeNull();
    expect(tabs()[0]).toHaveTextContent("Build");
    expect(screen.getByLabelText("Close Build")).toBeInTheDocument();
    expect(localStorage.getItem("oleafly.terminal.titles.project-1")).toContain("Build");
  });

  it("opens the rename input on double click, cancels on Escape, and saves on blur", () => {
    render(<TerminalDock projectId="project-1" visible />);

    fireEvent.doubleClick(tabs()[0]);
    const input = screen.getByLabelText("Terminal title");
    fireEvent.change(input, { target: { value: "Ignored" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(tabs()[0]).toHaveTextContent("Terminal 1");

    fireEvent.doubleClick(tabs()[0]);
    const again = screen.getByLabelText("Terminal title");
    fireEvent.change(again, { target: { value: "Server" } });
    fireEvent.blur(again);
    expect(tabs()[0]).toHaveTextContent("Server");
  });

  it("closes the dock when the last tab is closed from its control", () => {
    render(<DockHarness projectId="project-1" />);

    fireEvent.click(screen.getByLabelText("Close Terminal 1"));

    expect(mocks.settings.setTerminalOpen).toHaveBeenCalledWith(false);
    expect(screen.queryAllByTestId("dock-terminal-tab")).toHaveLength(0);
    expect(screen.queryByTestId("dock-terminal")).toBeNull();
  });

  it("closes a tab from its close control and activates the neighbor", () => {
    render(<TerminalDock projectId="project-1" visible />);
    fireEvent.click(screen.getByLabelText("New terminal"));
    fireEvent.click(screen.getByLabelText("New terminal"));
    fireEvent.click(tabs()[1]);

    fireEvent.click(screen.getByLabelText("Close Terminal 2"));

    expect(tabs()).toHaveLength(2);
    expect(tabs()[1]).toHaveTextContent("Terminal 3");
    expect(tabs()[1]).toHaveAttribute("data-active", "true");
    expect(mocks.settings.setTerminalOpen).not.toHaveBeenCalled();
  });

  it("closes the dock when the last shell exits and starts fresh on the next show", async () => {
    render(<DockHarness projectId="project-1" />);

    exitActivePane();

    expect(mocks.settings.setTerminalOpen).toHaveBeenCalledWith(false);
    expect(screen.queryAllByTestId("dock-terminal-tab")).toHaveLength(0);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryAllByTestId("dock-terminal-tab")).toHaveLength(0);

    act(() => mocks.setOpen?.(true));
    await waitFor(() => expect(tabs()).toHaveLength(1));
    expect(tabs()[0]).toHaveTextContent("Terminal 2");
    expect(tabs()[0]).toHaveAttribute("data-active", "true");
  });

  it("closes only the exited tab when others remain", () => {
    render(<TerminalDock projectId="project-1" visible />);
    fireEvent.click(screen.getByLabelText("New terminal"));

    exitActivePane();

    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]).toHaveTextContent("Terminal 1");
    expect(tabs()[0]).toHaveAttribute("data-active", "true");
    expect(mocks.settings.setTerminalOpen).not.toHaveBeenCalled();
  });

  it("disables the new terminal button at the cap", () => {
    render(<TerminalDock projectId="project-1" visible />);
    for (let count = 1; count < TERMINAL_LIMIT; count += 1) {
      fireEvent.click(screen.getByLabelText("New terminal"));
    }

    expect(tabs()).toHaveLength(TERMINAL_LIMIT);
    expect(screen.getByLabelText("New terminal")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("New terminal"));
    expect(tabs()).toHaveLength(TERMINAL_LIMIT);

    fireEvent.click(screen.getByLabelText("Close Terminal 10"));
    expect(screen.getByLabelText("New terminal")).toBeEnabled();
  });

  it("replaces every tab when the project changes", () => {
    const view = render(<TerminalDock projectId="project-1" visible={false} />);
    fireEvent.click(screen.getByLabelText("New terminal"));
    expect(tabs()).toHaveLength(2);

    view.rerender(<TerminalDock projectId="project-2" visible={false} />);

    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]).toHaveTextContent("Terminal 1");
    expect(screen.getByTestId("dock-terminal")).toHaveAttribute("data-project", "project-2");
    expect(screen.queryByTestId("dock-terminal-inactive")).toBeNull();
  });

  it("clears the tabs when the dock unmounts for good", async () => {
    const view = render(<TerminalDock projectId="project-1" visible />);
    fireEvent.click(screen.getByLabelText("New terminal"));

    view.unmount();
    await act(async () => {
      await Promise.resolve();
    });

    expect(useTerminalsStore.getState()).toMatchObject({ projectId: null, tabs: [] });
  });
});
