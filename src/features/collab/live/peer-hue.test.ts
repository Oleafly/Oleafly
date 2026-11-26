import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { avatarHue } from "@/components/ui/avatar";
import {
  hueAwayFrom,
  OVERLEAF_ANONYMOUS_HUE,
  OVERLEAF_OWN_HUE,
  OWN_HUE_BAND,
  overleafHue,
  peerHue,
} from "./peer-hue";

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

const SELF = "65a0c3e1f2b4d5c6a7b8c9d0";

const RECORDED_HUES = new URL(
  "../../../../crates/oleafly-online/tests/fixtures/overleaf-rt/probes/online-user-hues.json",
  import.meta.url,
);

type RecordedHueStep = {
  viewerId: string;
  circles: { userId: string | null; hue: number | null }[];
  cursors: { userId: string | null; hue: string }[];
};

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

describe("overleafHue", () => {
  it("gives the hues Overleaf's own editor shows for these user ids", () => {
    expect(overleafHue("5f9a1b2c3d4e5f6a7b8c9d0e", SELF)).toBe(89);
    expect(overleafHue("000000000000000000000001", SELF)).toBe(351);
    expect(overleafHue("64b7f0c2a1e3d4b5c6a7e8f9", SELF)).toBe(325);
  });

  it("gives every hue Overleaf's editor showed each viewer in the recorded session", () => {
    const steps: RecordedHueStep[] = JSON.parse(readFileSync(RECORDED_HUES, "utf8")).steps;
    const wrong: string[] = [];
    let compared = 0;
    for (const step of steps) {
      const shown = [...step.circles, ...step.cursors.map((cursor) => ({ userId: cursor.userId, hue: Number(cursor.hue) }))];
      for (const { userId, hue } of shown) {
        compared += 1;
        if (userId === null || overleafHue(userId, step.viewerId) !== hue) wrong.push(`${step.viewerId} sees ${userId} as ${hue}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(compared).toBe(12);
  });

  it("moves a hue strictly inside the band around 200 to the end of the wheel", () => {
    expect(overleafHue("0000000000000000000001cb", SELF)).toBe(180);
    expect(overleafHue("0000000000000000000000a6", SELF)).toBe(321);
    expect(overleafHue("000000000000000000000114", SELF)).toBe(359);
    expect(overleafHue("00000000000000000000006f", SELF)).toBe(220);
  });

  it("keeps every other person out of 180 to 220 and inside the wheel", () => {
    const wrong: string[] = [];
    for (let index = 0; index < 5_000; index += 1) {
      const id = randomBytes(12).toString("hex");
      const hue = overleafHue(id, null);
      if (!Number.isInteger(hue) || hue < 0 || hue >= 360 || (hue > 180 && hue < 220)) wrong.push(`${id}=${hue}`);
    }
    expect(wrong).toEqual([]);
  });

  it("shows you as 200 and anyone without a user id as 100", () => {
    expect(overleafHue(SELF, SELF)).toBe(OVERLEAF_OWN_HUE);
    expect(OVERLEAF_OWN_HUE).toBe(200);
    expect(OVERLEAF_ANONYMOUS_HUE).toBe(100);
    expect(overleafHue("", SELF)).toBe(100);
    expect(overleafHue("anonymous-user", SELF)).toBe(100);
    expect(overleafHue("unknown", SELF)).toBe(100);
    expect(overleafHue("", "")).toBe(100);
  });

  it("colours you like anyone else when it doesn't know who you are", () => {
    expect(overleafHue(SELF, null)).toBe(26);
  });
});

describe("peerHue", () => {
  it("keeps the avatar hue when there is no viewer or the peer is the viewer", () => {
    expect(peerHue("bob", null, "server")).toBe(avatarHue("bob"));
    expect(peerHue("alice", "alice", "server")).toBe(avatarHue("alice"));
    expect(peerHue("bob", null, null)).toBe(avatarHue("bob"));
  });

  it("gives a colliding person the same moved hue every time", () => {
    const peer = collidingAccount("alice");
    const hue = peerHue(peer, "alice", "server");
    expect(hue).not.toBe(avatarHue(peer));
    expect(distance(hue, avatarHue("alice"))).toBeGreaterThanOrEqual(OWN_HUE_BAND);
    expect(peerHue(peer, "alice", "server")).toBe(hue);
    expect(peerHue(peer, "alice", null)).toBe(hue);
  });

  it("uses Overleaf's colours on an Overleaf project", () => {
    expect(peerHue("5f9a1b2c3d4e5f6a7b8c9d0e", SELF, "overleaf")).toBe(89);
    expect(peerHue(SELF, SELF, "overleaf")).toBe(200);
    expect(peerHue("", SELF, "overleaf")).toBe(100);
  });
});
