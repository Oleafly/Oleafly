import { create } from "zustand";
import { i18n } from "@/i18n";
import { formatNumber } from "@/lib/intl";
import { logError } from "@/lib/log";
import { notifyError } from "@/lib/toast";
import {
  installPackTemplate,
  installTemplatePack,
  listTemplatePacks,
  packIndex,
  refreshPackCatalog,
  removeTemplatePack,
  withAssetProgress,
  type PackIndexInfo,
  type PackInfo,
  type PackTemplateInfo,
} from "@/lib/tauri";
import { sameTemplate, templateSearchText } from "@/lib/template-pack-browser";

export const ALL_CURATED = "all-curated";

export const packBusyKey = (packId: string) => `pack:${packId}`;

export const templateBusyKey = (packId: string, templateId: string) =>
  `template:${packId}/${templateId}`;

export function busyInPack(busy: string | null, pack: Pick<PackInfo, "id" | "group">): boolean {
  if (busy === null) return false;
  if (busy === ALL_CURATED) return pack.group === "curated";
  return busy === packBusyKey(pack.id) || busy.startsWith(`template:${pack.id}/`);
}

export interface ReadyPackIndex {
  readonly status: "ready";
  readonly version: 1 | 2;
  readonly templates: readonly PackTemplateInfo[];
  readonly search: readonly string[];
}

export type PackIndexEntry =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | ReadyPackIndex;

interface TemplatePacksState {
  packs: readonly PackInfo[];
  loaded: boolean;
  refreshing: boolean;
  indexes: Readonly<Record<string, PackIndexEntry>>;
  busy: string | null;
  progress: string;
}

function initialState(): TemplatePacksState {
  return {
    packs: [],
    loaded: false,
    refreshing: false,
    indexes: {},
    busy: null,
    progress: "",
  };
}

export const useTemplatePacksStore = create<TemplatePacksState>(initialState);

const indexLoads = new Map<string, Promise<void>>();
let catalogRefresh: Promise<void> | null = null;

export function resetTemplatePacks(): void {
  indexLoads.clear();
  catalogRefresh = null;
  useTemplatePacksStore.setState(initialState(), true);
}

const state = () => useTemplatePacksStore.getState();

export async function loadPacks(): Promise<void> {
  try {
    const packs = await listTemplatePacks();
    useTemplatePacksStore.setState({ packs, loaded: true });
  } catch (error) {
    void logError("list template packs", error);
    useTemplatePacksStore.setState({ loaded: true });
  }
}

export function refreshPackCatalogInBackground(force = false): Promise<void> {
  if (catalogRefresh) return catalogRefresh;
  useTemplatePacksStore.setState({ refreshing: true });
  const run = (async () => {
    try {
      if (await refreshPackCatalog(force)) await loadPacks();
    } catch (error) {
      if (force) {
        notifyError(
          "check for new template packs",
          error,
          i18n.t(($) => $.settings.downloads.errors.packsRefreshFailed),
        );
      } else {
        void logError("refresh template pack catalog", error);
      }
    } finally {
      catalogRefresh = null;
      useTemplatePacksStore.setState({ refreshing: false });
    }
  })();
  catalogRefresh = run;
  return run;
}

export async function ensurePackListed(packId: string): Promise<boolean> {
  const listed = () => state().packs.some((pack) => pack.id === packId);
  if (!state().loaded) await loadPacks();
  if (listed()) return true;
  try {
    if (await refreshPackCatalog(true)) await loadPacks();
  } catch (error) {
    void logError("refresh template pack catalog", error);
  }
  return listed();
}

function setIndex(packId: string, entry: PackIndexEntry): void {
  useTemplatePacksStore.setState((current) => ({
    indexes: { ...current.indexes, [packId]: entry },
  }));
}

function applyIndex(packId: string, info: PackIndexInfo): void {
  const previous = state().indexes[packId];
  if (previous?.status === "ready") {
    const known = new Map(previous.templates.map((template) => [template.id, template]));
    let unchanged = previous.templates.length === info.templates.length;
    const templates = info.templates.map((template, index) => {
      const old = known.get(template.id);
      if (old && sameTemplate(old, template)) {
        if (previous.templates[index] !== old) unchanged = false;
        return old;
      }
      unchanged = false;
      return template;
    });
    if (unchanged && previous.version === info.version) return;
    const search = templates.map((template, index) =>
      previous.templates[index] === template ? previous.search[index] : templateSearchText(template),
    );
    setIndex(packId, { status: "ready", version: info.version, templates, search });
    return;
  }
  setIndex(packId, {
    status: "ready",
    version: info.version,
    templates: info.templates,
    search: info.templates.map(templateSearchText),
  });
}

