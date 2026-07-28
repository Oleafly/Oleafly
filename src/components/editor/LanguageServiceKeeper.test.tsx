// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LATEX_ENGINE, UNKNOWN_ENGINE } from "@/lib/document-engine";
import { buildIndex } from "@/lib/index/build";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import {
  LANGUAGE_SERVICE_DISPOSE_DIAGNOSTIC,
  LanguageServiceKeeper,
  type LanguageServiceKeeperController,
} from "./LanguageServiceKeeper";

afterEach(() => {
  useFilesStore.setState({
    projectId: null,
    mainDoc: "main.tex",
    engine: UNKNOWN_ENGINE,
    engineLoaded: false,
    tree: [],
    files: {},
    openTabs: [],
    activePath: null,
  });
  useIndexStore.getState().reset();
});

describe("LanguageServiceKeeper", () => {
  it("publishes Files/Index snapshots and disposes after unmount", async () => {
    useFilesStore.setState({
      projectId: "project-a",
      mainDoc: "main.tex",
      engine: LATEX_ENGINE,
      engineLoaded: true,
      tree: [{ path: "main.tex", is_dir: false }],
      files: {
        "main.tex": { content: "Initial", dirty: false },
      },
    });
    useIndexStore.setState({
      texts: { "main.tex": "Initial" },
      index: buildIndex({ "main.tex": "Initial" }),
      building: false,
    });
    const controller: LanguageServiceKeeperController = {
      update: vi.fn(),
      dispose: vi.fn(async () => {}),
    };
    const rendered = render(
      <LanguageServiceKeeper controller={controller} />,
    );

    await waitFor(() => {
      expect(controller.update).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-a",
          engineId: "latex",
          mainDoc: "main.tex",
          indexTexts: { "main.tex": "Initial" },
        }),
      );
    });

    const semanticCalls = vi.mocked(controller.update).mock.calls.length;
    act(() => {
      useFilesStore.setState({ activePath: "main.tex" });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(controller.update).toHaveBeenCalledTimes(semanticCalls);

    act(() => {
      useFilesStore.setState((state) => ({
        files: {
          ...state.files,
          "main.tex": { content: "Unsaved", dirty: true },
        },
      }));
    });
    await waitFor(() => {
      expect(controller.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          files: {
            "main.tex": { content: "Unsaved", dirty: true },
          },
        }),
      );
    });

    rendered.unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(controller.dispose).toHaveBeenCalledTimes(1);
  });

  it("retains one controller through StrictMode's effect replay", async () => {
    const controller: LanguageServiceKeeperController = {
      update: vi.fn(),
      dispose: vi.fn(async () => {}),
    };
    const rendered = render(
      <StrictMode>
        <LanguageServiceKeeper controller={controller} />
      </StrictMode>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(controller.update).toHaveBeenCalled();
    expect(controller.dispose).not.toHaveBeenCalled();

    rendered.unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(controller.dispose).toHaveBeenCalledTimes(1);
  });

  it("reports one stable diagnostic without leaking a disposal failure", async () => {
    const diagnostic = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const controller: LanguageServiceKeeperController = {
      update: vi.fn(),
      dispose: vi.fn(async () => {
        throw new Error(
          "secret-token at /Users/private/language-server",
        );
      }),
    };
    const rendered = render(
      <LanguageServiceKeeper controller={controller} />,
    );

    rendered.unmount();
    await waitFor(() => {
      expect(diagnostic).toHaveBeenCalledTimes(1);
    });
    expect(diagnostic).toHaveBeenCalledWith(
      LANGUAGE_SERVICE_DISPOSE_DIAGNOSTIC,
    );
    expect(diagnostic.mock.calls.flat().join(" ")).not.toContain(
      "secret-token",
    );
    expect(diagnostic.mock.calls.flat().join(" ")).not.toContain(
      "/Users/private",
    );
    diagnostic.mockRestore();
  });
});
