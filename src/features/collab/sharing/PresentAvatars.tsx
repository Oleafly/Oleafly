import { type ComponentProps, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { Avatar, AvatarStack, type AvatarAction, type AvatarPerson } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { GuestBadge } from "../GuestBadge";
import { goToPerson } from "../live/go-to-person";
import { peerPlaces, useCollabLiveStore } from "../live/live-store";
import { canEditProjectRole, suggestsOnlyProjectRole } from "../roles";
import { middleEllipsisPath } from "./middle-ellipsis";
import { presentPeople, type PresentPerson } from "./presence";

const TIP_PATH_CHARS = 30;
const MORE_PATH_CHARS = 40;

type Translate = ReturnType<typeof useTranslation<["collab"]>>["t"];
type PathLabel = (path: string) => string;

const samePath: PathLabel = (path) => path;

function placeOf(entry: PresentPerson, t: Translate, path: string | null): string {
  if (!path) return t(($) => $.collab.toolbar.nowhere);
  if (canEditProjectRole(entry.role)) return t(($) => $.collab.toolbar.editing, { path });
  if (suggestsOnlyProjectRole(entry.role)) return t(($) => $.collab.toolbar.reviewing, { path });
  return t(($) => $.collab.toolbar.viewing, { path });
}

function PersonTip({ entry, pathLabel }: Readonly<{ entry: PresentPerson | undefined; pathLabel: PathLabel }>) {
  const { t } = useTranslation(["collab"]);
  if (!entry) return null;
  const role = entry.role;
  const path = entry.path ? pathLabel(entry.path) : null;
  const full = placeOf(entry, t, path);
  const shown = placeOf(entry, t, path ? middleEllipsisPath(path, TIP_PATH_CHARS) : null);
  return (
    <span data-slot="person-tip" className="flex w-72 items-center gap-2.5 py-0.5 text-left">
      <Avatar person={entry.person} size="md" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-semibold leading-tight text-foreground">{entry.person.name}</span>
        <span className="flex min-w-0 items-center gap-1">
          {role ? (
            <Badge data-slot="role-badge" variant="muted" size="sm">
              {t(($) => $.collab.projectRoles[role])}
            </Badge>
          ) : null}
          {entry.guest ? <GuestBadge /> : null}
        </span>
        {path ? (
          <span className="truncate leading-tight text-muted-foreground">
            <span aria-hidden="true">{shown}</span>
            <span className="sr-only">{full}</span>
          </span>
        ) : (
          <span className="leading-tight text-muted-foreground">{full}</span>
        )}
      </span>
    </span>
  );
}

function PersonLabel({ entry, pathLabel }: Readonly<{ entry: PresentPerson | undefined; pathLabel: PathLabel }>) {
  const { t } = useTranslation(["collab"]);
  if (!entry) return null;
  const role = entry.role;
  return [
    entry.person.name,
    role ? t(($) => $.collab.projectRoles[role]) : null,
    entry.guest ? t(($) => $.collab.guests.badge) : null,
    placeOf(entry, t, entry.path ? pathLabel(entry.path) : null),
  ]
    .filter(Boolean)
    .join(", ");
}

function HiddenPerson({ entry, pathLabel }: Readonly<{ entry: PresentPerson | undefined; pathLabel: PathLabel }>) {
  const { t } = useTranslation(["collab"]);
  if (!entry) return null;
  const role = entry.role;
  const details = [
    role ? t(($) => $.collab.projectRoles[role]) : null,
    entry.guest ? t(($) => $.collab.guests.badge) : null,
    entry.path ? middleEllipsisPath(pathLabel(entry.path), MORE_PATH_CHARS) : t(($) => $.collab.toolbar.noFile),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span data-slot="hidden-person" className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap text-left">
      <span className="shrink-0 font-medium">{entry.person.name}</span>
      <span className="truncate text-muted-foreground">{details}</span>
    </span>
  );
}

const goToFile = (entry: PresentPerson): (() => void) | null =>
  entry.path ? () => void goToPerson(entry.accountId) : null;

export function PresentAvatars({
  projectId,
  goTo = goToFile,
  pathLabel = samePath,
  className,
  ...rest
}: Readonly<
  {
    projectId: string;
    goTo?: (entry: PresentPerson) => (() => void) | null;
    pathLabel?: PathLabel;
  } & Omit<ComponentProps<"div">, "children">
>) {
  const { t } = useTranslation(["collab"]);
  const peers = useCollabLiveStore((state) => peerPlaces(state.peers));
  const live = useCollabLiveStore(
    useShallow((state) => ({
      shared: state.projectId === projectId && state.share !== null,
      members: state.members,
      selfId: state.share?.account_id ?? null,
    })),
  );
  const unknownName = t(($) => $.collab.toolbar.unknownPerson);
  const people = useMemo(
    () => presentPeople(peers, live.members, live.selfId, unknownName),
    [peers, live.members, live.selfId, unknownName],
  );
  if (!live.shared || people.length === 0) return null;
  const byId = new Map(people.map((entry) => [entry.accountId, entry]));
  const action = (person: AvatarPerson): AvatarAction | null => {
    const entry = byId.get(person.id);
    const run = entry ? goTo(entry) : null;
    return run ? { label: t(($) => $.collab.toolbar.goTo, { name: person.name }), run } : null;
  };
  return (
    <div {...rest} className={cn("flex w-max shrink-0 items-center", className)}>
      <AvatarStack
        people={people.map((entry) => entry.person)}
        size="base"
        className="cursor-pointer px-0.5"
        tipWide
        action={action}
        renderTip={(person) => <PersonTip entry={byId.get(person.id)} pathLabel={pathLabel} />}
        renderLabel={(person) => <PersonLabel entry={byId.get(person.id)} pathLabel={pathLabel} />}
        renderMoreTip={(hidden) => (
          <span className="flex flex-col gap-1">
            {hidden.map((person) => (
              <HiddenPerson key={person.id} entry={byId.get(person.id)} pathLabel={pathLabel} />
            ))}
          </span>
        )}
      />
    </div>
  );
}
