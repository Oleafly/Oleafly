import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModalShell } from "@/components/ui/modal-shell";
import { Spinner } from "@/components/ui/spinner";
import { collabOpenLink, isCollabCommandError } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { collabErrorCode, collabErrorText } from "../errors";
import { InlineAlert } from "../feedback";

type Failure = { kind: "serverUnknown"; server: string } | { kind: "message"; text: string };

export function OpenLinkDialog({ onClose }: Readonly<{ onClose: () => void }>) {
  const { t } = useTranslation(["collab", "common"]);
  const titleId = useId();
  const inputId = useId();
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const trimmed = link.trim();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (trimmed === "" || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const projectId = await collabOpenLink(trimmed);
      const files = useFilesStore.getState();
      await files.refreshProjects();
      await files.openProject(projectId);
      onClose();
    } catch (error) {
      const code = collabErrorCode(error);
      if (code === "server_unknown") {
        setFailure({ kind: "serverUnknown", server: isCollabCommandError(error) ? error.message : "" });
      } else if (code === "not_found") {
        setFailure({ kind: "message", text: t(($) => $.collab.library.openLink.noAccess) });
      } else {
        setFailure({ kind: "message", text: collabErrorText(error) });
      }
    } finally {
      setBusy(false);
    }
  };

  const openSettings = () => {
    onClose();
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("collaboration");
    settings.setSettingsOpen(true);
  };

  return (
    <ModalShell
      open
      onClose={onClose}
      closeLabel={t(($) => $.common.actions.close)}
      width="md"
      labelledBy={titleId}
      className="space-y-4 p-5"
      testId="collab-open-link-dialog"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 id={titleId} className="text-base font-semibold">
            {t(($) => $.collab.library.openLink.title)}
          </h2>
          <p className="text-xs text-muted-foreground">{t(($) => $.collab.library.openLink.description)}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={t(($) => $.common.actions.close)}
          onClick={onClose}
        >
          <X aria-hidden className="size-4" />
        </Button>
      </div>
      <form className="space-y-3" onSubmit={(event) => void submit(event)}>
        <label htmlFor={inputId} className="text-sm font-medium">
          {t(($) => $.collab.library.openLink.label)}
        </label>
        <Input
          id={inputId}
          data-modal-initial-focus
          value={link}
          autoComplete="off"
          spellCheck={false}
          placeholder={t(($) => $.collab.library.openLink.placeholder)}
          onChange={(event) => setLink(event.target.value)}
          className="text-sm"
        />
        {failure?.kind === "serverUnknown" ? (
          <div className="space-y-2">
            <InlineAlert>{t(($) => $.collab.library.openLink.serverUnknown, { server: failure.server })}</InlineAlert>
            <Button type="button" variant="outline" size="sm" onClick={openSettings}>
              {t(($) => $.collab.share.openSettings)}
            </Button>
          </div>
        ) : null}
        {failure?.kind === "message" ? <InlineAlert>{failure.text}</InlineAlert> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t(($) => $.common.actions.cancel)}
          </Button>
          <Button type="submit" disabled={trimmed === "" || busy}>
            {busy ? <Spinner /> : <Link2 aria-hidden />}
            {t(($) => $.collab.library.openLink.open)}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}
