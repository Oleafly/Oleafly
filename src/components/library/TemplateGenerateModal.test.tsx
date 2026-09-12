// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const getConfig = vi.fn(async () => ({}) as Record<string, unknown>);
const generateTemplateAvailable = vi.fn(async () => true);
const generateTemplateSource = vi.fn();
const compileGeneratedTemplate = vi.fn();
const saveGeneratedTemplate = vi.fn(async () => {});
const deleteGeneratedTemplate = vi.fn(async () => {});
const toastSuccess = vi.fn();
const notifyError = vi.fn();

vi.mock("@/lib/tauri", () => ({
  getConfig: () => getConfig(),
}));

vi.mock("@/features/template-generate", () => ({
  generateTemplateAvailable: () => generateTemplateAvailable(),
  generateTemplateSource: (...args: unknown[]) =>
    generateTemplateSource(...(args as [])),
  compileGeneratedTemplate: (...args: unknown[]) =>
    compileGeneratedTemplate(...(args as [])),
  saveGeneratedTemplate: (...args: unknown[]) =>
    saveGeneratedTemplate(...(args as [])),
  deleteGeneratedTemplate: (...args: unknown[]) =>
    deleteGeneratedTemplate(...(args as [])),
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: vi.fn(),
    info: vi.fn(),
    update: vi.fn(),
    dismiss: vi.fn(),
  },
  notifyError: (...args: unknown[]) => notifyError(...args),
}));

import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enLibrary from "@/i18n/locales/en/library.json" with { type: "json" };
import { TemplateGenerateModal } from "@/components/library/TemplateGenerateModal";
import type { ParsedTemplate } from "@/features/template-generate";

const onClose = vi.fn();
const onSaved = vi.fn();

const TEMPLATE: ParsedTemplate = {
  slug: "workshop-paper",
  name: "Workshop Paper",
  description: "A two-column workshop paper.",
  category: "Academic",
  tags: ["two-column", "abstract"],
  engine: "xetex",
  mainDoc: "main.tex",
  source: "\\documentclass{article}",
};

function renderModal(open = true) {
  return render(
    <TemplateGenerateModal open={open} onClose={onClose} onSaved={onSaved} />,
  );
}

async function runGeneration(overrides: Partial<ParsedTemplate> = {}) {
  generateTemplateSource.mockResolvedValue({ ...TEMPLATE, ...overrides });
  renderModal();
  fireEvent.change(screen.getByTestId("template-generate-input"), {
    target: { value: "a workshop paper" },
  });
  fireEvent.click(screen.getByTestId("template-generate-run"));
  await waitFor(() =>
    expect(screen.getByTestId("template-generate-save")).toBeInTheDocument(),
  );
}

beforeEach(() => {
  vi.useRealTimers();
  getConfig.mockReset();
  getConfig.mockResolvedValue({});
  generateTemplateAvailable.mockReset();
  generateTemplateAvailable.mockResolvedValue(true);
  generateTemplateSource.mockReset();
  compileGeneratedTemplate.mockReset();
  compileGeneratedTemplate.mockResolvedValue({
    png: "data:image/png;base64,preview",
    log: "",
  });
  saveGeneratedTemplate.mockReset();
  deleteGeneratedTemplate.mockReset();
  toastSuccess.mockReset();
  notifyError.mockReset();
  onClose.mockReset();
  onSaved.mockReset();
});

