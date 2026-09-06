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
  // The flow hands off between two dialogs, so the one that closes last would
  // restore focus to a card that no longer exists. Remember what opened the
  // flow and give the focus back to that.
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (props.open) {
      openerRef.current = document.activeElement as HTMLElement | null;
      void generateTemplateAvailable().then(setCanGenerate);
      return;
    }
    setKind(null);
    const opener = openerRef.current;
    openerRef.current = null;
    if (!opener?.isConnected) return;
    const frame = requestAnimationFrame(() => opener.focus());
    return () => cancelAnimationFrame(frame);
  }, [props.open]);
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
      <ProjectKindChooser
        open={props.open && kind === null}
        allowClose={props.allowClose !== false}
        onClose={props.onClose}
        onChoose={setKind}
      />
      <NewProjectDialogCore
        {...props}
        open={props.open && kind === "template"}
        onClose={() => {
          setKind(null);
          props.onClose();
        }}
        onGenerateWithAi={canGenerate ? () => setGenerateOpen(true) : undefined}
        onOpenTemplateDownloads={openTemplateDownloads}
        host={HOST}
        kit={KIT}
        colorOptions={BOOK_COLOR_OPTIONS}
        defaultColor={DEFAULT_BOOK_COLOR}
      />
      <ProjectImportDialog
        open={props.open && kind === "import"}
        onClose={() => setKind(null)}
        onImportStarted={props.onClose}
      />
      <ResearchProjectSetup
        open={props.open && kind === "research"}
        ensureInitialTask={ensureResearchStarterTask}
        onClose={() => setKind(null)}
        onFinished={() => {
          setKind(null);
          props.onClose();
        }}
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
