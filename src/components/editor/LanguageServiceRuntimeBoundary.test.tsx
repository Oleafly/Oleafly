// @vitest-environment jsdom
import {
  act,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LATEX_ENGINE, UNKNOWN_ENGINE } from "@/lib/document-engine";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import {
  LanguageServiceKeeper,
  type LanguageServiceKeeperController,
} from "./LanguageServiceKeeper";
import {
  createLanguageServiceRuntimeBoundary,
  LanguageServiceRuntimeUnavailable,
  type LanguageServiceRuntimeModule,
} from "./LanguageServiceRuntimeBoundary";

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

function deferredRuntimeModule() {
  let resolve!: (module: LanguageServiceRuntimeModule) => void;
  const promise = new Promise<LanguageServiceRuntimeModule>(
    (resolvePromise) => {
      resolve = resolvePromise;
    },
  );
  return { promise, resolve };
}

describe("LanguageServiceRuntimeBoundary", () => {
  it("renders an accessible, actionable unavailable state without the deferred chunk", async () => {
    const reload = vi.fn();
    const user = userEvent.setup();
    render(<LanguageServiceRuntimeUnavailable reload={reload} />);

    const alert = screen.getByRole("alert", {
      name: "Language analysis status",
    });
    expect(alert).toHaveTextContent(
      "Language analysis is unavailable",
    );
    await user.click(
      screen.getByRole("button", { name: "Reload Oleafly" }),
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("publishes the latest project snapshot after a deferred module resolves", async () => {
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
    const controller: LanguageServiceKeeperController = {
      update: vi.fn(),
      dispose: vi.fn(async () => {}),
    };
    const deferred = deferredRuntimeModule();
    const loadRuntime = vi.fn(() => deferred.promise);
    const Boundary =
      createLanguageServiceRuntimeBoundary(loadRuntime);
    const Runtime = () => (
      <LanguageServiceKeeper controller={controller} />
    );
    const rendered = render(<Boundary />);

    expect(loadRuntime).toHaveBeenCalledTimes(1);
    expect(controller.update).not.toHaveBeenCalled();

    act(() => {
      useFilesStore.setState((state) => ({
        files: {
          ...state.files,
          "main.tex": { content: "Unsaved", dirty: true },
        },
      }));
    });
    await act(async () => {
      deferred.resolve({ LanguageServiceRuntime: Runtime });
      await deferred.promise;
    });

    await waitFor(() => {
      expect(controller.update).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-a",
          files: {
            "main.tex": { content: "Unsaved", dirty: true },
          },
        }),
      );
    });
    expect(controller.update).toHaveBeenCalledTimes(1);

    rendered.unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(controller.dispose).toHaveBeenCalledTimes(1);
  });

  it("does not mount a late runtime after the boundary unmounts", async () => {
    const controller: LanguageServiceKeeperController = {
      update: vi.fn(),
      dispose: vi.fn(async () => {}),
    };
    const deferred = deferredRuntimeModule();
    const Boundary = createLanguageServiceRuntimeBoundary(
      () => deferred.promise,
    );
    const Runtime = () => (
      <LanguageServiceKeeper controller={controller} />
    );
    const rendered = render(<Boundary />);

    rendered.unmount();
    act(() => {
      useFilesStore.setState({
        projectId: "project-after-unmount",
        engine: LATEX_ENGINE,
        engineLoaded: true,
      });
    });
    await act(async () => {
      deferred.resolve({ LanguageServiceRuntime: Runtime });
      await deferred.promise;
      await Promise.resolve();
    });

    expect(controller.update).not.toHaveBeenCalled();
    expect(controller.dispose).not.toHaveBeenCalled();
  });
});
