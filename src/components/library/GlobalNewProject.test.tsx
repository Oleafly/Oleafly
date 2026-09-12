// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

const listTemplates = vi.fn(async () => [] as unknown[]);
const notifyError = vi.fn();
const logError = vi.fn();
const finishHomeTourAfterProjectCreation = vi.fn();

vi.mock("@/lib/tauri", () => ({
  listTemplates: () => listTemplates(),
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    update: vi.fn(),
    dismiss: vi.fn(),
  },
  notifyError: (...args: unknown[]) => notifyError(...args),
}));

vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => logError(...args),
}));

vi.mock("@/lib/tours/coordinator", () => ({
  finishHomeTourAfterProjectCreation: (...args: unknown[]) =>
    finishHomeTourAfterProjectCreation(...args),
}));

vi.mock("@/components/library/NewProjectDialog", () => ({
  NewProjectDialog: ({
    open,
    busy,
    allowClose,
    allowEnterSubmit,
    onClose,
    onCreate,
    onTemplatesChanged,
  }: {
    open: boolean;
    busy?: boolean;
    allowClose?: boolean;
    allowEnterSubmit?: boolean;
    onClose: () => void;
    onCreate: (name: string, templateId: string, color: string) => void;
    onTemplatesChanged?: () => void;
  }) =>
    open ? (
      <div
        data-testid="new-project-dialog"
        data-busy={String(Boolean(busy))}
        data-allow-close={String(allowClose)}
        data-allow-enter={String(allowEnterSubmit)}
      >
        <button
          type="button"
          data-testid="dialog-create"
          onClick={() => onCreate("  My Paper  ", "article", "indigo")}
        >
          <span>{"create"}</span>
        </button>
        <button
          type="button"
          data-testid="dialog-create-unnamed"
          onClick={() => onCreate("   ", "article", "indigo")}
        >
          <span>{"create-unnamed"}</span>
        </button>
        <button type="button" data-testid="dialog-close" onClick={onClose}>
          <span>{"close"}</span>
        </button>
        <button
          type="button"
          data-testid="dialog-templates-changed"
          onClick={() => onTemplatesChanged?.()}
        >
          <span>{"reload"}</span>
        </button>
      </div>
    ) : null,
}));

import enLibrary from "@/i18n/locales/en/library.json" with { type: "json" };
import { GlobalNewProject } from "@/components/library/GlobalNewProject";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useTourStore } from "@/store/tours";

const createFromTemplate = vi.fn(async () => "proj-1");

beforeEach(() => {
  listTemplates.mockReset();
  listTemplates.mockResolvedValue([{ id: "article", name: "Article" }]);
  notifyError.mockReset();
  logError.mockReset();
  finishHomeTourAfterProjectCreation.mockReset();
  createFromTemplate.mockReset();
  createFromTemplate.mockResolvedValue("proj-1");
  useFilesStore.setState({ createFromTemplate, projectId: null });
  useSettingsStore.setState({ newProjectOpen: true });
  useTourStore.setState({ activeTourId: null });
});

describe("GlobalNewProject", () => {
  it("renders nothing while the dialog is closed", () => {
    useSettingsStore.setState({ newProjectOpen: false });
    render(<GlobalNewProject />);
    expect(
      screen.queryByTestId("new-project-dialog"),
    ).not.toBeInTheDocument();
    expect(listTemplates).not.toHaveBeenCalled();
  });

  it("loads templates when it opens", async () => {
    render(<GlobalNewProject />);
    expect(screen.getByTestId("new-project-dialog")).toBeInTheDocument();
    await waitFor(() => expect(listTemplates).toHaveBeenCalledTimes(1));
  });

  it("reports a template listing failure", async () => {
    listTemplates.mockRejectedValue(new Error("no catalog"));
    render(<GlobalNewProject />);
    await waitFor(() => expect(logError).toHaveBeenCalledTimes(1));
  });

  it("creates a project from the dialog and closes", async () => {
    render(<GlobalNewProject />);
    await act(async () => {
      screen.getByTestId("dialog-create").click();
    });
    expect(createFromTemplate).toHaveBeenCalledWith(
      "My Paper",
      "article",
      "indigo",
    );
    await waitFor(() =>
      expect(useSettingsStore.getState().newProjectOpen).toBe(false),
    );
    expect(finishHomeTourAfterProjectCreation).toHaveBeenCalledTimes(1);
  });

  it("names an unnamed project", async () => {
    render(<GlobalNewProject />);
    await act(async () => {
      screen.getByTestId("dialog-create-unnamed").click();
    });
    expect(createFromTemplate).toHaveBeenCalledWith(
      enLibrary.newProject.untitled,
      "article",
      "indigo",
    );
  });

  it("reports a creation failure and closes", async () => {
    createFromTemplate.mockRejectedValue(new Error("disk full"));
    render(<GlobalNewProject />);
    await act(async () => {
      screen.getByTestId("dialog-create").click();
    });
    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
    expect(useSettingsStore.getState().newProjectOpen).toBe(false);
  });

  it("closes from the dialog", () => {
    render(<GlobalNewProject />);
    screen.getByTestId("dialog-close").click();
    expect(useSettingsStore.getState().newProjectOpen).toBe(false);
  });

  it("holds the dialog open while the home tour runs", () => {
    useTourStore.setState({ activeTourId: "home" });
    render(<GlobalNewProject />);
    const dialog = screen.getByTestId("new-project-dialog");
    expect(dialog).toHaveAttribute("data-allow-close", "false");
    expect(dialog).toHaveAttribute("data-allow-enter", "false");
    dialog.querySelector<HTMLButtonElement>('[data-testid="dialog-close"]')?.click();
    expect(useSettingsStore.getState().newProjectOpen).toBe(true);
  });

  it("reloads templates on request", async () => {
    render(<GlobalNewProject />);
    await waitFor(() => expect(listTemplates).toHaveBeenCalledTimes(1));
    await act(async () => {
      screen.getByTestId("dialog-templates-changed").click();
    });
    expect(listTemplates).toHaveBeenCalledTimes(2);
  });

  it("chains the workspace tour once the project toolbar appears", async () => {
    const start = vi.fn(() => true);
    useTourStore.setState({ activeTourId: null, start });
    render(<GlobalNewProject />);
    createFromTemplate.mockImplementation(async () => {
      useFilesStore.setState({ projectId: "proj-1" });
      const toolbar = document.createElement("div");
      toolbar.dataset.tour = "project-toolbar";
      toolbar.getClientRects = () => [{}] as unknown as DOMRectList;
      document.body.append(toolbar);
      return "proj-1";
    });
    await act(async () => {
      screen.getByTestId("dialog-create").click();
    });
    await waitFor(() => expect(start).toHaveBeenCalledWith("workspace"));
  });
});
