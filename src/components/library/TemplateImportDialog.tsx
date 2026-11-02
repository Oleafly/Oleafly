import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, X } from "lucide-react";
import { FileText, Search } from "@/components/icons/pack";
import { ChoiceCard } from "@/components/library/ChoiceCard";
import { CHOICE_ART } from "@/components/library/choice-art";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModalShell } from "@/components/ui/modal-shell";
import { Spinner } from "@/components/ui/spinner";
import { describeError } from "@/lib/app-error";
import { firstPagePng, templateNameFromPath } from "@/features/custom-templates";
import { logError } from "@/lib/log";
import { pickOpenPath } from "@/lib/native-file-dialog";
import {
  isOverleafError,
  overleafImportTemplate,
  overleafSaveProjectAsTemplate,
  overleafSignIn,
  overleafStatus,
  overleafTemplateDetails,
  overleafTemplatePdf,
  type OverleafProject,
  type OverleafTemplateDetails,
} from "@/lib/overleaf";
import { basename } from "@/lib/path-utils";
import { importTemplateFromPath } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useOverleafImportStore } from "@/store/overleaf-import";

type View = "sources" | "name" | "link" | "account";

const ACCOUNT_ROWS = 200;
const DATA_URI_PREFIX = "data:image/png;base64,";

function pngBase64(uri: string | null): string | null {
  return uri?.startsWith(DATA_URI_PREFIX) ? uri.slice(DATA_URI_PREFIX.length) : null;
}

