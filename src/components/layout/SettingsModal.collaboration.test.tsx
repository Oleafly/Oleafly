// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

describe("Collaboration section", () => {
  beforeEach(() => {
    localStorage.clear();
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("general");
    settings.setSettingsOpen(true);
  });

  it("appears in the navigation and loads its strings when opened", async () => {
    render(<SettingsModal />);
    expect(i18n.hasResourceBundle("en", "collab")).toBe(false);

    const entry = screen.getByTestId("settings-section-collaboration");
    expect(entry).toHaveTextContent(enShell.settings.nav.collaboration);
    fireEvent.click(entry);
    expect(await screen.findByTestId("collab-section-stub")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: enShell.settings.nav.collaboration })).toBeInTheDocument();
    expect(i18n.hasResourceBundle("en", "collab")).toBe(true);
  });

  it("opens straight on Collaboration when asked", async () => {
    useSettingsStore.getState().setSettingsInitialSection("collaboration");
    render(<SettingsModal />);
    expect(await screen.findByTestId("collab-section-stub")).toBeInTheDocument();
    expect(screen.getByTestId("settings-section-collaboration")).toHaveAttribute("aria-current", "page");
  });

  it("leaves only the LaTeX tools and research tasks switches in Experimentation", () => {
    useSettingsStore.getState().setSettingsInitialSection("experimentation");
    render(<SettingsModal />);
    const body = within(screen.getByTestId("settings-body"));
    expect(body.getAllByRole("switch")).toEqual([
      body.getByRole("switch", { name: experimentation.latexTools.label }),
      body.getByTestId("settings-research-tasks"),
    ]);
    expect(body.queryByText(/collaboration/i)).toBeNull();
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

  it("opens Collaboration from its keywords", async () => {
    render(<SettingsModal />);
    typeQuery("maintainers");
    await waitFor(() =>
      expect(screen.getByTestId("settings-section-collaboration")).toHaveAttribute("aria-current", "page"),
    );
    expect(await screen.findByTestId("collab-section-stub")).toBeInTheDocument();
  });
});
