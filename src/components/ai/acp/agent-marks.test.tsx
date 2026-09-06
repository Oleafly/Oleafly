// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentLogo } from "./AgentLogo";
import { AGENT_MARKS, AGENT_MARK_IDS } from "./agent-marks";

describe("agent marks", () => {
  it("covers every agent in the roster with a labelled, self-scaling mark", () => {
    expect(AGENT_MARK_IDS).toEqual(
      expect.arrayContaining([
        "claude",
        "codex",
        "opencode",
        "gemini",
        "openclaw",
        "cline",
        "hermes",
        "codebuddy",
        "kimi",
        "pi",
        "grok",
        "cursor",
        "deepseek",
        "qoder",
        "antigravity",
      ]),
    );
    for (const id of AGENT_MARK_IDS) {
      const { container, unmount } = render(<AgentLogo agentId={id} size={20} />);
      const svg = container.querySelector("svg");
      expect(svg, id).not.toBeNull();
      expect(svg?.getAttribute("width")).toBe("20");
      expect(svg?.getAttribute("aria-label")?.length, id).toBeGreaterThan(1);
      unmount();
    }
  });

  it("keeps gradient ids unique so two marks on one page do not collide", () => {
    const { container } = render(
      <>
        <AgentLogo agentId="codex" size={16} />
        <AgentLogo agentId="codex" size={16} />
      </>,
    );
    const ids = [...container.querySelectorAll("linearGradient")].map((node) => node.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("falls back to a generic mark for an unknown agent", () => {
    const { container } = render(<AgentLogo agentId="not-a-real-agent" size={14} />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(AGENT_MARKS["not-a-real-agent"]).toBeUndefined();
  });

  it("uses the supplied title when one is given", () => {
    const { container } = render(<AgentLogo agentId="pi" size={18} title="Pi coding agent" />);
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe("Pi coding agent");
  });
});
