import { useEffect, useState } from "react";
import { CiteOleaflyCard } from "@/components/settings/CiteOleaflyCard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { appVersion } from "@/lib/tauri";
import { useCiteOleaflyStore } from "@/store/cite-oleafly";
import { useSettingsStore } from "@/store/settings";

export function CiteOleaflyDialog() {
  const open = useCiteOleaflyStore((state) => state.open);
  const setOpen = useCiteOleaflyStore((state) => state.setOpen);
  const openSettingsAt = useSettingsStore((state) => state.openSettingsAt);
  const [version, setVersion] = useState("");
  useEffect(() => {
    if (!open) return;
    void appVersion().then(setVersion).catch(() => setVersion(""));
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl" data-testid="cite-oleafly-dialog">
        <DialogHeader>
          <DialogTitle>Cite Oleafly in this paper</DialogTitle>
          <DialogDescription>
            No bibliography file was found in this project, so nothing was changed. Copy
            the entry below into your bibliography, or find it again later under Settings,
            Help & About.
          </DialogDescription>
        </DialogHeader>
        <CiteOleaflyCard version={version} />
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(false);
              openSettingsAt("help");
            }}
          >
            Open Help & About
          </Button>
          <Button type="button" size="sm" onClick={() => setOpen(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
