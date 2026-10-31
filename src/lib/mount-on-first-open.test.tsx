// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { lazy, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { mountOnFirstOpen } from "./mount-on-first-open";

const toastError = vi.fn();
const appendAppLog = vi.fn(async (_detail: string) => {});

vi.mock("@/lib/toast", () => ({
  toast: { error: (message: string) => toastError(message) },
}));

vi.mock("@/lib/tauri", () => ({
  appendAppLog: (detail: string) => appendAppLog(detail),
}));

const useSurfaceStore = create<{ open: boolean }>(() => ({ open: false }));

afterEach(() => {
  useSurfaceStore.setState({ open: false });
  toastError.mockClear();
  appendAppLog.mockClear();
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

  it("closes a surface that crashes, logs it once, and opens it again", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let broken = true;
    function Surface() {
      if (broken) throw new Error("surface broke");
      return <p>{"working"}</p>;
    }
    const close = vi.fn(() => useSurfaceStore.setState({ open: false }));
    const Gated = mountOnFirstOpen(
      Surface,
      () => useSurfaceStore((state) => state.open),
      close,
    );
    render(
      <>
        <p>{"rest of the app"}</p>
        <Gated />
      </>,
    );

    act(() => useSurfaceStore.setState({ open: true }));

    expect(close).toHaveBeenCalledTimes(1);
    expect(useSurfaceStore.getState().open).toBe(false);
    expect(toastError).toHaveBeenCalledWith(enShell.errorBoundary.surfaceClosed);
    expect(appendAppLog).toHaveBeenCalledWith(expect.stringContaining("UI crash: Error: surface broke"));
    expect(screen.getByText("rest of the app")).toBeInTheDocument();

    broken = false;
    act(() => useSurfaceStore.setState({ open: true }));
    expect(await screen.findByText("working")).toBeInTheDocument();
    errors.mockRestore();
  });

  it("tries a surface that stays open again when its reset key changes", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const useRequests = create<{ requests: number }>(() => ({ requests: 1 }));
    let broken = true;
    function Surface() {
      if (broken) throw new Error("guide broke");
      return <p>{"guide"}</p>;
    }
    const close = vi.fn();
    const Gated = mountOnFirstOpen(Surface, () => true, close, {
      useResetKey: () => useRequests((state) => state.requests),
    });
    render(<Gated />);
    expect(close).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("guide")).toBeNull();

    broken = false;
    act(() => useRequests.setState({ requests: 2 }));

    expect(await screen.findByText("guide")).toBeInTheDocument();
    expect(close).toHaveBeenCalledTimes(1);
    errors.mockRestore();
  });

  it("does not mount on a reset key change before the surface first opens", () => {
    const useKey = create<{ key: string }>(() => ({ key: "a" }));
    const load = vi.fn(async () => ({ default: () => <p>{"surface"}</p> }));
    const Keyed = mountOnFirstOpen(
      lazy(load),
      () => useSurfaceStore((state) => state.open),
      undefined,
      { useResetKey: () => useKey((state) => state.key) },
    );
    const { container } = render(<Keyed />);

    act(() => useKey.setState({ key: "b" }));

    expect(load).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the caller's fallback for a crashed surface that has no close", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    function Surface(): never {
      throw new Error("runtime broke");
    }
    const Gated = mountOnFirstOpen(Surface, () => true, undefined, {
      fallback: <p>{"unavailable"}</p>,
    });

    render(<Gated />);

    expect(screen.getByText("unavailable")).toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
