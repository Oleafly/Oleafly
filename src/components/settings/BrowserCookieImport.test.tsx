// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { BrowserCookieImport } from "./BrowserCookieImport";

const mocks = vi.hoisted(() => ({
  detectBrowserCookieSources: vi.fn(),
  importBrowserCookies: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  detectBrowserCookieSources: mocks.detectBrowserCookieSources,
  importBrowserCookies: mocks.importBrowserCookies,
}));

const copy = enSettings.integrations.cookies;

const CHROME = {
  browser: "chrome",
  browserName: "Google Chrome",
  profile: "Profile 1",
  profileName: null,
  status: "available",
  detail: "Ready to import",
};

const EDGE = {
  browser: "edge",
  browserName: "Microsoft Edge",
  profile: null,
  profileName: null,
  status: "not_installed",
  detail: "Edge is not installed.",
};

beforeEach(() => {
  mocks.detectBrowserCookieSources.mockReset().mockResolvedValue([CHROME, EDGE]);
  mocks.importBrowserCookies.mockReset();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.scrollIntoView = vi.fn();
});

async function openAndChooseChrome(user: ReturnType<typeof userEvent.setup>) {
  render(<BrowserCookieImport />);
  await user.click(screen.getByRole("button", { name: copy.action }));
  await user.click(await screen.findByRole("radio", { name: /Google Chrome/u }));
}

describe("BrowserCookieImport", () => {
  it("marks a browser that is not installed and refuses a hostname that is not one", async () => {
    const user = userEvent.setup();
    await openAndChooseChrome(user);

    expect(screen.getByRole("radio", { name: new RegExp(`Microsoft Edge.*${copy.status.notInstalled}`, "u") })).toBeDisabled();
    await user.type(screen.getByLabelText(copy.hostnameLabel), "not a host");
    await user.click(screen.getByRole("button", { name: copy.review }));

    expect(screen.getByRole("alert")).toHaveTextContent(copy.errors.hostname);
    expect(screen.getByLabelText(copy.hostnameLabel)).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("explains a failed import, goes back to the profile list and then imports for one site", async () => {
    const user = userEvent.setup();
    mocks.importBrowserCookies
      .mockRejectedValueOnce(new Error("Keychain access was denied."))
      .mockResolvedValueOnce({ imported: 1, browserName: "Google Chrome", profileName: null, domain: "example.com" });
    await openAndChooseChrome(user);
    await user.type(screen.getByLabelText(copy.hostnameLabel), "Example.COM");
    await user.click(screen.getByRole("button", { name: copy.review }));

    const confirmation = screen.getByRole("alertdialog", { name: copy.confirmTitle });
    expect(confirmation).toHaveTextContent("Profile 1");
    await user.click(within(confirmation).getByRole("button", { name: copy.action }));
    expect(await within(confirmation).findByRole("alert")).toHaveTextContent("Keychain access was denied.");

    await user.click(within(confirmation).getByRole("button", { name: enCommon.actions.back }));
    expect(await screen.findByRole("dialog", { name: copy.dialogTitle })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.review }));
    await user.click(within(screen.getByRole("alertdialog", { name: copy.confirmTitle })).getByRole("button", { name: copy.action }));

    expect(await screen.findByRole("status")).toHaveTextContent("Imported 1 cookie from Google Chrome for example.com.");
    expect(mocks.importBrowserCookies).toHaveBeenLastCalledWith({ browser: "chrome", profile: "Profile 1", domain: "example.com" });
  });

  it("reports every cookie from a browser without a profile or site", async () => {
    const user = userEvent.setup();
    mocks.importBrowserCookies.mockResolvedValue({ imported: 3, browserName: "Google Chrome", profileName: null, domain: null });
    await openAndChooseChrome(user);
    await user.click(screen.getByRole("button", { name: copy.review }));
    await user.click(within(screen.getByRole("alertdialog", { name: copy.confirmTitle })).getByRole("button", { name: copy.action }));

    expect(await screen.findByRole("status")).toHaveTextContent("Imported 3 cookies from Google Chrome.");
  });

  it("retries a detection that failed and closes with Cancel", async () => {
    const user = userEvent.setup();
    mocks.detectBrowserCookieSources.mockRejectedValueOnce(new Error("Profiles folder is unreadable."));
    render(<BrowserCookieImport />);
    await user.click(screen.getByRole("button", { name: copy.action }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Profiles folder is unreadable.");
    await user.click(screen.getByRole("button", { name: copy.tryAgain }));
    expect(await screen.findByRole("radio", { name: /Google Chrome/u })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: enCommon.actions.cancel }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
