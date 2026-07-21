import { describe, expect, it, vi } from "vitest";
import { ModalCoordinator, modalCoordinator as templateModalCoordinator } from "@oleafly/templates/modal-coordinator";
import { appModalCoordinator } from "./use-modal-accessibility";

const element = (connected: boolean) => ({
  isConnected: connected,
  focus: vi.fn(),
}) as unknown as HTMLElement;

describe("cross-package modal coordination", () => {
  it("shares one coordinator across the app and templates boundary", () => {
    expect(appModalCoordinator).toBe(templateModalCoordinator);
  });

  it("gives keyboard and backdrop ownership to the top mounted modal", () => {
    const coordinator = new ModalCoordinator();
    const appModal = coordinator.add(element(true));
    const templateModal = coordinator.add(element(true));
    expect(coordinator.isTop(appModal)).toBe(false);
    expect(coordinator.isTop(templateModal)).toBe(true);
    expect(coordinator.remove(templateModal)).not.toBeNull();
    expect(coordinator.isTop(appModal)).toBe(true);
  });

  it("does not restore focus when a covered modal unmounts", () => {
    const coordinator = new ModalCoordinator();
    const rootOpener = element(true);
    const coveredOpener = element(false);
    const appModal = coordinator.add(rootOpener);
    const templateModal = coordinator.add(coveredOpener);
    expect(coordinator.remove(appModal)).toBeNull();
    expect(coordinator.remove(templateModal)).toBe(rootOpener);
  });

  it("exposes the active logical overlay", () => {
    const overlay = element(true);
    const id = appModalCoordinator.add(null, overlay);
    expect(appModalCoordinator.topOverlay()).toBe(overlay);
    appModalCoordinator.remove(id);
  });
});
