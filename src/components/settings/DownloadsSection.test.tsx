// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetProgress, ComponentInfo, PackInfo, TemplateInfo } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  unlisten: vi.fn(),
  listFontComponents: vi.fn(),
  listTemplatePacks: vi.fn(),
  listTemplates: vi.fn(),
  templatePreview: vi.fn(),
  refreshPackCatalog: vi.fn(),
  installFontComponent: vi.fn(),
  removeFontComponent: vi.fn(),
  downloadAllFonts: vi.fn(),
  installTemplatePack: vi.fn(),
  removeTemplatePack: vi.fn(),
  deleteCustomTemplate: vi.fn(),
  success: vi.fn(),
  notifyError: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@/lib/tauri", () => ({
  listFontComponents: mocks.listFontComponents,
  listTemplatePacks: mocks.listTemplatePacks,
  listTemplates: mocks.listTemplates,
  templatePreview: mocks.templatePreview,
  refreshPackCatalog: mocks.refreshPackCatalog,
  installFontComponent: mocks.installFontComponent,
  removeFontComponent: mocks.removeFontComponent,
  downloadAllFonts: mocks.downloadAllFonts,
  installTemplatePack: mocks.installTemplatePack,
  removeTemplatePack: mocks.removeTemplatePack,
  deleteCustomTemplate: mocks.deleteCustomTemplate,
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.success },
  notifyError: mocks.notifyError,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { i18n } from "@/i18n";
import { useSettingsStore } from "@/store/settings";
import { DownloadsSection } from "./DownloadsSection";

const downloads = enSettings.downloads;

const errors = {
  fontDownload: () => i18n.t(($) => $.settings.downloads.errors.fontDownloadFailed),
  fontsDownload: () => i18n.t(($) => $.settings.downloads.errors.fontsDownloadFailed),
  fontRemove: () => i18n.t(($) => $.settings.downloads.errors.fontRemoveFailed),
  packDownload: () => i18n.t(($) => $.settings.downloads.errors.packDownloadFailed),
  packsDownload: () => i18n.t(($) => $.settings.downloads.errors.packsDownloadFailed),
  packRemove: () => i18n.t(($) => $.settings.downloads.errors.packRemoveFailed),
  aiDelete: (name: string) =>
    i18n.t(($) => $.settings.downloads.aiTemplates.deleteFailed, { name }),
};

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const component = (over: Partial<ComponentInfo> = {}): ComponentInfo => ({
  id: "lato",
  label: "Lato",
  description: "font",
  approx_bytes: 2_400_000,
  license: { spdx: "OFL-1.1" } as ComponentInfo["license"],
  installed: false,
  kind: "font",
  ...over,
});

const pack = (over: Partial<PackInfo> = {}): PackInfo => ({
  id: "resumes",
  label: "Resumes",
  description: "Resume templates",
  category: "resume",
  approx_bytes: 640_000,
  count: 4,
  license_summary: "MIT",
  installed: false,
  ...over,
});

const template = (over: Partial<TemplateInfo> = {}): TemplateInfo =>
  ({
    id: "ai-1",
    name: "Grant draft",
    description: "",
    category: "AI Generated",
    engine: "pdflatex",
    document_engine: "latex",
    ats_profile: null,
    layout: null,
    pages: null,
    default_color: null,
    license: null,
    requires: { packages: [], fonts: [], engine: "pdflatex" },
    has_preview: false,
    assets_ready: true,
    order: 0,
    source: "custom",
    ...over,
  }) as TemplateInfo;

