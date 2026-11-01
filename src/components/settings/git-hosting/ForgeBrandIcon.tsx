import {
  CodebergBrandIcon,
  ForgejoBrandIcon,
  GiteaBrandIcon,
  GitHubBrandIcon,
  GitLabBrandIcon,
} from "@/components/settings/IntegrationBrandIcons";
import { accountKey } from "@/lib/forge";
import type { ForgeAccount } from "@/lib/tauri";

export function ForgeBrandIcon({
  base,
  kind,
  flavor,
  className,
}: Readonly<Pick<ForgeAccount, "kind"> & {
  base?: string;
  flavor?: NonNullable<ForgeAccount["flavor"]> | null;
  className?: string;
}>) {
  if (kind === "github") return <GitHubBrandIcon className={className} />;
  if (kind === "gitlab") return <GitLabBrandIcon className={className} />;
  if (base && accountKey(base) === "codeberg.org") return <CodebergBrandIcon className={className} />;
  return flavor === "forgejo" ? <ForgejoBrandIcon className={className} /> : <GiteaBrandIcon className={className} />;
}
