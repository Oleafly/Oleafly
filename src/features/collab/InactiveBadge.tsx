import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import type { CollabPerson } from "@/lib/tauri";

export function isInactive(person: Pick<CollabPerson, "active">): boolean {
  return person.active === false;
}

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
