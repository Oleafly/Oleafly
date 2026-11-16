// @vitest-environment jsdom
import { render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./live-editing", () => ({ startLiveEditing: vi.fn(() => () => undefined) }));

import { useCollabLiveProject } from "@/lib/collab-live-bridge";
import { viewsOnlyOn } from "../roles";
import { useLiveTree } from "../sharing/tree-version";
import { useCollabLiveStore } from "./live-store";
import { startLiveTarget } from "./note-slot";
import { CollabBanners } from "./SyncPauseBanner";

const SESSION = { projectId: "p1", role: "editor" as const, accountId: "alice", deviceId: "laptop" };

afterEach(() => {
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

  it("keeps project notes off the Overleaf session", () => {
    useCollabLiveStore.setState({ projectId: "p1", backend: "overleaf" });
    const stop = startLiveTarget(SESSION);
    expect(useCollabLiveProject.getState().session).toBeNull();
    stop();
    useCollabLiveStore.setState({ backend: "server" });
    const stopServer = startLiveTarget(SESSION);
    expect(useCollabLiveProject.getState().session).toEqual(SESSION);
    stopServer();
  });
});

describe("editor gates on Overleaf", () => {
  it.each([
    ["owner", false, false],
    ["editor", false, false],
    ["reviewer", true, false],
    ["viewer", true, true],
    ["commenter", true, true],
  ] as const)("a %s is read-only on Overleaf: %s, on a server: %s", (role, overleaf, server) => {
    expect(viewsOnlyOn("overleaf", role)).toBe(overleaf);
    expect(viewsOnlyOn("server", role)).toBe(server);
  });
});
