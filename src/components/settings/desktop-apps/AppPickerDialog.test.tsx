// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { buttonVariants } from "@/components/ui/button";
import type { InstalledApp } from "@/lib/desktop-apps";

const mocks = vi.hoisted(() => ({
  installed: vi.fn(),
  pick: vi.fn(),
  icons: vi.fn(),
}));

vi.mock("@/lib/desktop-apps", () => ({
  cuaDriverInstalledApps: mocks.installed,
  cuaDriverStatus: vi.fn(),
  cuaDriverPickApp: mocks.pick,
  cuaDriverAppIcons: mocks.icons,
}));

import AppPickerDialog from "./AppPickerDialog";
import { filterApps, MAX_PICKER_ROWS, sameApp } from "./desktop-apps-queries";

const copy = enSettings.integrations.desktopApps.apps;

function renderPicker(onPick = vi.fn(), existing: InstalledApp[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AppPickerDialog open onOpenChange={vi.fn()} existing={existing} onPick={onPick} />
    </QueryClientProvider>,
  );
  return onPick;
}

beforeEach(() => {
  mocks.installed.mockReset();
  mocks.pick.mockReset();
  mocks.icons.mockReset().mockResolvedValue({});
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.scrollIntoView = vi.fn();
});

describe("AppPickerDialog", () => {
  it("lists apps with blocked ones disabled and explained", async () => {
    mocks.installed.mockResolvedValue([
      { name: "Terminal", bundleId: "com.apple.Terminal", blocked: "terminal" },
      { name: "Zotero", bundleId: "org.zotero.zotero" },
    ]);
    const user = userEvent.setup();
    const onPick = renderPicker();
    const terminal = await screen.findByRole("button", { name: /^Terminal/ });
    expect(terminal).toBeDisabled();
    expect(screen.getByText(copy.blocked.terminal)).toBeVisible();
    expect(screen.getByText("Terminals and code editors run commands without Oleafly's command approval.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /^Zotero/ }));
    await user.click(screen.getByRole("button", { name: copy.dialog.add }));
    expect(onPick).toHaveBeenCalledWith({ name: "Zotero", bundleId: "org.zotero.zotero" });
  });

  it("draws each row with the kit's ghost button, so focus and disabled look like every other button", async () => {
    mocks.installed.mockResolvedValue([
      { name: "Terminal", bundleId: "com.apple.Terminal", blocked: "terminal" },
      { name: "Zotero", bundleId: "org.zotero.zotero" },
    ]);
    renderPicker();
    const zotero = await screen.findByRole("button", { name: /^Zotero/ });
    for (const kitClass of buttonVariants({ variant: "ghost" }).split(" ").filter((name) => name.startsWith("disabled:"))) {
      expect(zotero.className).toContain(kitClass);
    }
    expect(zotero).toHaveAttribute("aria-pressed", "false");
  });

  it("filters thousands of apps and shows at most 200", async () => {
    const apps: InstalledApp[] = Array.from({ length: 3000 }, (_, index) => ({
      name: `App ${index}`,
      executable: `/opt/app${index}/run`,
    }));
    mocks.installed.mockResolvedValue(apps);
    const user = userEvent.setup();
    renderPicker();
    const list = await screen.findByTestId("desktop-apps-picker-list");
    expect(within(list).getAllByRole("button")).toHaveLength(MAX_PICKER_ROWS);
    await user.click(screen.getByRole("searchbox", { name: copy.dialog.search }));
    await user.paste("app 12");
    await waitFor(() => {
      const rows = within(screen.getByTestId("desktop-apps-picker-list")).getAllByRole("button");
      expect(rows.length).toBeLessThanOrEqual(MAX_PICKER_ROWS);
      expect(rows.every((row) => row.textContent?.toLowerCase().includes("app 12"))).toBe(true);
    });
    expect(filterApps(apps, "app 12")).toHaveLength(111);
    expect(filterApps(apps, "")).toHaveLength(MAX_PICKER_ROWS);
  });

  it("shows each app's own icon, and a plain one for an app without", async () => {
    mocks.installed.mockResolvedValue([
      { name: "TextEdit", bundleId: "com.apple.TextEdit" },
      { name: "Zotero", bundleId: "org.zotero.zotero" },
    ]);
    mocks.icons.mockResolvedValue({ "TextEdit\u0000com.apple.TextEdit": "data:image/png;base64,iVBORw0KGgo=" });
    renderPicker();
    const textEdit = await screen.findByRole("button", { name: /^TextEdit/ });
    await waitFor(() =>
      expect(textEdit.querySelector("img")).toHaveAttribute("src", "data:image/png;base64,iVBORw0KGgo="),
    );
    expect(mocks.icons).toHaveBeenCalledWith(["TextEdit\u0000com.apple.TextEdit", "Zotero\u0000org.zotero.zotero"]);
    expect(textEdit.querySelector("img")).toHaveAttribute("alt", "");
    expect(screen.getByRole("button", { name: /^Zotero/ }).querySelector("img")).toBeNull();
  });

  it("adds nothing while a search hides the selected app", async () => {
    mocks.installed.mockResolvedValue([
      { name: "Activity Monitor", bundleId: "com.apple.ActivityMonitor" },
      { name: "Zotero", bundleId: "org.zotero.zotero" },
    ]);
    const user = userEvent.setup();
    const onPick = renderPicker();
    await user.click(await screen.findByRole("button", { name: /^Activity Monitor/ }));
    const add = screen.getByRole("button", { name: copy.dialog.add });
    expect(add).toBeEnabled();
    const search = screen.getByRole("searchbox", { name: copy.dialog.search });
    await user.type(search, "zotero");
    expect(add).toBeDisabled();
    await user.clear(search);
    expect(add).toBeEnabled();
    await user.click(add);
    expect(onPick).toHaveBeenCalledWith({ name: "Activity Monitor", bundleId: "com.apple.ActivityMonitor" });
  });

  it("marks apps that are already allowed", async () => {
    mocks.installed.mockResolvedValue([{ name: "Zotero", bundleId: "org.zotero.zotero" }]);
    renderPicker(vi.fn(), [{ name: "Zotero", bundleId: "ORG.zotero.zotero" }]);
    expect(await screen.findByRole("button", { name: /^Zotero/ })).toBeDisabled();
  });

  it("explains a blocked app chosen in the file dialog", async () => {
    mocks.installed.mockResolvedValue([]);
    mocks.pick.mockResolvedValue({ name: "Bash", executable: "/bin/bash", blocked: "terminal" });
    const user = userEvent.setup();
    const onPick = renderPicker();
    await user.click(await screen.findByRole("button", { name: copy.dialog.choose }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.blocked.terminal);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("keeps entries that run the same program apart", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.installed.mockResolvedValue([
      { name: "LibreOffice Writer", executable: "/opt/Libre Office/libreoffice" },
      { name: "LibreOffice Calc", executable: "/opt/Libre Office/libreoffice" },
      { name: "Terminal", executable: "/opt/Libre Office/term", blocked: "terminal" },
    ]);
    const user = userEvent.setup();
    renderPicker();
    const writer = await screen.findByRole("button", { name: /^LibreOffice Writer/ });
    const calc = screen.getByRole("button", { name: /^LibreOffice Calc/ });
    await user.click(writer);
    expect(writer).toHaveAttribute("aria-pressed", "true");
    expect(calc).toHaveAttribute("aria-pressed", "false");
    const terminal = screen.getByRole("button", { name: /^Terminal/ });
    const reason = document.getElementById(terminal.getAttribute("aria-describedby") ?? "");
    expect(reason).toHaveTextContent(copy.blocked.terminal);
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/same key/);
    warn.mockRestore();
  });

  it("says how many apps are not listed and can load the list again", async () => {
    const apps: InstalledApp[] = Array.from({ length: MAX_PICKER_ROWS + 30 }, (_, index) => ({
      name: `App ${index}`,
      executable: `/opt/app${index}/run`,
    }));
    mocks.installed.mockResolvedValue(apps);
    const user = userEvent.setup();
    renderPicker();
    const more = await screen.findByTestId("desktop-apps-picker-more");
    expect(more).toHaveTextContent(`Showing ${MAX_PICKER_ROWS} of ${MAX_PICKER_ROWS + 30}`);
    mocks.installed.mockResolvedValue([{ name: "Zotero", bundleId: "org.zotero.zotero" }]);
    await user.click(screen.getByRole("button", { name: copy.dialog.refresh }));
    expect(await screen.findByRole("button", { name: /^Zotero/ })).toBeVisible();
    expect(mocks.installed).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("desktop-apps-picker-more")).toBeNull();
  });

  it("explains a browser and an app that is already added", async () => {
    mocks.installed.mockResolvedValue([
      { name: "Google Chrome", bundleId: "com.google.Chrome", blocked: "browser" },
      { name: "Zotero", bundleId: "org.zotero.zotero" },
    ]);
    renderPicker(vi.fn(), [{ name: "Zotero", bundleId: "org.zotero.zotero" }]);
    expect(await screen.findByText(copy.blocked.browser)).toBeVisible();
    expect(screen.getByText(copy.dialog.added)).toBeVisible();
  });
});

describe("sameApp", () => {
  it("matches bundle ids and program paths without regard to case", () => {
    expect(sameApp({ bundleId: "org.zotero.zotero" }, { bundleId: "ORG.zotero.zotero" })).toBe(true);
    expect(sameApp({ executable: "/opt/App/run" }, { executable: "/OPT/app/RUN" })).toBe(true);
  });

  it("compares the bundle id alone when either app has one", () => {
    expect(sameApp({ bundleId: "a.b", executable: "/x" }, { executable: "/x" })).toBe(false);
    expect(sameApp({ executable: "/x" }, { bundleId: "a.b", executable: "/x" })).toBe(false);
    expect(sameApp({ bundleId: "a.b" }, { bundleId: "c.d" })).toBe(false);
  });

  it("never matches a missing or empty program path", () => {
    expect(sameApp({}, {})).toBe(false);
    expect(sameApp({ executable: "" }, { executable: "" })).toBe(false);
    expect(sameApp({ executable: "/x" }, {})).toBe(false);
    expect(sameApp({}, { executable: "/x" })).toBe(false);
  });
});