let emit: ((event: { payload: AssetProgress }) => void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  emit = null;
  mocks.listen.mockImplementation(
    async (_name: string, handler: (event: { payload: AssetProgress }) => void) => {
      emit = handler;
      return mocks.unlisten;
    },
  );
  mocks.listFontComponents.mockResolvedValue([]);
  mocks.listTemplatePacks.mockResolvedValue([]);
  mocks.listTemplates.mockResolvedValue([]);
  mocks.templatePreview.mockResolvedValue(null);
  mocks.refreshPackCatalog.mockResolvedValue(undefined);
  mocks.installFontComponent.mockResolvedValue(undefined);
  mocks.removeFontComponent.mockResolvedValue(undefined);
  mocks.downloadAllFonts.mockResolvedValue(undefined);
  mocks.installTemplatePack.mockResolvedValue(undefined);
  mocks.removeTemplatePack.mockResolvedValue(undefined);
  mocks.deleteCustomTemplate.mockResolvedValue(undefined);
  useSettingsStore.setState({ settingsScrollTarget: null });
});

describe("DownloadsSection fonts tab", () => {
  it("shows the empty state when nothing is downloadable", async () => {
    render(<DownloadsSection />);

    expect(await screen.findByText(downloads.fonts.empty)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: downloads.fonts.heading }),
    ).toBeInTheDocument();
    expect(screen.getByText(downloads.fonts.engineNote)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: downloads.actions.downloadAll }),
    ).toBeEnabled();
  });

  it("labels known font packs from the catalog and formats their size", async () => {
    mocks.listFontComponents.mockResolvedValue([
      component(),
      component({ id: "ptserif", installed: true, approx_bytes: 400_000 }),
      component({
        id: "vendor-face",
        label: "Vendor Face",
        description: "other",
        approx_bytes: 0,
        license: null,
      }),
    ]);
    render(<DownloadsSection />);

    expect(
      await screen.findByText(downloads.fontPacks.lato.label),
    ).toBeInTheDocument();
    expect(
      screen.getByText(downloads.fontPacks.lato.description, { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(downloads.fontPacks.ptserif.label),
    ).toBeInTheDocument();
    expect(screen.getByText("Vendor Face")).toBeInTheDocument();
    expect(
      screen.getByText(downloads.size.megabytes.replace("{{value}}", "2.4")),
    ).toBeInTheDocument();
    expect(
      screen.getByText(downloads.size.kilobytes.replace("{{value}}", "400")),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: enCommon.actions.remove }),
    ).toBeInTheDocument();
  });

  it("disables the bulk button once everything is installed", async () => {
    mocks.listFontComponents.mockResolvedValue([component({ installed: true })]);
    render(<DownloadsSection />);

    expect(
      await screen.findByRole("button", { name: downloads.actions.allDownloaded }),
    ).toBeDisabled();
  });

  it("streams progress while a single font downloads", async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    mocks.installFontComponent.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    mocks.listFontComponents.mockResolvedValue([component()]);
    render(<DownloadsSection />);

    await user.click(
      await screen.findByRole("button", { name: downloads.actions.download }),
    );
    await waitFor(() => expect(mocks.installFontComponent).toHaveBeenCalledWith("lato"));

    emit?.({
      payload: {
        component: "lato",
        label: "Lato Regular",
        file: "lato.ttf",
        index: 1,
        total: 4,
        received: 10,
        file_total: 100,
      },
    });
    expect(
      await screen.findByText(
        downloads.progress
          .replace("{{label}}", "Lato Regular")
          .replace("{{index}}", "1")
          .replace("{{total}}", "4"),
      ),
    ).toBeInTheDocument();

    release();
    await waitFor(() => expect(mocks.unlisten).toHaveBeenCalled());
  });

  it("downloads every font and reports a failure in plain words", async () => {
    const user = userEvent.setup();
    const failure = new Error("download failed: error sending request for url");
    mocks.downloadAllFonts.mockRejectedValue(failure);
    mocks.listFontComponents.mockResolvedValue([component()]);
    render(<DownloadsSection />);

    await user.click(
      await screen.findByRole("button", { name: downloads.actions.downloadAll }),
    );
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "download the fonts",
        failure,
        errors.fontsDownload(),
      ),
    );
    expect(mocks.notifyError).toHaveBeenCalledOnce();
  });

  it("reports a single font download failure in plain words", async () => {
    const user = userEvent.setup();
    const failure = new Error("No such file or directory (os error 2)");
    mocks.installFontComponent.mockRejectedValue(failure);
    mocks.listFontComponents.mockResolvedValue([component()]);
    render(<DownloadsSection />);

    await user.click(
      await screen.findByRole("button", { name: downloads.actions.download }),
    );
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "download the font",
        failure,
        errors.fontDownload(),
      ),
    );
  });

  it("removes an installed font and reports a failure", async () => {
    const user = userEvent.setup();
    const failure = new Error("locked");
    mocks.removeFontComponent.mockRejectedValue(failure);
    mocks.listFontComponents.mockResolvedValue([component({ installed: true })]);
    render(<DownloadsSection />);

    await user.click(
      await screen.findByRole("button", { name: enCommon.actions.remove }),
    );
    await waitFor(() => expect(mocks.removeFontComponent).toHaveBeenCalledWith("lato"));
    expect(mocks.notifyError).toHaveBeenCalledWith(
      "remove the font",
      failure,
      errors.fontRemove(),
    );
  });

  it("keeps a running font download busy after the section remounts", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    mocks.installFontComponent.mockReturnValue(pending.promise);
    mocks.listFontComponents.mockResolvedValue([
      component(),
      component({ id: "ptserif", installed: true }),
    ]);
    const first = render(<DownloadsSection />);

    await user.click(
      await screen.findByRole("button", { name: downloads.actions.download }),
    );
    await waitFor(() => expect(mocks.installFontComponent).toHaveBeenCalledWith("lato"));
    first.unmount();

    render(<DownloadsSection />);
    const remove = await screen.findByRole("button", { name: enCommon.actions.remove });
    expect(remove).toBeDisabled();
    expect(
      screen.getByRole("button", { name: downloads.actions.downloadAll }),
    ).toBeDisabled();
    emit?.({
      payload: {
        component: "lato",
        label: "Lato Bold",
        file: "lato-bold.ttf",
        index: 2,
        total: 4,
        received: 10,
        file_total: 100,
      },
    });
    expect(
      await screen.findByText(
        downloads.progress
          .replace("{{label}}", "Lato Bold")
          .replace("{{index}}", "2")
          .replace("{{total}}", "4"),
      ),
    ).toBeInTheDocument();

    const listsBefore = mocks.listFontComponents.mock.calls.length;
    mocks.listFontComponents.mockResolvedValue([
      component({ installed: true }),
      component({ id: "ptserif", installed: true }),
    ]);
    pending.resolve();
    expect(
      await screen.findByRole("button", { name: downloads.actions.allDownloaded }),
    ).toBeDisabled();
    expect(mocks.listFontComponents.mock.calls.length).toBeGreaterThan(listsBefore);
    expect(mocks.installFontComponent).toHaveBeenCalledOnce();
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("logs a failed catalog read instead of rendering rows", async () => {
    mocks.listFontComponents.mockRejectedValue(new Error("no catalog"));
    mocks.listTemplatePacks.mockRejectedValue(new Error("no catalog"));
    render(<DownloadsSection />);

    await waitFor(() => expect(mocks.logError).toHaveBeenCalledTimes(2));
    expect(screen.getByText(downloads.fonts.empty)).toBeInTheDocument();
  });
});