export function TemplateImportDialog({
  open,
  onClose,
  onImported,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  onImported: (templateId: string, name: string) => void;
}>) {
  const { t } = useTranslation(["common", "library"]);
  const nameId = useId();
  const linkId = useId();
  const [view, setView] = useState<View>("sources");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const sessionRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [details, setDetails] = useState<OverleafTemplateDetails | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [remote, setRemote] = useState<OverleafProject | null>(null);
  const [search, setSearch] = useState("");

  const wasOpenRef = useRef(open);
  useEffect(() => {
    if (open === wasOpenRef.current) return;
    wasOpenRef.current = open;
    sessionRef.current += 1;
    if (!open) return;
    setView("sources");
    setBusy(false);
    busyRef.current = false;
    setError(null);
    setPath(null);
    setName("");
    setLink("");
    setDetails(null);
    setPreview(null);
    setPreviewLoading(false);
    setNeedsSignIn(false);
    setSigningIn(false);
    setRemote(null);
    setSearch("");
  }, [open]);

  const close = () => {
    if (!busyRef.current) onClose();
  };

  const bodyRef = useRef<HTMLDivElement>(null);
  const picked = remote !== null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: picking an account project is a new step that needs the focus too.
  useEffect(() => {
    if (!open || view === "sources") return;
    const frame = requestAnimationFrame(() => {
      bodyRef.current
        ?.querySelector<HTMLElement>("[data-modal-initial-focus]")
        ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, view, picked]);

  const run = async (work: () => Promise<string>, savedName: string) => {
    if (busyRef.current) return;
    const session = sessionRef.current;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const id = await work();
      if (session !== sessionRef.current) return;
      onImported(id, savedName);
    } catch (error_) {
      if (session !== sessionRef.current) return;
      void logError("import template", error_);
      if (isOverleafError(error_, "signed_out") || isOverleafError(error_, "session_expired")) {
        setNeedsSignIn(true);
      }
      setError(describeError(error_) || t(($) => $.library.customTemplates.import.failed));
    } finally {
      busyRef.current = false;
      if (session === sessionRef.current) setBusy(false);
    }
  };

  const choosePath = async (directory: boolean) => {
    if (busyRef.current) return;
    setError(null);
    try {
      const picked = await pickOpenPath(
        directory
          ? {
              directory: true as const,
              multiple: false as const,
              title: t(($) => $.library.customTemplates.import.pickerFolderTitle),
            }
          : {
              multiple: false as const,
              title: t(($) => $.library.customTemplates.import.pickerZipTitle),
              filters: [
                {
                  name: t(($) => $.library.customTemplates.import.pickerZipFilter),
                  extensions: ["zip"],
                },
              ],
            },
      );
      if (typeof picked !== "string") return;
      setPath(picked);
      setName(templateNameFromPath(picked));
      setView("name");
    } catch (error_) {
      void logError("choose a template source", error_);
      setError(describeError(error_));
    }
  };

  const saveFromPath = () => {
    const chosen = path;
    const templateName = name.trim();
    if (!chosen || !templateName) return;
    void run(() => importTemplateFromPath(chosen, templateName), templateName);
  };

  const lookUp = async (event?: FormEvent) => {
    event?.preventDefault();
    const address = link.trim();
    if (!address || busyRef.current) return;
    const session = sessionRef.current;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setDetails(null);
    setPreview(null);
    setNeedsSignIn(false);
    try {
      const found = await overleafTemplateDetails(useOverleafImportStore.getState().server, address);
      if (session !== sessionRef.current) return;
      setDetails(found);
      setName(found.title);
      if (found.hasPdf) {
        setPreviewLoading(true);
        void overleafTemplatePdf(found.server, found.link)
          .then(firstPagePng)
          .catch((error_: unknown) => {
            void logError("template link preview", error_);
            return null;
          })
          .then((uri) => {
            if (session !== sessionRef.current) return;
            setPreview(uri);
            setPreviewLoading(false);
          });
      }
    } catch (error_) {
      if (session !== sessionRef.current) return;
      void logError("look up a template link", error_);
      setError(describeError(error_));
    } finally {
      busyRef.current = false;
      if (session === sessionRef.current) setBusy(false);
    }
  };

  const importLink = async () => {
    const found = details;
    const templateName = name.trim();
    if (!found || !templateName || busyRef.current) return;
    try {
      const status = await overleafStatus(found.server);
      if (!status.signedIn) {
        setNeedsSignIn(true);
        return;
      }
    } catch (error_) {
      void logError("overleaf status", error_);
    }
    await run(
      () => overleafImportTemplate(found.server, found.link, templateName, pngBase64(preview)),
      templateName,
    );
  };

  const signInAndImport = async () => {
    const found = details;
    if (!found || signingIn) return;
    setSigningIn(true);
    setError(null);
    try {
      await overleafSignIn(found.server, t(($) => $.library.import.overleaf.signInWindowTitle));
      void useOverleafImportStore.getState().refreshStatus();
      setNeedsSignIn(false);
    } catch (error_) {
      if (!isOverleafError(error_, "sign_in_cancelled")) {
        void logError("overleaf sign in", error_);
        setError(describeError(error_));
      }
      return;
    } finally {
      setSigningIn(false);
    }
    await importLink();
  };

  const saveRemote = () => {
    const chosen = remote;
    const templateName = name.trim();
    if (!chosen || !templateName) return;
    const server = useOverleafImportStore.getState().server;
    void run(() => overleafSaveProjectAsTemplate(server, chosen.id, templateName), templateName);
  };

  const goBack = () => {
    if (busyRef.current) return;
    setError(null);
    setNeedsSignIn(false);
    if (view === "account" && remote) {
      setRemote(null);
      return;
    }
    setView("sources");
    setPath(null);
    setDetails(null);
    setPreview(null);
  };

  const titleId = useId();
  const descriptionId = useId();

  const nameField = (onSubmit: () => void, action: string, testId: string) => (
    <div className="space-y-1.5">
      <label htmlFor={nameId} className="text-xs font-medium text-muted-foreground">
        {t(($) => $.library.customTemplates.nameLabel)}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={nameId}
          data-modal-initial-focus
          data-testid="template-import-name"
          value={name}
          disabled={busy}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSubmit();
          }}
          className="flex-1"
        />
        <Button
          type="button"
          data-testid={testId}
          disabled={busy || !name.trim()}
          onClick={onSubmit}
        >
          {busy ? <Spinner size="sm" /> : null}
          {action}
        </Button>
      </div>
    </div>
  );

  const renderSources = () => (
    <div className="grid gap-3 sm:grid-cols-2">
      <ChoiceCard
        image={CHOICE_ART.importArchive}
        title={t(($) => $.library.customTemplates.import.zipTitle)}
        description={t(($) => $.library.customTemplates.import.zipDescription)}
        testId="template-import-zip"
        compact
        disabled={busy}
        onClick={() => void choosePath(false)}
      />
      <ChoiceCard
        image={CHOICE_ART.openFolder}
        title={t(($) => $.library.customTemplates.import.folderTitle)}
        description={t(($) => $.library.customTemplates.import.folderDescription)}
        testId="template-import-folder"
        compact
        disabled={busy}
        onClick={() => void choosePath(true)}
      />
      <ChoiceCard
        image={CHOICE_ART.template}
        title={t(($) => $.library.customTemplates.import.linkTitle)}
        description={t(($) => $.library.customTemplates.import.linkDescription)}
        testId="template-import-link"
        compact
        disabled={busy}
        onClick={() => {
          setError(null);
          setView("link");
        }}
      />
      <ChoiceCard
        image={CHOICE_ART.importOverleaf}
        title={t(($) => $.library.customTemplates.import.accountTitle)}
        description={t(($) => $.library.customTemplates.import.accountDescription)}
        testId="template-import-account"
        compact
        disabled={busy}
        onClick={() => {
          setError(null);
          setView("account");
        }}
      />
    </div>
  );

  const renderName = () => (
    <div className="space-y-4">
      <p className="select-text break-all text-xs text-muted-foreground">
        {t(($) => $.library.customTemplates.import.from, { source: basename(path ?? "") })}
      </p>
      {nameField(
        saveFromPath,
        t(($) => $.library.customTemplates.import.saveTemplate),
        "template-import-save",
      )}
    </div>
  );

  const renderPreview = () => {
    if (preview) {
      return (
        <img
          src={preview}
          alt={t(($) => $.library.customTemplates.import.previewAlt, { name: details?.title ?? "" })}
          className="h-full w-full object-cover object-top"
          draggable={false}
        />
      );
    }
    if (previewLoading) return <Spinner size="sm" />;
    return (
      <span className="flex flex-col items-center gap-1 text-[0.625rem] text-muted-foreground">
        <FileText aria-hidden="true" className="size-5" />
        {t(($) => $.library.customTemplates.import.noPreview)}
      </span>
    );
  };

  const renderLink = () => (
    <div className="space-y-4">
      <form className="space-y-1.5" onSubmit={(event) => void lookUp(event)}>
        <label htmlFor={linkId} className="text-xs font-medium text-muted-foreground">
          {t(($) => $.library.customTemplates.import.linkLabel)}
        </label>
        <div className="flex items-center gap-2">
          <Input
            id={linkId}
            data-modal-initial-focus
            data-testid="template-import-link-input"
            value={link}
            disabled={busy}
            inputMode="url"
            spellCheck={false}
            placeholder={t(($) => $.library.customTemplates.import.linkPlaceholder)}
            onChange={(event) => setLink(event.target.value)}
            className="flex-1"
          />
          <Button
            type="submit"
            variant="outline"
            data-testid="template-import-look-up"
            disabled={busy || !link.trim()}
          >
            {t(($) => $.library.customTemplates.import.lookUp)}
          </Button>
        </div>
      </form>
      {details ? (
        <div className="space-y-4">
          <div className="flex gap-4 rounded-lg border bg-card p-3" data-testid="template-import-details">
            <div className="flex aspect-[17/22] w-24 shrink-0 items-center justify-center overflow-hidden rounded border border-black/10 bg-white">
              {renderPreview()}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="select-text break-words text-sm font-semibold text-foreground">{details.title}</p>
              {details.author ? (
                <p className="select-text truncate text-xs text-muted-foreground">
                  {t(($) => $.library.customTemplates.import.by, { author: details.author })}
                </p>
              ) : null}
              {details.license ? (
                <p className="select-text truncate text-xs text-muted-foreground">{details.license}</p>
              ) : null}
              {details.description ? (
                <p className="line-clamp-3 select-text text-xs text-muted-foreground">
                  {details.description}
                </p>
              ) : null}
            </div>
          </div>
          {nameField(
            () => void importLink(),
            t(($) => $.library.customTemplates.import.importAction),
            "template-import-link-save",
          )}
          <p className="text-xs text-muted-foreground">
            {t(($) => $.library.customTemplates.import.copyNote)}
          </p>
          {needsSignIn ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 p-3">
              <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                {signingIn
                  ? t(($) => $.library.customTemplates.import.signingIn)
                  : t(($) => $.library.customTemplates.import.signInNeeded)}
              </p>
              <Button
                type="button"
                size="sm"
                data-testid="template-import-sign-in"
                disabled={signingIn || busy}
                onClick={() => void signInAndImport()}
              >
                {signingIn ? <Spinner size="sm" /> : null}
                {t(($) => $.library.customTemplates.import.signIn)}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  return (
    <ModalShell
      open={open}
      onClose={close}
      closeLabel={t(($) => $.common.actions.close)}
      layer="nested"
      portal
      animated
      labelledBy={titleId}
      describedBy={descriptionId}
      testId="template-import-dialog"
      className={cn(
        "flex max-h-[calc(100dvh-2rem)] w-full flex-col gap-4 overflow-hidden p-6",
        view === "sources" ? "max-w-2xl" : "max-w-xl",
      )}
    >
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 id={titleId} className="flex items-center gap-2 text-lg font-semibold leading-none">
            {view !== "sources" ? (
              <button
                type="button"
                aria-label={t(($) => $.library.customTemplates.import.back)}
                data-testid="template-import-back"
                disabled={busy}
                onClick={goBack}
                className="rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
              >
                <ChevronLeft aria-hidden="true" className="size-4" />
              </button>
            ) : null}
            {t(($) => $.library.customTemplates.import.title)}
          </h2>
          <p id={descriptionId} className="text-sm text-muted-foreground">
            {t(($) => $.library.customTemplates.import.description)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          disabled={busy}
          onClick={close}
          aria-label={t(($) => $.common.actions.close)}
        >
          <X className="size-4" />
        </Button>
      </div>
      {error ? (
        <p
          role="alert"
          className="shrink-0 select-text rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      {busy && view === "link" && !details ? (
        <output className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          {t(($) => $.library.customTemplates.import.lookingUp)}
        </output>
      ) : null}
      <div ref={bodyRef} className="-mx-6 -mb-6 min-h-0 overflow-y-auto px-6 pb-6">
        {view === "sources" ? renderSources() : null}
        {view === "name" ? renderName() : null}
        {view === "link" ? renderLink() : null}
        {view === "account" ? (
          <AccountProjects
            busy={busy}
            selected={remote}
            search={search}
            onSearch={setSearch}
            onSelect={(project) => {
              setRemote(project);
              setName(project.name);
              setError(null);
            }}
            nameField={nameField(
              saveRemote,
              t(($) => $.library.customTemplates.import.saveTemplate),
              "template-import-account-save",
            )}
          />
        ) : null}
      </div>
    </ModalShell>
  );
}

function AccountProjects({
  busy,
  selected,
  search,
  onSearch,
  onSelect,
  nameField,
}: Readonly<{
  busy: boolean;
  selected: OverleafProject | null;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (project: OverleafProject) => void;
  nameField: ReactNode;
}>) {
  const { t } = useTranslation(["library"]);
  const phase = useOverleafImportStore((state) => state.phase);
  const projects = useOverleafImportStore((state) => state.projects);
  const openAccount = useOverleafImportStore((state) => state.open);
  const signIn = useOverleafImportStore((state) => state.signIn);
  const searchId = useId();

  useEffect(() => {
    void openAccount();
  }, [openAccount]);

  const needle = search.trim().toLocaleLowerCase();
  const matching = useMemo(
    () =>
      projects
        .filter((project) => !project.archived)
        .filter((project) => !needle || project.name.toLocaleLowerCase().includes(needle))
        .slice(0, ACCOUNT_ROWS),
    [projects, needle],
  );

  if (selected) {
    return (
      <div className="space-y-4">
        <p className="select-text break-words text-xs text-muted-foreground">
          {t(($) => $.library.customTemplates.import.from, { source: selected.name })}
        </p>
        {nameField}
      </div>
    );
  }
  if (phase === "signed-out" || phase === "signing-in") {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 p-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {phase === "signing-in"
            ? t(($) => $.library.customTemplates.import.signingIn)
            : t(($) => $.library.import.overleaf.signInPrompt)}
        </p>
        <Button
          type="button"
          size="sm"
          data-testid="template-import-account-sign-in"
          disabled={phase === "signing-in"}
          onClick={() => void signIn(t(($) => $.library.import.overleaf.signInWindowTitle))}
        >
          {phase === "signing-in" ? <Spinner size="sm" /> : null}
          {t(($) => $.library.customTemplates.import.signIn)}
        </Button>
      </div>
    );
  }
  if (phase === "error") {
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-muted-foreground">
          {t(($) => $.library.customTemplates.import.accountFailed)}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => void openAccount()}>
          {t(($) => $.library.customTemplates.import.tryAgain)}
        </Button>
      </div>
    );
  }
  if (phase !== "ready") {
    return (
      <output className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        {t(($) => $.library.customTemplates.import.accountLoading)}
      </output>
    );
  }
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={searchId}
          data-modal-initial-focus
          data-testid="template-import-account-search"
          aria-label={t(($) => $.library.customTemplates.import.accountSearch)}
          placeholder={t(($) => $.library.customTemplates.import.accountSearch)}
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          className="pl-8"
        />
      </div>
      {matching.length === 0 ? (
        <p className="p-2 text-sm text-muted-foreground">
          {t(($) => $.library.customTemplates.import.accountEmpty)}
        </p>
      ) : (
        <ul className="max-h-72 space-y-0.5 overflow-y-auto">
          {matching.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                disabled={busy}
                data-testid={`template-import-account-${project.id}`}
                onClick={() => onSelect(project)}
                className="flex w-full min-w-0 items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent disabled:opacity-60"
              >
                <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">{project.name}</span>
                {project.ownerName && !project.owned ? (
                  <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">
                    {project.ownerName}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
