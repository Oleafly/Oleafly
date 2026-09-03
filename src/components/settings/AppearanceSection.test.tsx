// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCENTS,
  DEFAULT_HIDDEN_FILE_PATTERNS,
  useSettingsStore,
} from "@/store/settings";

const themeMocks = vi.hoisted(() => ({
  preference: "dark" as "system" | "light" | "dark",
  setPreference: vi.fn(),
}));
const browserCookieMocks = vi.hoisted(() => ({
  detectBrowserCookieSources: vi.fn(),
  importBrowserCookies: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    preference: themeMocks.preference,
    theme: themeMocks.preference === "light" ? "light" : "dark",
    setPreference: themeMocks.setPreference,
    toggleTheme: vi.fn(),
  }),
}));

vi.mock("@/lib/tauri", () => ({
  detectBrowserCookieSources: browserCookieMocks.detectBrowserCookieSources,
  importBrowserCookies: browserCookieMocks.importBrowserCookies,
}));

import { AppearanceSection } from "./AppearanceSection";
import { ShortcutsSection } from "./ShortcutsSection";

describe("Appearance settings tabs", () => {
  beforeEach(() => {
    themeMocks.preference = "dark";
    themeMocks.setPreference.mockClear();
    browserCookieMocks.detectBrowserCookieSources.mockReset().mockResolvedValue([
      {
        browser: "chrome",
        browserName: "Google Chrome",
        profile: "Default",
        profileName: "Default",
        status: "available",
        detail: "Ready to import",
      },
      {
        browser: "firefox",
        browserName: "Firefox",
        profile: "empty.default",
        profileName: "empty.default",
        status: "no_cookie_store",
        detail: "Firefox is installed, but this profile has no cookie store.",
      },
      {
        browser: "safari",
        browserName: "Safari",
        profile: null,
        profileName: null,
        status: "coming_soon",
        detail: "Safari cookie import is not supported yet.",
      },
    ]);
    browserCookieMocks.importBrowserCookies.mockReset().mockResolvedValue({
      imported: 12,
      browserName: "Google Chrome",
      profileName: "Default",
      domain: "example.com",
    });
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
    useSettingsStore.setState({
      dockPlacement: "left",
      bgPattern: "dots",
      accentColor: ACCENTS[0].color,
      vim: false,
      editorAutocomplete: false,
      editorAutoCloseBrackets: false,
      editorGhostCompletion: false,
      editorNonBlinkingCursor: false,
      editorStickyScroll: false,
      hiddenFilePatterns: [...DEFAULT_HIDDEN_FILE_PATTERNS],
      openInTree: false,
      pdfDarkMode: false,
      pdfZoomShortcuts: false,
      hoverPreview: false,
      homeProjectLayout: "grid",
      terminalFontSize: 14,
      terminalFontFamily:
        'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace',
      terminalFontWeight: 500,
      terminalFontWeightBold: 700,
      terminalCursorStyle: "block",
      terminalCursorBlink: true,
      terminalStartWithProject: true,
      terminalColorTheme: "dark",
      terminalBackground: "#1e1e1e",
      terminalForeground: "#f2f2f2",
      terminalCursorColor: "#ffffff",
      browserSearchEngine: "google",
      browserHomePage: "https://www.google.com/",
    });
  });

  it("groups editor, PDF preview, and file management settings", async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);

    expect(screen.getByRole("tab", { name: "App" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Editor" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "PDF Preview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Project" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Terminal" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Browser" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "PDF Preview" }));
    expect(screen.getByRole("switch", { name: "PDF dark mode" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "PDF zoom shortcuts" })).toBeInTheDocument();

    for (const label of [
      "PDF dark mode",
      "PDF zoom shortcuts",
      "Preview PDF on hover",
    ]) {
      await user.click(screen.getByRole("switch", { name: label }));
    }
    expect(useSettingsStore.getState()).toMatchObject({
      pdfDarkMode: true,
      pdfZoomShortcuts: true,
      hoverPreview: true,
    });
  });

  it("fits the tab strip to its tabs while keeping it scrollable", async () => {
    render(<AppearanceSection />);

    const tabList = screen.getByRole("tablist");
    expect(tabList).toHaveClass(
      "w-fit",
      "max-w-full",
      "overflow-x-auto",
      "no-scrollbar",
    );
    expect(tabList).not.toHaveClass("w-full");
    expect(tabList).not.toHaveClass("max-w-xs");

    const appTab = screen.getByRole("tab", { name: "App" });
    const editorTab = screen.getByRole("tab", { name: "Editor" });
    const scrollIntoView = vi.fn();
    editorTab.scrollIntoView = scrollIntoView;
    appTab.focus();
    fireEvent.keyDown(appTab, { key: "ArrowRight" });

    await waitFor(() => expect(editorTab).toHaveAttribute("aria-selected", "true"));
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest",
    });
  });

  it("scrolls the tab strip horizontally with a mouse wheel", () => {
    render(<AppearanceSection />);

    const tabList = screen.getByRole("tablist");
    Object.defineProperties(tabList, {
      clientWidth: { configurable: true, value: 320 },
      scrollLeft: { configurable: true, value: 0, writable: true },
      scrollWidth: { configurable: true, value: 640 },
    });

    fireEvent.wheel(tabList, { deltaY: 80 });

    expect(tabList.scrollLeft).toBe(80);
  });

  it("updates the app and editor appearance controls", async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);

    await user.click(screen.getByTestId("settings-dock-placement-right"));
    await user.click(screen.getByTestId("settings-bg-pattern-grid"));
    await user.click(
      screen.getByRole("button", { name: `${ACCENTS[1].name} accent` }),
    );
    await user.click(screen.getByTestId("settings-appearance-light"));

    expect(useSettingsStore.getState()).toMatchObject({
      dockPlacement: "right",
      bgPattern: "grid",
      accentColor: ACCENTS[1].color,
    });
    expect(themeMocks.setPreference).toHaveBeenCalledWith("light");

    await user.click(screen.getByRole("tab", { name: "Editor" }));
    for (const label of [
      "Vim mode",
      "Auto-complete",
      "Auto-close brackets",
      "Inline suggestion",
      "Non-blinking cursor",
      "Sticky scroll",
    ]) {
      await user.click(screen.getByRole("switch", { name: label }));
    }
    expect(useSettingsStore.getState()).toMatchObject({
      vim: true,
      editorAutocomplete: true,
      editorAutoCloseBrackets: true,
      editorGhostCompletion: true,
      editorNonBlinkingCursor: true,
      editorStickyScroll: true,
    });
  });

  it("offers system, light, and dark appearance with the active choice pressed", () => {
    themeMocks.preference = "system";
    render(<AppearanceSection />);

    const row = screen.getByTestId("settings-row-appearance");
    expect(row).toHaveTextContent("Appearance");
    expect(row).toHaveTextContent("System follows the operating system and changes when it does.");
    expect(within(row).getByRole("button", { name: "Use system theme" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(row).getByRole("button", { name: "Use light theme" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(within(row).getByRole("button", { name: "Use dark theme" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.queryByRole("switch", { name: "Dark mode" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("settings-appearance-dark"));
    expect(themeMocks.setPreference).toHaveBeenCalledWith("dark");
  });

  it("resets only Appearance preferences after confirmation", async () => {
    const user = userEvent.setup();
    const settings = useSettingsStore.getState();
    settings.setDockPlacement("right");
    settings.setVisualEditor(true);
    themeMocks.preference = "light";

    render(<AppearanceSection />);

    await user.click(
      screen.getByRole("button", { name: "Reset to defaults" }),
    );
    const confirmation = screen.getByRole("alertdialog");
    expect(confirmation).toHaveTextContent("Appearance");
    expect(useSettingsStore.getState().dockPlacement).toBe("right");

    await user.click(
      within(confirmation).getByRole("button", { name: "Reset to defaults" }),
    );

    expect(useSettingsStore.getState()).toMatchObject({
      dockPlacement: "left",
      visualEditor: true,
    });
    expect(localStorage.getItem("oleafly.dockPlacement")).toBe("left");
    expect(localStorage.getItem("oleafly.visualEditor")).toBe("1");
    expect(themeMocks.setPreference).toHaveBeenCalledWith("system");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("keeps a reset browser home page from being restored by a stale draft", async () => {
    const user = userEvent.setup();
    useSettingsStore
      .getState()
      .setBrowserHomePage("https://example.com/research");

    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: "Browser" }));

    const homePage = screen.getByRole("textbox", {
      name: "Browser home page",
    });
    expect(homePage).toHaveValue("https://example.com/research");

    await user.click(
      screen.getByRole("button", { name: "Reset to defaults" }),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Reset to defaults",
      }),
    );

    expect(homePage).toHaveValue("https://www.google.com/");
    fireEvent.blur(homePage);
    expect(useSettingsStore.getState().browserHomePage).toBe(
      "https://www.google.com/",
    );
    expect(localStorage.getItem("oleafly.browser.homePage")).toBe(
      "https://www.google.com/",
    );
  });

  it("uses the shared file-management controls to add and remove patterns", async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: "Project" }));

    const homeView = screen.getByLabelText("Default home view");
    expect(homeView).toHaveTextContent("Grid");
    await user.click(homeView);
    await user.click(await screen.findByRole("option", { name: "List" }));
    expect(useSettingsStore.getState().homeProjectLayout).toBe("list");

    await user.click(screen.getByRole("switch", { name: "Show file tree on open" }));
    expect(useSettingsStore.getState().openInTree).toBe(true);

    expect(screen.getByText("*.aux")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("File name or pattern to hide"), {
      target: { value: "*.generated.tex" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add hidden file pattern" }));
    expect(screen.getByText("*.generated.tex")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove *.generated.tex from hidden files",
      }),
    );
    expect(screen.queryByText("*.generated.tex")).not.toBeInTheDocument();

    const patternInput = screen.getByLabelText("File name or pattern to hide");
    fireEvent.change(patternInput, { target: { value: "   " } });
    const patternForm = patternInput.closest("form");
    expect(patternForm).not.toBeNull();
    if (!patternForm) throw new Error("hidden-file form is unavailable");
    fireEvent.submit(patternForm);
    expect(useSettingsStore.getState().hiddenFilePatterns).toEqual(
      DEFAULT_HIDDEN_FILE_PATTERNS,
    );
  });

  it("updates terminal appearance controls", async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: "Terminal" }));

    expect(screen.getByLabelText("Terminal font size")).toBeInTheDocument();
    expect(screen.getByLabelText("Terminal font family")).toBeInTheDocument();
    expect(screen.getByLabelText("Regular font weight")).toBeInTheDocument();
    expect(screen.getByLabelText("Bold font weight")).toBeInTheDocument();
    expect(screen.getByLabelText("Terminal cursor style")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Blink cursor" })).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Start shell with project" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Terminal color theme")).toBeInTheDocument();
    expect(screen.getByLabelText("Terminal background color")).toBeInTheDocument();
    expect(screen.getByLabelText("Terminal foreground color")).toBeInTheDocument();
    expect(screen.getByLabelText("Terminal cursor color")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Terminal font size"));
    await user.click(await screen.findByRole("option", { name: "16px" }));
    await user.click(screen.getByLabelText("Terminal cursor style"));
    await user.click(await screen.findByRole("option", { name: "Underline" }));
    await user.click(screen.getByRole("switch", { name: "Blink cursor" }));
    await user.click(
      screen.getByRole("switch", { name: "Start shell with project" }),
    );
    await user.click(screen.getByLabelText("Terminal color theme"));
    await user.click(await screen.findByRole("option", { name: "Light" }));
    fireEvent.change(screen.getByLabelText("Terminal background color"), {
      target: { value: "#f8f8f8" },
    });

    expect(useSettingsStore.getState()).toMatchObject({
      terminalFontSize: 16,
      terminalCursorStyle: "underline",
      terminalCursorBlink: false,
      terminalStartWithProject: false,
      terminalColorTheme: "light",
      terminalBackground: "#f8f8f8",
    });
  });

  it("updates browser search and home page controls", async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: "Browser" }));

    await user.click(screen.getByLabelText("Default search engine"));
    await user.click(await screen.findByRole("option", { name: "DuckDuckGo" }));
    const homePage = screen.getByLabelText("Browser home page");
    await user.clear(homePage);
    await user.type(homePage, "https://example.com/");
    fireEvent.blur(homePage);

    expect(useSettingsStore.getState()).toMatchObject({
      browserSearchEngine: "duckduckgo",
      browserHomePage: "https://example.com/",
    });
  });

  it("renders a local icon for every browser search engine", async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: "Browser" }));

    const trigger = screen.getByLabelText("Default search engine");
    expect(
      within(trigger).getByTestId("search-engine-icon-google"),
    ).toBeInTheDocument();
    await user.click(trigger);

    const iconMarkup = new Set<string>();
    for (const engine of [
      { id: "google", name: "Google" },
      { id: "bing", name: "Bing" },
      { id: "duckduckgo", name: "DuckDuckGo" },
      { id: "brave", name: "Brave" },
      { id: "perplexity", name: "Perplexity" },
      { id: "startpage", name: "Startpage" },
      { id: "ecosia", name: "Ecosia" },
    ]) {
      const option = await screen.findByRole("option", { name: engine.name });
      const icon = within(option).getByTestId(`search-engine-icon-${engine.id}`);
      expect(icon.tagName.toLowerCase()).toBe("svg");
      expect(icon.querySelector("image, [href^='http']")).toBeNull();
      const visual = icon.cloneNode(true) as SVGElement;
      visual.querySelector("title")?.remove();
      visual.removeAttribute("aria-hidden");
      visual.removeAttribute("class");
      visual.removeAttribute("data-testid");
      iconMarkup.add(visual.outerHTML);
    }
    expect(iconMarkup.size).toBe(7);
  });

  it("detects cookie sources only after the user opens the importer", async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: "Browser" }));

    expect(browserCookieMocks.detectBrowserCookieSources).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Import cookies" }));

    await waitFor(() =>
      expect(browserCookieMocks.detectBrowserCookieSources).toHaveBeenCalledOnce(),
    );
    expect(
      await screen.findByRole("radio", { name: /Safari.*Coming soon/iu }),
    ).toBeDisabled();
    expect(
      screen.getByRole("radio", { name: /Firefox.*No cookie store/iu }),
    ).toBeDisabled();
    expect(browserCookieMocks.importBrowserCookies).not.toHaveBeenCalled();
  });

  it("requires final confirmation and reports the imported cookie summary", async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: "Browser" }));
    await user.click(screen.getByRole("button", { name: "Import cookies" }));

    const chrome = await screen.findByRole("radio", {
      name: /Google Chrome.*Default/iu,
    });
    await user.click(chrome);
    const targetHostname = screen.getByLabelText("Target hostname (optional)");
    expect(targetHostname).toHaveAttribute(
      "aria-describedby",
      "browser-cookie-domain-hint",
    );
    await user.type(targetHostname, "example.com");
    await user.click(screen.getByRole("button", { name: "Review import" }));

    const confirmation = screen.getByRole("alertdialog", {
      name: "Confirm cookie import",
    });
    expect(confirmation).toHaveTextContent("Google Chrome");
    expect(confirmation).toHaveTextContent("Default");
    expect(confirmation).toHaveTextContent("example.com");
    expect(confirmation).toHaveTextContent(
      "confirm once more in a native dialog",
    );
    expect(browserCookieMocks.importBrowserCookies).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Enter" });
    expect(browserCookieMocks.importBrowserCookies).not.toHaveBeenCalled();

    await user.click(
      within(confirmation).getByRole("button", { name: "Import cookies" }),
    );

    await waitFor(() =>
      expect(browserCookieMocks.importBrowserCookies).toHaveBeenCalledWith({
        browser: "chrome",
        profile: "Default",
        domain: "example.com",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Imported 12 cookies from Google Chrome, Default for example.com.",
    );
  });

  it("imports all eligible cookies only after confirming the blank scope", async () => {
    browserCookieMocks.importBrowserCookies.mockResolvedValueOnce({
      imported: 1,
      browserName: "Google Chrome",
      profileName: "Default",
      domain: null,
    });
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: "Browser" }));
    await user.click(screen.getByRole("button", { name: "Import cookies" }));
    await user.click(
      await screen.findByRole("radio", { name: /Google Chrome.*Default/iu }),
    );
    await user.click(screen.getByRole("button", { name: "Review import" }));

    const confirmation = screen.getByRole("alertdialog", {
      name: "Confirm cookie import",
    });
    expect(confirmation).toHaveTextContent("all domains");
    expect(browserCookieMocks.importBrowserCookies).not.toHaveBeenCalled();
    await user.click(
      within(confirmation).getByRole("button", { name: "Import cookies" }),
    );

    await waitFor(() =>
      expect(browserCookieMocks.importBrowserCookies).toHaveBeenCalledWith({
        browser: "chrome",
        profile: "Default",
        domain: null,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Imported 1 cookie from Google Chrome, Default.",
    );
  });

  it("rejects URL-shaped domain filters before review", async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: "Browser" }));
    await user.click(screen.getByRole("button", { name: "Import cookies" }));
    await user.click(
      await screen.findByRole("radio", { name: /Google Chrome.*Default/iu }),
    );
    await user.type(
      screen.getByLabelText("Target hostname (optional)"),
      "https://example.com",
    );

    await user.click(screen.getByRole("button", { name: "Review import" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a hostname such as example.com.",
    );
    expect(screen.getByLabelText("Target hostname (optional)")).toHaveAttribute(
      "aria-describedby",
      "browser-cookie-domain-hint browser-cookie-review-error",
    );
    expect(
      screen.queryByRole("alertdialog", { name: "Confirm cookie import" }),
    ).not.toBeInTheDocument();
    expect(browserCookieMocks.importBrowserCookies).not.toHaveBeenCalled();
  });

  it("ignores stale browser detection after the importer is reopened", async () => {
    const staleDetection = deferred<
      Awaited<ReturnType<typeof browserCookieMocks.detectBrowserCookieSources>>
    >();
    const currentDetection = deferred<
      Awaited<ReturnType<typeof browserCookieMocks.detectBrowserCookieSources>>
    >();
    browserCookieMocks.detectBrowserCookieSources
      .mockReset()
      .mockReturnValueOnce(staleDetection.promise)
      .mockReturnValueOnce(currentDetection.promise);
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: "Browser" }));
    await user.click(screen.getByRole("button", { name: "Import cookies" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Import cookies" }));

    currentDetection.resolve([
      {
        browser: "chrome",
        browserName: "Google Chrome",
        profile: "Default",
        profileName: "Default",
        status: "available",
        detail: "Ready to import",
      },
    ]);
    expect(
      await screen.findByRole("radio", { name: /Google Chrome.*Default/iu }),
    ).toBeEnabled();

    await act(async () => {
      staleDetection.resolve([
        {
          browser: "safari",
          browserName: "Safari",
          profile: null,
          profileName: null,
          status: "coming_soon",
          detail: "Safari cookie import is not supported yet.",
        },
      ]);
      await staleDetection.promise;
    });
    expect(
      screen.getByRole("radio", { name: /Google Chrome.*Default/iu }),
    ).toBeEnabled();
    expect(screen.queryByRole("radio", { name: /Safari/iu })).not.toBeInTheDocument();
  });

  it("announces when detection finds no supported profiles", async () => {
    browserCookieMocks.detectBrowserCookieSources.mockResolvedValueOnce([]);
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: "Browser" }));
    await user.click(screen.getByRole("button", { name: "Import cookies" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "No supported browser profiles were found.",
      ),
    );
  });

  it("shows a recoverable source-detection error", async () => {
    browserCookieMocks.detectBrowserCookieSources.mockRejectedValueOnce(
      new Error("Browser profile detection failed."),
    );
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: "Browser" }));
    await user.click(screen.getByRole("button", { name: "Import cookies" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Browser profile detection failed.",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("radio", { name: /Google Chrome.*Default/iu }),
    ).toBeEnabled();
  });

  it("keeps the confirmation open when import fails", async () => {
    browserCookieMocks.importBrowserCookies.mockRejectedValueOnce(
      new Error(
        "Google Chrome's cookie store is locked. Close Google Chrome completely, then try again.",
      ),
    );
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: "Browser" }));
    await user.click(screen.getByRole("button", { name: "Import cookies" }));
    await user.click(
      await screen.findByRole("radio", { name: /Google Chrome.*Default/iu }),
    );
    await user.click(screen.getByRole("button", { name: "Review import" }));
    const confirmation = screen.getByRole("alertdialog", {
      name: "Confirm cookie import",
    });

    await user.click(
      within(confirmation).getByRole("button", { name: "Import cookies" }),
    );

    expect(await within(confirmation).findByRole("alert")).toHaveTextContent(
      "Google Chrome's cookie store is locked. Close Google Chrome completely, then try again.",
    );
    expect(confirmation).toBeInTheDocument();
  });

  it("cannot appear canceled while an import is still running", async () => {
    const pendingImport = deferred<{
      imported: number;
      browserName: string;
      profileName: string;
      domain: null;
    }>();
    browserCookieMocks.importBrowserCookies.mockReturnValueOnce(
      pendingImport.promise,
    );
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole("tab", { name: "Browser" }));
    await user.click(screen.getByRole("button", { name: "Import cookies" }));
    await user.click(
      await screen.findByRole("radio", { name: /Google Chrome.*Default/iu }),
    );
    await user.click(screen.getByRole("button", { name: "Review import" }));
    const confirmation = screen.getByRole("alertdialog", {
      name: "Confirm cookie import",
    });
    await user.click(
      within(confirmation).getByRole("button", { name: "Import cookies" }),
    );

    expect(within(confirmation).getByRole("button", { name: "Close" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(confirmation).toBeInTheDocument();

    pendingImport.resolve({
      imported: 2,
      browserName: "Google Chrome",
      profileName: "Default",
      domain: null,
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Imported 2 cookies from Google Chrome, Default.",
    );
  });

});

describe("Shortcut settings", () => {
  it("lists both dock toggle shortcuts", () => {
    render(<ShortcutsSection />);

    expect(screen.getByText("Toggle terminal")).toBeInTheDocument();
    expect(screen.getByText("Toggle browser")).toBeInTheDocument();
  });

  it("shows fixed Ctrl in the terminal shortcut", () => {
    render(<ShortcutsSection />);

    const label = screen.getByText("Toggle terminal");
    const row = label.parentElement?.parentElement;
    expect(row).not.toBeNull();
    if (!row) throw new Error("terminal shortcut row is unavailable");
    expect(within(row).getByText("Ctrl")).toBeInTheDocument();
    expect(within(row).getByText("`")).toBeInTheDocument();
  });

  it("shows fixed Ctrl+Shift+B in the browser shortcut", () => {
    render(<ShortcutsSection />);

    const label = screen.getByText("Toggle browser");
    const row = label.parentElement?.parentElement;
    expect(row).not.toBeNull();
    if (!row) throw new Error("browser shortcut row is unavailable");
    expect(within(row).getByText("Ctrl")).toBeInTheDocument();
    expect(within(row).getByText("Shift")).toBeInTheDocument();
    expect(within(row).getByText("B")).toBeInTheDocument();
  });

  it("detects the editor's fixed Ctrl+Space binding on macOS", async () => {
    const originalNavigator = globalThis.navigator;
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    try {
      const user = userEvent.setup();
      render(<ShortcutsSection />);
      await user.click(
        screen.getByRole("button", { name: /Edit Toggle browser/u }),
      );
      fireEvent.keyDown(
        screen.getByRole("button", { name: /Recording Toggle browser/u }),
        { key: " ", ctrlKey: true },
      );

      expect(
        screen.getByText("Already assigned to Trigger autocomplete."),
      ).toBeInTheDocument();
    } finally {
      vi.stubGlobal("navigator", originalNavigator);
    }
  });
});