export function ensurePackIndex(
  packId: string,
  options: Readonly<{ reload?: boolean; force?: boolean }> = {},
): Promise<void> {
  const current = state().indexes[packId];
  const wanted = options.reload || options.force;
  if (!wanted && current?.status === "ready") return Promise.resolve();
  const inflight = indexLoads.get(packId);
  if (inflight && options.force) return inflight.then(() => ensurePackIndex(packId, options));
  if (inflight) return inflight;
  if (current?.status !== "ready") setIndex(packId, { status: "loading" });
  const run = packIndex(packId, options.force ?? false)
    .then(
      (info) => applyIndex(packId, info),
      (error: unknown) => {
        void logError("load template pack", error);
        if (state().indexes[packId]?.status !== "ready") setIndex(packId, { status: "error" });
      },
    )
    .finally(() => {
      indexLoads.delete(packId);
    });
  indexLoads.set(packId, run);
  return run;
}

async function afterChange(packIds: readonly string[]): Promise<void> {
  await Promise.all([
    loadPacks(),
    ...packIds
      .filter((packId) => state().indexes[packId]?.status === "ready")
      .map((packId) => ensurePackIndex(packId, { reload: true })),
  ]);
}

async function withPackProgress(packId: string, run: () => Promise<void>): Promise<void> {
  try {
    await withAssetProgress(
      {
        component: (progress) => {
          if (progress.component !== packId) return;
          useTemplatePacksStore.setState({
            progress: i18n.t(($) => $.settings.downloads.packProgress, {
              index: formatNumber(progress.index),
              total: formatNumber(progress.total),
            }),
          });
        },
      },
      run,
    );
  } finally {
    useTemplatePacksStore.setState({ progress: "" });
  }
}

async function exclusive(
  busy: string,
  packIds: () => readonly string[],
  run: () => Promise<void>,
  failure: (error: unknown) => void,
): Promise<boolean> {
  if (state().busy !== null) return false;
  useTemplatePacksStore.setState({ busy, progress: "" });
  let succeeded = false;
  try {
    await run();
    succeeded = true;
  } catch (error) {
    failure(error);
  } finally {
    await afterChange(packIds());
    useTemplatePacksStore.setState({ busy: null, progress: "" });
  }
  return succeeded;
}

export function installPack(packId: string): Promise<boolean> {
  return exclusive(
    packBusyKey(packId),
    () => [packId],
    () => withPackProgress(packId, () => installTemplatePack(packId)),
    (error) =>
      notifyError(
        "download the template pack",
        error,
        i18n.t(($) => $.settings.downloads.errors.packDownloadFailed),
      ),
  );
}

export function installCuratedPacks(): Promise<boolean> {
  const curated = () =>
    state()
      .packs.filter((pack) => pack.group === "curated")
      .map((pack) => pack.id);
  return exclusive(
    ALL_CURATED,
    curated,
    async () => {
      const pending = state().packs.filter((pack) => pack.group === "curated" && !pack.installed);
      await pending.reduce<Promise<void>>(
        (chain, pack) => chain.then(() => withPackProgress(pack.id, () => installTemplatePack(pack.id))),
        Promise.resolve(),
      );
    },
    (error) =>
      notifyError(
        "download the template packs",
        error,
        i18n.t(($) => $.settings.downloads.errors.packsDownloadFailed),
      ),
  );
}

export function installTemplate(packId: string, templateId: string): Promise<boolean> {
  return exclusive(
    templateBusyKey(packId, templateId),
    () => [packId],
    () => withPackProgress(packId, () => installPackTemplate(packId, templateId)),
    (error) =>
      notifyError(
        "download the template",
        error,
        i18n.t(($) => $.settings.downloads.errors.templateDownloadFailed),
      ),
  );
}

export function removePack(packId: string): Promise<boolean> {
  return exclusive(
    packBusyKey(packId),
    () => [packId],
    () => removeTemplatePack(packId),
    (error) =>
      notifyError(
        "remove the template pack",
        error,
        i18n.t(($) => $.settings.downloads.errors.packRemoveFailed),
      ),
  );
}
