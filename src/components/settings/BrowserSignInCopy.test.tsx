// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { COOKIE_IMPORT_CANCELLED } from "@/lib/tauri";
import { useOverleafImportStore } from "@/store/overleaf-import";
import { BrowserSignIn, BrowserSignInCopy, WindowSignIn } from "./BrowserSignInCopy";

const mocks = vi.hoisted(() => ({
  detect: vi.fn(),
  importCookies: vi.fn(),
  signInWithCookies: vi.fn(),
  browsers: vi.fn(),
  icons: vi.fn(),
  signIns: vi.fn(),
  signInWithBrowser: vi.fn(),
  signInWindow: vi.fn(),
  listProjects: vi.fn(),
  logError: vi.fn(async (_scope: string, _error: unknown) => undefined),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  detectBrowserCookieSources: mocks.detect,
  importBrowserCookies: mocks.importCookies,
}));

vi.mock("@/lib/overleaf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf")>()),
  overleafSignInWithAppCookies: mocks.signInWithCookies,
  overleafSignInBrowsers: mocks.browsers,
  overleafBrowserIcons: mocks.icons,
  overleafSignIns: mocks.signIns,
  overleafSignInWithBrowser: mocks.signInWithBrowser,
  overleafSignIn: mocks.signInWindow,
  overleafListProjects: mocks.listProjects,
}));

vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

const copy = enSettings.integrations.cookies;
const signIns = enSettings.integrations.signIns;
const browserCopy = enSettings.integrations.overleaf;
const SERVER = "https://www.latex.example";

const ICON = "data:image/png;base64,AA==";

function source(browser: string, profile: string, profileName = profile, status = "available") {
  const browserName = browser === "chrome" ? "Google Chrome" : "Brave";
  return { browser, browserName, profile, profileName, status };
}

beforeEach(() => {
  mocks.detect.mockReset();
  mocks.importCookies.mockReset();
  mocks.signInWithCookies.mockReset();
  mocks.browsers.mockReset().mockResolvedValue([]);
  mocks.icons.mockReset().mockResolvedValue({});
  mocks.signIns.mockReset().mockResolvedValue([]);
  mocks.signInWithBrowser.mockReset();
  mocks.signInWindow.mockReset();
  mocks.listProjects.mockReset();
  mocks.logError.mockClear();
  useOverleafImportStore.setState({ server: SERVER, status: null, phase: "idle", signingWith: null, error: null });
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.scrollIntoView = vi.fn();
});

async function copyFromChrome(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: copy.useBrowserSignIn }));
  await user.click(screen.getByRole("button", { name: copy.copyAction }));
}

async function openProfiles(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: copy.useBrowserSignIn }));
  await user.click(screen.getByRole("combobox", { name: copy.from }));
  return screen.findAllByRole("option");
}

