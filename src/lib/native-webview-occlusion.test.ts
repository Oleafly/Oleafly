import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireNativeWebviewOcclusion,
  getNativeWebviewOccluded,
  nativeWebviewOccludedBy,
  subscribeToNativeWebviewOcclusion,
} from "@/lib/native-webview-occlusion";

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

describe("native webview occlusion", () => {
  beforeEach(() => {
    expect(getNativeWebviewOccluded()).toBe(false);
  });

  it("notifies on every occluder change so geometry can be re-evaluated", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToNativeWebviewOcclusion(listener);

    const releaseModal = acquireNativeWebviewOcclusion();
    const releaseMenu = acquireNativeWebviewOcclusion();
    expect(getNativeWebviewOccluded()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);

    releaseMenu();
    expect(getNativeWebviewOccluded()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(3);

    releaseModal();
    expect(getNativeWebviewOccluded()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(4);

    // A double release is a no-op and does not notify again.
    releaseModal();
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
  });

  it("occludes a target only when an occluder actually overlaps it", () => {
    const target = rect(1000, 0, 400, 800); // browser docked on the right
    const release = acquireNativeWebviewOcclusion(() => rect(0, 0, 120, 40)); // top-left tooltip
    expect(nativeWebviewOccludedBy(target)).toBe(false);
    release();
  });

  it("occludes when an occluder's rect intersects the target", () => {
    const target = rect(1000, 0, 400, 800);
    const release = acquireNativeWebviewOcclusion(() => rect(900, 100, 300, 200));
    expect(nativeWebviewOccludedBy(target)).toBe(true);
    release();
  });

  it("treats an occluder with no known rect as a full-screen overlap", () => {
    const target = rect(1000, 0, 400, 800);
    const release = acquireNativeWebviewOcclusion(); // e.g. a modal backdrop
    expect(nativeWebviewOccludedBy(target)).toBe(true);
    release();
  });

  it("is never occluded when nothing is registered", () => {
    expect(nativeWebviewOccludedBy(rect(0, 0, 100, 100))).toBe(false);
    expect(nativeWebviewOccludedBy(null)).toBe(false);
  });
});
