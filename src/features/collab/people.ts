import type { AvatarPerson } from "@/components/ui/avatar";
import type { CollabAccount, CollabPerson } from "@/lib/tauri";

export function accountPerson(account: CollabAccount): AvatarPerson {
  return { id: account.account_id, name: account.display_name, imageUrl: account.avatar_url };
}

export function accountDetail(account: CollabAccount): string {
  return account.emails[0] ?? account.logins[0] ?? "";
}

export function collabPerson(person: CollabPerson): AvatarPerson {
  return { id: person.account_id, name: person.display_name, imageUrl: person.avatar_url };
}

export function personDetail(person: CollabPerson): string {
  return person.email ?? person.login ?? "";
}
