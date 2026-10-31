import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: mocks.isTauri,
}));

import { createDesktopAppsTools, cuaDriverSettingsSet, syncDesktopAppsTool } from "./desktop-apps";

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.isTauri.mockReturnValue(true);
});

describe("desktop apps tool", () => {
  it("offers no tool until the connector is ready", async () => {
    mocks.invoke.mockResolvedValueOnce(null);
    await syncDesktopAppsTool();
    expect(createDesktopAppsTools()).toEqual({});
  });

  it("offers the spec Rust returns", async () => {
    mocks.invoke.mockResolvedValueOnce({
      name: "desktop_apps",
      description: "d",
      inputSchema: { type: "object" },
    });
    await syncDesktopAppsTool();
    const tools = createDesktopAppsTools();
    expect(Object.keys(tools)).toEqual(["desktop_apps"]);
    expect(tools.desktop_apps.description).toBe("d");
    expect(tools.desktop_apps.inputSchema).toEqual({ type: "object" });
    expect(mocks.invoke).toHaveBeenCalledWith("cua_driver_tool_spec");
    expect(await tools.desktop_apps.execute?.({})).toEqual({
      error: "Desktop apps run inside the Oleafly app only.",
    });
  });

  it("drops the tool when Rust can't answer or outside the app", async () => {
    mocks.invoke.mockResolvedValueOnce({ name: "desktop_apps", description: "d", inputSchema: {} });
    await syncDesktopAppsTool();
    mocks.invoke.mockRejectedValueOnce(new Error("main window only"));
    await syncDesktopAppsTool();
    expect(createDesktopAppsTools()).toEqual({});

    mocks.invoke.mockResolvedValueOnce({ name: "desktop_apps", description: "d", inputSchema: {} });
    await syncDesktopAppsTool();
    mocks.isTauri.mockReturnValue(false);
    await syncDesktopAppsTool();
    expect(createDesktopAppsTools()).toEqual({});
  });

  it("sends settings to Rust as they are", async () => {
    const settings = { enabled: true, apps: [], sites: [{ origin: "https://a.org", signedIn: true }], scriptedControl: false, askBeforeActions: false };
    mocks.invoke.mockResolvedValueOnce(settings);
    await expect(cuaDriverSettingsSet(settings)).resolves.toEqual(settings);
    expect(mocks.invoke).toHaveBeenCalledWith("cua_driver_settings_set", { settings });
  });

  it("is known to the approval rules", () => {
    const rust = readFileSync(join(process.cwd(), "src-tauri/src/approvals.rs"), "utf8");
    expect(rust.slice(rust.indexOf("const KNOWN_TOOLS"), rust.indexOf("const MCP_TOOL_PREFIX"))).toContain(
      '"desktop_apps"',
    );
  });
});
