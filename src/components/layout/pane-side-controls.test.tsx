// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AssistantShellHeader } from "@/components/ai/AssistantShellHeader";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { DEFAULT_PANE_LAYOUT, movePane, usePaneLayoutStore, type PaneId } from "@/store/pane-layout";
import { useSettingsStore } from "@/store/settings";
import { PaneReorderProvider } from "./pane-reorder";
import { SidebarCollapseToggle } from "./WorkspaceControls";

function InWorkspace({ visible }: Readonly<{ visible: readonly PaneId[] }>) {
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <PaneReorderProvider rootRef={rootRef} visiblePanes={visible}>
      <div ref={rootRef}>
        <div id="assistant" data-panel="">
          <AssistantShellHeader data-testid="ai-assistant-header" />
        </div>
      </div>
    </PaneReorderProvider>
  );
}

beforeEach(() => {
  usePaneLayoutStore.setState({ layout: DEFAULT_PANE_LAYOUT });
  useSettingsStore.setState({ showTree: true, assistantOpen: true });
});

afterEach(() => {
  usePaneLayoutStore.setState({ layout: DEFAULT_PANE_LAYOUT });
});

describe("controls that point at a pane's side", () => {
  it("draws the sidebar toggle on the side the sidebar sits", () => {
    render(<SidebarCollapseToggle />);
    const toggle = () => screen.getByRole("button");
    expect(toggle().querySelector("svg.lucide-panel-left-close")).not.toBeNull();
    act(() => usePaneLayoutStore.getState().move("sidebar", { kind: "pane", pane: "assistant", side: "right" }));
    expect(toggle().querySelector("svg.lucide-panel-right-close")).not.toBeNull();
    act(() => useSettingsStore.setState({ showTree: false }));
    expect(toggle().querySelector("svg.lucide-panel-right")).not.toBeNull();
    act(() => usePaneLayoutStore.getState().reset());
    expect(toggle().querySelector("svg.lucide-panel-left")).not.toBeNull();
  });

  it("draws the assistant close button on the side the assistant sits", () => {
    render(<AssistantShellHeader />);
    const hide = () => screen.getByRole("button", { name: enShell.dock.assistant.hide });
    expect(hide().querySelector("svg.lucide-panel-right-close")).not.toBeNull();
    act(() => usePaneLayoutStore.getState().setLayout(movePane(DEFAULT_PANE_LAYOUT, "assistant", { kind: "edge", side: "left" })));
    expect(hide().querySelector("svg.lucide-panel-left-close")).not.toBeNull();
  });
});

describe("assistant header as a pane bar", () => {
  it("can be grabbed inside the workspace and is plain elsewhere", () => {
    const view = render(<InWorkspace visible={["editor", "assistant"]} />);
    expect(screen.getByTestId("ai-assistant-header")).toHaveAttribute("data-pane-bar", "");
    view.unmount();
    render(<AssistantShellHeader data-testid="floating-header" />);
    expect(screen.getByTestId("floating-header")).not.toHaveAttribute("data-pane-bar");
  });
});
