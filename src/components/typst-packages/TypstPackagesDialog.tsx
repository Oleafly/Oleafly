import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Copy, Plus } from "lucide-react";
import { i18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { SectionHeading } from "@/components/ui/section-heading";
import { useCopyStatus } from "@/components/ui/use-copy-status";
import { getEditorView } from "@/components/editor/cm/controller";
import { PackagesDialog, showPackagesDialog, type PackagesProvider } from "@/components/packages/PackagesDialog";
import { describeError } from "@/lib/app-error";
import { formatList } from "@/lib/intl";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import {
  compilerTooNew,
  importEdit,
  importLine,
  loadUniverseIndex,
  packageCategories,
  searchPackages,
  setTypstVendorPackages,
  typstPackageSettings,
  vendorTypstPackages,
  type TypstPackageSettings,
  type TypstVendorReport,
  type UniversePackage,
} from "@/lib/typst-universe";

function PackageRow({
  pkg,
  typstVersion,
  canInsert,
  onInsert,
}: Readonly<{
  pkg: UniversePackage;
  typstVersion: string | null;
  canInsert: boolean;
  onInsert: (pkg: UniversePackage) => void;
}>) {
  const { t } = useTranslation(["common", "editor"]);
  const { copied, copy } = useCopyStatus();
  const tooNew = compilerTooNew(pkg, typstVersion);
  return (
    <div data-testid={`typst-package-${pkg.name}`} className="flex flex-col gap-1.5 border-b px-3 py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-sm">{pkg.name}</span>
        <Badge variant="muted" size="sm">
          {t(($) => $.editor.typstPackages.latest, { version: pkg.version })}
        </Badge>
        {pkg.template && (
          <Badge variant="primaryGhost" size="sm">
            {t(($) => $.editor.typstPackages.template)}
          </Badge>
        )}
      </div>
      {pkg.description && <p className="line-clamp-2 text-xs text-muted-foreground">{pkg.description}</p>}
      {tooNew && pkg.compiler && typstVersion && (
        <p className="flex items-center gap-1.5 text-[0.6875rem] text-amber-700 dark:text-amber-300">
          <AlertTriangle aria-hidden="true" className="size-3 shrink-0" />
          {t(($) => $.editor.typstPackages.needsTypst, { version: pkg.compiler, current: typstVersion })}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={!canInsert}
          aria-label={t(($) => $.editor.typstPackages.insertAria, { name: pkg.name })}
          onClick={() => onInsert(pkg)}
        >
          <Plus aria-hidden="true" />
          {t(($) => $.editor.typstPackages.insert)}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          aria-label={t(($) => $.editor.typstPackages.copyAria, { name: pkg.name })}
          onClick={() => void copy(importLine(pkg.name, pkg.version))}
        >
          {copied ? <Check aria-hidden="true" className="text-emerald-500" /> : <Copy aria-hidden="true" />}
          {copied ? t(($) => $.common.actions.copied) : t(($) => $.editor.typstPackages.copy)}
        </Button>
        {!canInsert && (
          <span className="text-[0.6875rem] text-muted-foreground">
            {t(($) => $.editor.typstPackages.insertNeedsFile)}
          </span>
        )}
      </div>
    </div>
  );
}

function vendorMessage(report: TypstVendorReport): string {
  if (report.missing.length > 0) {
    return i18n.t(($) => $.editor.typstPackages.vendor.missing, { names: formatList(report.missing) });
  }
  if (report.vendored.length > 0) {
    return i18n.t(($) => $.editor.typstPackages.vendor.copied, { count: report.vendored.length });
  }
  return i18n.t(($) => $.editor.typstPackages.vendor.upToDate);
}

function VendorSection({ projectId, offline }: Readonly<{ projectId: string; offline: boolean }>) {
  const { t } = useTranslation(["common", "editor"]);
  const [settings, setSettings] = useState<TypstPackageSettings | null>(null);
  const [busy, setBusy] = useState<"toggle" | "vendor" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSettings(await typstPackageSettings(projectId));
    } catch (error_) {
      setError(describeError(error_));
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = async (enabled: boolean) => {
    setBusy("toggle");
    setError(null);
    try {
      await setTypstVendorPackages(projectId, enabled);
      await refresh();
    } catch (error_) {
      setError(describeError(error_));
    } finally {
      setBusy(null);
    }
  };

  const vendor = async () => {
    setBusy("vendor");
    setError(null);
    setNotice(null);
    try {
      const result = await vendorTypstPackages(projectId, offline);
      setNotice(vendorMessage(result.report));
      await refresh();
    } catch (error_) {
      setError(describeError(error_));
    } finally {
      setBusy(null);
    }
  };

  const count = settings?.vendored.length ?? 0;
  return (
    <section aria-labelledby="typst-packages-vendor" className="flex flex-col gap-2 border-t p-3">
      <SectionHeading id="typst-packages-vendor">{t(($) => $.editor.typstPackages.vendor.heading)}</SectionHeading>
      <div className="flex items-start gap-2.5">
        <Switch
          id="typst-packages-vendor-toggle"
          checked={settings?.vendorPackages ?? false}
          disabled={settings === null || busy !== null}
          onCheckedChange={(checked) => void toggle(checked)}
          aria-label={t(($) => $.editor.typstPackages.vendor.toggle)}
        />
        <div className="min-w-0">
          <label htmlFor="typst-packages-vendor-toggle" className="text-sm">
            {t(($) => $.editor.typstPackages.vendor.toggle)}
          </label>
          <p className="text-[0.6875rem] text-muted-foreground">{t(($) => $.editor.typstPackages.vendor.detail)}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void vendor()}>
          {busy === "vendor" && <Spinner size="sm" />}
          {t(($) => $.editor.typstPackages.vendor.action)}
        </Button>
        {busy === "vendor" ? (
          <span className="text-xs text-muted-foreground">{t(($) => $.editor.typstPackages.vendor.running)}</span>
        ) : (
          settings && (
            <span className="text-xs text-muted-foreground">
              {count > 0
                ? t(($) => $.editor.typstPackages.vendor.count, { count })
                : t(($) => $.editor.typstPackages.vendor.none)}
            </span>
          )
        )}
      </div>
      {notice && <output className="block text-xs text-muted-foreground">{notice}</output>}
      {error && (
        <p role="alert" className="select-text text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

interface TypstRowContext {
  readonly typstVersion: string | null;
  readonly canInsert: boolean;
  readonly projectId: string | null;
  readonly offline: boolean;
  readonly insert: (pkg: UniversePackage) => void;
}

function useTypstRowContext(_open: boolean, onClose: () => void): TypstRowContext {
  const offline = useSettingsStore((state) => state.offline);
  const projectId = useFilesStore((state) => state.projectId);
  const activePath = useFilesStore((state) => state.activePath);
  const typstVersion = useFilesStore((state) => state.engine.typst_resolved?.version ?? null);
  const canInsert = Boolean(activePath && /\.typ$/i.test(activePath));
  const insert = (pkg: UniversePackage) => {
    const view = getEditorView();
    if (!view || !canInsert) return;
    const edit = importEdit(view.state.doc.toString(), pkg.name, pkg.version);
    if (edit) view.dispatch({ changes: edit });
    onClose();
    requestAnimationFrame(() => view.focus());
  };
  return { typstVersion, canInsert, projectId, offline, insert };
}

export const typstPackagesProvider: PackagesProvider<UniversePackage, TypstRowContext> = {
  id: "typst",
  labels: {
    title: () => i18n.t(($) => $.editor.typstPackages.title),
    close: () => i18n.t(($) => $.editor.typstPackages.close),
    searchLabel: () => i18n.t(($) => $.editor.typstPackages.searchLabel),
    searchPlaceholder: () => i18n.t(($) => $.editor.typstPackages.searchPlaceholder),
    categories: () => i18n.t(($) => $.editor.typstPackages.categories),
    allCategories: () => i18n.t(($) => $.editor.typstPackages.allCategories),
    loading: () => i18n.t(($) => $.editor.typstPackages.loading),
    empty: () => i18n.t(($) => $.editor.typstPackages.empty),
    results: (count) => i18n.t(($) => $.editor.typstPackages.results, { count }),
    resultsCapped: (shown, count) => i18n.t(($) => $.editor.typstPackages.resultsCapped, { shown, count }),
    stale: (date) => i18n.t(($) => $.editor.typstPackages.stale, { date }),
    staleOffline: (date) => i18n.t(($) => $.editor.typstPackages.staleOffline, { date }),
  },
  load: (options) => loadUniverseIndex(options),
  key: (pkg) => pkg.name,
  search: searchPackages,
  categories: packageCategories,
  useRowContext: useTypstRowContext,
  renderRow: (pkg, context) => (
    <PackageRow
      pkg={pkg}
      typstVersion={context.typstVersion}
      canInsert={context.canInsert}
      onInsert={context.insert}
    />
  ),
  renderFooter: (context) =>
    context.projectId ? <VendorSection projectId={context.projectId} offline={context.offline} /> : null,
};

export function TypstPackagesDialog({ open, onClose }: Readonly<{ open: boolean; onClose: () => void }>) {
  return <PackagesDialog provider={typstPackagesProvider} open={open} onClose={onClose} />;
}

export function showTypstPackagesDialog(): void {
  showPackagesDialog(typstPackagesProvider);
}
