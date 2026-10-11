import type { AvatarPerson } from "@/components/ui/avatar";
import type { CollabAccount } from "@/lib/tauri";

export function accountPerson(account: CollabAccount): AvatarPerson {
  return { id: account.account_id, name: account.display_name, imageUrl: account.avatar_url };
}

export function accountDetail(account: CollabAccount): string {
  return account.emails[0] ?? account.logins[0] ?? "";
}
