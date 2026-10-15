import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";

export function GuestBadge() {
  const { t } = useTranslation(["collab"]);
  return (
    <Badge variant="info" size="sm">
      {t(($) => $.collab.guests.badge)}
    </Badge>
  );
}
