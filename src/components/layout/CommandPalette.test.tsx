// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCommand, registry } from "@oleafly/registry";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useShortcutStore } from "@/store/shortcuts";
import { useTourStore } from "@/store/tours";
import { ThemeProvider } from "@/lib/theme";
import { CommandPalette } from "./CommandPalette";

const copy = enShell.commandPalette;
const runCompile = vi.fn();
const runGrouped = vi.fn();

function renderPalette() {
  return render(
    <ThemeProvider>
      <CommandPalette />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  registry.commands.length = 0;
  runCompile.mockClear();
  runGrouped.mockClear();
  registerCommand({
    id: "test.compile",
    surfaces: ["palette"],
    group: () => enShell.commandGroups.compile,
    label: () => "Recompile now",
    keywords: () => "build latex",
    hint: "cmd enter",
    icon: () => null,
    order: 10,
    run: runCompile,
  });
  registerCommand({
    id: "test.ungrouped",
    surfaces: ["palette"],
    label: () => "Loose action",
    order: 20,
    run: runGrouped,
  });
  registerCommand({
    id: "test.hidden",
    surfaces: ["palette"],
    label: () => "Only with a project",
    when: (ctx) => ctx.projectId !== null,
    order: 30,
    run: vi.fn(),
  });
  useFilesStore.setState({
    projectId: null,
    projectKind: null,
    activePath: null,
  } as unknown as ReturnType<typeof useFilesStore.getState>);
  useSettingsStore.setState({ paletteOpen: true, latexTools: true });
  useTourStore.setState({ activeTourId: null });
});

afterEach(() => {
  registry.commands.length = 0;
});

describe("CommandPalette", () => {
  it("groups the registered commands and shows their hints", () => {
    renderPalette();
    expect(screen.getByPlaceholderText(copy.placeholder)).toBeInTheDocument();
    expect(screen.getByText(enShell.commandGroups.compile)).toBeInTheDocument();
    expect(screen.getByText(enShell.commandGroups.commands)).toBeInTheDocument();
    expect(screen.getByText("Recompile now")).toBeInTheDocument();
    expect(screen.getByText("cmd enter")).toBeInTheDocument();
    expect(screen.queryByText("Only with a project")).not.toBeInTheDocument();
  });

  it("filters on the keywords of a command", async () => {
    renderPalette();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(copy.placeholder), "build");
    await waitFor(() =>
      expect(screen.queryByText("Loose action")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Recompile now")).toBeInTheDocument();
  });

  it("says when nothing matches", async () => {
    renderPalette();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(copy.placeholder), "zzzzqqq");
    expect(await screen.findByText(copy.empty)).toBeInTheDocument();
  });

  it("runs the command the reader picks and closes", async () => {
    renderPalette();
    const user = userEvent.setup();
    await user.click(screen.getByText("Recompile now"));
    expect(runCompile).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(useSettingsStore.getState().paletteOpen).toBe(false),
    );
  });

  it("toggles on the palette shortcut and stays shut during a tour", async () => {
    useSettingsStore.setState({ paletteOpen: false });
    renderPalette();
    const binding = useShortcutStore.getState().bindings.commandPalette;
    const apple = /Mac|iPhone|iPad/.test(navigator.platform);
    const press = () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: binding.key,
          metaKey: apple && Boolean(binding.mod),
          ctrlKey: Boolean(binding.ctrl) || (!apple && Boolean(binding.mod)),
          shiftKey: Boolean(binding.shift),
          altKey: Boolean(binding.alt),
          cancelable: true,
        }),
      );
    press();
    await waitFor(() =>
      expect(useSettingsStore.getState().paletteOpen).toBe(true),
    );
    press();
    await waitFor(() =>
      expect(useSettingsStore.getState().paletteOpen).toBe(false),
    );

    useTourStore.setState({ activeTourId: "home" });
    press();
    expect(useSettingsStore.getState().paletteOpen).toBe(false);
  });
});
