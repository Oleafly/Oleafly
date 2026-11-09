// @vitest-environment node

import { describe, expect, it } from "vitest";
import { sourceLoadsRemoteContent } from "./mermaid-remote";

describe("sourceLoadsRemoteContent without a DOM", () => {
  it("still decodes numeric character references", () => {
    expect(sourceLoadsRemoteContent('flowchart LR\n  A["<img src=&#104;ttps://attacker.example/h.png>"]')).toBe(true);
    expect(sourceLoadsRemoteContent('flowchart LR\n  A["<img src=&#x68;ttps://attacker.example/h.png>"]')).toBe(true);
    expect(sourceLoadsRemoteContent('flowchart LR\n  A["Tom &amp; Jerry"] --> B')).toBe(false);
  });
});
