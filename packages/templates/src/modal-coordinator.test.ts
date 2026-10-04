// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { ModalCoordinator, modalCoordinator, visibleFocusable } from "./modal-coordinator";

function button(parent: HTMLElement = document.body): HTMLButtonElement {
  const element = document.createElement("button");
  parent.appendChild(element);
  return element;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ModalCoordinator", () => {
  it("tracks which modal is on top as modals open and close", () => {
    const coordinator = new ModalCoordinator();
    const first = coordinator.add(null);
    const second = coordinator.add(null);

    expect(coordinator.size()).toBe(2);
    expect(coordinator.isTop(second)).toBe(true);
    expect(coordinator.isTop(first)).toBe(false);

    coordinator.remove(second);
    expect(coordinator.size()).toBe(1);
    expect(coordinator.isTop(first)).toBe(true);
  });

  it("returns the opener to refocus when the top modal closes", () => {
    const coordinator = new ModalCoordinator();
    const opener = button();
    const id = coordinator.add(opener);

    expect(coordinator.remove(id)).toBe(opener);
    expect(coordinator.size()).toBe(0);
  });

  it("does not refocus an opener that has left the document", () => {
    const coordinator = new ModalCoordinator();
    const opener = button();
    const id = coordinator.add(opener);
    opener.remove();

    expect(coordinator.remove(id)).toBeNull();
  });

  it("hands a lower modal's opener to the modal above it when the lower one closes first", () => {
    const coordinator = new ModalCoordinator();
    const outerOpener = button();
    const innerOpener = button();
    const outer = coordinator.add(outerOpener);
    const inner = coordinator.add(innerOpener);

    expect(coordinator.remove(outer)).toBeNull();
    innerOpener.remove();

    expect(coordinator.remove(inner)).toBe(outerOpener);
  });

  it("ignores ids it never registered or already removed", () => {
    const coordinator = new ModalCoordinator();
    const id = coordinator.add(button());
    coordinator.remove(id);

    expect(coordinator.remove(id)).toBeNull();
    expect(coordinator.remove(Symbol("stranger"))).toBeNull();
    expect(coordinator.isTop(id)).toBe(false);
  });

  it("reports the logical overlay of the topmost modal only", () => {
    const coordinator = new ModalCoordinator();
    const overlay = document.createElement("div");

    expect(coordinator.topOverlay()).toBeNull();
    const withOverlay = coordinator.add(null, overlay);
    expect(coordinator.topOverlay()).toBe(overlay);

    const plain = coordinator.add(null);
    expect(coordinator.topOverlay()).toBeNull();

    coordinator.remove(plain);
    coordinator.remove(withOverlay);
    expect(coordinator.topOverlay()).toBeNull();
  });

  it("is shared through a global so separate bundles agree on the stack", () => {
    const key = Symbol.for("oleafly.modal-coordinator");
    expect((globalThis as Record<symbol, unknown>)[key]).toBe(modalCoordinator);
  });
});

describe("visibleFocusable", () => {
  it("keeps visible controls in their original order", () => {
    const first = button();
    const second = button();

    expect(visibleFocusable([first, second])).toEqual([first, second]);
  });

  it("drops controls under a hidden or aria-hidden ancestor", () => {
    const hiddenParent = document.createElement("div");
    hiddenParent.hidden = true;
    const ariaHiddenParent = document.createElement("div");
    ariaHiddenParent.setAttribute("aria-hidden", "true");
    document.body.append(hiddenParent, ariaHiddenParent);
    const visible = button();

    expect(visibleFocusable([button(hiddenParent), button(ariaHiddenParent), visible])).toEqual([visible]);
  });

  it("drops controls whose ancestor is styled invisible", () => {
    const invisible = document.createElement("div");
    invisible.style.visibility = "hidden";
    document.body.appendChild(invisible);
    const self = button();
    self.style.display = "none";

    expect(visibleFocusable([button(invisible), self])).toEqual([]);
  });
});
