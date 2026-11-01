// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotebookToolchainStatus, NotebookToolStatus } from "@/lib/notebook-commands";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: mocks.invoke,
  Channel: class<T> {
    onmessage: (message: T) => void = () => {};
  },
}));

import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { useNotebookToolchainStore } from "@/store/notebook-toolchain";
import { NotebookEngineTab } from "./NotebookEngineTab";

const copy = enSettings.engine.notebook;

function quarto(over: Partial<NotebookToolStatus> = {}): NotebookToolStatus {
  return {
    tool: "quarto",
    pinnedVersion: "1.10.19",
    active: null,
    system: null,
    managed: null,
    offered: true,
    downloadBytes: 128_000_000,
    license: "MIT",
    installing: false,
    ...over,
  };
}

function toolchain(over: Partial<NotebookToolStatus> = {}): NotebookToolchainStatus {
  return { quarto: quarto(over), calepin: { ...quarto(), tool: "calepin", pinnedVersion: "0.0.61" }, runtimes: [] };
}

beforeEach(() => {
  mocks.invoke.mockReset();
  useNotebookToolchainStore.setState({ status: null, loading: false, loadFailed: false, installs: {}, removing: null });
});

describe("NotebookEngineTab", () => {
  it("lists a download an older Oleafly pinned and removes it", async () => {
    const user = userEvent.setup();
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "notebook_toolchain_status") return toolchain({ supersededVersions: ["1.10.18"] });
      if (command === "remove_notebook_tool") return toolchain();
      return null;
    });
    render(<NotebookEngineTab tool="quarto" />);

    const card = await screen.findByTestId("quarto-engine-superseded");
    expect(card).toHaveTextContent("Quarto 1.10.18");
    expect(card).toHaveTextContent(copy.superseded.replace("{{tool}}", "Quarto").replace("{{version}}", "1.10.19"));
    expect(screen.getByTestId("quarto-engine-download")).toBeInTheDocument();

    await user.click(
      within(card).getByRole("button", { name: copy.removeAria.replace("{{tool}}", "Quarto") }),
    );

    expect(mocks.invoke).toHaveBeenCalledWith("remove_notebook_tool", { tool: "quarto" });
    await waitFor(() => expect(screen.queryByTestId("quarto-engine-superseded")).toBeNull());
  });

  it("shows no old download when there is none", async () => {
    mocks.invoke.mockResolvedValue(toolchain({ supersededVersions: [] }));
    render(<NotebookEngineTab tool="quarto" />);

    expect(await screen.findByTestId("quarto-engine-download")).toBeInTheDocument();
    expect(screen.queryByTestId("quarto-engine-superseded")).toBeNull();
  });
});
