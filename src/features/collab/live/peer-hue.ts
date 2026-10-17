import { avatarHue } from "@/components/ui/avatar";

export const OWN_HUE_BAND = 30;

export function hueAwayFrom(hue: number, own: number): number {
  const offset = ((((hue - own) % 360) + 540) % 360) - 180;
  if (Math.abs(offset) >= OWN_HUE_BAND) return hue;
  const moved = own + offset + (offset >= 0 ? OWN_HUE_BAND : -OWN_HUE_BAND);
  return ((moved % 360) + 360) % 360;
}

export function peerHue(accountId: string, ownAccountId: string | null): number {
  const hue = avatarHue(accountId);
  if (ownAccountId === null || ownAccountId === accountId) return hue;
  return hueAwayFrom(hue, avatarHue(ownAccountId));
}