describe("BrowserSignInCopy", () => {
  it("renders nothing when no browser profile is available (Windows and Linux today)", async () => {
    mocks.detect.mockResolvedValue([
      { browser: "chrome", browserName: "Google Chrome", profile: "Default", profileName: "Default", status: "coming_soon" },
    ]);
    const { container } = render(<BrowserSignInCopy server={SERVER} onSignedIn={vi.fn()} />);
    await waitFor(() => expect(mocks.detect).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when detection fails", async () => {
    mocks.detect.mockRejectedValue(new Error("unreadable"));
    const { container } = render(<BrowserSignInCopy server={SERVER} onSignedIn={vi.fn()} />);
    await waitFor(() => expect(mocks.detect).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("copies only the service host and then signs in, with no second confirmation in the app", async () => {
    const user = userEvent.setup();
    mocks.detect.mockResolvedValue([source("chrome", "Default")]);
    mocks.importCookies.mockResolvedValue({ imported: 3, browserName: "Google Chrome", profileName: "Default", domain: "www.latex.example" });
    mocks.signInWithCookies.mockResolvedValue({ server: SERVER, signedIn: true, email: "a@b.c" });
    const onSignedIn = vi.fn();
    render(<BrowserSignInCopy server={SERVER} onSignedIn={onSignedIn} />);

    await user.click(await screen.findByRole("button", { name: copy.useBrowserSignIn }));
    expect(screen.getByTestId("browser-sign-in-copy-site")).toHaveTextContent("www.latex.example");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(mocks.importCookies).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: copy.copyAction }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mocks.importCookies).toHaveBeenCalledExactlyOnceWith({ browser: "chrome", profile: "Default", domain: "www.latex.example" });
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(expect.objectContaining({ signedIn: true })));
    expect(mocks.signInWithCookies).toHaveBeenCalledWith(SERVER);
  });

  it("says the copy didn't sign in when the cookies are stale", async () => {
    const user = userEvent.setup();
    mocks.detect.mockResolvedValue([source("chrome", "Default")]);
    mocks.importCookies.mockResolvedValue({ imported: 3, browserName: "Google Chrome", profileName: "Default", domain: "www.latex.example" });
    mocks.signInWithCookies.mockRejectedValue(
      `@oleafly/error:${JSON.stringify({ code: "overleaf.browser_sign_in_failed", params: {}, detail: null })}`,
    );
    const onSignedIn = vi.fn();
    render(<BrowserSignInCopy server={SERVER} onSignedIn={onSignedIn} />);
    await copyFromChrome(user);

    expect(
      await screen.findByText("Copied 3 cookies from Google Chrome, but they didn't sign you in. Sign in instead."),
    ).toBeVisible();
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it("shows each profile with its browser's logo and the name people gave it, and copies from the one picked", async () => {
    const user = userEvent.setup();
    mocks.icons.mockResolvedValue({ brave: ICON });
    mocks.detect.mockResolvedValue([
      source("chrome", "Default", "Person 1"),
      source("brave", "Default", "General"),
      source("brave", "Profile 2", "The Final Grind", "no_cookie_store"),
      source("brave", "Profile 3", "RNerd"),
      { browser: "firefox", browserName: "Firefox", profile: null, profileName: null, status: "not_installed" },
      { browser: "safari", browserName: "Safari", profile: null, profileName: null, status: "coming_soon" },
    ]);
    mocks.importCookies.mockResolvedValue({ imported: 1, browserName: "Brave", profileName: "RNerd", domain: "www.latex.example" });
    mocks.signInWithCookies.mockResolvedValue({ server: SERVER, signedIn: true, email: "a@b.c" });
    render(<BrowserSignInCopy server={SERVER} onSignedIn={vi.fn()} />);

    const options = await openProfiles(user);
    expect(options.map((option) => option.textContent)).toEqual([
      "Google ChromePerson 1",
      "BraveGeneral",
      `BraveThe Final Grind${copy.noCookies}`,
      "BraveRNerd",
    ]);
    expect(options[2]).toHaveAttribute("aria-disabled", "true");
    expect(options[1].querySelector("img")).toHaveAttribute("src", ICON);
    expect(options[0].querySelector("img")).toBeNull();
    await user.click(options[3]);
    expect(screen.getByRole("combobox", { name: copy.from })).toHaveTextContent("BraveRNerd");
    await user.click(screen.getByRole("button", { name: copy.copyAction }));
    expect(mocks.importCookies).toHaveBeenCalledExactlyOnceWith({ browser: "brave", profile: "Profile 3", domain: "www.latex.example" });
  });

  it("starts on the first profile that has cookies and looks again each time it opens", async () => {
    const user = userEvent.setup();
    mocks.detect.mockResolvedValue([
      source("brave", "Default", "General", "no_cookie_store"),
      source("brave", "Profile 3", "RNerd"),
    ]);
    render(<BrowserSignInCopy server={SERVER} onSignedIn={vi.fn()} />);
    await screen.findByRole("button", { name: copy.useBrowserSignIn });
    mocks.detect.mockResolvedValue([source("brave", "Default", "General"), source("brave", "Profile 3", "RNerd")]);
    await user.click(screen.getByRole("button", { name: copy.useBrowserSignIn }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: copy.from })).toHaveTextContent("BraveGeneral"));
    expect(mocks.importCookies).not.toHaveBeenCalled();
  });

  it("says so when the profile is signed in as the account Oleafly already uses", async () => {
    const user = userEvent.setup();
    mocks.detect.mockResolvedValue([source("chrome", "Default", "Person 1")]);
    mocks.importCookies.mockResolvedValue({ imported: 2, browserName: "Google Chrome", profileName: "Person 1", domain: "www.latex.example" });
    const ada = { server: SERVER, signedIn: true, email: "ada@uni.edu", userId: "u-ada" };
    useOverleafImportStore.setState({ status: ada });
    mocks.signInWithCookies.mockResolvedValue(ada);
    const onSignedIn = vi.fn();
    render(<BrowserSignInCopy server={SERVER} onSignedIn={onSignedIn} />);
    await copyFromChrome(user);

    const dialog = screen.getByRole("dialog", { name: copy.dialogTitle });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Google Chrome Person 1 is signed in as ada@uni.edu, which Oleafly already uses.",
    );
    expect(within(dialog).getByRole("button", { name: copy.copyAction })).toBeEnabled();
    expect(onSignedIn).not.toHaveBeenCalled();

    mocks.signInWithCookies.mockResolvedValue({ ...ada, email: "bea@lab.org", userId: "u-bea" });
    await user.click(within(dialog).getByRole("button", { name: copy.copyAction }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(expect.objectContaining({ userId: "u-bea" })));
  });

  it("goes to the saved sign-ins and back to importing", async () => {
    const user = userEvent.setup();
    mocks.detect.mockResolvedValue([source("chrome", "Default")]);
    mocks.signIns.mockResolvedValue([
      { server: SERVER, userId: "u-ada", email: "ada@uni.edu", current: true, signedInAt: null },
    ]);
    render(<BrowserSignInCopy server={SERVER} onSignedIn={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: copy.useBrowserSignIn }));
    await user.click(screen.getByRole("button", { name: signIns.title }));
    const manage = await screen.findByRole("dialog", { name: signIns.title });
    expect(screen.queryByRole("dialog", { name: copy.dialogTitle })).toBeNull();
    expect(await within(manage).findByText("ada@uni.edu")).toBeVisible();
    await user.click(within(manage).getByRole("button", { name: signIns.importMore }));
    expect(await screen.findByRole("dialog", { name: copy.dialogTitle })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: signIns.title })).toBeNull();
  });

  it("stays open and takes no second copy while the system confirmation is up", async () => {
    const user = userEvent.setup();
    mocks.detect.mockResolvedValue([source("chrome", "Default")]);
    let refuse: (error: Error) => void = () => {};
    mocks.importCookies.mockReturnValue(new Promise((_resolve, reject) => (refuse = reject)));
    render(<BrowserSignInCopy server={SERVER} onSignedIn={vi.fn()} />);
    await copyFromChrome(user);

    expect(screen.getByRole("button", { name: copy.copying })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: copy.from })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: copy.dialogTitle })).toBeVisible();
    refuse(new Error(COOKIE_IMPORT_CANCELLED));
    await waitFor(() => expect(screen.getByRole("button", { name: copy.copyAction })).toBeEnabled());
    expect(mocks.importCookies).toHaveBeenCalledOnce();
  });

  it.each([COOKIE_IMPORT_CANCELLED, new Error(COOKIE_IMPORT_CANCELLED)])(
    "goes back to the picker without an error when the system confirmation is cancelled (%s)",
    async (cancelled) => {
      const user = userEvent.setup();
      mocks.detect.mockResolvedValue([source("chrome", "Default")]);
      mocks.importCookies.mockRejectedValue(cancelled);
      render(<BrowserSignInCopy server={SERVER} onSignedIn={vi.fn()} />);
      await copyFromChrome(user);

      await waitFor(() => expect(screen.getByRole("button", { name: copy.copyAction })).toBeEnabled());
      expect(screen.getByRole("dialog", { name: copy.dialogTitle })).toBeVisible();
      expect(screen.getByRole("combobox", { name: copy.from })).toHaveTextContent("Google ChromeDefault");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(mocks.logError).not.toHaveBeenCalled();
      expect(mocks.signInWithCookies).not.toHaveBeenCalled();
    },
  );

  it("knows the cancelled sentence the app's backend sends", () => {
    expect(readFileSync(join(process.cwd(), "crates/oleafly-online/src/browser_cookies/mod.rs"), "utf8")).toContain(
      `"${COOKIE_IMPORT_CANCELLED}"`,
    );
  });

  it("keeps the picker open and explains a failed copy", async () => {
    const user = userEvent.setup();
    mocks.detect.mockResolvedValue([source("chrome", "Default")]);
    mocks.importCookies.mockRejectedValue(new Error("Keychain access was denied."));
    render(<BrowserSignInCopy server={SERVER} onSignedIn={vi.fn()} />);
    await copyFromChrome(user);

    const picker = screen.getByRole("dialog", { name: copy.dialogTitle });
    expect(await within(picker).findByRole("alert")).toHaveTextContent("Keychain access was denied.");
    expect(mocks.signInWithCookies).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledWith("copy browser cookies", expect.any(Error));
  });

  it("renders a button for the import panel", async () => {
    mocks.detect.mockResolvedValue([source("chrome", "Default")]);
    render(<BrowserSignInCopy server={SERVER} onSignedIn={vi.fn()} variant="button" />);
    expect(await screen.findByRole("button", { name: copy.useBrowserSignIn })).toBeVisible();
    expect(screen.queryByText(copy.label)).toBeNull();
  });

  it("names the site in the settings row", async () => {
    mocks.detect.mockResolvedValue([source("chrome", "Default")]);
    render(<BrowserSignInCopy server={SERVER} onSignedIn={vi.fn()} />);
    expect(await screen.findByText(copy.label)).toBeVisible();
    expect(screen.getByText(/www\.latex\.example/)).toBeVisible();
  });
});

