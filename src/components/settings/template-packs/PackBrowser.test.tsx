// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PackIndexInfo, PackInfo, PackTemplateInfo } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  listen: vi.fn(async () => () => {}),
  listFontComponents: vi.fn(),
  listTemplatePacks: vi.fn(),
  listTemplates: vi.fn(),
  templatePreview: vi.fn(),
  refreshPackCatalog: vi.fn(),
  packIndex: vi.fn(),
  installTemplatePack: vi.fn(),
  installPackTemplate: vi.fn(),
  removeTemplatePack: vi.fn(),
  openExternal: vi.fn(),
  notifyError: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.openExternal }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  withAssetProgress: (await importOriginal<typeof import("@/lib/tauri")>()).withAssetProgress,
  listFontComponents: mocks.listFontComponents,
  listTemplatePacks: mocks.listTemplatePacks,
  listTemplates: mocks.listTemplates,
  templatePreview: mocks.templatePreview,
  refreshPackCatalog: mocks.refreshPackCatalog,
  packIndex: mocks.packIndex,
  installTemplatePack: mocks.installTemplatePack,
  installPackTemplate: mocks.installPackTemplate,
  removeTemplatePack: mocks.removeTemplatePack,
  installFontComponent: vi.fn(),
  removeFontComponent: vi.fn(),
  downloadAllFonts: vi.fn(),
  deleteCustomTemplate: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn() }, notifyError: mocks.notifyError }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { DownloadsSection } from "@/components/settings/DownloadsSection";
import { useSettingsStore } from "@/store/settings";
import { resetTemplatePacks } from "@/store/template-packs";
import { clearTemplateRequest, useTemplateRequestStore } from "@/store/template-request";

const copy = enSettings.downloads;
const BASE = "https://raw.githubusercontent.com/Oleafly/template-packs/main";

const pack = (over: Partial<PackInfo> = {}): PackInfo => ({
  id: "open-letter",
  label: "Open letter templates",
  description: "Cover letters and memos",
  category: "Business",
  group: "community",
  approx_bytes: 104_627,
  count: 3,
  license_summary: "Apache-2.0, MIT",
  covers: [`${BASE}/previews/open-letter/a/thumb.webp`],
  installed: false,
  installed_count: 0,
  version: 2,
  ...over,
});

const template = (index: number, over: Partial<PackTemplateInfo> = {}): PackTemplateInfo => ({
  id: `tpl-${index}`,
  name: `Template ${index}`,
  description: `Description ${index}`,
  category: "Business",
  engine: index % 3 === 0 ? "typst" : "pdflatex",
  license: { spdx: "MIT", label: "MIT" },
  credit: null,
  thumb_url: `${BASE}/previews/open-letter/tpl-${index}/thumb.webp`,
  preview_url: `${BASE}/previews/open-letter/tpl-${index}/page-1.webp`,
  kind: null,
  languages: [],
  country: null,
  institution: null,
  bytes: 2_000,
  file_count: 3,
  installed: false,
  ...over,
});

const index = (count: number, extra: Partial<PackIndexInfo> = {}): PackIndexInfo => ({
  pack_id: "open-letter",
  version: 2,
  templates: Array.from({ length: count }, (_, i) => template(i)),
  ...extra,
});

function renderTemplatesTab() {
  useSettingsStore.setState({ settingsScrollTarget: "templates" });
  return render(<DownloadsSection />);
}

