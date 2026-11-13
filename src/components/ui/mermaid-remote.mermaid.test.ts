// @vitest-environment jsdom

import mermaid from "mermaid";
import { describe, expect, it } from "vitest";
import { MERMAID_LABEL_PURIFY, MERMAID_SECURE_KEYS } from "./mermaid-remote";

describe("the mermaid settings", () => {
  it("survive mermaid's config copies and can't be changed from inside a diagram", async () => {
    mermaid.initialize({
      dompurifyConfig: MERMAID_LABEL_PURIFY,
      secure: MERMAID_SECURE_KEYS,
      securityLevel: "strict",
      startOnLoad: false,
    });
    await mermaid.parse(
      '%%{init: {"securityLevel": "loose", "dompurifyConfig": {"FORBID_ATTR": [], "ADD_TAGS": ["style"]}}}%%\nflowchart LR\n  A --> B',
    );
    const config = mermaid.mermaidAPI.getConfig();
    expect(config.securityLevel).toBe("strict");
    expect(config.dompurifyConfig?.FORBID_ATTR).toEqual(MERMAID_LABEL_PURIFY.FORBID_ATTR);
    expect(config.dompurifyConfig?.FORBID_TAGS).toEqual(["style"]);
    expect(config.dompurifyConfig).not.toHaveProperty("ADD_TAGS");
  });
});
