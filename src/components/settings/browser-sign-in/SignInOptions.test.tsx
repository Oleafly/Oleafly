// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  detect: vi.fn(async () => [] as unknown[]),
  browsers: vi.fn(),
  icons: vi.fn(),
  signInWithBrowser: vi.fn(),
  signInWindow: vi.fn(),
  listProjects: vi.fn(),
  logError: vi.fn(async (_scope: string, _error: unknown) => undefined),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  detectBrowserCookieSources: mocks.detect,
}));
vi.mock("@/lib/overleaf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf")>()),
  overleafSignInBrowsers: mocks.browsers,
  overleafBrowserIcons: mocks.icons,
  overleafSignInWithBrowser: mocks.signInWithBrowser,
  overleafSignIn: mocks.signInWindow,
  overleafListProjects: mocks.listProjects,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { useOverleafImportStore } from "@/store/overleaf-import";
import { SignInOptions } from "./SignInOptions";

const copy = enSettings.integrations.overleaf;
const SERVER = "https://www.latex.example";
const ICON = "data:image/png;base64,AA==";
const signedIn = { server: SERVER, signedIn: true, email: "ada@uni.edu" };

function browser(key: string, product: string, packaging: string | null = null) {
  return { key, name: packaging ? `${product} (${packaging})` : product, product, packaging };
}

const BRAVE = browser("brave", "Brave");
const CHROME = browser("chrome", "Google Chrome");
const EDGE = browser("edge", "Microsoft Edge");
const FIREFOX = browser("firefox", "Firefox");
const FIREFOX_SNAP = browser("firefox-snap", "Firefox", "Snap");

const appError = (code: string, params = {}) => `@oleafly/error:${JSON.stringify({ code, params, detail: null })}`;

function show() {
  return render(<SignInOptions server={SERVER} onSignedIn={vi.fn()} />);
}

async function tiles(): Promise<HTMLElement[]> {
  await screen.findAllByTestId("browser-sign-in");
  return [screen.getByTestId("window-sign-in"), ...screen.getAllByTestId("browser-sign-in")];
}

beforeEach(() => {
  mocks.detect.mockReset().mockResolvedValue([]);
  mocks.browsers.mockReset().mockResolvedValue([]);
  mocks.icons.mockReset().mockResolvedValue({});
  mocks.signInWithBrowser.mockReset();
  mocks.signInWindow.mockReset();
  mocks.listProjects.mockReset().mockResolvedValue({ status: signedIn, projects: [] });
  mocks.logError.mockClear();
  useOverleafImportStore.setState({
    server: SERVER,
    status: null,
    phase: "idle",
    signingWith: null,
    error: null,
    repeated: null,
  });
});

