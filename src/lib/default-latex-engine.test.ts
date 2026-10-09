// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setDefaultLatexEngineCmd: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({ setDefaultLatexEngineCmd: mocks.setDefaultLatexEngineCmd }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { useSettingsStore } from "@/store/settings";
import { startDefaultLatexEngineSync } from "./default-latex-engine";

describe("startDefaultLatexEngineSync", () => {
  let stop: (() => void) | null = null;

  beforeEach(() => {
    mocks.setDefaultLatexEngineCmd.mockReset().mockResolvedValue(undefined);
    mocks.logError.mockReset().mockResolvedValue(undefined);
    useSettingsStore.setState({ defaultLatexEngine: "latexmk" });
  });

  afterEach(() => {
    stop?.();
    stop = null;
    useSettingsStore.setState({ defaultLatexEngine: "tectonic" });
  });

  it("sends the stored default at launch and every later change", async () => {
    stop = await startDefaultLatexEngineSync();
    expect(mocks.setDefaultLatexEngineCmd).toHaveBeenCalledWith("latexmk");

    useSettingsStore.getState().setDefaultLatexEngine("tectonic");
    useSettingsStore.getState().resetEnginePreferences();
    useSettingsStore.setState({ appFontSize: useSettingsStore.getState().appFontSize + 1 });

    expect(mocks.setDefaultLatexEngineCmd.mock.calls).toEqual([["latexmk"], ["tectonic"]]);
  });

  it("stops sending once unsubscribed and logs a refused update", async () => {
    mocks.setDefaultLatexEngineCmd.mockRejectedValueOnce(new Error("config.json is corrupt"));
    stop = await startDefaultLatexEngineSync();
    await vi.waitFor(() =>
      expect(mocks.logError).toHaveBeenCalledWith("set the default compile engine", expect.any(Error)),
    );

    stop();
    stop = null;
    useSettingsStore.getState().setDefaultLatexEngine("tectonic");
    expect(mocks.setDefaultLatexEngineCmd).toHaveBeenCalledTimes(1);
  });
});