async function openPack(id = "open-letter") {
  const user = userEvent.setup();
  renderTemplatesTab();
  await user.click(await screen.findByTestId(`pack-open-${id}`));
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTemplatePacks();
  clearTemplateRequest();
  mocks.listFontComponents.mockResolvedValue([]);
  mocks.listTemplates.mockResolvedValue([]);
  mocks.templatePreview.mockResolvedValue(null);
  mocks.refreshPackCatalog.mockResolvedValue(false);
  mocks.listTemplatePacks.mockResolvedValue([
    pack({ id: "resumes", label: "Resumes", group: "curated", description: "CVs", covers: [] }),
    pack(),
    pack({ id: "cn-theses", label: "Chinese theses", group: "university", description: "Tsinghua and Peking" }),
  ]);
  mocks.packIndex.mockResolvedValue(index(3));
  mocks.installTemplatePack.mockResolvedValue(undefined);
  mocks.installPackTemplate.mockResolvedValue(undefined);
  mocks.removeTemplatePack.mockResolvedValue(undefined);
  mocks.openExternal.mockResolvedValue(undefined);
  useSettingsStore.setState({ settingsOpen: true, newProjectOpen: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pack list", () => {
  it("opens a pack from its cover collage as well as its browse button", async () => {
    const user = userEvent.setup();
    renderTemplatesTab();
    const card = await screen.findByTestId("pack-row-open-letter");
    const collage = card.querySelector<HTMLButtonElement>('button[tabindex="-1"]');
    expect(collage).not.toBeNull();
    await user.click(collage as HTMLButtonElement);
    expect(await screen.findByTestId("pack-title")).toHaveTextContent("Open letter templates");
  });

  it("groups packs, offers download all only for curated packs, and filters by search", async () => {
    const user = userEvent.setup();
    renderTemplatesTab();

    const curated = await screen.findByTestId("pack-group-curated");
    expect(within(curated).getByRole("heading", { name: copy.packs.groups.curated })).toBeInTheDocument();
    expect(within(curated).getByTestId("packs-download-curated")).toHaveTextContent(copy.actions.downloadAll);
    const community = screen.getByTestId("pack-group-community");
    expect(within(community).queryByTestId("packs-download-curated")).not.toBeInTheDocument();
    expect(screen.getByTestId("pack-group-university")).toBeInTheDocument();
    expect(screen.queryByTestId("pack-group-typst")).not.toBeInTheDocument();
    expect(within(community).getByText(copy.packs.count_other.replace("{{count}}", "3"), { exact: false })).toBeInTheDocument();
    expect(within(community).getByText("Apache-2.0, MIT")).toBeInTheDocument();

    await user.type(screen.getByTestId("packs-search"), "tsinghua");
    expect(screen.getByTestId("pack-row-cn-theses")).toBeInTheDocument();
    expect(screen.queryByTestId("pack-row-open-letter")).not.toBeInTheDocument();

    await user.clear(screen.getByTestId("packs-search"));
    await user.type(screen.getByTestId("packs-search"), "zzz");
    expect(screen.getByText(copy.packs.noPacks)).toBeInTheDocument();
  });

  it("draws a lazy cover collage in fixed slots", async () => {
    renderTemplatesTab();
    const card = await screen.findByTestId("pack-row-open-letter");
    const images = card.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute("loading", "lazy");
    expect(images[0]).toHaveAttribute("decoding", "async");
    expect(card.querySelectorAll(".aspect-\\[1\\/1\\.294\\]")).toHaveLength(4);
  });

  it("shows partial installs and checks for new packs when asked", async () => {
    mocks.listTemplatePacks.mockResolvedValue([pack({ installed_count: 1 })]);
    const user = userEvent.setup();
    renderTemplatesTab();
    expect(
      await screen.findByText(
        copy.packs.installedCount.replace("{{installed}}", "1").replace("{{total}}", "3"),
        { exact: false },
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(mocks.refreshPackCatalog).toHaveBeenCalledWith(false));

    await user.click(screen.getByTestId("packs-refresh"));
    await waitFor(() => expect(mocks.refreshPackCatalog).toHaveBeenLastCalledWith(true));
  });
});

describe("pack view", () => {
  it("loads the index only when a pack opens and reuses it when the pack opens again", async () => {
    renderTemplatesTab();
    await screen.findByTestId("pack-row-open-letter");
    expect(mocks.packIndex).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(screen.getByTestId("pack-open-open-letter"));
    expect(await screen.findByTestId("pack-template-tpl-0")).toBeInTheDocument();
    expect(screen.getByTestId("pack-title")).toHaveTextContent("Open letter templates");
    expect(mocks.packIndex).toHaveBeenCalledOnce();
    expect(mocks.packIndex).toHaveBeenCalledWith("open-letter", false);

    await user.click(screen.getByTestId("pack-back"));
    expect(await screen.findByTestId("pack-row-open-letter")).toBeInTheDocument();
    await user.click(screen.getByTestId("pack-open-open-letter"));
    expect(screen.getByTestId("pack-template-tpl-0")).toBeInTheDocument();
    expect(mocks.packIndex).toHaveBeenCalledOnce();
  });

  it("mounts only a window of cards for a 500 template pack and never loads an image eagerly", async () => {
    mocks.packIndex.mockResolvedValue(index(500));
    await openPack();
    await screen.findByTestId("pack-template-tpl-0");

    const cards = screen.getAllByTestId(/^pack-template-tpl-/);
    expect(cards.length).toBeLessThanOrEqual(16);
    expect(screen.queryByTestId("pack-template-tpl-499")).not.toBeInTheDocument();
    const grid = screen.getByTestId("pack-template-grid");
    expect(Number.parseFloat(grid.style.paddingBottom)).toBe(0);
    for (const image of document.querySelectorAll("img")) {
      expect(image).toHaveAttribute("loading", "lazy");
    }
  });

  it("filters by search text and by engine", async () => {
    mocks.packIndex.mockResolvedValue(index(30));
    const user = await openPack();
    await screen.findByTestId("pack-template-tpl-0");

    await user.type(screen.getByTestId("pack-templates-search"), "template 27");
    await waitFor(() => expect(screen.getAllByTestId(/^pack-template-tpl-/)).toHaveLength(1));
    expect(screen.getByTestId("pack-template-tpl-27")).toBeInTheDocument();

    await user.clear(screen.getByTestId("pack-templates-search"));
    await user.type(screen.getByTestId("pack-templates-search"), "no such thing");
    expect(await screen.findByText(copy.packs.noTemplates)).toBeInTheDocument();
    expect(screen.getByTestId("pack-filter-engine")).toBeInTheDocument();
    expect(screen.queryByTestId("pack-filter-kind")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pack-filter-language")).not.toBeInTheDocument();
  });

  it("offers kind and language filters when the pack has them", async () => {
    mocks.packIndex.mockResolvedValue({
      pack_id: "cn-theses",
      version: 2,
      templates: [
        template(1, { kind: "thesis", languages: ["zh"], country: "CN", institution: "Tsinghua University" }),
        template(2, { kind: "report", languages: ["en"] }),
      ],
    });
    await openPack("cn-theses");
    expect(await screen.findByTestId("pack-filter-kind")).toBeInTheDocument();
    expect(screen.getByTestId("pack-filter-language")).toBeInTheDocument();
  });

  it("explains a failed load and retries from the network", async () => {
    mocks.packIndex.mockRejectedValueOnce(new Error("offline"));
    const user = await openPack();
    expect(await screen.findByTestId("pack-load-failed")).toHaveTextContent(copy.packs.loadFailed);
    expect(mocks.notifyError).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: copy.packs.retry }));
    await screen.findByTestId("pack-template-tpl-0");
    expect(mocks.packIndex).toHaveBeenLastCalledWith("open-letter", true);
  });

  it("renders a v1 pack the backend synthesised from its file list", async () => {
    mocks.listTemplatePacks.mockResolvedValue([
      pack({ id: "venue-classes", label: "Journal classes", group: "curated", version: 1, covers: [] }),
    ]);
    mocks.packIndex.mockResolvedValue({
      pack_id: "venue-classes",
      version: 1,
      templates: [
        template(1, {
          id: "revtex",
          name: "Revtex",
          engine: "",
          license: { spdx: null, label: "CC0-1.0" },
          thumb_url: `${BASE}/packs/venue-classes/revtex/preview.png`,
          preview_url: `${BASE}/packs/venue-classes/revtex/preview.png`,
        }),
        template(2, { id: "achemso", name: "Achemso", engine: "", thumb_url: null, preview_url: null }),
      ],
    });
    await openPack("venue-classes");
    const card = await screen.findByTestId("pack-template-revtex");
    expect(card).toHaveTextContent("Revtex");
    expect(card).toHaveTextContent("CC0-1.0");
    expect(card.querySelector("img")).toHaveAttribute("src", `${BASE}/packs/venue-classes/revtex/preview.png`);
    expect(screen.getByTestId("pack-template-achemso").querySelector("img")).toBeNull();
    expect(screen.queryByTestId("pack-filter-engine")).not.toBeInTheDocument();
  });

  it("narrows the grid with the engine, kind and language menus", async () => {
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
    mocks.packIndex.mockResolvedValue({
      pack_id: "open-letter",
      version: 2,
      templates: [
        template(0, { kind: "thesis", languages: ["zh"] }),
        template(1, { kind: "report", languages: ["en"] }),
        template(2, { kind: "thesis", languages: ["en"] }),
      ],
    });
    const user = await openPack();
    await screen.findByTestId("pack-template-tpl-0");

    await user.click(screen.getByTestId("pack-filter-engine"));
    await user.click(await screen.findByRole("option", { name: "Typst" }));
    await waitFor(() => expect(screen.getAllByTestId(/^pack-template-tpl-/)).toHaveLength(1));
    expect(screen.getByTestId("pack-template-tpl-0")).toBeInTheDocument();

    await user.click(screen.getByTestId("pack-filter-engine"));
    await user.click(await screen.findByRole("option", { name: copy.packs.allEngines }));
    await user.click(screen.getByTestId("pack-filter-kind"));
    await user.click(await screen.findByRole("option", { name: "Thesis" }));
    await waitFor(() => expect(screen.getAllByTestId(/^pack-template-tpl-/)).toHaveLength(2));

    await user.click(screen.getByTestId("pack-filter-language"));
    await user.click(await screen.findByRole("option", { name: "English" }));
    await waitFor(() => expect(screen.getAllByTestId(/^pack-template-tpl-/)).toHaveLength(1));
    expect(screen.getByTestId("pack-template-tpl-2")).toBeInTheDocument();
  });

  it("removes an installed pack from its header", async () => {
    mocks.listTemplatePacks.mockResolvedValue([pack({ installed: true, installed_count: 3 })]);
    const user = await openPack();
    await screen.findByTestId("pack-template-tpl-0");
    expect(screen.queryByTestId("pack-view-install-open-letter")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("pack-view-remove-open-letter"));
    await waitFor(() => expect(mocks.removeTemplatePack).toHaveBeenCalledWith("open-letter"));
  });

  it("falls back to a page placeholder when a thumbnail cannot load", async () => {
    await openPack();
    const card = await screen.findByTestId("pack-template-tpl-0");
    const image = card.querySelector("img") as HTMLImageElement;
    expect(image).toHaveClass("opacity-0");
    fireEvent.load(image);
    expect(image).toHaveClass("opacity-100");
    const other = screen.getByTestId("pack-template-tpl-1").querySelector("img") as HTMLImageElement;
    fireEvent.error(other);
    expect(screen.getByTestId("pack-template-tpl-1").querySelector("img")).toBeNull();
    expect(screen.getByTestId("pack-template-tpl-1").querySelector("svg")).not.toBeNull();
  });

  it("downloads the whole pack from its header", async () => {
    const user = await openPack();
    await screen.findByTestId("pack-template-tpl-0");
    await user.click(screen.getByTestId("pack-view-install-open-letter"));
    await waitFor(() => expect(mocks.installTemplatePack).toHaveBeenCalledWith("open-letter"));
  });
});

