import { listen } from "@tauri-apps/api/event";
import {
  NewProjectDialog as NewProjectDialogCore,
  type TemplatesHost,
  type TemplatesKit,
} from "@openleaf/templates";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { BOOK_COLOR_OPTIONS, DEFAULT_BOOK_COLOR } from "@/components/library/Book";
import { logError } from "@/lib/log";
import {
  ensureTemplateAssets,
  templatePreview,
  type AssetProgress,
  type TemplateInfo,
} from "@/lib/tauri";

const KIT: TemplatesKit = { Button, Tooltip };

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
}) {
  return (
    <NewProjectDialogCore
      {...props}
      host={HOST}
      kit={KIT}
      colorOptions={BOOK_COLOR_OPTIONS}
      defaultColor={DEFAULT_BOOK_COLOR}
    />
  );
}
