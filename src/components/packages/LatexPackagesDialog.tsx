import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Download, ExternalLink, Plus } from "lucide-react";
import { i18n } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useCopyStatus } from "@/components/ui/use-copy-status";
import { getEditorView } from "@/components/editor/cm/controller";
import {
  PackagesDialog,
  showPackagesDialog,
  type PackagesProvider,
} from "@/components/packages/PackagesDialog";
import { documentPackages, insertUsepackage, latexMainDocument } from "@/components/packages/latex-document";
import {
  ctanUrl,
  documentClassLine,
  latexInstallMode,
  latexInstallState,
  loadLatexPackageIndex,
  normalizePackageOptions,
  searchLatexPackages,
  usepackageLine,
  type LatexInstallMode,
  type LatexPackageEntry,
} from "@/lib/latex-package-index";
import { logError } from "@/lib/log";
import { readOnlyEditMessage } from "@/lib/read-only-files";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { packageErrorMessage, useEngineStore, type PackageError } from "@/store/engine";
import { useFilesStore } from "@/store/files";

const NO_NAMES: ReadonlySet<string> = new Set();

interface LatexRowContext {
  readonly mode: LatexInstallMode;
  readonly engineReady: boolean;
  readonly installed: ReadonlySet<string>;
  readonly checked: boolean;
  readonly busyPackage: string | null;
  readonly packageError: PackageError | null;
  readonly packageNotice: string | null;
  readonly loaded: ReadonlySet<string>;
  readonly mainDoc: string | null;
  readonly blocked: string | null;
  readonly inserting: boolean;
  readonly message: string | null;
  readonly install: (name: string) => void;
  readonly insert: (entry: LatexPackageEntry, options: string) => void;
}

function useLatexRowContext(open: boolean, onClose: () => void): LatexRowContext {
  const engineId = useFilesStore((state) => (state.engineLoaded ? state.engine.id : "unknown"));
  const tlmgr = useEngineStore((state) => state.info?.tlmgr ?? null);
  const engineReady = useEngineStore((state) => state.loaded);
  const installedNames = useEngineStore((state) => state.installed);
  const busyPackage = useEngineStore((state) => state.busyPkg);
  const packageError = useEngineStore((state) => state.packageError);
  const packageNotice = useEngineStore((state) => state.packageNotice);
  const [mainDoc, setMainDoc] = useState<string | null>(() => latexMainDocument());
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(NO_NAMES);
  const [checked, setChecked] = useState(false);
  const [inserting, setInserting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const installed = useMemo(
    () => new Set(installedNames.map((name) => name.toLowerCase())),
    [installedNames],
  );
  const mode = latexInstallMode(engineId, tlmgr);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const main = latexMainDocument();
    setMainDoc(main);
    setMessage(null);
    setLoaded(NO_NAMES);
    if (main) {
      documentPackages(main).then(
        (names) => {
          if (live) setLoaded(names);
        },
        (error: unknown) => void logError("read LaTeX packages", error),
      );
    }
    return () => {
      live = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open || engineId !== "latexmk") return;
    let live = true;
    setChecked(false);
    void (async () => {
      await useEngineStore.getState().ensureLoaded();
      if (!useEngineStore.getState().info?.tlmgr) return;
      await useEngineStore.getState().refreshPackages();
      if (live) setChecked(true);
    })();
    return () => {
      live = false;
    };
  }, [open, engineId]);

  const install = useCallback((name: string) => {
    void useEngineStore.getState().addPackage(name);
  }, []);

  const insert = useCallback(
    (entry: LatexPackageEntry, options: string) => {
      if (!mainDoc) return;
      setInserting(true);
      setMessage(null);
      insertUsepackage(mainDoc, entry.name, options)
        .then((outcome) => {
          if (outcome === "editor") {
            const view = getEditorView();
            onClose();
            requestAnimationFrame(() => view?.focus());
          } else if (outcome === "file") {
            onClose();
            toast.success(i18n.t(($) => $.editor.latexPackages.added, { name: entry.name, file: mainDoc }));
          } else if (outcome === "loaded") {
            setLoaded((previous) => new Set([...previous, entry.name.toLowerCase()]));
            setMessage(i18n.t(($) => $.editor.latexPackages.alreadyLoaded, { name: entry.name, file: mainDoc }));
          } else {
            setMessage(i18n.t(($) => $.editor.latexPackages.noPreamble, { file: mainDoc }));
          }
        })
        .catch((error: unknown) => {
          void logError("add LaTeX package", error);
          setMessage(i18n.t(($) => $.editor.latexPackages.insertFailed));
        })
        .finally(() => setInserting(false));
    },
    [mainDoc, onClose],
  );

  const blocked = mainDoc ? readOnlyEditMessage(mainDoc) : i18n.t(($) => $.editor.latexPackages.noProject);
  return {
    mode,
    engineReady,
    installed,
    checked: checked && packageError?.kind !== "read",
    busyPackage,
    packageError,
    packageNotice,
    loaded,
    mainDoc,
    blocked,
    inserting,
    message,
    install,
    insert,
  };
}

