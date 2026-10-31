import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ForgeBrandIcon } from "@/components/settings/git-hosting/ForgeBrandIcon";
import { hostLabel } from "@/lib/forge";
import type { ForgeAccount } from "@/lib/tauri";
import { cn } from "@/lib/utils";

function optionLabel(account: ForgeAccount): string {
  return `${hostLabel(account.base)} · ${account.login}`;
}

function AccountLogo({ account }: Readonly<{ account: ForgeAccount }>) {
  return (
    <ForgeBrandIcon
      base={account.base}
      kind={account.kind}
      flavor={account.flavor}
      className="size-3.5 shrink-0"
    />
  );
}

export function ForgeAccountSelect({
  accounts,
  value,
  onValueChange,
  label,
  testId,
  className,
}: Readonly<{
  accounts: readonly ForgeAccount[];
  value: string;
  onValueChange: (base: string) => void;
  label: string;
  testId?: string;
  className?: string;
}>) {
  const current = accounts.find((account) => account.base === value);
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        className={cn("h-8 w-auto min-w-48 gap-2 text-xs", className)}
        data-testid={testId}
        aria-label={label}
      >
        <SelectValue>
          {current ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <AccountLogo account={current} />
              <span className="truncate">{optionLabel(current)}</span>
            </span>
          ) : null}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="z-[100]">
        {accounts.map((account) => (
          <SelectItem key={account.base} value={account.base} icon={<AccountLogo account={account} />}>
            {optionLabel(account)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