describe("BrowserSignIn", () => {
  const CHROME = { key: "chrome", name: "Google Chrome" };
  const FIREFOX = { key: "firefox-snap", name: "Firefox (Snap)" };
  const signedIn = { server: SERVER, signedIn: true, email: "ada@uni.edu" };

  it("renders nothing when no browser is installed or the list fails", async () => {
    const { container, unmount } = render(<BrowserSignIn />);
    await waitFor(() => expect(mocks.browsers).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    unmount();
    mocks.browsers.mockRejectedValue(new Error("no registry"));
    const failed = render(<BrowserSignIn />);
    await waitFor(() => expect(mocks.browsers).toHaveBeenCalledTimes(2));
    expect(failed.container).toBeEmptyDOMElement();
  });

  it("names the only browser it found and signs in with it, naming it while waiting", async () => {
    const user = userEvent.setup();
    mocks.browsers.mockResolvedValue([CHROME]);
    let finish: (status: typeof signedIn) => void = () => {};
    mocks.signInWithBrowser.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    mocks.listProjects.mockResolvedValue({ status: signedIn, projects: [] });
    render(<BrowserSignIn />);

    const row = await screen.findByTestId("browser-sign-in-row");
    expect(row).toHaveTextContent(browserCopy.browserLabel);
    expect(row).toHaveTextContent("Oleafly opens www.latex.example in a new browser window");
    expect(screen.getByRole("combobox", { name: browserCopy.browserPick })).toHaveTextContent("Google Chrome");
    await user.click(screen.getByRole("button", { name: browserCopy.browserAction }));

    expect(mocks.signInWithBrowser).toHaveBeenCalledWith(SERVER, "chrome");
    expect(await screen.findByText("Finish signing in to www.latex.example in Google Chrome. Closing the window cancels.")).toBeVisible();
    expect(screen.getByTestId("browser-sign-in")).toBeDisabled();
    finish(signedIn);
    await waitFor(() => expect(useOverleafImportStore.getState().status).toEqual(signedIn));
    expect(screen.queryByText(/Closing the window cancels/)).toBeNull();
  });

  it("lists the installed browsers in order and signs in with the one picked", async () => {
    const user = userEvent.setup();
    mocks.browsers.mockResolvedValue([CHROME, FIREFOX]);
    mocks.signInWithBrowser.mockResolvedValue(signedIn);
    mocks.listProjects.mockResolvedValue({ status: signedIn, projects: [] });
    mocks.icons.mockResolvedValue({ "firefox-snap": ICON });
    render(<BrowserSignIn />);

    const picker = await screen.findByRole("combobox", { name: browserCopy.browserPick });
    expect(picker).toHaveTextContent("Google Chrome");
    await user.click(picker);
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Google Chrome", "Firefox (Snap)"]);
    expect(options.map((option) => option.querySelector("img")?.getAttribute("src") ?? null)).toEqual([null, ICON]);
    await user.click(screen.getByRole("option", { name: "Firefox (Snap)" }));
    await user.click(screen.getByRole("button", { name: browserCopy.browserAction }));
    expect(mocks.signInWithBrowser).toHaveBeenCalledWith(SERVER, "firefox-snap");
  });

  it("explains a failed browser sign-in in the row, but not a closed window", async () => {
    const user = userEvent.setup();
    mocks.browsers.mockResolvedValue([CHROME]);
    mocks.signInWithBrowser.mockRejectedValueOnce(
      '@oleafly/error:{"code":"overleaf.sign_in_cancelled","params":{}}',
    );
    render(<BrowserSignIn />);
    await user.click(await screen.findByRole("button", { name: browserCopy.browserAction }));
    await waitFor(() => expect(useOverleafImportStore.getState().phase).toBe("signed-out"));
    expect(screen.queryByRole("alert")).toBeNull();

    mocks.signInWithBrowser.mockRejectedValueOnce(
      '@oleafly/error:{"code":"overleaf.browser_unavailable","params":{"browser":"Google Chrome"}}',
    );
    await user.click(screen.getByRole("button", { name: browserCopy.browserAction }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Oleafly couldn't open Google Chrome for sign-in. Try another browser.",
    );
  });

  it("renders the button and picker for the import panel, with what the route is for", async () => {
    mocks.browsers.mockResolvedValue([CHROME, FIREFOX]);
    render(<BrowserSignIn variant="button" />);
    expect(await screen.findByRole("button", { name: "Sign in with Google Chrome" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: browserCopy.browserPick })).toBeVisible();
    expect(screen.getByText(/^Opens a new Google Chrome window that starts signed out\./)).toBeVisible();
    expect(screen.queryByTestId("browser-sign-in-row")).toBeNull();
  });

  it("offers the sign-in window instead when no browser is found", async () => {
    const user = userEvent.setup();
    let finish: (status: typeof signedIn) => void = () => {};
    mocks.signInWindow.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    mocks.listProjects.mockResolvedValue({ status: signedIn, projects: [] });
    render(<BrowserSignIn fallback={<WindowSignIn />} />);

    const row = await screen.findByTestId("window-sign-in-row");
    expect(row).toHaveTextContent("Sign in to www.latex.example");
    expect(row).toHaveTextContent(browserCopy.windowDescription);
    expect(screen.queryByTestId("browser-sign-in-row")).toBeNull();
    await user.click(screen.getByRole("button", { name: browserCopy.windowAction }));

    expect(mocks.signInWindow).toHaveBeenCalledWith(SERVER, "Sign in to www.latex.example");
    expect(await screen.findByText("Finish signing in to www.latex.example in the window that opened.")).toBeVisible();
    expect(screen.getByTestId("window-sign-in")).toBeDisabled();
    finish(signedIn);
    await waitFor(() => expect(useOverleafImportStore.getState().status).toEqual(signedIn));
  });

  it("explains a failed window sign-in in its row", async () => {
    const user = userEvent.setup();
    mocks.signInWindow.mockRejectedValueOnce(
      '@oleafly/error:{"code":"overleaf.sign_in_failed","params":{}}',
    );
    render(<WindowSignIn />);
    await user.click(screen.getByRole("button", { name: browserCopy.windowAction }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Oleafly could not confirm your Overleaf sign-in.");
  });
});
