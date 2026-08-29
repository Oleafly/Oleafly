// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prefersReducedMotion, useReducedMotion } from "./use-reduced-motion";

type Listener = (event: { matches: boolean }) => void;

function installMatchMedia(initialReduced: boolean) {
  let reduced = initialReduced;
  const listeners = new Set<Listener>();
  window.matchMedia = vi.fn((query: string) => ({
    get matches() {
      return query.includes("prefers-reduced-motion") ? reduced : false;
    },
    media: query,
    addEventListener: (_type: string, listener: Listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: Listener) => {
      listeners.delete(listener);
    },
  })) as unknown as typeof window.matchMedia;
  return {
    setReduced(next: boolean) {
      reduced = next;
      for (const listener of listeners) listener({ matches: next });
    },
  };
}

function Probe() {
  return <p>{useReducedMotion() ? "reduced" : "full"}</p>;
}

describe("reduced motion", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports the current OS setting synchronously", () => {
    installMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    render(<Probe />);
    expect(screen.getByText("reduced")).toBeInTheDocument();
  });

  it("tracks live changes to the OS setting", () => {
    const media = installMatchMedia(false);
    render(<Probe />);
    expect(screen.getByText("full")).toBeInTheDocument();

    act(() => media.setReduced(true));

    expect(screen.getByText("reduced")).toBeInTheDocument();
  });
});