describe("SignInOptions", () => {
  it.each([
    [[BRAVE], "@lg:grid-cols-2"],
    [[BRAVE, FIREFOX], "@lg:grid-cols-3"],
    [[BRAVE, CHROME, FIREFOX], "@lg:grid-cols-4"],
  ])("puts Oleafly and up to three browsers in one row of big tiles", async (found, columns) => {
    mocks.browsers.mockResolvedValue(found);
    show();
    const shown = await tiles();
    expect(shown.map((tile) => tile.textContent)).toEqual([
      "Oleafly In this app",
      ...found.map(({ product }) => `${product} New window`),
    ]);
    expect(shown[0].parentElement).toHaveClass(columns);
    expect(shown[0]).toHaveClass("@lg:flex-col");
    expect(screen.getByText(copy.signInNote)).toBeVisible();
  });

  it("uses compact tiles, three in a row, once there are more, and tells two copies of a browser apart", async () => {
    mocks.browsers.mockResolvedValue([CHROME, BRAVE, EDGE, FIREFOX, FIREFOX_SNAP]);
    mocks.icons.mockResolvedValue({ brave: ICON });
    show();
    const shown = await tiles();
    expect(shown).toHaveLength(6);
    expect(shown[5]).toHaveTextContent("Firefox Snap");
    expect(shown[0].parentElement).toHaveClass("@lg:grid-cols-3");
    expect(shown[0]).not.toHaveClass("@lg:flex-col");
    await waitFor(() => expect(shown[2].querySelector("img")).toHaveAttribute("src", ICON));
    expect(shown[3].querySelector("img")).toBeNull();
  });

  it("signs in inside Oleafly with one click, and says what it waits for", async () => {
    const user = userEvent.setup();
    mocks.browsers.mockResolvedValue([BRAVE, FIREFOX]);
    let finish: (status: typeof signedIn) => void = () => {};
    mocks.signInWindow.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    show();
    const [here, brave] = await tiles();
    await user.click(here);
    expect(mocks.signInWindow).toHaveBeenCalledExactlyOnceWith(SERVER, "Sign in to www.latex.example");
    expect(await screen.findByText("Finish signing in to www.latex.example in the window that opened.")).toBeVisible();
    expect(here).toHaveAttribute("aria-busy", "true");
    expect(here).toHaveTextContent("Waiting for you");
    expect(brave).toBeDisabled();
    expect(screen.queryByText(copy.signInNote)).toBeNull();
    finish(signedIn);
    await waitFor(() => expect(useOverleafImportStore.getState().status).toEqual(signedIn));
    expect(here).not.toHaveAttribute("aria-busy");
  });

  it("signs in with the browser whose tile was clicked", async () => {
    const user = userEvent.setup();
    mocks.browsers.mockResolvedValue([BRAVE, FIREFOX_SNAP]);
    let finish: (status: typeof signedIn) => void = () => {};
    mocks.signInWithBrowser.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    show();
    const [here, , firefox] = await tiles();
    await user.click(firefox);
    expect(mocks.signInWithBrowser).toHaveBeenCalledExactlyOnceWith(SERVER, "firefox-snap");
    expect(
      await screen.findByText("Finish signing in to www.latex.example in Firefox (Snap). Closing the window cancels."),
    ).toBeVisible();
    expect(firefox).toHaveAttribute("aria-busy", "true");
    expect(here).toBeDisabled();
    firefox.click();
    expect(mocks.signInWithBrowser).toHaveBeenCalledOnce();
    finish(signedIn);
    await waitFor(() => expect(useOverleafImportStore.getState().status).toEqual(signedIn));
  });

  it("explains a failed sign-in, but not a closed window, and lets another be picked", async () => {
    const user = userEvent.setup();
    mocks.browsers.mockResolvedValue([BRAVE]);
    mocks.signInWithBrowser.mockRejectedValueOnce(appError("overleaf.sign_in_cancelled"));
    show();
    const [here, brave] = await tiles();
    await user.click(brave);
    await waitFor(() => expect(useOverleafImportStore.getState().phase).toBe("signed-out"));
    expect(screen.queryByRole("alert")).toBeNull();

    mocks.signInWithBrowser.mockRejectedValueOnce(appError("overleaf.browser_unavailable", { browser: "Brave" }));
    await user.click(brave);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Oleafly couldn't open Brave for sign-in. Try another browser.",
    );
    mocks.signInWindow.mockRejectedValueOnce(appError("overleaf.sign_in_failed"));
    await user.click(here);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Oleafly could not confirm your Overleaf sign-in."),
    );
  });

  it("shows an older error only after a try", async () => {
    mocks.browsers.mockResolvedValue([BRAVE]);
    useOverleafImportStore.setState({ phase: "signed-out", error: appError("overleaf.session_expired") });
    show();
    await tiles();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    ["none is installed", () => mocks.browsers.mockResolvedValue([])],
    ["they can't be listed", () => mocks.browsers.mockRejectedValue(new Error("registry"))],
  ])("offers Oleafly's window alone and names the browsers to install when %s", async (_case, arrange) => {
    const user = userEvent.setup();
    arrange();
    mocks.signInWindow.mockResolvedValue(signedIn);
    show();
    const row = await screen.findByTestId("window-sign-in-row");
    expect(row).toHaveTextContent(copy.windowLabel);
    expect(row).toHaveTextContent(copy.windowDescription);
    expect(screen.getByText(copy.noBrowser)).toBeVisible();
    expect(screen.queryByTestId("browser-sign-in")).toBeNull();
    await user.click(within(row).getByRole("button", { name: copy.windowAction }));
    expect(mocks.signInWindow).toHaveBeenCalledOnce();
  });

  it("keeps the import row out of the way while signing in", async () => {
    const user = userEvent.setup();
    mocks.browsers.mockResolvedValue([BRAVE]);
    mocks.detect.mockResolvedValue([
      { browser: "brave", browserName: "Brave", profile: "Default", profileName: "General", status: "available" },
    ]);
    mocks.signInWindow.mockReturnValue(new Promise(() => undefined));
    show();
    const [here] = await tiles();
    expect(await screen.findByTestId("browser-sign-in-copy")).toBeEnabled();
    await user.click(here);
    await waitFor(() => expect(screen.getByTestId("browser-sign-in-copy")).toBeDisabled());
  });
});
