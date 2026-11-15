// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { useOverleafImportStore } from "@/store/overleaf-import";
import { BrowserSignIn, BrowserSignInCopy } from "./BrowserSignInCopy";

const mocks = vi.hoisted(() => ({
  detect: vi.fn(),
  importCookies: vi.fn(),
  signInWithCookies: vi.fn(),
  browsers: vi.fn(),
  signInWithBrowser: vi.fn(),
  listProjects: vi.fn(),
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
  overleafSignInWithBrowser: mocks.signInWithBrowser,
  overleafListProjects: mocks.listProjects,
}));

vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => undefined) }));

const copy = enSettings.integrations.cookies;
const browserCopy = enSettings.integrations.overleaf;
const SERVER = "https://www.latex.example";

function available(browser: string, profile: string) {
  return {
    browser,
    browserName: browser === "chrome" ? "Google Chrome" : "Microsoft Edge",
    profile,
    profileName: profile,
    status: "available",
    detail: "Ready",
  };
}

beforeEach(() => {
  mocks.detect.mockReset();
  mocks.importCookies.mockReset();
  mocks.signInWithCookies.mockReset();
  mocks.browsers.mockReset().mockResolvedValue([]);
  mocks.signInWithBrowser.mockReset();
  mocks.listProjects.mockReset();
  useOverleafImportStore.setState({ server: SERVER, status: null, phase: "idle", signingWith: null, error: null });
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.scrollIntoView = vi.fn();
});

async function copyFromChrome(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: copy.useBrowserSignIn }));
  await user.click(screen.getByLabelText(/Google Chrome/));
  await user.click(screen.getByRole("button", { name: copy.review }));
  await user.click(screen.getByRole("button", { name: copy.copyAction }));
}

describe("BrowserSignInCopy", () => {
  it("renders nothing when no browser profile is available (Windows and Linux today)", async () => {
    mocks.detect.mockResolvedValue([
      { browser: "chrome", browserName: "Google Chrome", profile: "Default", profileName: "Default", status: "coming_soon", detail: "" },
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

  it("copies only the service host and then signs in", async () => {
    const user = userEvent.setup();
    mocks.detect.mockResolvedValue([available("chrome", "Default")]);
    mocks.importCookies.mockResolvedValue({ imported: 3, browserName: "Google Chrome", profileName: "Default", domain: "www.latex.example" });
    mocks.signInWithCookies.mockResolvedValue({ server: SERVER, signedIn: true, email: "a@b.c" });
    const onSignedIn = vi.fn();
    render(<BrowserSignInCopy server={SERVER} onSignedIn={onSignedIn} />);

    await user.click(await screen.findByRole("button", { name: copy.useBrowserSignIn }));
    await user.click(screen.getByLabelText(/Google Chrome/));
    expect(screen.getByText("Site: www.latex.example")).toBeVisible();
    expect(screen.queryByRole("textbox")).toBeNull();
    await user.click(screen.getByRole("button", { name: copy.review }));
    const confirmation = screen.getByRole("alertdialog", { name: copy.confirmTitle });
    expect(confirmation).toHaveTextContent("www.latex.example");
    await user.click(within(confirmation).getByRole("button", { name: copy.copyAction }));

    expect(mocks.importCookies).toHaveBeenCalledWith({ browser: "chrome", profile: "Default", domain: "www.latex.example" });
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(expect.objectContaining({ signedIn: true })));
    expect(mocks.signInWithCookies).toHaveBeenCalledWith(SERVER);
  });

  it("says the copy didn't sign in when the cookies are stale", async () => {
    const user = userEvent.setup();
    mocks.detect.mockResolvedValue([available("chrome", "Default")]);
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

  it("keeps the confirmation open and explains a failed copy", async () => {
    const user = userEvent.setup();
    mocks.detect.mockResolvedValue([available("chrome", "Default")]);
    mocks.importCookies.mockRejectedValue(new Error("Keychain access was denied."));
    render(<BrowserSignInCopy server={SERVER} onSignedIn={vi.fn()} />);
    await copyFromChrome(user);

    const confirmation = screen.getByRole("alertdialog", { name: copy.confirmTitle });
    expect(await within(confirmation).findByRole("alert")).toHaveTextContent("Keychain access was denied.");
    expect(mocks.signInWithCookies).not.toHaveBeenCalled();
  });

  it("renders a button for the import panel", async () => {
    mocks.detect.mockResolvedValue([available("chrome", "Default")]);
    render(<BrowserSignInCopy server={SERVER} onSignedIn={vi.fn()} variant="button" />);
    expect(await screen.findByRole("button", { name: copy.useBrowserSignIn })).toBeVisible();
    expect(screen.queryByText(copy.label)).toBeNull();
  });

  it("names the site in the settings row", async () => {
    mocks.detect.mockResolvedValue([available("chrome", "Default")]);
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
    render(<BrowserSignIn />);

    const picker = await screen.findByRole("combobox", { name: browserCopy.browserPick });
    expect(picker).toHaveTextContent("Google Chrome");
    await user.click(picker);
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Google Chrome", "Firefox (Snap)"]);
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

  it("renders the button and picker alone for the import panel", async () => {
    mocks.browsers.mockResolvedValue([CHROME, FIREFOX]);
    render(<BrowserSignIn variant="button" />);
    expect(await screen.findByRole("button", { name: browserCopy.browserLabel })).toBeVisible();
    expect(screen.getByRole("combobox", { name: browserCopy.browserPick })).toBeVisible();
    expect(screen.queryByTestId("browser-sign-in-row")).toBeNull();
  });
});
