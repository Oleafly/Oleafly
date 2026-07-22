import { listen } from "@tauri-apps/api/event";
import {
  NewProjectDialog as NewProjectDialogCore,
  type TemplatesHost,
  type TemplatesKit,
} from "@oleafly/templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
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
  installTemplatePack,
  listTemplatePacks,
  refreshPackCatalog,
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
  listPacks: async () => {
    // Best-effort catalog refresh; offline just serves the cache/bundled copy.
    await refreshPackCatalog().catch(() => {});
    const packs = await listTemplatePacks();
    return packs.map((p) => ({
      id: p.id,
      label: p.label,
      description: p.description,
      count: p.count,
      approxBytes: p.approx_bytes,
      licenseSummary: p.license_summary,
      installed: p.installed,
    }));
  },
  installPack: async (id, onProgress) => {
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<AssetProgress>("asset-progress", (e) => {
        const p = e.payload;
        if (p.component === id) onProgress(p.file, p.index, p.total);
      });
      await installTemplatePack(id);
    } finally {
      unlisten?.();
    }
  },
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
