import { DropboxBrandIcon, GoogleDriveBrandIcon } from "@/components/settings/IntegrationBrandIcons";
import type { CloudProviderKind } from "@/lib/cloud";
import { cn } from "@/lib/utils";
import { Cloud, Database } from "lucide-react";
import type { ComponentType } from "react";

const LOOK: Readonly<Record<CloudProviderKind, { icon: ComponentType<{ className?: string }>; tile: string }>> = {
  dropbox: { icon: DropboxBrandIcon, tile: "bg-[#0061FF] text-white" },
  google_drive: { icon: GoogleDriveBrandIcon, tile: "bg-[#4285F4] text-white" },
  s3: { icon: Database, tile: "bg-muted text-foreground" },
};

const SIZE_CLASS = {
  md: { tile: "size-10 rounded-lg", icon: "size-5" },
  sm: { tile: "size-8 rounded-md", icon: "size-4" },
} as const;

/** A provider's logo on its brand colour, or a cloud for no provider in particular. */
export function CloudProviderLogo({
  kind,
  size = "md",
}: Readonly<{ kind: CloudProviderKind | null; size?: keyof typeof SIZE_CLASS }>) {
  const look = kind ? LOOK[kind] : { icon: Cloud, tile: "bg-primary/10 text-primary" };
  const Icon = look.icon;
  return (
    <span
      aria-hidden
      className={cn("flex shrink-0 items-center justify-center", SIZE_CLASS[size].tile, look.tile)}
    >
      <Icon className={SIZE_CLASS[size].icon} />
    </span>
  );
}
