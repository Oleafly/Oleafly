// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { BrowserSignInCopy } from "./BrowserSignInCopy";

const mocks = vi.hoisted(() => ({
  detect: vi.fn(),
  importCookies: vi.fn(),
  signInWithCookies: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  detectBrowserCookieSources: mocks.detect,
  importBrowserCookies: mocks.importCookies,
}));

vi.mock("@/lib/overleaf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf")>()),
  overleafSignInWithAppCookies: mocks.signInWithCookies,
}));

vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => undefined) }));

const copy = enSettings.integrations.cookies;
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
