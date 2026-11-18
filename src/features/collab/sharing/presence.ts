import type { PeerMark } from "@/components/collab/CollabSlots";
import type { AvatarPerson } from "@/components/ui/avatar";
import type { CollabProjectMember, CollabProjectRole } from "@/lib/tauri";
import type { PeerPlace, PeerPlaces } from "../live/live-store";
import { collabPerson } from "../people";

export interface PresentPerson {
  accountId: string;
  person: AvatarPerson;
  role: CollabProjectRole | null;
  path: string | null;
  guest: boolean;
}

function peerPerson(peer: PeerPlace, members: readonly CollabProjectMember[], unknownName: string) {
  const member = members.find((entry) => entry.person.account_id === peer.accountId) ?? null;
  const known = member?.person ?? peer.person;
  return {
    person: known ? collabPerson(known) : { id: peer.accountId, name: unknownName },
    role: member?.role ?? null,
    guest: member?.person.guest === true,
  };
}

function ownName(peer: PeerPlace, selfId: string | null, ownLabel: string | null): string | null | undefined {
  if (peer.accountId !== selfId) return undefined;
  return ownLabel;
}

export function presentPeople(
  peers: PeerPlaces,
  members: readonly CollabProjectMember[],
  selfId: string | null,
  unknownName: string,
  ownLabel: string | null = null,
): PresentPerson[] {
  const byAccount = new Map<string, PresentPerson>();
  for (const peer of Object.values(peers)) {
    const own = ownName(peer, selfId, ownLabel);
    if (own === null) continue;
    const existing = byAccount.get(peer.accountId);
    const { person, role, guest } = peerPerson(peer, members, unknownName);
    byAccount.set(peer.accountId, {
      accountId: peer.accountId,
      person: { ...person, name: own ?? person.name, hue: peer.hue },
      role,
      path: existing?.path ?? peer.path,
      guest,
    });
  }
  return [...byAccount.values()].sort((a, b) => a.person.name.localeCompare(b.person.name));
}

export function peerMarks(
  peers: PeerPlaces,
  members: readonly CollabProjectMember[],
  selfId: string | null,
  unknownName: string,
  label: (name: string) => string,
  ownLabel: string | null = null,
): Map<string, PeerMark[]> {
  const byPath = new Map<string, PeerMark[]>();
  for (const peer of Object.values(peers)) {
    const own = ownName(peer, selfId, ownLabel);
    if (!peer.path || own === null) continue;
    const marks = byPath.get(peer.path) ?? [];
    if (marks.some((mark) => mark.id === peer.accountId)) continue;
    const { person } = peerPerson(peer, members, unknownName);
    marks.push({ id: peer.accountId, hue: peer.hue, label: label(own ?? person.name) });
    byPath.set(peer.path, marks);
  }
  return byPath;
}
