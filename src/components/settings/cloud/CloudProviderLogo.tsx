import { BrandSvg, type BrandIconProps } from "@/components/settings/IntegrationBrandIcons";
import type { CloudProviderKind } from "@/lib/cloud";
import { cn } from "@/lib/utils";
import { Cloud, Database } from "lucide-react";
import type { ComponentType } from "react";

// Only the Cloud tab shows these, so they live here rather than in the shared
// brand icons, which load at startup with the toolbar.
function DropboxBrandIcon({ className }: BrandIconProps) {
  return (
    <BrandSvg className={className} viewBox="0 0 24 24">
      <path d="M6 1.807L0 5.629l6 3.822 6.001-3.822L6 1.807zM18 1.807l-6 3.822 6 3.822 6-3.822-6-3.822zM0 13.274l6 3.822 6.001-3.822L6 9.452l-6 3.822zM18 9.452l-6 3.822 6 3.822 6-3.822-6-3.822zM6 18.371l6.001 3.822 6-3.822-6-3.822L6 18.371z" />
    </BrandSvg>
  );
}

function GoogleDriveBrandIcon({ className }: BrandIconProps) {
  return (
    <BrandSvg className={className} viewBox="0 0 24 24">
      <path d="M12.01 1.485c-2.082 0-3.754.02-3.743.047.01.02 1.708 3.001 3.774 6.62l3.76 6.574h3.76c2.081 0 3.753-.02 3.742-.047-.005-.02-1.708-3.001-3.775-6.62l-3.76-6.574zm-4.76 1.73a789.828 789.861 0 0 0-3.63 6.319L0 15.868l1.89 3.298 1.885 3.297 3.62-6.335 3.618-6.33-1.88-3.287C8.1 4.704 7.255 3.22 7.25 3.214zm2.259 12.653-.203.348c-.114.198-.96 1.672-1.88 3.287a423.93 423.948 0 0 1-1.698 2.97c-.01.026 3.24.042 7.222.042h7.244l1.796-3.157c.992-1.734 1.85-3.23 1.906-3.323l.104-.167h-7.249z" />
    </BrandSvg>
  );
}

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
