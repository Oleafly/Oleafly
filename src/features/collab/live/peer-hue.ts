import { Md5 } from "ts-md5";
import { avatarHue } from "@/components/ui/avatar";

export type PeerHueBackend = "server" | "overleaf" | null;

export const OWN_HUE_BAND = 30;
export const OVERLEAF_ANONYMOUS_HUE = 100;
export const OVERLEAF_OWN_HUE = 200;

const OVERLEAF_OWN_BAND = 20;
const OVERLEAF_USER_ID = /^[0-9a-f]{24}$/iu;

export function hueAwayFrom(hue: number, own: number): number {
  const offset = ((((hue - own) % 360) + 540) % 360) - 180;
  if (Math.abs(offset) >= OWN_HUE_BAND) return hue;
  const moved = own + offset + (offset >= 0 ? OWN_HUE_BAND : -OWN_HUE_BAND);
  return ((moved % 360) + 360) % 360;
}

export function overleafHue(userId: string, self: string | null): number {
  if (!OVERLEAF_USER_ID.test(userId)) return OVERLEAF_ANONYMOUS_HUE;
  if (userId === self) return OVERLEAF_OWN_HUE;
  const hue = Number.parseInt(Md5.hashStr(userId).slice(0, 8), 16) % (360 - 2 * OVERLEAF_OWN_BAND);
  const near = hue > OVERLEAF_OWN_HUE - OVERLEAF_OWN_BAND && hue < OVERLEAF_OWN_HUE + OVERLEAF_OWN_BAND;
  return near ? hue - OVERLEAF_OWN_HUE + 360 - OVERLEAF_OWN_BAND : hue;
}

export function peerHue(accountId: string, ownAccountId: string | null, backend: PeerHueBackend): number {
  if (backend === "overleaf") return overleafHue(accountId, ownAccountId);
  const hue = avatarHue(accountId);
  if (ownAccountId === null || ownAccountId === accountId) return hue;
  return hueAwayFrom(hue, avatarHue(ownAccountId));
}
