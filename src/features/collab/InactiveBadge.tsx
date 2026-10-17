import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import type { CollabPerson } from "@/lib/tauri";

// Someone removed from this server or suspended on it. Older servers never
// say so, and everyone they list is active.
export function isInactive(person: Pick<CollabPerson, "active">): boolean {
  return person.active === false;
}

// `owner` names the owner, for a line that doesn't say whose name it is.
export function InactiveBadge({
  owner = false,
  tone = "muted",
}: Readonly<{ owner?: boolean; tone?: "muted" | "warning" }>) {
  const { t } = useTranslation(["collab"]);
  return (
    <Badge variant={tone} size="sm">
      {owner ? t(($) => $.collab.manage.ownerInactive) : t(($) => $.collab.manage.inactive)}
    </Badge>
  );
}
