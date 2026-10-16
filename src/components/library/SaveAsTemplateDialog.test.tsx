// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/custom-templates", () => ({
  saveProjectTemplate: vi.fn(),
  announceSavedTemplate: vi.fn(),
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => {}) }));

import enLibrary from "@/i18n/locales/en/library.json" with { type: "json" };
import { announceSavedTemplate, saveProjectTemplate } from "@/features/custom-templates";
import { useSaveAsTemplateStore } from "@/store/save-as-template";
import { SaveAsTemplateDialog } from "./SaveAsTemplateDialog";
import { SaveAsTemplateHost } from "./SaveAsTemplateHost";

const copy = enLibrary.customTemplates;

beforeEach(() => {
  vi.clearAllMocks();
  useSaveAsTemplateStore.setState({ target: null });
  vi.mocked(saveProjectTemplate).mockResolvedValue("paper-abc123");
});

describe("SaveAsTemplateDialog", () => {
  it("stays hidden until a project asks for it", () => {
    render(<SaveAsTemplateDialog />);
    expect(screen.queryByTestId("save-as-template-dialog")).not.toBeInTheDocument();
  });

  it("saves under the project's name by default and announces the template", async () => {
    render(<SaveAsTemplateDialog />);
    act(() => useSaveAsTemplateStore.getState().openFor("p1", "Lab paper"));

    const dialog = await screen.findByTestId("save-as-template-dialog");
    expect(dialog).toHaveTextContent(copy.saveTitle);
    expect(dialog).toHaveTextContent("A copy of Lab paper goes to your templates under Custom.");
    const name = screen.getByTestId("save-as-template-name");
    expect(name).toHaveValue("Lab paper");

    fireEvent.change(name, { target: { value: "Lab paper template " } });
    fireEvent.keyDown(name, { key: "Enter" });

    await waitFor(() =>
      expect(saveProjectTemplate).toHaveBeenCalledWith("p1", "Lab paper template"),
    );
    expect(announceSavedTemplate).toHaveBeenCalledWith("paper-abc123", "Lab paper template");
    expect(useSaveAsTemplateStore.getState().target).toBeNull();
  });

  it("needs a name and shows a failure without closing", async () => {
    vi.mocked(saveProjectTemplate).mockRejectedValue(new Error("disk full"));
    render(<SaveAsTemplateDialog />);
    act(() => useSaveAsTemplateStore.getState().openFor("p1", "Lab paper"));

    const name = await screen.findByTestId("save-as-template-name");
    fireEvent.change(name, { target: { value: "   " } });
    expect(screen.getByTestId("save-as-template-save")).toBeDisabled();

    fireEvent.change(name, { target: { value: "Kept" } });
    fireEvent.click(screen.getByTestId("save-as-template-save"));

    expect(await screen.findByRole("alert")).toHaveTextContent(copy.saveFailed);
    expect(announceSavedTemplate).not.toHaveBeenCalled();
    expect(useSaveAsTemplateStore.getState().target).not.toBeNull();
  });

  it("shows the backend's own reason when there is one", async () => {
    vi.mocked(saveProjectTemplate).mockRejectedValue(
      '@oleafly/error:{"code":"project.import_no_main"}',
    );
    render(<SaveAsTemplateDialog />);
    act(() => useSaveAsTemplateStore.getState().openFor("p1", "Notes"));

    fireEvent.click(await screen.findByTestId("save-as-template-save"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/no LaTeX, Typst or Markdown document/);
  });

  it("closes from the close button but not while saving", async () => {
    let finish: (id: string) => void = () => {};
    vi.mocked(saveProjectTemplate).mockImplementation(
      () => new Promise<string>((resolve) => { finish = resolve; }),
    );
    render(<SaveAsTemplateDialog />);
    act(() => useSaveAsTemplateStore.getState().openFor("p1", "Notes"));

    fireEvent.click(await screen.findByTestId("save-as-template-save"));
    await waitFor(() => expect(saveProjectTemplate).toHaveBeenCalled());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useSaveAsTemplateStore.getState().target).not.toBeNull();
    finish("n-1");
    await waitFor(() => expect(useSaveAsTemplateStore.getState().target).toBeNull());

    act(() => useSaveAsTemplateStore.getState().openFor("p2", "Other"));
    const dialog = await screen.findByTestId("save-as-template-dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(useSaveAsTemplateStore.getState().target).toBeNull();
  });
});

describe("SaveAsTemplateHost", () => {
  it("loads the dialog only while a project asks for it", async () => {
    render(<SaveAsTemplateHost />);
    expect(screen.queryByTestId("save-as-template-dialog")).not.toBeInTheDocument();

    act(() => useSaveAsTemplateStore.getState().openFor("p1", "Lab paper"));
    expect(await screen.findByTestId("save-as-template-name")).toHaveValue("Lab paper");

    act(() => useSaveAsTemplateStore.getState().close());
    await waitFor(() =>
      expect(screen.queryByTestId("save-as-template-dialog")).not.toBeInTheDocument(),
    );
  });
});
