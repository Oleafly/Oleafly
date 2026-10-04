// @vitest-environment jsdom

import type { ComponentPropsWithRef, ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewProjectDialog } from "./NewProjectDialog";
import { modalCoordinator } from "./modal-coordinator";
import type { TemplateInfo, TemplatesHost, TemplatesKit } from "./types";
import type { TemplatesMessageKey } from "./messages";

const t = (key: TemplatesMessageKey, params?: Record<string, unknown>) =>
  params ? `${key} ${Object.values(params).join(" ")}` : key;

const kit: TemplatesKit = {
  Input: (props: ComponentPropsWithRef<"input">) => <input {...props} />,
  Button: ({
    children,
    onClick,
    disabled,
    ...rest
  }: {
    children?: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  Select: ({
    value,
    onValueChange,
    options,
    ...rest
  }: {
    value: string;
    onValueChange: (value: string) => void;
    options: { value: string; label: string }[];
  }) => (
    <select value={value} onChange={(event) => onValueChange(event.target.value)} {...rest}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  t,
};

const COLORS = [
  { name: "Slate", hex: "#334155" },
  { name: "Amber", hex: "#f59e0b" },
];

function template(overrides: Partial<TemplateInfo> = {}): TemplateInfo {
  return {
    id: "blank",
    name: "Blank",
    description: "An empty document",
    category: "Blank",
    engine: "xetex",
    document_engine: "latex",
    ats_profile: null,
    default_color: null,
    license: null,
    has_preview: false,
    assets_ready: true,
    source: "bundled",
    ...overrides,
  };
}

const TEMPLATES: TemplateInfo[] = [
  template(),
  template({
    id: "ats-resume",
    name: "ATS resume",
    category: "CVs & Resumes",
    ats_profile: "friendly",
    default_color: "#f59e0b",
    license: { spdx: "MIT", author: "A. Writer" },
  }),
  template({
    id: "poster",
    name: "Conference poster",
    category: "Posters",
    ats_profile: "design-forward",
    document_engine: "typst",
    engine: "typst",
    assets_ready: false,
  }),
  template({
    id: "ai-flow",
    name: "Generated flow",
    category: "AI Generated",
    document_engine: "markdown",
    engine: "markdown",
  }),
  template({ id: "zine", name: "Zine", category: "Zines" }),
];

function makeHost(overrides: Partial<TemplatesHost> = {}): TemplatesHost {
  return {
    loadPreview: vi.fn(async () => null),
    ensureAssets: vi.fn(async () => undefined),
    logError: vi.fn(),
    ...overrides,
  };
}

function open(props: Record<string, unknown> = {}, host = makeHost()) {
  const onCreate = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <NewProjectDialog
      open
      templates={TEMPLATES}
      onClose={onClose}
      onCreate={onCreate}
      host={host}
      kit={kit}
      colorOptions={COLORS}
      defaultColor="#334155"
      {...props}
    />,
  );
  return { view, onCreate, onClose, host };
}

describe("NewProjectDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing while closed", () => {
    const { container } = render(
      <NewProjectDialog
        open={false}
        templates={TEMPLATES}
        onClose={() => {}}
        onCreate={() => {}}
        host={makeHost()}
        kit={kit}
        colorOptions={COLORS}
        defaultColor="#334155"
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("lists the categories in order with their counts", () => {
    open();

    const nav = screen.getByRole("dialog").querySelector("nav") as HTMLElement;
    const labels = Array.from(nav.querySelectorAll("button")).map(
      (button) => button.textContent ?? "",
    );

    expect(labels[0]).toContain("category.all");
    expect(labels[0]).toContain("5");
    expect(labels[1]).toContain("category.aiGenerated");
    expect(labels.some((label) => label.includes("category.blank"))).toBe(true);
    expect(labels.some((label) => label.includes("Zines"))).toBe(true);
  });

  it("names every card and badges the ones that need setup", () => {
    open();

    expect(screen.getByText("dialog.chooseTemplate")).toBeInTheDocument();
    expect(screen.getByTestId("template-card-blank")).toHaveTextContent("Blank");
    expect(screen.getByTestId("template-card-poster")).toHaveTextContent("dialog.setupBadge");
    expect(screen.getByTestId("template-card-poster")).toHaveTextContent("dialog.needsSetup");
    expect(screen.getByTestId("template-card-poster")).toHaveTextContent("Typst");
    expect(screen.getByTestId("template-card-ai-flow")).toHaveTextContent("dialog.aiBadge");
    expect(screen.getByTestId("template-card-ai-flow")).toHaveTextContent("Pandoc");
    expect(screen.getByTestId("template-card-blank")).toHaveTextContent("Tectonic");
  });

  it("filters by search, category, engine, ats and offline", () => {
    open();
    const search = screen.getByPlaceholderText("dialog.searchPlaceholder");

    fireEvent.change(search, { target: { value: "poster" } });
    expect(screen.getByTestId("template-card-poster")).toBeInTheDocument();
    expect(screen.queryByTestId("template-card-blank")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("dialog.engineLabel"), {
      target: { value: "typst" },
    });
    expect(screen.getByTestId("template-card-poster")).toBeInTheDocument();
    expect(screen.queryByTestId("template-card-ai-flow")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("dialog.engineLabel"), { target: { value: "all" } });
    fireEvent.click(screen.getByText("category.posters"));
    expect(screen.queryByTestId("template-card-blank")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("category.all"));
    fireEvent.click(screen.getAllByText("dialog.atsFriendly")[0]);
    expect(screen.getByTestId("template-card-ats-resume")).toBeInTheDocument();
    expect(screen.queryByTestId("template-card-poster")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByText("dialog.atsFriendly")[0]);
    fireEvent.click(screen.getByTestId("template-offline-filter"));
    expect(screen.queryByTestId("template-card-poster")).not.toBeInTheDocument();
    expect(screen.getByTestId("template-card-blank")).toBeInTheDocument();
  });

  it("offers to generate a template when the filters match nothing", () => {
    const onGenerateWithAi = vi.fn();
    open({ onGenerateWithAi });

    fireEvent.change(screen.getByPlaceholderText("dialog.searchPlaceholder"), {
      target: { value: "no such template" },
    });

    expect(screen.getByText("dialog.emptyTitle")).toBeInTheDocument();
    expect(screen.getByText("dialog.emptyBody")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("generate-template-empty-state"));
    expect(onGenerateWithAi).toHaveBeenCalledOnce();
  });

  it("offers import, AI generation and the download catalog in the header", () => {
    const onImportProject = vi.fn();
    const onGenerateWithAi = vi.fn();
    const onOpenTemplateDownloads = vi.fn();
    open({ onImportProject, onGenerateWithAi, onOpenTemplateDownloads });

    fireEvent.click(screen.getByTestId("import-from-overleaf"));
    fireEvent.click(screen.getByTestId("generate-template-with-ai"));
    fireEvent.click(screen.getByTestId("open-template-downloads"));

    expect(onImportProject).toHaveBeenCalledOnce();
    expect(onGenerateWithAi).toHaveBeenCalledOnce();
    expect(onOpenTemplateDownloads).toHaveBeenCalledOnce();
    expect(screen.getByText("dialog.getMoreTemplates")).toBeInTheDocument();
  });

  it("prefers an app-supplied import control over the built-in one", () => {
    open({
      importControl: <span data-testid="app-import" />,
      onImportProject: vi.fn(),
    });

    expect(screen.getByTestId("app-import")).toBeInTheDocument();
    expect(screen.queryByTestId("import-from-overleaf")).not.toBeInTheDocument();
  });

  it("moves to the details step with the template accent and its hint", () => {
    open();

    fireEvent.click(screen.getByTestId("template-card-ats-resume"));

    expect(screen.getByText("dialog.nameProject")).toBeInTheDocument();
    expect(screen.getByText("dialog.projectName")).toBeInTheDocument();
    expect(screen.getByText("dialog.coverColor")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("nameHint.atsResume")).toBeInTheDocument();
    expect(screen.getByText("dialog.atsFriendly")).toBeInTheDocument();
    expect(screen.getByText("MIT · A. Writer")).toBeInTheDocument();
    expect(screen.getByLabelText("Amber")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("create-project")).toBeDisabled();
  });

  it("warns that a template still needs its assets", () => {
    open();

    fireEvent.click(screen.getByTestId("template-card-poster"));

    expect(screen.getByText("dialog.setupNotice")).toBeInTheDocument();
    expect(screen.getByText("dialog.designForward")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("nameHint.poster")).toBeInTheDocument();
  });

  it("falls back to the generic name hint for an unmapped template", () => {
    open();

    fireEvent.click(screen.getByTestId("template-card-zine"));

    expect(screen.getByPlaceholderText("nameHint.default")).toBeInTheDocument();
  });

  it("creates the project with the chosen name and colour", async () => {
    const { onCreate } = open();

    fireEvent.click(screen.getByTestId("template-card-blank"));
    fireEvent.change(screen.getByLabelText("dialog.projectName"), {
      target: { value: "My paper" },
    });
    fireEvent.click(screen.getByLabelText("Amber"));
    fireEvent.click(screen.getByTestId("create-project"));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("My paper", "blank", "#f59e0b"));
  });

  it("gives an unpicked cover a colour from the host instead of the first swatch", async () => {
    const pickColor = vi.fn(() => "#a3c4f3");
    const { onCreate } = open({ pickColor });

    fireEvent.click(screen.getByTestId("template-card-blank"));
    expect(screen.queryAllByRole("button", { pressed: true })).toEqual([]);
    fireEvent.change(screen.getByLabelText("dialog.projectName"), {
      target: { value: "Untitled" },
    });
    fireEvent.click(screen.getByTestId("create-project"));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("Untitled", "blank", "#a3c4f3"));
    expect(pickColor).toHaveBeenCalledOnce();
  });

  it("downloads the assets a template needs before creating it", async () => {
    const host = makeHost({
      ensureAssets: vi.fn(async (_id, onProgress) => {
        onProgress("Fandol", 1, 2);
      }),
    });
    const { onCreate } = open({}, host);

    fireEvent.click(screen.getByTestId("template-card-poster"));
    fireEvent.change(screen.getByLabelText("dialog.projectName"), {
      target: { value: "Poster" },
    });
    fireEvent.click(screen.getByTestId("create-project"));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("Poster", "poster", "#334155"));
    expect(host.ensureAssets).toHaveBeenCalledOnce();
  });

  it("stops at the download step when the assets cannot be fetched", async () => {
    const host = makeHost({
      ensureAssets: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    const { onCreate } = open({}, host);

    fireEvent.click(screen.getByTestId("template-card-poster"));
    fireEvent.change(screen.getByLabelText("dialog.projectName"), {
      target: { value: "Poster" },
    });
    fireEvent.click(screen.getByTestId("create-project"));

    await waitFor(() => expect(host.logError).toHaveBeenCalledOnce());
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("says it is working while the host creates the project", () => {
    open({ busy: true });

    fireEvent.click(screen.getByTestId("template-card-blank"));

    expect(screen.getByText("dialog.creating")).toBeInTheDocument();
    expect(screen.getByTestId("create-project")).toBeDisabled();
  });

  it("goes back to the gallery", () => {
    open();

    fireEvent.click(screen.getByTestId("template-card-blank"));
    fireEvent.click(screen.getByText("dialog.back"));

    expect(screen.getByText("dialog.chooseTemplate")).toBeInTheDocument();
  });

  it("closes on Escape and from the close button", () => {
    const { onClose } = open();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByLabelText("dialog.close"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps the dialog open when closing is not allowed", () => {
    const { onClose } = open({ allowClose: false });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("dialog.close")).not.toBeInTheDocument();
  });

  it("submits from the create chord and from Enter in the name field", async () => {
    const { onCreate } = open();

    fireEvent.click(screen.getByTestId("template-card-blank"));
    const field = screen.getByLabelText("dialog.projectName");
    fireEvent.change(field, { target: { value: "Chorded" } });

    fireEvent.keyDown(document, { key: "Enter", metaKey: true });
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("Chorded", "blank", "#334155"));

    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2));
  });

  it("ignores Enter in the name field when the host disables it", async () => {
    const { onCreate } = open({ allowEnterSubmit: false });

    fireEvent.click(screen.getByTestId("template-card-blank"));
    const field = screen.getByLabelText("dialog.projectName");
    fireEvent.change(field, { target: { value: "Quiet" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onCreate).not.toHaveBeenCalled();
  });

  it("shows a rendered thumbnail when the host has one", async () => {
    const host = makeHost({ loadPreview: vi.fn(async () => "data:image/png;base64,AA") });
    open({ templates: [template({ id: "with-preview", name: "Cover", has_preview: true })] }, host);

    const image = await screen.findByAltText("dialog.previewAlt Cover");

    expect(image).toHaveAttribute("src", "data:image/png;base64,AA");
    expect(host.loadPreview).toHaveBeenCalledWith("with-preview");
  });

  it("jumps straight to the details step for an app-requested template", async () => {
    open();

    fireEvent(
      window,
      new CustomEvent("oleafly:use-template", { detail: { id: "ats-resume" } }),
    );

    await waitFor(() => expect(screen.getByText("dialog.nameProject")).toBeInTheDocument());
    expect(screen.getByPlaceholderText("nameHint.atsResume")).toBeInTheDocument();
  });
});

describe("NewProjectDialog focus and dismissal", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("wraps Tab focus at both ends of the dialog and leaves the middle alone", () => {
    open();
    const closeButton = screen.getByLabelText("dialog.close");
    const lastCard = screen.getByTestId("template-card-zine");
    const search = screen.getByPlaceholderText("dialog.searchPlaceholder");

    lastCard.focus();
    expect(fireEvent.keyDown(window, { key: "Tab" })).toBe(false);
    expect(document.activeElement).toBe(closeButton);

    expect(fireEvent.keyDown(window, { key: "Tab", shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(lastCard);

    search.focus();
    expect(fireEvent.keyDown(window, { key: "Tab" })).toBe(true);
    expect(document.activeElement).toBe(search);
  });

  it("pulls focus back into the dialog when it lands outside", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    open();
    const search = screen.getByPlaceholderText("dialog.searchPlaceholder");

    search.focus();
    expect(document.activeElement).toBe(search);

    outside.focus();
    expect(document.activeElement).toBe(screen.getByLabelText("dialog.close"));
  });

  it("leaves keys, focus and the backdrop to a modal stacked above it", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    const { onClose } = open();
    const above = modalCoordinator.add(null);

    try {
      fireEvent.keyDown(window, { key: "Escape" });
      outside.focus();
      fireEvent.mouseDown(screen.getByRole("dialog").parentElement as HTMLElement);

      expect(onClose).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(outside);
    } finally {
      modalCoordinator.remove(above);
    }
  });

  it("closes when the backdrop is pressed, not when the dialog itself is", () => {
    const { onClose } = open();
    const dialog = screen.getByRole("dialog");

    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ignores the backdrop when closing is not allowed", () => {
    const { onClose } = open({ allowClose: false });

    fireEvent.mouseDown(screen.getByRole("dialog").parentElement as HTMLElement);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("gives focus back to the control that opened it", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { view } = open();
    expect(document.activeElement).toBe(screen.getByPlaceholderText("dialog.searchPlaceholder"));

    view.rerender(
      <NewProjectDialog
        open={false}
        templates={TEMPLATES}
        onClose={() => {}}
        onCreate={() => {}}
        host={makeHost()}
        kit={kit}
        colorOptions={COLORS}
        defaultColor="#334155"
      />,
    );

    expect(document.activeElement).toBe(opener);
  });

  it("does not try to refocus an opener that was removed while it was open", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { view } = open();
    opener.remove();

    view.unmount();

    expect(document.activeElement).not.toBe(opener);
    expect(modalCoordinator.size()).toBe(0);
  });
});

describe("NewProjectDialog create shortcut", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("submits from the Ctrl chord and ignores other chords", async () => {
    const { onCreate } = open();

    fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });
    expect(onCreate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("template-card-blank"));
    fireEvent.change(screen.getByLabelText("dialog.projectName"), { target: { value: "Ctrl paper" } });
    fireEvent.keyDown(document, { key: "a", ctrlKey: true });
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onCreate).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("Ctrl paper", "blank", "#334155"));
  });

  it("does not submit from the chord while the name is blank", () => {
    const { onCreate } = open();

    fireEvent.click(screen.getByTestId("template-card-blank"));
    fireEvent.change(screen.getByLabelText("dialog.projectName"), { target: { value: "   " } });
    fireEvent.keyDown(document, { key: "Enter", metaKey: true });

    expect(onCreate).not.toHaveBeenCalled();
  });

  it.each([
    ["MacIntel", "⌘"],
    ["Win32", "Ctrl"],
  ])("labels the shortcut for %s", (platform, label) => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
    open();

    fireEvent.click(screen.getByTestId("template-card-blank"));

    expect(screen.getByTestId("create-project")).toHaveTextContent(label);
  });
});

