// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  return {
    listeners,
    listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
      listeners.set(name, handler);
      return () => listeners.delete(name);
    }),
    emit: vi.fn(async () => {}),
    openExternal: vi.fn(async () => {}),
    browserState: vi.fn(async () => ({
      window: "oleafly-browser-window-1",
      tabs: [
        {
          label: "oleafly-browser-pane-1",
          url: "https://www.example.com/",
          title: "Example",
          loading: false,
        },
      ],
      active: "oleafly-browser-pane-1",
    })),
    browserTabOpen: vi.fn(async () => "oleafly-browser-pane-2"),
    browserTabActivate: vi.fn(async () => {}),
    browserTabClose: vi.fn(async () => {}),
    browserNavigate: vi.fn(async () => {}),
    browserBack: vi.fn(async () => {}),
    browserForward: vi.fn(async () => {}),
    browserReload: vi.fn(async () => {}),
    browserContentVisible: vi.fn(async () => {}),
  };
});

vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen, emit: mocks.emit }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.openExternal }));
vi.mock("@/lib/browser-commands", async () => {
  const actual = await vi.importActual<typeof import("@/lib/browser-commands")>(
    "@/lib/browser-commands",
  );
  return {
    BROWSER_EVENTS: actual.BROWSER_EVENTS,
    browserState: mocks.browserState,
    browserTabOpen: mocks.browserTabOpen,
    browserTabActivate: mocks.browserTabActivate,
    browserTabClose: mocks.browserTabClose,
    browserNavigate: mocks.browserNavigate,
    browserBack: mocks.browserBack,
    browserForward: mocks.browserForward,
    browserReload: mocks.browserReload,
    browserContentVisible: mocks.browserContentVisible,
  };
});

import { BrowserChrome } from "./BrowserChrome";
import { useSettingsStore } from "@/store/settings";

function payload(name: string, value: unknown) {
  const handler = mocks.listeners.get(name);
  if (!handler) throw new Error(`no listener for ${name}`);
  act(() => handler({ payload: value }));
}

async function renderChrome() {
  render(<BrowserChrome />);
  await waitFor(() => expect(mocks.browserState).toHaveBeenCalled());
  await screen.findByText("Example");
}

describe("BrowserChrome", () => {
  beforeEach(() => {
    mocks.listeners.clear();
    for (const fn of Object.values(mocks)) {
      if (typeof fn === "function" && "mockClear" in fn) fn.mockClear();
    }
    useSettingsStore.setState({
      browserSearchEngine: "google",
      browserHomePage: "https://home.test/",
    });
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
  });

  it("renders the tab strip and the address controls with their labels", async () => {
    await renderChrome();
    expect(screen.getByRole("tablist", { name: "Open tabs" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent("Example");
    expect(screen.getByRole("button", { name: "New tab" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Forward" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open in your browser" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Search or enter a URL" })).toHaveValue(
      "https://www.example.com/",
    );
    expect(screen.getByTestId("browser-chrome")).toHaveStyle({ height: "88px" });
  });

  it("navigates the active tab on Enter, turning text into a search", async () => {
    await renderChrome();
    const field = screen.getByRole("textbox", { name: "Search or enter a URL" });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "latex tables" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    await waitFor(() =>
      expect(mocks.browserNavigate).toHaveBeenCalledWith(
        "oleafly-browser-pane-1",
        "https://www.google.com/search?q=latex%20tables",
      ),
    );
  });

  it("adds https to a bare domain", async () => {
    await renderChrome();
    const field = screen.getByRole("textbox", { name: "Search or enter a URL" });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "arxiv.org/abs/1" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    await waitFor(() =>
      expect(mocks.browserNavigate).toHaveBeenCalledWith(
        "oleafly-browser-pane-1",
        "https://arxiv.org/abs/1",
      ),
    );
  });

  it("drives back, forward, and reload on the active tab", async () => {
    await renderChrome();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(mocks.browserReload).toHaveBeenCalledWith("oleafly-browser-pane-1"));
    expect(mocks.browserBack).toHaveBeenCalledWith("oleafly-browser-pane-1");
    expect(mocks.browserForward).toHaveBeenCalledWith("oleafly-browser-pane-1");
  });

  it("opens the home page in a new tab and closes tabs", async () => {
    await renderChrome();
    fireEvent.click(screen.getByRole("button", { name: "New tab" }));
    await waitFor(() => expect(mocks.browserTabOpen).toHaveBeenCalledWith("https://home.test/"));
    fireEvent.click(screen.getByRole("button", { name: "Close tab" }));
    await waitFor(() =>
      expect(mocks.browserTabClose).toHaveBeenCalledWith("oleafly-browser-pane-1"),
    );
  });

  it("follows tab events from the backend", async () => {
    await renderChrome();
    payload("browser-tab-opened", {
      label: "oleafly-browser-pane-2",
      url: "https://second.test/",
      active: true,
    });
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent("second.test");
    expect(screen.getByTestId("browser-loading")).toBeInTheDocument();

    payload("browser-page-load", {
      label: "oleafly-browser-pane-2",
      state: "finished",
      url: "https://second.test/landed",
      active: true,
    });
    expect(screen.queryByTestId("browser-loading")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Search or enter a URL" })).toHaveValue(
      "https://second.test/landed",
    );

    payload("browser-title", { label: "oleafly-browser-pane-2", title: "Second" });
    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent("Second");

    payload("browser-tab-closed", { label: "oleafly-browser-pane-2", active: "oleafly-browser-pane-1" });
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent("Example");
  });

  it("activates a tab when its title is clicked", async () => {
    await renderChrome();
    payload("browser-tab-opened", {
      label: "oleafly-browser-pane-2",
      url: "https://second.test/",
      active: true,
    });
    fireEvent.click(screen.getByText("Example"));
    await waitFor(() =>
      expect(mocks.browserTabActivate).toHaveBeenCalledWith("oleafly-browser-pane-1"),
    );
  });

  it("hides the page before the overflow menu opens and shows it after it closes", async () => {
    await renderChrome();
    fireEvent.pointerDown(screen.getByRole("button", { name: "More options" }));
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    await waitFor(() => expect(mocks.browserContentVisible).toHaveBeenCalledWith(false));
    await screen.findByRole("menu");
    expect(screen.getByRole("menuitem", { name: "Copy URL" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Set as home page" })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(mocks.browserContentVisible).toHaveBeenLastCalledWith(true));
  });

  it("opens the page in the system browser", async () => {
    await renderChrome();
    fireEvent.click(screen.getByRole("button", { name: "Open in your browser" }));
    expect(mocks.openExternal).toHaveBeenCalledWith("https://www.example.com/");
  });

  it("sets the home page and tells the main window", async () => {
    await renderChrome();
    fireEvent.pointerDown(screen.getByRole("button", { name: "More options" }));
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    const item = await screen.findByRole("menuitem", { name: "Set as home page" });
    fireEvent.click(item);
    await waitFor(() =>
      expect(useSettingsStore.getState().browserHomePage).toBe("https://www.example.com/"),
    );
    expect(mocks.emit).toHaveBeenCalledWith("browser-home-page", {
      url: "https://www.example.com/",
    });
  });
});