describe("template preview", () => {
  it("opens a template, steps through the filtered list with the arrow keys, and closes on Escape", async () => {
    mocks.packIndex.mockResolvedValue(
      index(3, {
        templates: [
          template(0, { credit: { url: "https://github.com/owner/repo", author: "owner" } }),
          template(1, { kind: "thesis", languages: ["zh"], country: "CN", institution: "Tsinghua University" }),
          template(2),
        ],
      }),
    );
    const user = await openPack();
    await user.click(within(await screen.findByTestId("pack-template-tpl-0")).getByRole("button"));

    const dialog = await screen.findByTestId("template-preview");
    expect(within(dialog).getByRole("heading", { name: "Template 0" })).toBeInTheDocument();
    const page = within(dialog).getByTestId("template-preview-page");
    const pageImages = page.querySelectorAll("img");
    expect(pageImages).toHaveLength(2);
    expect(pageImages[0]).toHaveClass("blur-md");
    expect(pageImages[1]).toHaveAttribute("src", `${BASE}/previews/open-letter/tpl-0/page-1.webp`);
    for (const image of pageImages) expect(image).toHaveAttribute("loading", "lazy");
    fireEvent.load(pageImages[1]);
    expect(page.querySelectorAll("img")).toHaveLength(1);
    expect(within(dialog).getByTestId("template-preview-previous")).toBeDisabled();

    await user.click(within(dialog).getByTestId("template-preview-source"));
    expect(mocks.openExternal).toHaveBeenCalledWith("https://github.com/owner/repo");

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(within(dialog).getByRole("heading", { name: "Template 1" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Tsinghua University");
    expect(dialog).toHaveTextContent("China");
    expect(dialog).toHaveTextContent("Chinese");
    expect(dialog).toHaveTextContent("Thesis");
    expect(within(dialog).queryByTestId("template-preview-source")).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(within(dialog).getByRole("heading", { name: "Template 2" })).toBeInTheDocument();
    expect(within(dialog).getByTestId("template-preview-next")).toBeDisabled();
    fireEvent.keyDown(document.body, { key: "ArrowLeft", metaKey: true });
    expect(within(dialog).getByRole("heading", { name: "Template 2" })).toBeInTheDocument();
    await user.click(within(dialog).getByTestId("template-preview-previous"));
    expect(within(dialog).getByRole("heading", { name: "Template 1" })).toBeInTheDocument();

    await user.click(within(dialog).getByTestId("template-preview-next"));
    expect(within(dialog).getByRole("heading", { name: "Template 2" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("pack-templates-search"), { key: "ArrowLeft" });
    expect(within(dialog).getByRole("heading", { name: "Template 2" })).toBeInTheDocument();
    const outside = document.createElement("button");
    document.body.append(outside);
    fireEvent.keyDown(outside, { key: "ArrowLeft" });
    expect(within(dialog).getByRole("heading", { name: "Template 2" })).toBeInTheDocument();
    outside.remove();

    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("template-preview")).not.toBeInTheDocument());
    expect(screen.getByTestId("pack-title")).toBeInTheDocument();
  });

  it("shows the thumbnail itself when the large page cannot load", async () => {
    const user = await openPack();
    await user.click(within(await screen.findByTestId("pack-template-tpl-0")).getByRole("button"));
    const page = within(await screen.findByTestId("template-preview")).getByTestId("template-preview-page");
    const large = page.querySelectorAll("img")[1];
    fireEvent.error(large);
    const images = page.querySelectorAll("img");
    expect(images).toHaveLength(2);
    expect(images[1]).toHaveAttribute("src", `${BASE}/previews/open-letter/tpl-0/thumb.webp`);
    expect(images[1]).not.toHaveClass("blur-md");
  });

  it("shows a page placeholder for a template without any preview", async () => {
    mocks.packIndex.mockResolvedValue(
      index(1, { templates: [template(0, { thumb_url: null, preview_url: null, engine: "", bytes: 0 })] }),
    );
    const user = await openPack();
    await user.click(within(await screen.findByTestId("pack-template-tpl-0")).getByRole("button"));
    const dialog = await screen.findByTestId("template-preview");
    expect(within(dialog).getByTestId("template-preview-page").querySelector("img")).toBeNull();
    expect(dialog).not.toHaveTextContent(copy.packs.preview.engine);
    expect(dialog).not.toHaveTextContent("KB");
  });

  it("gets one template, shows it installed, then hands it to the new project dialog", async () => {
    const user = await openPack();
    await user.click(within(await screen.findByTestId("pack-template-tpl-1")).getByRole("button"));
    const dialog = await screen.findByTestId("template-preview");

    mocks.packIndex.mockResolvedValue(
      index(3, { templates: [template(0), template(1, { installed: true }), template(2)] }),
    );
    mocks.listTemplatePacks.mockResolvedValue([pack({ installed_count: 1 })]);
    await user.click(within(dialog).getByTestId("template-preview-get"));
    expect(mocks.installPackTemplate).toHaveBeenCalledWith("open-letter", "tpl-1");
    expect(mocks.installTemplatePack).not.toHaveBeenCalled();

    const use = await within(dialog).findByTestId("template-preview-use");
    expect(within(screen.getByTestId("pack-template-tpl-1")).getByText(copy.packs.installed)).toBeInTheDocument();
    await user.click(use);
    expect(useSettingsStore.getState()).toMatchObject({ settingsOpen: false, newProjectOpen: true });
    expect(useTemplateRequestStore.getState().requestedTemplateId).toBe("tpl-1");
  });

  it("reports a failed single template download once and keeps the template uninstalled", async () => {
    mocks.installPackTemplate.mockRejectedValueOnce(new Error("offline"));
    const user = await openPack();
    await user.click(within(await screen.findByTestId("pack-template-tpl-2")).getByRole("button"));
    const dialog = await screen.findByTestId("template-preview");
    await user.click(within(dialog).getByTestId("template-preview-get"));
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledOnce());
    expect(within(dialog).getByTestId("template-preview-get")).toBeEnabled();
  });

  it("downloads the whole pack from the preview and closes from its close button", async () => {
    const user = await openPack();
    await user.click(within(await screen.findByTestId("pack-template-tpl-0")).getByRole("button"));
    const dialog = await screen.findByTestId("template-preview");
    await user.click(within(dialog).getByTestId("template-preview-download-pack"));
    await waitFor(() => expect(mocks.installTemplatePack).toHaveBeenCalledWith("open-letter"));
    const closes = within(dialog).getAllByRole("button", { name: enCommon.actions.close });
    await user.click(closes[closes.length - 1]);
    await waitFor(() => expect(screen.queryByTestId("template-preview")).not.toBeInTheDocument());
  });
});

function rect(top: number, height: number, width = 780): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: width,
    width,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

describe("pack view performance", () => {
  it("keeps a bounded window of lazy cards for 800 templates while scrolling", async () => {
    mocks.packIndex.mockResolvedValue(index(800));
    let scrollTop = 0;
    vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) {
      return this.getAttribute("data-testid") === "scroller" ? 600 : 0;
    });
    vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
      return this.getAttribute("data-testid") === "pack-template-grid" ? 780 : 0;
    });
    vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (this: Element) {
      return this.getAttribute("data-testid") === "scroller" ? scrollTop : 0;
    });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.hasAttribute("data-row-window-item")) return rect(0, 240);
      if (this.getAttribute("data-testid") === "pack-template-grid") return rect(-scrollTop, 0);
      return rect(0, 600);
    });
    useSettingsStore.setState({ settingsScrollTarget: "templates" });
    const user = userEvent.setup();
    render(
      <div data-testid="scroller" style={{ overflowY: "auto" }}>
        <DownloadsSection />
      </div>,
    );
    await user.click(await screen.findByTestId("pack-open-open-letter"));
    await screen.findByTestId("pack-template-tpl-0");
    await act(async () => {});

    const mounted = () => screen.getAllByTestId(/^pack-template-tpl-/).length;
    expect(mounted()).toBeGreaterThan(0);
    expect(mounted()).toBeLessThan(60);
    const grid = screen.getByTestId("pack-template-grid");
    expect(grid.style.gridTemplateColumns).toBe("repeat(5, minmax(0, 1fr))");

    scrollTop = 24_000;
    act(() => {
      screen.getByTestId("scroller").dispatchEvent(new Event("scroll"));
    });
    expect(screen.queryByTestId("pack-template-tpl-0")).not.toBeInTheDocument();
    expect(screen.getByTestId("pack-template-tpl-500")).toBeInTheDocument();
    expect(mounted()).toBeLessThan(60);
    expect(Number.parseFloat(grid.style.paddingTop)).toBeGreaterThan(0);
    const images = document.querySelectorAll("img");
    expect(images.length).toBeLessThan(60);
    for (const image of images) expect(image).toHaveAttribute("loading", "lazy");
  });
});