describe("NewProjectDialog template requests and metadata", () => {
  afterEach(() => {
    cleanup();
  });

  it("ignores template requests without an id", () => {
    open();

    fireEvent(window, new CustomEvent("oleafly:use-template", { detail: {} }));
    fireEvent(window, new CustomEvent("oleafly:use-template"));

    expect(screen.getByText("dialog.chooseTemplate")).toBeInTheDocument();
  });

  it("opens a requested template once it arrives in the catalog", () => {
    const { view, onClose, onCreate, host } = open();
    const late = template({ id: "late", name: "Late arrival", category: "Letters" });

    fireEvent(window, new CustomEvent("oleafly:use-template", { detail: { id: "late" } }));
    expect(screen.getByText("dialog.chooseTemplate")).toBeInTheDocument();

    view.rerender(
      <NewProjectDialog
        open
        templates={[...TEMPLATES, late]}
        onClose={onClose}
        onCreate={onCreate}
        host={host}
        kit={kit}
        colorOptions={COLORS}
        defaultColor="#334155"
      />,
    );

    expect(screen.getByText("dialog.nameProject")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("nameHint.categoryLetters")).toBeInTheDocument();
  });

  it("files templates without a category under Other", () => {
    open({
      templates: [template(), template({ id: "loose", name: "Loose sheet", category: "" })],
    });

    const other = screen.getByText("category.other").closest("button") as HTMLElement;
    expect(other).toHaveTextContent("1");

    fireEvent.click(other);
    expect(screen.getByTestId("template-card-loose")).toBeInTheDocument();
    expect(screen.queryByTestId("template-card-blank")).not.toBeInTheDocument();
  });

  it("shows a licence without an author on its own", () => {
    open({ templates: [template({ id: "cc", name: "CC sheet", license: { spdx: "CC-BY-4.0", author: null } })] });

    fireEvent.click(screen.getByTestId("template-card-cc"));

    expect(screen.getByText("CC-BY-4.0")).toBeInTheDocument();
  });
});

