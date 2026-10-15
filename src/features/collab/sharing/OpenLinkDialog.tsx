import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link2, X } from "lucide-react";
import { useLinkInbox } from "@/components/collab/link-inbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModalShell } from "@/components/ui/modal-shell";
import { InlineAlert } from "../feedback";
import { pastedProjectLink } from "../links/app-link";

// Hands the pasted link to the same flow as links opened from outside the
// app, which signs in, adds an unknown server with its address filled in,
// asks before joining and shows the download.
export function OpenLinkDialog({ onClose }: Readonly<{ onClose: () => void }>) {
  const { t } = useTranslation(["collab", "common"]);
  const titleId = useId();
  const inputId = useId();
  const [link, setLink] = useState("");
  const [notALink, setNotALink] = useState(false);
  const trimmed = link.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed === "") return;
    const app = pastedProjectLink(trimmed);
    if (app === null) {
      setNotALink(true);
      return;
    }
    useLinkInbox.getState().add(app);
    onClose();
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
      <form className="space-y-3" onSubmit={submit}>
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
          onChange={(event) => {
            setLink(event.target.value);
            setNotALink(false);
          }}
          className="text-sm"
        />
        {notALink ? <InlineAlert>{t(($) => $.collab.errors.not_a_link)}</InlineAlert> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t(($) => $.common.actions.cancel)}
          </Button>
          <Button type="submit" disabled={trimmed === ""}>
            <Link2 aria-hidden />
            {t(($) => $.collab.library.openLink.open)}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}
