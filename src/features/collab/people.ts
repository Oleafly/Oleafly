import type { AvatarPerson } from "@/components/ui/avatar";
import type { CollabAccount, CollabMemberStanding, CollabPerson, CollabProjectMember } from "@/lib/tauri";

export interface ListedPerson extends CollabPerson {
  standing?: CollabMemberStanding;
}

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

export function onRoster(member: Pick<CollabProjectMember, "standing">): boolean {
  return member.standing === undefined || member.standing === "member";
}

export function inPeople(member: Pick<CollabProjectMember, "standing">): boolean {
  return onRoster(member) || member.standing === "invited";
}

export function peopleById(members: readonly CollabProjectMember[]): ReadonlyMap<string, ListedPerson> {
  const people = new Map<string, ListedPerson>();
  for (const member of members) {
    const id = member.person.account_id;
    if (people.has(id) && !onRoster(member)) continue;
    people.set(id, onRoster(member) ? member.person : { ...member.person, standing: member.standing });
  }
  return people;
}
