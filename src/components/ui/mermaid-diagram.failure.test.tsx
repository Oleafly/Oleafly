// @vitest-environment jsdom

import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/lib/theme";
import { Markdown } from "./markdown";
import { clearDiagramCache } from "./mermaid-diagram";
import {
  installIntersectionObserverStub,
  type IntersectionObserverStub,
} from "./test-intersection-observer";

const mermaidRender = vi.hoisted(() => vi.fn());

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: mermaidRender,
  },
}));

describe("Mermaid render failures", () => {
  let intersection: IntersectionObserverStub | null = null;

  beforeEach(() => {
    clearDiagramCache();
    mermaidRender.mockReset();
    mermaidRender.mockRejectedValue(new Error("parse error"));
    window.localStorage.setItem("oleafly.theme", "dark");
  });

  afterEach(() => {
    intersection?.restore();
    intersection = null;
  });

  it("does not retry a failed diagram when it scrolls out of view and back", async () => {
    intersection = installIntersectionObserverStub(() => true);
    render(
      <ThemeProvider>
        <Markdown>{"```mermaid\nflowchart TD\n  A --> B\n```"}</Markdown>
      </ThemeProvider>,
    );
    await waitFor(() => expect(mermaidRender).toHaveBeenCalledTimes(1));

    act(() => intersection?.setVisible(() => false));
    act(() => intersection?.setVisible(() => true));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect(mermaidRender).toHaveBeenCalledTimes(1);
  });
});