function LatexPackageRow({ pkg, context }: Readonly<{ pkg: LatexPackageEntry; context: LatexRowContext }>) {
  const { t } = useTranslation(["common", "editor"]);
  const { copied, copy } = useCopyStatus();
  const [options, setOptions] = useState("");
  const normalized = normalizePackageOptions(options);
  const loaded = context.loaded.has(pkg.name.toLowerCase());
  const documentClass = pkg.documentClass ?? null;
  const line = documentClass ? documentClassLine(documentClass) : usepackageLine(pkg.name, normalized ?? "");
  const state = latexInstallState(pkg, context.mode, context.installed, context.checked);
  const busy = context.busyPackage === pkg.name;
  const canInsert =
    !loaded && !documentClass && normalized !== null && context.blocked === null && !context.inserting;
  const insertFile = context.mainDoc ?? "";

  const note = () => {
    if (documentClass) return t(($) => $.editor.latexPackages.classNote);
    if (normalized === null) return t(($) => $.editor.latexPackages.optionsInvalid);
    return null;
  };
  const rowNote = note();

  return (
    <div data-testid={`latex-package-${pkg.name}`} className="flex flex-col gap-1.5 border-b px-3 py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-sm">{pkg.name}</span>
        {loaded && (
          <Badge variant="primaryGhost" size="sm">
            {t(($) => $.editor.latexPackages.loaded)}
          </Badge>
        )}
        {documentClass && (
          <Badge variant="muted" size="sm">
            {t(($) => $.editor.latexPackages.documentClass)}
          </Badge>
        )}
        {state === "installed" && (
          <Badge variant="success" size="sm" className="gap-1">
            <Check aria-hidden="true" className="size-2.5" />
            {t(($) => $.editor.latexPackages.installed)}
          </Badge>
        )}
        <a
          href={ctanUrl(pkg.name)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t(($) => $.editor.latexPackages.ctanAria, { name: pkg.name })}
          className="ml-auto inline-flex items-center gap-1 text-[0.6875rem] font-medium text-primary hover:underline"
        >
          {t(($) => $.editor.latexPackages.ctan)}
          <ExternalLink aria-hidden="true" className="size-3" />
        </a>
      </div>
      {pkg.caption && <p className="line-clamp-2 text-xs text-muted-foreground">{pkg.caption}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {!documentClass && (
          <Input
            value={options}
            onChange={(event) => setOptions(event.target.value)}
            placeholder={t(($) => $.editor.latexPackages.options)}
            aria-label={t(($) => $.editor.latexPackages.optionsAria, { name: pkg.name })}
            aria-invalid={normalized === null}
            maxLength={200}
            className={cn("h-6 w-36 px-2 py-0 font-mono text-[0.6875rem]", normalized === null && "border-destructive")}
          />
        )}
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={!canInsert}
          aria-label={t(($) => $.editor.latexPackages.insertAria, { name: pkg.name, file: insertFile })}
          onClick={() => context.insert(pkg, normalized ?? "")}
        >
          <Plus aria-hidden="true" />
          {t(($) => $.editor.latexPackages.insert)}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={normalized === null && !documentClass}
          aria-label={t(($) => $.editor.latexPackages.copyAria, { name: pkg.name })}
          onClick={() => void copy(line)}
        >
          {copied ? <Check aria-hidden="true" className="text-emerald-500" /> : <Copy aria-hidden="true" />}
          {copied ? t(($) => $.common.actions.copied) : t(($) => $.editor.latexPackages.copy)}
        </Button>
        {state === "missing" && (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={context.busyPackage !== null}
            aria-label={t(($) => $.editor.latexPackages.installAria, { name: pkg.name })}
            onClick={() => context.install(pkg.name)}
          >
            {busy ? <Spinner size="xs" /> : <Download aria-hidden="true" />}
            {busy ? t(($) => $.editor.latexPackages.installing) : t(($) => $.editor.latexPackages.install)}
          </Button>
        )}
      </div>
      {rowNote && <p className="text-[0.6875rem] text-muted-foreground">{rowNote}</p>}
    </div>
  );
}

function installNote(context: LatexRowContext): string | null {
  if (context.mode === "on-demand") return i18n.t(($) => $.editor.latexPackages.onDemand);
  if (context.mode === "tlmgr") return context.checked ? null : i18n.t(($) => $.editor.latexPackages.checking);
  if (!context.engineReady) return null;
  return i18n.t(($) => $.editor.latexPackages.unknownInstall);
}

function renderLatexNotice(context: LatexRowContext) {
  const note = installNote(context);
  const packageError = context.mode === "tlmgr" ? context.packageError : null;
  const packageNotice = context.mode === "tlmgr" ? context.packageNotice : null;
  if (!note && !packageError && !packageNotice && !context.blocked && !context.message) return null;
  return (
    <>
      {note && <p className="text-[0.6875rem] text-muted-foreground">{note}</p>}
      {context.blocked && <p className="text-[0.6875rem] text-muted-foreground">{context.blocked}</p>}
      {packageNotice && <output className="block text-xs text-muted-foreground">{packageNotice}</output>}
      {packageError && (
        <p role="alert" className="select-text whitespace-pre-wrap break-words text-xs text-destructive">
          {packageErrorMessage(packageError)}
        </p>
      )}
      {context.message && (
        <p role="alert" className="select-text text-xs text-destructive">
          {context.message}
        </p>
      )}
    </>
  );
}

export const latexPackagesProvider: PackagesProvider<LatexPackageEntry, LatexRowContext> = {
  id: "latex",
  labels: {
    title: () => i18n.t(($) => $.editor.latexPackages.title),
    close: () => i18n.t(($) => $.editor.latexPackages.close),
    searchLabel: () => i18n.t(($) => $.editor.latexPackages.searchLabel),
    searchPlaceholder: () => i18n.t(($) => $.editor.latexPackages.searchPlaceholder),
    loading: () => i18n.t(($) => $.editor.latexPackages.loading),
    empty: () => i18n.t(($) => $.editor.latexPackages.empty),
    results: (count) => i18n.t(($) => $.editor.latexPackages.results, { count }),
    resultsCapped: (shown, count) => i18n.t(($) => $.editor.latexPackages.resultsCapped, { shown, count }),
    stale: (date) => i18n.t(($) => $.editor.latexPackages.stale, { date }),
    staleOffline: (date) => i18n.t(($) => $.editor.latexPackages.staleOffline, { date }),
    partial: (offline) =>
      offline
        ? i18n.t(($) => $.editor.latexPackages.partialOffline)
        : i18n.t(($) => $.editor.latexPackages.partial),
  },
  load: (options) =>
    loadLatexPackageIndex(options).then((index) => ({ ...index, partial: index.source === "bundled" })),
  key: (pkg) => pkg.name,
  search: (packages, query) => searchLatexPackages(packages, query),
  useRowContext: useLatexRowContext,
  renderNotice: renderLatexNotice,
  renderRow: (pkg, context) => <LatexPackageRow pkg={pkg} context={context} />,
};

export function LatexPackagesDialog({ open, onClose }: Readonly<{ open: boolean; onClose: () => void }>) {
  return <PackagesDialog provider={latexPackagesProvider} open={open} onClose={onClose} />;
}

export function showLatexPackagesDialog(): void {
  showPackagesDialog(latexPackagesProvider);
}
