import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FolderDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModalShell } from "@/components/ui/modal-shell";
import type { CollabProjectSummary, CollabServer } from "@/lib/tauri";
import { personDetail } from "../people";

interface Fact {
  key: string;
  label: string;
  value: ReactNode;
}

function Named({ name, detail }: Readonly<{ name: string; detail: string }>) {
  return (
    <>
      <span className="block break-words font-medium">{name}</span>
      {detail === "" ? null : <span className="block break-all text-xs text-muted-foreground">{detail}</span>}
    </>
  );
}

export function JoinLinkDialog({
  server,
  project,
  onAnswer,
}: Readonly<{ server: CollabServer; project: CollabProjectSummary; onAnswer: (join: boolean) => void }>) {
  const { t } = useTranslation(["collab", "common"]);
  const titleId = useId();
  const bodyId = useId();
  const decline = () => onAnswer(false);
  const facts: Fact[] = [
    {
      key: "project",
      label: t(($) => $.collab.links.confirm.project),
      value: <span className="block break-words font-medium">{project.title}</span>,
    },
    {
      key: "owner",
      label: t(($) => $.collab.links.confirm.owner),
      value: <Named name={project.owner.display_name} detail={personDetail(project.owner)} />,
    },
    {
      key: "server",
      label: t(($) => $.collab.links.confirm.server),
      value: <Named name={server.name === "" ? server.url : server.name} detail={server.name === "" ? "" : server.url} />,
    },
    {
      key: "role",
      label: t(($) => $.collab.links.confirm.role),
      value: t(($) => $.collab.projectRoles[project.role]),
    },
  ];

  return (
    <ModalShell
      open
      onClose={decline}
      closeLabel={t(($) => $.common.actions.close)}
      width="md"
      labelledBy={titleId}
      describedBy={bodyId}
      className="space-y-4 p-5"
      testId="collab-link-join"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 id={titleId} className="text-base font-semibold">
            {t(($) => $.collab.links.confirm.title)}
          </h2>
          <p id={bodyId} className="text-xs text-muted-foreground">
            {t(($) => $.collab.links.confirm.body)}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={t(($) => $.common.actions.close)}
          onClick={decline}
        >
          <X aria-hidden className="size-4" />
        </Button>
      </div>
      <dl className="divide-y rounded-lg border text-sm">
        {facts.map((fact) => (
          <div key={fact.key} className="flex items-baseline gap-3 px-3 py-2">
            <dt className="w-24 shrink-0 text-xs text-muted-foreground">{fact.label}</dt>
            <dd className="min-w-0 flex-1 select-text">{fact.value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" data-modal-initial-focus onClick={decline}>
          {t(($) => $.common.actions.cancel)}
        </Button>
        <Button type="button" onClick={() => onAnswer(true)}>
          <FolderDown aria-hidden />
          {t(($) => $.collab.links.confirm.join)}
        </Button>
      </div>
    </ModalShell>
  );
}
