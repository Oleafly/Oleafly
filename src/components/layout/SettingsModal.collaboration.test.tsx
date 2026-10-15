// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { i18n } from "@/i18n";
import { useSettingsStore } from "@/store/settings";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  appVersion: () => Promise.resolve("0.4.6"),
  libraryRoot: vi.fn(async () => "/tmp/library"),
}));
vi.mock("@/components/layout/UpdateChecker", () => ({ UpdateChecker: () => null }));
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ preference: "dark", theme: "dark", setPreference: vi.fn(), toggleTheme: vi.fn() }),
}));
vi.mock("@/features/collab/CollaborationSection", () => ({
  CollaborationSection: () => <div data-testid="collab-section-stub" />,
}));

import { SettingsModal } from "./SettingsModal";

const experimentation = enShell.settings.experimentation;

describe("Live collaboration flag", () => {
  beforeEach(() => {
    localStorage.clear();
    const settings = useSettingsStore.getState();
    settings.setLiveCollaboration(false);
    settings.setSettingsInitialSection("experimentation");
    settings.setSettingsOpen(true);
  });

  it("turns live collaboration on and off from Experimentation", () => {
    render(<SettingsModal />);
    const toggle = screen.getByRole("switch", { name: experimentation.liveCollaboration.label });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveTextContent(experimentation.liveCollaboration.description);

    fireEvent.click(toggle);
    expect(useSettingsStore.getState().liveCollaboration).toBe(true);
    expect(localStorage.getItem("oleafly.liveCollaboration")).toBe("1");
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);
    expect(useSettingsStore.getState().liveCollaboration).toBe(false);
    expect(localStorage.getItem("oleafly.liveCollaboration")).toBe("0");
  });
});

describe("Collaboration section", () => {
  beforeEach(() => {
    localStorage.clear();
    const settings = useSettingsStore.getState();
    settings.setLiveCollaboration(false);
    settings.setSettingsInitialSection("general");
    settings.setSettingsOpen(true);
  });

  it("appears in the navigation only while the flag is on and loads its strings with it", async () => {
    render(<SettingsModal />);
    expect(screen.queryByTestId("settings-section-collaboration")).toBeNull();
    expect(i18n.hasResourceBundle("en", "collab")).toBe(false);

    act(() => useSettingsStore.getState().setLiveCollaboration(true));
    const entry = screen.getByTestId("settings-section-collaboration");
    expect(entry).toHaveTextContent(enShell.settings.nav.collaboration);
    fireEvent.click(entry);
    expect(await screen.findByTestId("collab-section-stub")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: enShell.settings.nav.collaboration })).toBeInTheDocument();
    expect(i18n.hasResourceBundle("en", "collab")).toBe(true);

    act(() => useSettingsStore.getState().setLiveCollaboration(false));
    expect(screen.queryByTestId("settings-section-collaboration")).toBeNull();
    expect(screen.queryByTestId("collab-section-stub")).toBeNull();
    expect(screen.getByTestId("settings-section-general")).toHaveAttribute("aria-current", "page");
  });

  it("opens straight on Collaboration when asked, and on General while the flag is off", async () => {
    useSettingsStore.getState().setLiveCollaboration(true);
    useSettingsStore.getState().setSettingsInitialSection("collaboration");
    const first = render(<SettingsModal />);
    expect(await screen.findByTestId("collab-section-stub")).toBeInTheDocument();
    first.unmount();

    useSettingsStore.getState().setLiveCollaboration(false);
    useSettingsStore.getState().setSettingsInitialSection("collaboration");
    render(<SettingsModal />);
    expect(screen.getByTestId("settings-section-general")).toHaveAttribute("aria-current", "page");
    expect(screen.queryByTestId("collab-section-stub")).toBeNull();
  });
});

describe("Collaboration in the Settings search", () => {
  beforeEach(() => {
    localStorage.clear();
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("general");
    settings.setSettingsOpen(true);
  });

  function typeQuery(value: string) {
    fireEvent.change(screen.getByRole("searchbox", { name: enShell.settings.search.label }), {
      target: { value },
    });
  }

  it("opens Collaboration from its keywords while the flag is on", async () => {
    useSettingsStore.getState().setLiveCollaboration(true);
    render(<SettingsModal />);
    typeQuery("maintainers");
    await waitFor(() =>
      expect(screen.getByTestId("settings-section-collaboration")).toHaveAttribute("aria-current", "page"),
    );
    expect(await screen.findByTestId("collab-section-stub")).toBeInTheDocument();
  });

  it("never offers Collaboration while the flag is off", async () => {
    useSettingsStore.getState().setLiveCollaboration(false);
    render(<SettingsModal />);
    typeQuery("maintainers");
    await waitFor(() =>
      expect(screen.getByTestId("settings-search-status")).toHaveTextContent(enShell.settings.search.empty),
    );
    expect(screen.queryByTestId("settings-section-collaboration")).toBeNull();
  });
});
