import { describe, expect, it } from "vitest";
import { avatarHue } from "@/components/ui/avatar";
import { hueAwayFrom, OWN_HUE_BAND, peerHue } from "./peer-hue";

function distance(a: number, b: number): number {
  const gap = Math.abs(a - b) % 360;
  return Math.min(gap, 360 - gap);
}

function collidingAccount(own: string): string {
  for (let index = 0; index < 10_000; index += 1) {
    const candidate = `peer-${index}`;
    if (distance(avatarHue(candidate), avatarHue(own)) < OWN_HUE_BAND) return candidate;
  }
  throw new Error("no colliding account found");
}

describe("hueAwayFrom", () => {
  it("keeps a hue outside the band around the viewer's own hue", () => {
    expect(OWN_HUE_BAND).toBe(30);
    expect(hueAwayFrom(200, 100)).toBe(200);
    expect(hueAwayFrom(130, 100)).toBe(130);
    expect(hueAwayFrom(70, 100)).toBe(70);
  });

  it("moves a hue inside the band out on the side it already leans to", () => {
    expect(hueAwayFrom(110, 100)).toBe(140);
    expect(hueAwayFrom(90, 100)).toBe(60);
    expect(hueAwayFrom(100, 100)).toBe(130);
    expect(hueAwayFrom(129, 100)).toBe(159);
    expect(hueAwayFrom(71, 100)).toBe(41);
  });

  it("wraps around the colour wheel", () => {
    expect(hueAwayFrom(10, 350)).toBe(40);
    expect(hueAwayFrom(350, 10)).toBe(320);
    expect(hueAwayFrom(0, 345)).toBe(30);
  });

  it("never leaves a hue inside the band for any pair of hues", () => {
    const wrong: string[] = [];
    for (let own = 0; own < 360; own += 1) {
      for (let hue = 0; hue < 360; hue += 1) {
        const moved = hueAwayFrom(hue, own);
        if (moved < 0 || moved >= 360 || distance(moved, own) < OWN_HUE_BAND) wrong.push(`${hue}@${own}=${moved}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("peerHue", () => {
  it("keeps the avatar hue when there is no viewer or the peer is the viewer", () => {
    expect(peerHue("bob", null)).toBe(avatarHue("bob"));
    expect(peerHue("alice", "alice")).toBe(avatarHue("alice"));
  });

  it("gives a colliding person the same moved hue every time", () => {
    const peer = collidingAccount("alice");
    const hue = peerHue(peer, "alice");
    expect(hue).not.toBe(avatarHue(peer));
    expect(distance(hue, avatarHue("alice"))).toBeGreaterThanOrEqual(OWN_HUE_BAND);
    expect(peerHue(peer, "alice")).toBe(hue);
  });
});
