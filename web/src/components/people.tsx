import { ShieldQuestion } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar, type AvatarSize } from "@/components/ui/avatar";
import { peerHue } from "@/features/collab/live/peer-hue";
import { cn } from "@/lib/utils";
import { useWeb } from "../store";

export function usePersonName(): (accountId: string, verified?: boolean) => string {
  const { t } = useTranslation(["web"]);
  const people = useWeb((state) => state.people);
  const self = useWeb((state) => state.me?.accountId ?? null);
  return (accountId, verified = true) => {
    if (!verified) return t(($) => $.web.people.unverified);
    if (accountId && accountId === self) return t(($) => $.web.people.you);
    return people[accountId]?.name || t(($) => $.web.people.someone);
  };
}

export function PersonAvatar({
  accountId,
  name,
  verified = true,
  size = "sm",
  className,
}: Readonly<{ accountId: string; name: string; verified?: boolean; size?: AvatarSize; className?: string }>) {
  const self = useWeb((state) => state.me?.accountId ?? null);
  const avatarUrl = useWeb((state) => state.people[accountId]?.avatarUrl ?? null);
  const known = useWeb((state) => state.people[accountId]?.name ?? "");
  return (
    <Avatar
      person={{
        id: accountId || "unknown",
        name: (verified && known) || name,
        imageUrl: verified ? avatarUrl : null,
        hue: peerHue(accountId || "unknown", self),
      }}
      size={size}
      fallbackIcon={verified ? undefined : <ShieldQuestion />}
      className={cn(!verified && "bg-muted text-muted-foreground", className)}
    />
  );
}
