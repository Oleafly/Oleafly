import { BrandSvg, type BrandIconProps } from "@/components/settings/IntegrationBrandIcons";
import type { CloudProviderKind } from "@/lib/cloud";
import { cn } from "@/lib/utils";
import { Cloud, Database } from "lucide-react";
import type { ComponentType } from "react";

function DropboxBrandIcon({ className }: BrandIconProps) {
  return (
    <BrandSvg className={className} viewBox="0 0 24 24">
      <path d="M6 1.807L0 5.629l6 3.822 6.001-3.822L6 1.807zM18 1.807l-6 3.822 6 3.822 6-3.822-6-3.822zM0 13.274l6 3.822 6.001-3.822L6 9.452l-6 3.822zM18 9.452l-6 3.822 6 3.822 6-3.822-6-3.822zM6 18.371l6.001 3.822 6-3.822-6-3.822L6 18.371z" />
    </BrandSvg>
  );
}

// Google's four-colour Drive mark, so it sits on white like Google's own icon.
function GoogleDriveBrandIcon({ className }: BrandIconProps) {
  return (
    <BrandSvg className={className} viewBox="0 0 87.3 78">
      <path fill="#0066DA" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" />
      <path fill="#00AC47" d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" />
      <path fill="#EA4335" d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" />
      <path fill="#00832D" d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" />
      <path fill="#2684FC" d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
      <path fill="#FFBA00" d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" />
    </BrandSvg>
  );
}

const LOOK: Readonly<Record<CloudProviderKind, { icon: ComponentType<{ className?: string }>; tile: string }>> = {
  dropbox: { icon: DropboxBrandIcon, tile: "bg-[#0061FF] text-white" },
  google_drive: { icon: GoogleDriveBrandIcon, tile: "border border-border bg-white" },
  // S3's storage green, but no Amazon mark: the card covers every
  // S3-compatible service, not only Amazon's.
  s3: { icon: Database, tile: "bg-[#7AA116] text-white" },
};

const SIZE_CLASS = {
  md: { tile: "size-10 rounded-lg", icon: "size-5" },
  sm: { tile: "size-8 rounded-md", icon: "size-4" },
  xs: { tile: "size-4 rounded-[4px]", icon: "size-2.5" },
} as const;

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
