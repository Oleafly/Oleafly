import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  NewProjectDialog as NewProjectDialogCore,
  type TemplatesHost,
  type TemplatesKit,
} from "@oleafly/templates";
import { generateTemplateAvailable } from "@/features/template-generate";
import { TemplateGenerateModal } from "@/components/library/TemplateGenerateModal";
import { openTemplateInNewProject } from "@/store/template-request";
import { ResearchProjectSetup } from "@/components/research/workspace/ResearchProjectSetup";
import { useFilesStore } from "@/store/files";
import { ensureResearchStarterTask } from "@/lib/research-starter-task";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { useRowWindow } from "@/hooks/use-row-window";
import { useSettingsStore } from "@/store/settings";
import { ProjectImportDialog } from "@/components/library/ProjectImportDialog";
import { ProjectKindChooser, type ProjectKind } from "@/components/library/ProjectKindChooser";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BOOK_COLOR_OPTIONS, DEFAULT_BOOK_COLOR, randomBookColor } from "@/components/library/Book";
import { logError } from "@/lib/log";
import {
  ensureTemplateAssets,
  templatePreview,
  withAssetProgress,
  type TemplateInfo,
} from "@/lib/tauri";

function KitSelect({
  value,
  onValueChange,
  options,
  className,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: Readonly<{
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  "aria-label"?: string;
  "data-testid"?: string;
}>) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={className} aria-label={ariaLabel} data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="z-[100]">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const KIT: Omit<TemplatesKit, "t"> = { Button, Input, Tooltip, Select: KitSelect, useRowWindow };

const HOST: TemplatesHost = {
  loadPreview: templatePreview,
  ensureAssets: (templateId, onProgress) =>
    withAssetProgress(
      { component: (p) => onProgress(p.label, p.index, p.total) },
      () => ensureTemplateAssets(templateId),
    ),
  logError: (scope, e) => void logError(scope, e),
};

const FOCUS_RESTORE_FRAMES = 12;

const TemplateImportDialog = lazy(() =>
  import("@/components/library/TemplateImportDialog").then((module) => ({
    default: module.TemplateImportDialog,
  })),
);

export function NewProjectDialog(props: Readonly<{
  open: boolean;
  templates: TemplateInfo[];
  busy?: boolean;
  onClose: () => void;
  onCreate: (name: string, templateId: string, color: string) => void | Promise<void>;
  onTemplatesChanged?: () => void;
  allowEnterSubmit?: boolean;
  allowClose?: boolean;
  initialTemplateId?: string | null;
}>) {
  const { t } = useTranslation(["templates"]);
  const kit = useMemo<TemplatesKit>(
    () => ({
      ...KIT,
      t: (key, params) =>
        (t as unknown as (k: string, p?: Record<string, unknown>) => string)(
          `templates:package.${key}`,
          params,
        ),
    }),
    [t],
  );
  const [canGenerate, setCanGenerate] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [importTemplateOpen, setImportTemplateOpen] = useState(false);
  const [kind, setKind] = useState<ProjectKind | null>(null);
  const [armed, setArmed] = useState(!props.open);
  useEffect(() => {
    if (!props.open) setArmed(true);
  }, [props.open]);
  const flowOpen = props.open && armed;
  const activeKind: ProjectKind | null = kind ?? (props.initialTemplateId ? "template" : null);
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (flowOpen) {
      openerRef.current = document.activeElement as HTMLElement | null;
      void generateTemplateAvailable().then(setCanGenerate);
      return;
    }
    setKind(null);
    const opener = openerRef.current;
    openerRef.current = null;
    if (!opener?.isConnected) return;
    let frame = 0;
    let attempts = 0;
    const restore = () => {
      if (!opener.isConnected) return;
      const active = document.activeElement;
      if (active !== null && active !== document.body && active !== opener) return;
      if (active !== opener) opener.focus();
      attempts += 1;
      if (attempts < FOCUS_RESTORE_FRAMES) frame = requestAnimationFrame(restore);
    };
    opener.focus();
    frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [flowOpen]);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const setSettingsInitialSection = useSettingsStore((s) => s.setSettingsInitialSection);
  const setSettingsScrollTarget = useSettingsStore((s) => s.setSettingsScrollTarget);
  const openTemplateDownloads = () => {
    setSettingsScrollTarget("templates");
    setSettingsInitialSection("downloads");
    setSettingsOpen(true);
    props.onClose();
  };
  return (
    <>
      {/* Unmounted the moment a starting point is chosen: a dialog Radix is
          still animating out keeps a full-screen overlay over the workspace
          the user has just landed in. */}
      {activeKind === null && (
      <ProjectKindChooser
        open={flowOpen}
        allowClose={props.allowClose !== false}
        onClose={props.onClose}
        onChoose={setKind}
      />
      )}
      <NewProjectDialogCore
        {...props}
        open={flowOpen && activeKind === "template"}
        onClose={props.onClose}
        onGenerateWithAi={canGenerate ? () => setGenerateOpen(true) : undefined}
        onImportTemplate={() => setImportTemplateOpen(true)}
        onOpenTemplateDownloads={openTemplateDownloads}
        host={HOST}
        kit={kit}
        colorOptions={BOOK_COLOR_OPTIONS}
        defaultColor={DEFAULT_BOOK_COLOR}
        pickColor={randomBookColor}
      />
      <ProjectImportDialog
        open={flowOpen && activeKind === "import"}
        onClose={props.onClose}
      />
      <ResearchProjectSetup
        open={flowOpen && activeKind === "research"}
        ensureInitialTask={ensureResearchStarterTask}
        onClose={props.onClose}
        onFinished={props.onClose}
        onCreated={async (projectId) => {
          await useFilesStore.getState().openProject(projectId);
        }}
      />
      <TemplateGenerateModal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        onSaved={() => props.onTemplatesChanged?.()}
      />
      {importTemplateOpen ? (
        <Suspense fallback={null}>
          <TemplateImportDialog
            open
            onClose={() => setImportTemplateOpen(false)}
            onImported={(templateId) => {
              setImportTemplateOpen(false);
              openTemplateInNewProject(templateId);
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}
