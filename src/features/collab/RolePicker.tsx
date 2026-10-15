import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { assignableRoles, toServerRole, type ServerRole } from "./roles";

export function RolePicker({
  actor,
  value,
  label,
  roles,
  disabled = false,
  onChange,
}: Readonly<{
  actor: ServerRole;
  value: ServerRole;
  label: string;
  roles?: readonly ServerRole[];
  disabled?: boolean;
  onChange: (role: ServerRole) => void;
}>) {
  const { t } = useTranslation(["collab"]);
  const options = roles ?? assignableRoles(actor);
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        const role = toServerRole(next);
        if (role) onChange(role);
      }}
    >
      <SelectTrigger aria-label={label} className="h-8 w-[8.5rem] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="z-[100]">
        {options.map((role) => (
          <SelectItem key={role} value={role}>
            {t(($) => $.collab.roles[role])}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
