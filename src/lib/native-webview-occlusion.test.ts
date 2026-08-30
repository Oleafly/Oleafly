import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireNativeWebviewOcclusion,
  getNativeWebviewOccluded,
  subscribeToNativeWebviewOcclusion,
} from "@/lib/native-webview-occlusion";

describe("native webview occlusion", () => {
  beforeEach(() => {
    expect(getNativeWebviewOccluded()).toBe(false);
  });

  it("stays active until every overlapping layer has closed", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToNativeWebviewOcclusion(listener);

    const releaseModal = acquireNativeWebviewOcclusion();
    const releaseMenu = acquireNativeWebviewOcclusion();

    expect(getNativeWebviewOccluded()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    releaseMenu();
    expect(getNativeWebviewOccluded()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    releaseModal();
    expect(getNativeWebviewOccluded()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);

    releaseModal();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
