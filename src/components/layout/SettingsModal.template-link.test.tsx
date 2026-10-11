// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyLocale } from "@/i18n";
import { useSettingsStore } from "@/store/settings";
import { openTemplateLink, useTemplateLinkStore } from "@/store/template-link";
import { useTourStore } from "@/store/tours";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(async () => undefined) }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  libraryRoot: vi.fn(async () => "/tmp/library"),
}));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("@/i18n/desktop", () => ({ changeLocalePreference: vi.fn(async () => {}) }));
vi.mock("@/components/layout/UpdateChecker", () => ({ UpdateChecker: () => null }));
vi.mock("@/components/settings/AISection", () => ({ AISection: () => <div data-testid="ai-section" /> }));
vi.mock("@/components/settings/DownloadsSection", () => ({
  DownloadsSection: () => <div data-testid="downloads-section" />,
}));
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ preference: "dark", theme: "dark", setPreference: vi.fn(), toggleTheme: vi.fn() }),
}));

import { SettingsModal } from "./SettingsModal";

describe("Settings and template links", () => {
  beforeEach(async () => {
    await applyLocale("en");
    useTourStore.setState({ activeTourId: null });
    useTemplateLinkStore.setState({ pending: null, serial: 0 });
    useSettingsStore.getState().setSettingsInitialSection("general");
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.getState().setSettingsOpen(false);
  });

  it("opens on Downloads when a link arrives while Settings is closed", () => {
    render(<SettingsModal />);
    expect(screen.queryByTestId("downloads-section")).not.toBeInTheDocument();
    act(() => openTemplateLink({ packId: "open-letter", templateId: "tpl-1" }));
    expect(screen.getByTestId("downloads-section")).toBeInTheDocument();
  });

  it("moves an open Settings to Downloads for every new link", () => {
    useSettingsStore.getState().setSettingsOpen(true);
    render(<SettingsModal />);
    expect(screen.queryByTestId("downloads-section")).not.toBeInTheDocument();

    act(() => openTemplateLink({ packId: "open-letter", templateId: "tpl-1" }));
    expect(screen.getByTestId("downloads-section")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("settings-section-general"));
    expect(screen.queryByTestId("downloads-section")).not.toBeInTheDocument();
    act(() => openTemplateLink({ packId: "open-letter", templateId: "tpl-2" }));
    expect(screen.getByTestId("downloads-section")).toBeInTheDocument();
  });

  it("stays where it is for a malformed link", () => {
    useSettingsStore.getState().setSettingsOpen(true);
    render(<SettingsModal />);
    act(() => openTemplateLink({ packId: "open-letter", templateId: "a/b" }));
    expect(screen.queryByTestId("downloads-section")).not.toBeInTheDocument();
  });
});