describe("DownloadsSection templates tab", () => {
  it("opens on the templates tab when Settings asks for it", async () => {
    useSettingsStore.setState({ settingsScrollTarget: "templates" });
    mocks.listTemplatePacks.mockResolvedValue([pack()]);
    render(<DownloadsSection />);

    expect(await screen.findByTestId("pack-row-resumes")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: downloads.templates.heading }),
    ).toBeInTheDocument();
    expect(useSettingsStore.getState().settingsScrollTarget).toBeNull();
  });

  it("shows the pack empty state after switching tabs", async () => {
    const user = userEvent.setup();
    render(<DownloadsSection />);

    await user.click(screen.getByTestId("downloads-tab-templates"));
    expect(
      await screen.findByText(downloads.templates.empty),
    ).toBeInTheDocument();
  });

  it("installs one pack with progress, then removes it", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ settingsScrollTarget: "templates" });
    let release: () => void = () => {};
    mocks.installTemplatePack.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    mocks.listTemplatePacks.mockResolvedValue([pack()]);
    render(<DownloadsSection />);

    await user.click(await screen.findByTestId("pack-install-resumes"));
    await waitFor(() => expect(mocks.installTemplatePack).toHaveBeenCalledWith("resumes"));

    emit?.({
      payload: {
        component: "resumes",
        label: "Resumes",
        file: "a.tex",
        index: 2,
        total: 3,
        received: 1,
        file_total: null,
      },
    });
    expect(
      await screen.findByText(
        downloads.packProgress.replace("{{index}}", "2").replace("{{total}}", "3"),
      ),
    ).toBeInTheDocument();

    mocks.listTemplatePacks.mockResolvedValue([pack({ installed: true })]);
    release();
    await screen.findByTestId("pack-remove-resumes");

    await user.click(screen.getByTestId("pack-remove-resumes"));
    await waitFor(() => expect(mocks.removeTemplatePack).toHaveBeenCalledWith("resumes"));
  });

  it("skips installed packs when downloading them all and reports a failure", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ settingsScrollTarget: "templates" });
    const failure = new Error("offline");
    mocks.installTemplatePack.mockRejectedValue(failure);
    mocks.listTemplatePacks.mockResolvedValue([
      pack({ id: "done", installed: true }),
      pack(),
    ]);
    render(<DownloadsSection />);

    await screen.findByTestId("pack-row-resumes");
    await user.click(
      screen.getByRole("button", { name: downloads.actions.downloadAll }),
    );
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "download the template packs",
        failure,
        errors.packsDownload(),
      ),
    );
    expect(mocks.notifyError).toHaveBeenCalledOnce();
    expect(mocks.installTemplatePack).toHaveBeenCalledTimes(1);
    expect(mocks.installTemplatePack).toHaveBeenCalledWith("resumes");
  });

  it("reports a single pack download failure in plain words", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ settingsScrollTarget: "templates" });
    const failure = new Error("unknown template pack: resumes");
    mocks.installTemplatePack.mockRejectedValue(failure);
    mocks.listTemplatePacks.mockResolvedValue([pack()]);
    render(<DownloadsSection />);

    await user.click(await screen.findByTestId("pack-install-resumes"));
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "download the template pack",
        failure,
        errors.packDownload(),
      ),
    );
  });

  it("reports a failed pack removal", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ settingsScrollTarget: "templates" });
    const failure = new Error("locked");
    mocks.removeTemplatePack.mockRejectedValue(failure);
    mocks.listTemplatePacks.mockResolvedValue([pack({ installed: true })]);
    render(<DownloadsSection />);

    await user.click(await screen.findByTestId("pack-remove-resumes"));
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "remove the template pack",
        failure,
        errors.packRemove(),
      ),
    );
  });

  it("keeps a running pack download busy after the section remounts", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ settingsScrollTarget: "templates" });
    const pending = deferred();
    mocks.installTemplatePack.mockReturnValue(pending.promise);
    mocks.listTemplatePacks.mockResolvedValue([pack()]);
    const first = render(<DownloadsSection />);

    await user.click(await screen.findByTestId("pack-install-resumes"));
    await waitFor(() => expect(mocks.installTemplatePack).toHaveBeenCalledWith("resumes"));
    first.unmount();

    useSettingsStore.setState({ settingsScrollTarget: "templates" });
    render(<DownloadsSection />);
    expect(await screen.findByTestId("pack-install-resumes")).toBeDisabled();
    await user.click(screen.getByTestId("pack-install-resumes"));
    expect(mocks.installTemplatePack).toHaveBeenCalledOnce();

    mocks.listTemplatePacks.mockResolvedValue([pack({ installed: true })]);
    pending.resolve();
    expect(await screen.findByTestId("pack-remove-resumes")).toBeEnabled();
    expect(mocks.installTemplatePack).toHaveBeenCalledOnce();
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("reports one failure when a download from an earlier mount fails", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ settingsScrollTarget: "templates" });
    const pending = deferred();
    mocks.installTemplatePack.mockReturnValue(pending.promise);
    mocks.listTemplatePacks.mockResolvedValue([pack()]);
    const first = render(<DownloadsSection />);

    await user.click(await screen.findByTestId("pack-install-resumes"));
    await waitFor(() => expect(mocks.installTemplatePack).toHaveBeenCalledOnce());
    first.unmount();

    useSettingsStore.setState({ settingsScrollTarget: "templates" });
    render(<DownloadsSection />);
    expect(await screen.findByTestId("pack-install-resumes")).toBeDisabled();

    const failure = new Error("download failed: connection reset");
    pending.reject(failure);
    await waitFor(() =>
      expect(screen.getByTestId("pack-install-resumes")).toBeEnabled(),
    );
    expect(mocks.notifyError).toHaveBeenCalledOnce();
    expect(mocks.notifyError).toHaveBeenCalledWith(
      "download the template pack",
      failure,
      errors.packDownload(),
    );
  });
});

