import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CollabProjectRole } from "@/lib/tauri";

export const GRANTABLE_ROLES = ["editor", "viewer"] as const satisfies readonly CollabProjectRole[];

export type GrantableRole = (typeof GRANTABLE_ROLES)[number];

export function toGrantableRole(value: string | null | undefined): GrantableRole | null {
  return GRANTABLE_ROLES.find((role) => role === value) ?? null;
}

export function ProjectRolePicker({
  value,
  label,
  disabled = false,
  onChange,
}: Readonly<{
  value: GrantableRole;
  label: string;
  disabled?: boolean;
  onChange: (role: GrantableRole) => void;
}>) {
  const { t } = useTranslation(["collab"]);
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        const role = toGrantableRole(next);
        if (role) onChange(role);
      }}
    >
      <SelectTrigger aria-label={label} className="h-8 w-[7.5rem] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="z-[130]">
        {GRANTABLE_ROLES.map((role) => (
          <SelectItem key={role} value={role}>
            {t(($) => $.collab.projectRoles[role])}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
