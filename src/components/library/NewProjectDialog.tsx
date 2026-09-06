import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  NewProjectDialog as NewProjectDialogCore,
  type TemplatesHost,
  type TemplatesKit,
} from "@oleafly/templates";
import { generateTemplateAvailable } from "@/features/template-generate";
import { TemplateGenerateModal } from "@/components/library/TemplateGenerateModal";
import { ResearchProjectSetup } from "@/components/research/workspace/ResearchProjectSetup";
import { useFilesStore } from "@/store/files";
import { ensureResearchStarterTask } from "@/lib/research-starter-task";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
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
import { BOOK_COLOR_OPTIONS, DEFAULT_BOOK_COLOR } from "@/components/library/Book";
import { logError } from "@/lib/log";
import {
  ensureTemplateAssets,
  templatePreview,
  type AssetProgress,
  type TemplateInfo,
} from "@/lib/tauri";

// Adapts the app's shadcn Select to the templates package's minimal kit contract
// so the gallery uses a real design component instead of a native <select>.
function KitSelect({
  value,
  onValueChange,
  options,
  className,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  "aria-label"?: string;
  "data-testid"?: string;
}) {
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

const KIT: TemplatesKit = { Button, Input, Tooltip, Select: KitSelect };

const HOST: TemplatesHost = {
  loadPreview: templatePreview,
  ensureAssets: async (templateId, onProgress) => {
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<AssetProgress>("asset-progress", (e) => {
        const p = e.payload;
        onProgress(p.label, p.index, p.total);
      });
      await ensureTemplateAssets(templateId);
    } finally {
      unlisten?.();
    }
  },
  logError: (scope, e) => void logError(scope, e),
};

const FOCUS_RESTORE_FRAMES = 12;

export function NewProjectDialog(props: {
  open: boolean;
  templates: TemplateInfo[];
  busy?: boolean;
  onClose: () => void;
  onCreate: (name: string, templateId: string, color: string) => void | Promise<void>;
  onTemplatesChanged?: () => void;
  allowEnterSubmit?: boolean;
  allowClose?: boolean;
}) {
  const [canGenerate, setCanGenerate] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [kind, setKind] = useState<ProjectKind | null>(null);
  // This dialog is mounted in both app shells, so creating a project unmounts
  // one host and mounts the other while the flow is still open. A host that
  // arrives mid-flow must stay inert, or it opens the chooser over the
  // workspace the project just landed in and leaves its overlay behind.
  const [armed, setArmed] = useState(!props.open);
  useEffect(() => {
    if (!props.open) setArmed(true);
  }, [props.open]);
  const flowOpen = props.open && armed;
  // The flow hands off between two dialogs, so the one that closes last would
  // restore focus to a card that no longer exists. Remember what opened the
  // flow and give the focus back to that.
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
    // The dialog that closes last restores focus on its own, to a control that
    // belonged to the step before it and is already gone. Take the focus back
    // once that has happened.
    let frame = 0;
    let attempts = 0;
    const restore = () => {
      if (!opener.isConnected) return;
      const active = document.activeElement;
      // Yield the moment anything else takes the focus: a menu or a select
      // opened right after this closed owns it, and stealing it back would
      // dismiss them.
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
      {kind === null && (
      <ProjectKindChooser
        open={flowOpen}
        allowClose={props.allowClose !== false}
        onClose={props.onClose}
        onChoose={setKind}
      />
      )}
      <NewProjectDialogCore
        {...props}
        open={flowOpen && kind === "template"}
        onClose={props.onClose}
        onGenerateWithAi={canGenerate ? () => setGenerateOpen(true) : undefined}
        onOpenTemplateDownloads={openTemplateDownloads}
        host={HOST}
        kit={KIT}
        colorOptions={BOOK_COLOR_OPTIONS}
        defaultColor={DEFAULT_BOOK_COLOR}
      />
      <ProjectImportDialog
        open={flowOpen && kind === "import"}
        onClose={props.onClose}
        onImportStarted={props.onClose}
      />
      <ResearchProjectSetup
        open={flowOpen && kind === "research"}
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
    </>
  );
}
