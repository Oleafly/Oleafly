// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const generateTemplateAvailable = vi.fn(async () => true);
const templatePreview = vi.fn(async () => null);
const ensureTemplateAssets = vi.fn(async () => {});
const listen = vi.fn(async () => () => {});

vi.mock("@/features/template-generate", () => ({
  generateTemplateAvailable: () => generateTemplateAvailable(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listen(...(args as [])),
}));

vi.mock("@/lib/tauri", () => ({
  templatePreview: (...args: unknown[]) => templatePreview(...(args as [])),
  ensureTemplateAssets: (...args: unknown[]) =>
    ensureTemplateAssets(...(args as [])),
}));

vi.mock("@oleafly/templates", () => ({
  NewProjectDialog: ({
    open,
    onGenerateWithAi,
    onOpenTemplateDownloads,
  }: {
    open: boolean;
    onGenerateWithAi?: () => void;
    onOpenTemplateDownloads?: () => void;
  }) =>
    open ? (
      <div data-testid="templates-core">
        <button
          type="button"
          data-testid="templates-core-generate"
          disabled={!onGenerateWithAi}
          onClick={onGenerateWithAi}
        >
          <span>{"generate"}</span>
        </button>
        <button
          type="button"
          data-testid="templates-core-downloads"
          onClick={onOpenTemplateDownloads}
        >
          <span>{"downloads"}</span>
        </button>
      </div>
    ) : null,
  modalCoordinator: { add: () => 1, remove: () => null },
}));

vi.mock("@/components/library/ProjectImportDialog", () => ({
  ProjectImportDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="import-dialog" /> : null,
}));

vi.mock("@/components/research/workspace/ResearchProjectSetup", () => ({
  ResearchProjectSetup: ({
    open,
    onCreated,
  }: {
    open: boolean;
    onCreated: (projectId: string) => Promise<void>;
  }) =>
    open ? (
      <div data-testid="research-setup">
        <button
          type="button"
          data-testid="research-created"
          onClick={() => void onCreated("proj-1")}
        >
          <span>{"created"}</span>
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/library/TemplateGenerateModal", () => ({
  TemplateGenerateModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="generate-modal" /> : null,
}));

import { NewProjectDialog } from "@/components/library/NewProjectDialog";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

const onClose = vi.fn();
const onCreate = vi.fn();
const onTemplatesChanged = vi.fn();

function dialog(open: boolean, overrides: Record<string, unknown> = {}) {
  return (
    <NewProjectDialog
      open={open}
      templates={[]}
      onClose={onClose}
      onCreate={onCreate}
      onTemplatesChanged={onTemplatesChanged}
      {...overrides}
    />
  );
}

function renderDialog(open = true, overrides: Record<string, unknown> = {}) {
  const view = render(dialog(false, overrides));
  if (open) view.rerender(dialog(true, overrides));
  return view;
}

beforeEach(() => {
  generateTemplateAvailable.mockReset();
  generateTemplateAvailable.mockResolvedValue(true);
  onClose.mockReset();
  onCreate.mockReset();
  onTemplatesChanged.mockReset();
  useSettingsStore.setState({ settingsOpen: false });
});

describe("NewProjectDialog flow", () => {
  it("renders nothing while closed", () => {
    renderDialog(false);
    expect(
      screen.queryByTestId("project-kind-chooser"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("templates-core")).not.toBeInTheDocument();
  });

  it("opens on the starting-point chooser", async () => {
    renderDialog();
    expect(
      await screen.findByTestId("project-kind-chooser"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("templates-core")).not.toBeInTheDocument();
  });

  it("hands off to the template gallery", async () => {
    renderDialog();
    fireEvent.click(await screen.findByTestId("project-kind-template"));
    expect(screen.getByTestId("templates-core")).toBeInTheDocument();
    expect(
      screen.queryByTestId("project-kind-chooser"),
    ).not.toBeInTheDocument();
  });

  it("hands off to the import dialog", async () => {
    renderDialog();
    fireEvent.click(await screen.findByTestId("project-kind-import"));
    expect(screen.getByTestId("import-dialog")).toBeInTheDocument();
  });

  it("hands off to the research setup", async () => {
    renderDialog();
    fireEvent.click(await screen.findByTestId("project-kind-research"));
    expect(screen.getByTestId("research-setup")).toBeInTheDocument();
  });

  it("opens the generate modal when a provider is available", async () => {
    renderDialog();
    fireEvent.click(await screen.findByTestId("project-kind-template"));
    await waitFor(() =>
      expect(screen.getByTestId("templates-core-generate")).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId("templates-core-generate"));
    expect(screen.getByTestId("generate-modal")).toBeInTheDocument();
  });

  it("withholds AI generation when no provider is available", async () => {
    generateTemplateAvailable.mockResolvedValue(false);
    renderDialog();
    fireEvent.click(await screen.findByTestId("project-kind-template"));
    await waitFor(() => expect(generateTemplateAvailable).toHaveBeenCalled());
    expect(screen.getByTestId("templates-core-generate")).toBeDisabled();
  });

  it("opens the template downloads section of settings", async () => {
    renderDialog();
    fireEvent.click(await screen.findByTestId("project-kind-template"));
    fireEvent.click(screen.getByTestId("templates-core-downloads"));
    const settings = useSettingsStore.getState();
    expect(settings.settingsOpen).toBe(true);
    expect(settings.settingsInitialSection).toBe("downloads");
    expect(settings.settingsScrollTarget).toBe("templates");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays inert when it mounts already open, then arms on close", async () => {
    const { rerender } = render(dialog(true));
    expect(
      screen.queryByTestId("project-kind-chooser"),
    ).not.toBeInTheDocument();

    rerender(dialog(false));
    rerender(dialog(true));
    expect(
      await screen.findByTestId("project-kind-chooser"),
    ).toBeInTheDocument();
  });

  it("opens the project the research setup created", async () => {
    const openProject = vi.fn(async () => {});
    useFilesStore.setState({ openProject });
    renderDialog();
    fireEvent.click(await screen.findByTestId("project-kind-research"));
    fireEvent.click(screen.getByTestId("research-created"));
    await waitFor(() => expect(openProject).toHaveBeenCalledWith("proj-1"));
  });

  it("returns focus to whatever opened the flow", async () => {
    const opener = document.createElement("button");
    opener.type = "button";
    document.body.append(opener);
    opener.focus();

    const view = render(dialog(false));
    view.rerender(dialog(true));
    await screen.findByTestId("project-kind-chooser");
    view.rerender(dialog(false));
    await waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });

  it("refuses to close the chooser while closing is held back", async () => {
    renderDialog(true, { allowClose: false });
    await screen.findByTestId("project-kind-chooser");
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
