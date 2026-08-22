// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
import { registry } from "@oleafly/registry";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: vi.fn() }),
}));
vi.mock("@/lib/tauri", () => ({
  searchDocs: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/components/editor/cm/controller", () => ({
  gotoLine: vi.fn(),
}));

import { SearchOmnibar } from "./SearchOmnibar";

describe("SearchOmnibar experimental tool visibility", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    registry.commands.length = 0;
    registry.commands.push({
      id: "tool.pdf-to-latex",
      surfaces: ["omnibar"],
      label: "Open PDF to LaTeX",
      slash: ["pdf-to-latex"],
      order: 1,
      when: (ctx) => ctx.latexToolsEnabled === true,
      run: vi.fn(),
    });
    useSettingsStore.setState({ searchOpen: true, latexTools: true });
    useFilesStore.setState({
      projectId: null,
      projectKind: undefined,
      projects: [],
      refreshProjects: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("removes tool commands immediately when LaTeX Tools is disabled", async () => {
    render(<SearchOmnibar />);
    expect(screen.getByText("Open PDF to LaTeX")).toBeInTheDocument();

    act(() => useSettingsStore.getState().setLatexTools(false));

    await waitFor(() => {
      expect(screen.queryByText("Open PDF to LaTeX")).not.toBeInTheDocument();
    });
  });
});
