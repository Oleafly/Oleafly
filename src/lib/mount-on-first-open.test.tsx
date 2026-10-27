// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { lazy, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { mountOnFirstOpen } from "./mount-on-first-open";

const useSurfaceStore = create<{ open: boolean }>(() => ({ open: false }));

afterEach(() => {
  useSurfaceStore.setState({ open: false });
});

function gatedSurface(onMount: () => void) {
  function Surface() {
    const open = useSurfaceStore((state) => state.open);
    useEffect(onMount, []);
    return <p>{open ? "open" : "closed"}</p>;
  }
  const load = vi.fn(async () => ({ default: Surface }));
  const Gated = mountOnFirstOpen(lazy(load), () => useSurfaceStore((state) => state.open));
  return { Gated, load };
}

describe("mountOnFirstOpen", () => {
  it("does not load the surface before it first opens", () => {
    const { Gated, load } = gatedSurface(() => {});

    const { container } = render(<Gated />);

    expect(load).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it("mounts the surface when it opens and keeps it mounted once closed", async () => {
    const onMount = vi.fn();
    const { Gated, load } = gatedSurface(onMount);
    render(<Gated />);

    act(() => useSurfaceStore.setState({ open: true }));
    expect(await screen.findByText("open")).toBeInTheDocument();

    act(() => useSurfaceStore.setState({ open: false }));
    expect(screen.getByText("closed")).toBeInTheDocument();

    act(() => useSurfaceStore.setState({ open: true }));
    expect(screen.getByText("open")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it("mounts at once when it is already open on first render", async () => {
    useSurfaceStore.setState({ open: true });
    const { Gated } = gatedSurface(() => {});

    render(<Gated />);

    expect(await screen.findByText("open")).toBeInTheDocument();
  });
});