describe("DownloadsSection AI templates", () => {
  it("lists nothing until the panel is opened, then shows the empty state", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ settingsScrollTarget: "templates" });
    render(<DownloadsSection />);

    const toggle = await screen.findByTestId("manage-ai-templates");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(mocks.listTemplates).not.toHaveBeenCalled();

    await user.click(toggle);
    expect(
      await screen.findByText(downloads.aiTemplates.empty),
    ).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("renders previews, the fallback description, and deletes on confirmation", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ settingsScrollTarget: "templates" });
    mocks.listTemplates.mockResolvedValue([
      template(),
      template({ id: "ai-2", name: "Poster", description: "A poster" }),
      template({ id: "plain", category: "Reports" }),
    ]);
    mocks.templatePreview.mockImplementation(async (id: string) =>
      id === "ai-2" ? "data:image/png;base64,AAA" : null,
    );
    render(<DownloadsSection />);

    await user.click(await screen.findByTestId("manage-ai-templates"));
    await screen.findByTestId("ai-template-row-ai-1");
    expect(screen.queryByTestId("ai-template-row-plain")).not.toBeInTheDocument();
    expect(
      screen.getByText(downloads.aiTemplates.fallbackDescription),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("presentation")).toHaveAttribute(
        "src",
        "data:image/png;base64,AAA",
      ),
    );

    await user.click(screen.getByTestId("ai-template-delete-ai-1"));
    expect(
      await screen.findByText(downloads.aiTemplates.deleteTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        downloads.aiTemplates.deleteDescription.replace("{{name}}", "Grant draft"),
      ),
    ).toBeInTheDocument();

    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: enCommon.actions.delete,
      }),
    );
    await waitFor(() => expect(mocks.deleteCustomTemplate).toHaveBeenCalledWith("ai-1"));
    expect(mocks.success).toHaveBeenCalledWith(
      downloads.aiTemplates.deleted.replace("{{name}}", "Grant draft"),
    );
  });

  it("keeps the template when the delete is cancelled and reports a failed delete", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ settingsScrollTarget: "templates" });
    mocks.listTemplates.mockResolvedValue([template()]);
    mocks.deleteCustomTemplate.mockRejectedValue(new Error("busy"));
    render(<DownloadsSection />);

    await user.click(await screen.findByTestId("manage-ai-templates"));
    await user.click(await screen.findByTestId("ai-template-delete-ai-1"));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: new RegExp(enCommon.actions.cancel),
      }),
    );
    expect(mocks.deleteCustomTemplate).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("ai-template-delete-ai-1"));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: enCommon.actions.delete,
      }),
    );
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "delete the template",
        expect.any(Error),
        errors.aiDelete("Grant draft"),
      ),
    );
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("logs a failed AI template read", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ settingsScrollTarget: "templates" });
    mocks.listTemplates.mockRejectedValue(new Error("no library"));
    render(<DownloadsSection />);

    await user.click(await screen.findByTestId("manage-ai-templates"));
    await waitFor(() => expect(mocks.logError).toHaveBeenCalled());
  });
});