describe("TemplateGenerateModal prompt phase", () => {
  it("renders nothing while closed", () => {
    const { container } = renderModal(false);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the prompt form with every example chip", () => {
    renderModal();
    expect(screen.getByTestId("template-generate-modal")).toBeInTheDocument();
    expect(screen.getByText(enLibrary.generate.title)).toBeInTheDocument();
    for (const example of Object.values(enLibrary.generate.examples)) {
      expect(screen.getByText(example)).toBeInTheDocument();
    }
    expect(screen.getByTestId("template-generate-run")).toBeDisabled();
  });

  it("fills the prompt from an example chip", () => {
    renderModal();
    fireEvent.click(
      screen.getByText(enLibrary.generate.examples.resume),
    );
    expect(screen.getByTestId("template-generate-input")).toHaveValue(
      enLibrary.generate.examples.resume,
    );
    expect(screen.getByTestId("template-generate-run")).not.toBeDisabled();
  });

  it("closes from the header button and the backdrop", () => {
    renderModal();
    fireEvent.click(
      screen.getByRole("button", { name: enCommon.actions.close }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(screen.getByTestId("template-generate-modal"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("asks for a provider when none is configured", async () => {
    generateTemplateAvailable.mockResolvedValue(false);
    renderModal();
    fireEvent.change(screen.getByTestId("template-generate-input"), {
      target: { value: "a resume" },
    });
    fireEvent.click(screen.getByTestId("template-generate-run"));
    expect(
      await screen.findByText(enLibrary.generate.noProvider),
    ).toBeInTheDocument();
    expect(generateTemplateSource).not.toHaveBeenCalled();
  });

  it("generates from the keyboard shortcut", async () => {
    generateTemplateSource.mockResolvedValue(TEMPLATE);
    renderModal();
    const input = screen.getByTestId("template-generate-input");
    fireEvent.change(input, { target: { value: "a poster" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    await waitFor(() =>
      expect(generateTemplateSource).toHaveBeenCalledTimes(1),
    );
  });

  it("surfaces a generation failure back on the prompt", async () => {
    generateTemplateSource.mockRejectedValue(new Error("model refused"));
    renderModal();
    fireEvent.change(screen.getByTestId("template-generate-input"), {
      target: { value: "a resume" },
    });
    fireEvent.click(screen.getByTestId("template-generate-run"));
    expect(await screen.findByText("model refused")).toBeInTheDocument();
    expect(screen.getByTestId("template-generate-input")).toBeInTheDocument();
  });

  it("offers a model selector once providers are configured", async () => {
    getConfig.mockResolvedValue({
      ai_provider: "openai",
      ai_model: "gpt-5",
      ai_keys: { openai: "sk-test" },
      ai_custom_providers: [],
    });
    renderModal();
    await waitFor(() => expect(getConfig).toHaveBeenCalled());
    expect(screen.getByTestId("template-generate-run")).toBeInTheDocument();
  });
});

describe("TemplateGenerateModal loading phase", () => {
  it("shows the quoted prompt and advances the step list", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const pending: { settle: ((value: ParsedTemplate) => void) | null } = {
      settle: null,
    };
    generateTemplateSource.mockImplementation(
      () =>
        new Promise<ParsedTemplate>((resolve) => {
          pending.settle = resolve;
        }),
    );
    renderModal();
    fireEvent.change(screen.getByTestId("template-generate-input"), {
      target: { value: "a newsletter" },
    });
    fireEvent.click(screen.getByTestId("template-generate-run"));
    await waitFor(() =>
      expect(
        screen.getByText(enLibrary.generate.loading),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText(
        enLibrary.generate.quotedPrompt.replace("{{prompt}}", "a newsletter"),
      ),
    ).toBeInTheDocument();
    for (const step of Object.values(enLibrary.generate.steps)) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await act(async () => {
      pending.settle?.(TEMPLATE);
    });
    await waitFor(() =>
      expect(screen.getByTestId("template-generate-save")).toBeInTheDocument(),
    );
    vi.useRealTimers();
  });
});

describe("TemplateGenerateModal result phase", () => {
  it("renders the compiled preview and template metadata", async () => {
    await runGeneration();
    expect(
      screen.getByAltText(enLibrary.generate.previewAlt),
    ).toBeInTheDocument();
    expect(screen.getByText(TEMPLATE.name)).toBeInTheDocument();
    expect(screen.getByText(TEMPLATE.description)).toBeInTheDocument();
    expect(screen.getByText(TEMPLATE.category)).toBeInTheDocument();
    for (const tag of TEMPLATE.tags) {
      expect(screen.getByText(tag)).toBeInTheDocument();
    }
    expect(screen.getByText(enLibrary.generate.badge)).toBeInTheDocument();
  });

  it("switches to the source view", async () => {
    await runGeneration();
    fireEvent.click(screen.getByTestId("template-generate-view-code"));
    expect(screen.getByText(TEMPLATE.source)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("template-generate-view-preview"));
    expect(
      screen.getByAltText(enLibrary.generate.previewAlt),
    ).toBeInTheDocument();
  });

  it("warns when a LaTeX draft failed to compile", async () => {
    compileGeneratedTemplate.mockRejectedValue(new Error("missing package"));
    await runGeneration();
    expect(
      screen.getByText(enLibrary.generate.compileWarning),
    ).toBeInTheDocument();
    expect(screen.getByText(TEMPLATE.source)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("template-generate-view-preview"));
    expect(
      screen.getByText(enLibrary.generate.compileFailed),
    ).toBeInTheDocument();
  });

  it("explains that a non-LaTeX engine has no preview", async () => {
    compileGeneratedTemplate.mockResolvedValue({ png: null, log: "" });
    await runGeneration({ engine: "typst" });
    fireEvent.click(screen.getByTestId("template-generate-view-preview"));
    expect(
      screen.getByText(enLibrary.generate.previewUnsupported),
    ).toBeInTheDocument();
  });

  it("falls back to a placeholder when there is no description", async () => {
    await runGeneration({ description: "" });
    expect(
      screen.getByText(enLibrary.generate.noDescription),
    ).toBeInTheDocument();
  });

  it("edits the description inline", async () => {
    await runGeneration();
    fireEvent.click(
      screen.getByRole("button", {
        name: enLibrary.generate.editDescription,
      }),
    );
    const editor = screen.getByDisplayValue(TEMPLATE.description);
    fireEvent.change(editor, { target: { value: "Updated description" } });
    fireEvent.blur(editor);
    expect(screen.getByText("Updated description")).toBeInTheDocument();
  });

  it("saves the template and then removes it", async () => {
    await runGeneration();
    fireEvent.click(screen.getByTestId("template-generate-save"));
    await waitFor(() => expect(saveGeneratedTemplate).toHaveBeenCalledTimes(1));
    expect(toastSuccess).toHaveBeenCalledWith(
      enLibrary.generate.savedToast.replace("{{name}}", TEMPLATE.name),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);

    const unsave = await screen.findByRole("button", {
      name: new RegExp(enLibrary.generate.saved),
    });
    fireEvent.click(unsave);
    await waitFor(() =>
      expect(deleteGeneratedTemplate).toHaveBeenCalledWith(TEMPLATE.slug),
    );
    expect(toastSuccess).toHaveBeenLastCalledWith(
      enLibrary.generate.removedToast.replace("{{name}}", TEMPLATE.name),
    );
  });

  it("reports a failed save", async () => {
    saveGeneratedTemplate.mockRejectedValue(new Error("disk full"));
    await runGeneration();
    fireEvent.click(screen.getByTestId("template-generate-save"));
    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("reports a failed removal", async () => {
    deleteGeneratedTemplate.mockRejectedValue(new Error("locked"));
    await runGeneration();
    fireEvent.click(screen.getByTestId("template-generate-save"));
    const unsave = await screen.findByRole("button", {
      name: new RegExp(enLibrary.generate.saved),
    });
    fireEvent.click(unsave);
    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
  });

  it("saves and announces the template when it is used", async () => {
    const listener = vi.fn();
    window.addEventListener("oleafly:use-template", listener);
    await runGeneration();
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(enLibrary.generate.use) }),
    );
    await waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    expect(saveGeneratedTemplate).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    window.removeEventListener("oleafly:use-template", listener);
  });

  it("does not announce the template when saving fails", async () => {
    const listener = vi.fn();
    window.addEventListener("oleafly:use-template", listener);
    saveGeneratedTemplate.mockRejectedValue(new Error("disk full"));
    await runGeneration();
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(enLibrary.generate.use) }),
    );
    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener("oleafly:use-template", listener);
  });

  it("regenerates from the result footer", async () => {
    await runGeneration();
    fireEvent.click(
      screen.getByRole("button", { name: enLibrary.generate.regenerate }),
    );
    await waitFor(() =>
      expect(generateTemplateSource).toHaveBeenCalledTimes(2),
    );
  });
});
