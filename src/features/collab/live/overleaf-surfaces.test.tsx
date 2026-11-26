// @vitest-environment jsdom
import { cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useLiveTree } from "../sharing/tree-version";
import { useCollabLiveStore } from "./live-store";
import { CollabBanners } from "./SyncPauseBanner";

afterEach(() => {
  cleanup();
  useCollabLiveStore.setState({ projectId: null, backend: null, status: null, share: null, projectFull: false });
});

describe("Oleafly Server surfaces stay out of an Overleaf project", () => {
  it("mounts none of the server's banners", () => {
    useCollabLiveStore.setState({ projectId: "p1", backend: "overleaf", status: { state: "online" }, projectFull: true });
    const { container } = render(<CollabBanners />);
    expect(container.innerHTML).toBe("");
  });

  it("asks the server for no trash or tree clashes", () => {
    useCollabLiveStore.setState({ projectId: "p1", backend: "overleaf", status: { state: "online" } });
    expect(renderHook(() => useLiveTree()).result.current).toBeNull();
    useCollabLiveStore.setState({ backend: "server" });
    expect(renderHook(() => useLiveTree()).result.current).toEqual({ projectId: "p1", version: 0 });
  });
});

