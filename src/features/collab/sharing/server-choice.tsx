import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { useShareDialog } from "@/components/collab/share-dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CollabServer } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";

export function openCollaborationSettings() {
  useShareDialog.getState().close();
  const settings = useSettingsStore.getState();
  settings.setSettingsInitialSection("collaboration");
  settings.setSettingsOpen(true);
}

export function NoServers({ onAddOleafly }: Readonly<{ onAddOleafly: (() => void) | null }>) {
  const { t } = useTranslation(["collab"]);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {onAddOleafly ? t(($) => $.collab.share.noServersYet) : t(($) => $.collab.share.noServers)}
      </p>
      <div className="flex flex-wrap gap-2">
        {onAddOleafly ? (
          <Button type="button" onClick={onAddOleafly}>
            <Plus aria-hidden />
            {t(($) => $.collab.share.addOleafly)}
          </Button>
        ) : null}
        <Button type="button" variant="outline" onClick={openCollaborationSettings}>
          {t(($) => $.collab.share.openSettings)}
        </Button>
      </div>
    </div>
  );
}

export function ServerField({
  servers,
  value,
  disabled,
  onChange,
}: Readonly<{ servers: CollabServer[]; value: CollabServer; disabled: boolean; onChange: (id: string) => void }>) {
  const { t } = useTranslation(["collab"]);
  const label = t(($) => $.collab.share.serverLabel);
  if (servers.length === 1) {
    return (
      <p className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="truncate font-medium">{value.name}</span>
      </p>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Select value={value.server_id} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="h-8 w-56 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="z-[130]">
          {servers.map((entry) => (
            <SelectItem key={entry.server_id} value={entry.server_id}>
              {entry.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