describe("NewProjectDialog previews", () => {
  afterEach(() => {
    cleanup();
  });

  it("reuses a loaded thumbnail on the details step instead of fetching it again", async () => {
    const host = makeHost({ loadPreview: vi.fn(async () => "data:image/png;base64,BB") });
    open({ templates: [template({ id: "reused-cover", name: "Reused", has_preview: true })] }, host);
    await screen.findByAltText("dialog.previewAlt Reused");

    fireEvent.click(screen.getByTestId("template-card-reused-cover"));

    expect(screen.getByAltText("dialog.previewAlt Reused")).toHaveAttribute("src", "data:image/png;base64,BB");
    expect(host.loadPreview).toHaveBeenCalledOnce();
  });

  it("keeps the engine placeholder when a thumbnail fails, without retrying", async () => {
    const host = makeHost({
      loadPreview: vi.fn(async () => {
        throw new Error("missing");
      }),
    });
    open({ templates: [template({ id: "broken-cover", name: "Broken", has_preview: true })] }, host);
    await waitFor(() => expect(host.loadPreview).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByTestId("template-card-broken-cover"));
    await act(async () => {});

    expect(screen.queryByAltText("dialog.previewAlt Broken")).not.toBeInTheDocument();
    expect(screen.getAllByText("Tectonic").length).toBeGreaterThan(0);
    expect(host.loadPreview).toHaveBeenCalledOnce();
  });

  it("keeps a thumbnail that arrives after its card was filtered away", async () => {
    let resolvePreview: (uri: string) => void = () => {};
    const host = makeHost({
      loadPreview: vi.fn(
        () =>
          new Promise<string | null>((resolve) => {
            resolvePreview = resolve;
          }),
      ),
    });
    open({ templates: [template(), template({ id: "slow-cover", name: "Slow", has_preview: true })] }, host);
    const search = screen.getByPlaceholderText("dialog.searchPlaceholder");

    fireEvent.change(search, { target: { value: "nothing matches" } });
    expect(screen.queryByTestId("template-card-slow-cover")).not.toBeInTheDocument();
    await act(async () => {
      resolvePreview("data:image/png;base64,CC");
    });
    fireEvent.change(search, { target: { value: "" } });

    expect(screen.getByAltText("dialog.previewAlt Slow")).toHaveAttribute("src", "data:image/png;base64,CC");
    expect(host.loadPreview).toHaveBeenCalledOnce();
  });

  it("shows a figure thumbnail whole rather than cropped like a page", async () => {
    const host = makeHost({ loadPreview: vi.fn(async () => "data:image/png;base64,DD") });
    open(
      {
        templates: [
          template({ id: "figure-cover", name: "Figure", category: "Diagrams & Figures", has_preview: true }),
          template({ id: "page-cover", name: "Page", has_preview: true }),
        ],
      },
      host,
    );

    expect(await screen.findByAltText("dialog.previewAlt Figure")).toHaveClass("object-contain");
    expect(await screen.findByAltText("dialog.previewAlt Page")).toHaveClass("object-cover");
  });
});
