// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import {
  NATIVE_SCROLLBAR_HIDDEN_CLASS,
  OVERLAY_SCROLLBAR_ATTRIBUTE,
} from "@oleafly/editor/overlay-scrollbar";
import { useOverlayScrollbar } from "./use-overlay-scrollbar";

function Panel({ loading }: Readonly<{ loading: boolean }>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useOverlayScrollbar(scrollRef);
  if (loading) return <div data-testid="loading" />;
  return (
    <div data-testid="host" className="relative">
      <div ref={scrollRef} data-testid="scroller" style={{ overflowY: "auto" }}>
        <div data-testid="content" />
      </div>
    </div>
  );
}

describe("useOverlayScrollbar", () => {
  it("attaches once the scroller mounts after a loading state and detaches on unmount", () => {
    const view = render(<Panel loading />);
    expect(document.querySelector(`[${OVERLAY_SCROLLBAR_ATTRIBUTE}]`)).toBeNull();

    view.rerender(<Panel loading={false} />);
    const host = view.getByTestId("host");
    expect(host.querySelectorAll(`[${OVERLAY_SCROLLBAR_ATTRIBUTE}="y"]`)).toHaveLength(1);
    expect(view.getByTestId("scroller").classList.contains(NATIVE_SCROLLBAR_HIDDEN_CLASS)).toBe(true);

    view.rerender(<Panel loading={false} />);
    expect(host.querySelectorAll(`[${OVERLAY_SCROLLBAR_ATTRIBUTE}="y"]`)).toHaveLength(1);

    view.unmount();
    expect(document.querySelector(`[${OVERLAY_SCROLLBAR_ATTRIBUTE}]`)).toBeNull();
  });

  it("moves to a new scroller element when the old one is replaced", () => {
    const view = render(<Panel loading={false} />);
    view.rerender(<Panel loading />);
    expect(document.querySelector(`[${OVERLAY_SCROLLBAR_ATTRIBUTE}]`)).toBeNull();
    view.rerender(<Panel loading={false} />);
    expect(document.querySelectorAll(`[${OVERLAY_SCROLLBAR_ATTRIBUTE}="y"]`)).toHaveLength(1);
  });
});
