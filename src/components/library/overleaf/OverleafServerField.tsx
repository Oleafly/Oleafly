import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input, LITERAL_INPUT } from "@/components/ui/input";
import { DEFAULT_OVERLEAF_SERVER } from "@/lib/overleaf";
import { serverHost } from "@/lib/overleaf-live";
import { cn } from "@/lib/utils";
import { useOverleafImportStore } from "@/store/overleaf-import";

export const LINK_BUTTON =
  "rounded px-1 font-medium text-foreground transition-colors hover:bg-accent focus-visible:bg-accent disabled:opacity-50";

export function OverleafServerField({
  disabled = false,
  onChanged,
  className,
}: Readonly<{ disabled?: boolean; onChanged: () => void; className?: string }>) {
  const { t } = useTranslation(["library"]);
  const server = useOverleafImportStore((state) => state.server);
  const setServer = useOverleafImportStore((state) => state.setServer);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(server);
  const custom = server !== DEFAULT_OVERLEAF_SERVER;

  if (editing) {
    return (
      <form
        className={cn("flex w-full max-w-md items-center gap-2", className)}
        onSubmit={(event) => {
          event.preventDefault();
          setServer(draft);
          setEditing(false);
          onChanged();
        }}
      >
        <Input
          {...LITERAL_INPUT}
          data-testid="overleaf-server-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label={t(($) => $.library.import.overleaf.serverLabel)}
          placeholder={DEFAULT_OVERLEAF_SERVER}
          className="h-8"
        />
        <Button type="submit" size="sm" variant="outline" data-testid="overleaf-save-server" disabled={!draft.trim()}>
          {t(($) => $.library.import.overleaf.saveServer)}
        </Button>
      </form>
    );
  }
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      {t(($) => $.library.import.overleaf.server, { server: serverHost(server) })}{" "}
      <button
        type="button"
        data-testid="overleaf-change-server"
        disabled={disabled}
        onClick={() => {
          setDraft(server);
          setEditing(true);
        }}
        className={LINK_BUTTON}
      >
        {t(($) => $.library.import.overleaf.useDifferentServer)}
      </button>
      {custom ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setServer(DEFAULT_OVERLEAF_SERVER);
            onChanged();
          }}
          className={LINK_BUTTON}
        >
          {t(($) => $.library.import.overleaf.useDefaultServer)}
        </button>
      ) : null}
    </p>
  );
}
