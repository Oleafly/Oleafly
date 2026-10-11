import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetProgress, PackIndexInfo, PackInfo, PackTemplateInfo } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  listTemplatePacks: vi.fn(),
  refreshPackCatalog: vi.fn(),
  packIndex: vi.fn(),
  installTemplatePack: vi.fn(),
  installPackTemplate: vi.fn(),
  removeTemplatePack: vi.fn(),
  notifyError: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  withAssetProgress: (await importOriginal<typeof import("@/lib/tauri")>()).withAssetProgress,
  listTemplatePacks: mocks.listTemplatePacks,
  refreshPackCatalog: mocks.refreshPackCatalog,
  packIndex: mocks.packIndex,
  installTemplatePack: mocks.installTemplatePack,
  installPackTemplate: mocks.installPackTemplate,
  removeTemplatePack: mocks.removeTemplatePack,
}));
vi.mock("@/lib/toast", () => ({ notifyError: mocks.notifyError, toast: {} }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { i18n } from "@/i18n";
import {
  ALL_CURATED,
  busyInPack,
  ensurePackIndex,
  installCuratedPacks,
  installPack,
  installTemplate,
  loadPacks,
  packBusyKey,
  refreshPackCatalogInBackground,
  removePack,
  resetTemplatePacks,
  templateBusyKey,
  useTemplatePacksStore,
} from "./template-packs";

const pack = (over: Partial<PackInfo> = {}): PackInfo => ({
  id: "letters",
  label: "Letters",
  description: "",
  category: "",
  group: "curated",
  approx_bytes: 0,
  count: 2,
  license_summary: "MIT",
  covers: [],
  installed: false,
  installed_count: 0,
  version: 2,
  ...over,
});

const template = (over: Partial<PackTemplateInfo> = {}): PackTemplateInfo => ({
  id: "a",
  name: "Alpha",
  description: "",
  category: "",
  engine: "typst",
  license: { spdx: "MIT", label: "MIT" },
  credit: null,
  thumb_url: null,
  preview_url: null,
  kind: null,
  languages: [],
  country: null,
  institution: null,
  bytes: 1,
  file_count: 2,
  installed: false,
  ...over,
});

const index = (templates: PackTemplateInfo[], version: 1 | 2 = 2): PackIndexInfo => ({
  pack_id: "letters",
  version,
  templates,
});

let emit: ((event: { payload: AssetProgress }) => void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  resetTemplatePacks();
  emit = null;
  mocks.listen.mockImplementation(async (_event: string, handler: typeof emit) => {
    emit = handler;
    return () => {};
  });
  mocks.listTemplatePacks.mockResolvedValue([pack()]);
  mocks.refreshPackCatalog.mockResolvedValue(false);
  mocks.packIndex.mockResolvedValue(index([template(), template({ id: "b", name: "Beta" })]));
  mocks.installTemplatePack.mockResolvedValue(undefined);
  mocks.installPackTemplate.mockResolvedValue(undefined);
  mocks.removeTemplatePack.mockResolvedValue(undefined);
});

describe("template packs store", () => {
  it("loads packs and logs a failed listing", async () => {
    await loadPacks();
    expect(useTemplatePacksStore.getState()).toMatchObject({ loaded: true, packs: [pack()] });

    resetTemplatePacks();
    mocks.listTemplatePacks.mockRejectedValueOnce(new Error("disk"));
    await loadPacks();
    expect(useTemplatePacksStore.getState()).toMatchObject({ loaded: true, packs: [] });
    expect(mocks.logError).toHaveBeenCalledWith("list template packs", expect.any(Error));
  });

  it("refreshes the catalog once at a time and relists only when it changed", async () => {
    const first = refreshPackCatalogInBackground();
    expect(refreshPackCatalogInBackground()).toBe(first);
    expect(useTemplatePacksStore.getState().refreshing).toBe(true);
    await first;
    expect(mocks.refreshPackCatalog).toHaveBeenCalledOnce();
    expect(mocks.refreshPackCatalog).toHaveBeenCalledWith(false);
    expect(mocks.listTemplatePacks).not.toHaveBeenCalled();
    expect(useTemplatePacksStore.getState().refreshing).toBe(false);

    mocks.refreshPackCatalog.mockResolvedValueOnce(true);
    await refreshPackCatalogInBackground(true);
    expect(mocks.refreshPackCatalog).toHaveBeenLastCalledWith(true);
    expect(mocks.listTemplatePacks).toHaveBeenCalledOnce();
  });

  it("stays quiet when a background refresh fails and reports a requested one once", async () => {
    mocks.refreshPackCatalog.mockRejectedValueOnce(new Error("offline"));
    await refreshPackCatalogInBackground();
    expect(mocks.notifyError).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledWith("refresh template pack catalog", expect.any(Error));

    mocks.refreshPackCatalog.mockRejectedValueOnce(new Error("offline"));
    await refreshPackCatalogInBackground(true);
    expect(mocks.notifyError).toHaveBeenCalledOnce();
    expect(mocks.notifyError).toHaveBeenCalledWith(
      "check for new template packs",
      expect.any(Error),
      i18n.t(($) => $.settings.downloads.errors.packsRefreshFailed),
    );
  });

  it("fetches a pack index once, shares the request and precomputes search text", async () => {
    const first = ensurePackIndex("letters");
    const second = ensurePackIndex("letters");
    expect(second).toBe(first);
    expect(useTemplatePacksStore.getState().indexes.letters).toEqual({ status: "loading" });
    await first;
    await ensurePackIndex("letters");
    expect(mocks.packIndex).toHaveBeenCalledOnce();
    const entry = useTemplatePacksStore.getState().indexes.letters;
    expect(entry).toMatchObject({ status: "ready", version: 2 });
    if (entry?.status !== "ready") throw new Error("not ready");
    expect(entry.search[1]).toContain("beta");
  });

  it("keeps unchanged template objects when an index reloads", async () => {
    await ensurePackIndex("letters");
    const before = useTemplatePacksStore.getState().indexes.letters;
    await ensurePackIndex("letters", { reload: true });
    expect(useTemplatePacksStore.getState().indexes.letters).toBe(before);

    mocks.packIndex.mockResolvedValueOnce(
      index([template(), template({ id: "b", name: "Beta", installed: true })]),
    );
    await ensurePackIndex("letters", { reload: true });
    const after = useTemplatePacksStore.getState().indexes.letters;
    if (before?.status !== "ready" || after?.status !== "ready") throw new Error("not ready");
    expect(after.templates[0]).toBe(before.templates[0]);
    expect(after.templates[1]).not.toBe(before.templates[1]);
    expect(after.templates[1].installed).toBe(true);
    expect(after.search[0]).toBe(before.search[0]);

    mocks.packIndex.mockResolvedValueOnce(index([template({ id: "c", name: "Gamma" })], 1));
    await ensurePackIndex("letters", { force: true });
    expect(mocks.packIndex).toHaveBeenLastCalledWith("letters", true);
    const forced = useTemplatePacksStore.getState().indexes.letters;
    if (forced?.status !== "ready") throw new Error("not ready");
    expect(forced.version).toBe(1);
    expect(forced.search).toEqual([expect.stringContaining("gamma")]);
  });

  it("takes a reordered index even when every template is unchanged", async () => {
    await ensurePackIndex("letters");
    const before = useTemplatePacksStore.getState().indexes.letters;
    mocks.packIndex.mockResolvedValueOnce(index([template({ id: "b", name: "Beta" }), template()]));
    await ensurePackIndex("letters", { reload: true });
    const after = useTemplatePacksStore.getState().indexes.letters;
    if (before?.status !== "ready" || after?.status !== "ready") throw new Error("not ready");
    expect(after).not.toBe(before);
    expect(after.templates.map((t) => t.id)).toEqual(["b", "a"]);
    expect(after.templates[0]).toBe(before.templates[1]);
    expect(after.search[0]).toContain("beta");
  });

  it("marks a failed index load and keeps an older index when a reload fails", async () => {
    mocks.packIndex.mockRejectedValueOnce(new Error("offline"));
    await ensurePackIndex("letters");
    expect(useTemplatePacksStore.getState().indexes.letters).toEqual({ status: "error" });
    expect(mocks.logError).toHaveBeenCalledWith("load template pack", expect.any(Error));

    await ensurePackIndex("letters");
    mocks.packIndex.mockRejectedValueOnce(new Error("offline"));
    await ensurePackIndex("letters", { force: true });
    expect(useTemplatePacksStore.getState().indexes.letters?.status).toBe("ready");
  });

  it("installs a pack with progress, then relists and reloads its open index", async () => {
    let finish: () => void = () => {};
    mocks.installTemplatePack.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    await ensurePackIndex("letters");
    const running = installPack("letters");
    expect(useTemplatePacksStore.getState().busy).toBe(packBusyKey("letters"));
    expect(await installTemplate("letters", "a")).toBe(false);
    await vi.waitFor(() => expect(emit).not.toBeNull());
    emit?.({ payload: { component: "other", label: "", file: "", index: 9, total: 9, received: 0, file_total: null } });
    expect(useTemplatePacksStore.getState().progress).toBe("");
    emit?.({ payload: { component: "letters", label: "", file: "", index: 3, total: 8, received: 0, file_total: null } });
    expect(useTemplatePacksStore.getState().progress).toBe(
      i18n.t(($) => $.settings.downloads.packProgress, { index: "3", total: "8" }),
    );
    mocks.listTemplatePacks.mockResolvedValueOnce([pack({ installed: true, installed_count: 2 })]);
    finish();
    expect(await running).toBe(true);
    expect(mocks.packIndex).toHaveBeenCalledTimes(2);
    expect(useTemplatePacksStore.getState()).toMatchObject({ busy: null, progress: "" });
    expect(useTemplatePacksStore.getState().packs[0].installed).toBe(true);
  });

  it("installs one template and reports a failure once", async () => {
    expect(await installTemplate("letters", "b")).toBe(true);
    expect(mocks.installPackTemplate).toHaveBeenCalledWith("letters", "b");

    mocks.installPackTemplate.mockRejectedValueOnce(new Error("offline"));
    expect(await installTemplate("letters", "b")).toBe(false);
    expect(mocks.notifyError).toHaveBeenCalledOnce();
    expect(mocks.notifyError).toHaveBeenCalledWith(
      "download the template",
      expect.any(Error),
      i18n.t(($) => $.settings.downloads.errors.templateDownloadFailed),
    );
  });

  it("downloads only the curated packs that are missing", async () => {
    useTemplatePacksStore.setState({
      packs: [
        pack({ id: "done", installed: true }),
        pack({ id: "todo" }),
        pack({ id: "open-cv", group: "community" }),
      ],
    });
    expect(await installCuratedPacks()).toBe(true);
    expect(mocks.installTemplatePack.mock.calls).toEqual([["todo"]]);

    useTemplatePacksStore.setState({ packs: [pack({ id: "todo" })] });
    mocks.installTemplatePack.mockRejectedValueOnce(new Error("offline"));
    expect(await installCuratedPacks()).toBe(false);
    expect(mocks.notifyError).toHaveBeenCalledWith(
      "download the template packs",
      expect.any(Error),
      i18n.t(($) => $.settings.downloads.errors.packsDownloadFailed),
    );
  });

  it("removes a pack and reports a failed removal", async () => {
    expect(await removePack("letters")).toBe(true);
    expect(mocks.removeTemplatePack).toHaveBeenCalledWith("letters");
    mocks.removeTemplatePack.mockRejectedValueOnce(new Error("locked"));
    expect(await removePack("letters")).toBe(false);
    expect(mocks.notifyError).toHaveBeenCalledWith(
      "remove the template pack",
      expect.any(Error),
      i18n.t(($) => $.settings.downloads.errors.packRemoveFailed),
    );
    mocks.installTemplatePack.mockRejectedValueOnce(new Error("offline"));
    expect(await installPack("letters")).toBe(false);
    expect(mocks.notifyError).toHaveBeenLastCalledWith(
      "download the template pack",
      expect.any(Error),
      i18n.t(($) => $.settings.downloads.errors.packDownloadFailed),
    );
  });

  it("knows which work belongs to a pack", () => {
    const letters = { id: "letters", group: "curated" as const };
    expect(busyInPack(null, letters)).toBe(false);
    expect(busyInPack(packBusyKey("letters"), letters)).toBe(true);
    expect(busyInPack(templateBusyKey("letters", "a"), letters)).toBe(true);
    expect(busyInPack(templateBusyKey("letters-2", "a"), letters)).toBe(false);
    expect(busyInPack(ALL_CURATED, letters)).toBe(true);
    expect(busyInPack(ALL_CURATED, { id: "open-cv", group: "community" })).toBe(false);
  });
});
