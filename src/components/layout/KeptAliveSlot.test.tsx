// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { KeptAliveSlot, useKeptAliveHost } from "./KeptAliveSlot";

const KEPT_TEXT = "Kept content";
const lifecycle = { mounts: 0, unmounts: 0 };

function Kept() {
  useEffect(() => {
    lifecycle.mounts++;
    return () => {
      lifecycle.unmounts++;
    };
  }, []);
  return (
    <div data-testid="kept-scroller" data-pdf-scroll-root>
      <p>{KEPT_TEXT}</p>
    </div>
  );
}

function Harness({ shown }: { shown: boolean }) {
  const host = useKeptAliveHost("h-full");
  return (
    <>
      {shown && <KeptAliveSlot host={host} className="h-full" />}
      {createPortal(<Kept />, host)}
    </>
  );
}

beforeEach(() => {
  lifecycle.mounts = 0;
  lifecycle.unmounts = 0;
});

describe("KeptAliveSlot", () => {
  it("keeps its content out of the page until a slot shows it", () => {
    render(<Harness shown={false} />);
    expect(screen.queryByText(KEPT_TEXT)).toBeNull();
    expect(lifecycle.mounts).toBe(1);
  });

  it("moves the kept content in and out of the page without remounting it", () => {
    const view = render(<Harness shown />);
    expect(screen.getByText(KEPT_TEXT)).toBeInTheDocument();

    view.rerender(<Harness shown={false} />);
    expect(screen.queryByText(KEPT_TEXT)).toBeNull();

    view.rerender(<Harness shown />);
    expect(screen.getByText(KEPT_TEXT)).toBeInTheDocument();
    expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 });
  });

  it("brings back the scroll position the browser drops while the content is out of the page", () => {
    const view = render(<Harness shown />);
    const scroller = screen.getByTestId("kept-scroller");
    scroller.scrollTop = 1_234;
    scroller.scrollLeft = 56;

    view.rerender(<Harness shown={false} />);
    scroller.scrollTop = 0;
    scroller.scrollLeft = 0;
    view.rerender(<Harness shown />);

    expect(scroller.scrollTop).toBe(1_234);
    expect(scroller.scrollLeft).toBe(56);
  });

  it("places the content inside the slot's element", () => {
    render(<Harness shown />);
    const host = screen.getByTestId("kept-scroller").parentElement as HTMLElement;
    expect(host).toHaveClass("h-full");
    expect(host.parentElement).toHaveClass("h-full");
  });
});
