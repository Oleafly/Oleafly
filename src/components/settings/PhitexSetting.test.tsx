// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import type { EngineInfo } from "@/lib/tauri";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
const logError = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/log", () => ({ logError }));

import { useEngineStore } from "@/store/engine";
import { PhitexSetting } from "./PhitexSetting";

const copy = enShell.settings.experimentation.phitex;

const engine = (overrides: Partial<EngineInfo> = {}): EngineInfo => ({
  kind: "none",
  lualatex: null,
  tlmgr: null,
  version: null,
  latexmk: null,
  ...overrides,
});

const setPhitex = vi.fn<(enabled: boolean) => Promise<void>>();

describe("PhiTeX switch", () => {
  beforeEach(() => {
    logError.mockClear();
    setPhitex.mockReset().mockImplementation(async (enabled) => {
      useEngineStore.setState((state) => ({
        info: state.info && { ...state.info, phitex_enabled: enabled, phitex: "/opt/phitex/bin/phitex" },
      }));
    });
    useEngineStore.setState({ info: engine(), loaded: true, setPhitex });
  });

  it("starts off and turns on through the engine store", async () => {
    render(<PhitexSetting />);
    const toggle = screen.getByRole("switch", { name: copy.label });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle);

    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(setPhitex).toHaveBeenCalledExactlyOnceWith(true);
    expect(screen.getByText("/opt/phitex/bin/phitex")).toBeInTheDocument();
  });

  it("says when the switch is on but PhiTeX isn't installed", () => {
    useEngineStore.setState({ info: engine({ phitex_enabled: true, phitex: null }) });
    render(<PhitexSetting />);
    expect(screen.getByRole("switch", { name: copy.label })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(copy.notFound)).toBeInTheDocument();
  });

  it("waits for the engine info before it can be switched", () => {
    useEngineStore.setState({ info: null });
    render(<PhitexSetting />);
    fireEvent.click(screen.getByRole("switch", { name: copy.label }));
    expect(setPhitex).not.toHaveBeenCalled();
  });

  it("keeps the switch where it was, logs it and says so when saving fails", async () => {
    setPhitex.mockRejectedValueOnce(new Error("disk full"));
    render(<PhitexSetting />);
    const toggle = screen.getByRole("switch", { name: copy.label });

    fireEvent.click(toggle);

    expect(await screen.findByRole("alert")).toHaveTextContent(copy.saveFailed);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(logError).toHaveBeenCalledWith("save the PhiTeX switch", expect.any(Error));
  });
});
