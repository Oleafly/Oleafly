// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useCollabEditorGate } from "@/lib/collab-live-bridge";
import { useFilesStore } from "@/store/files";
import { activeFileReadOnly, useActiveFileReadOnly } from "./read-only-files";

beforeEach(() => {
  useFilesStore.setState({ projectId: "paper", activePath: "main.tex", manifestHome: "library", tree: [] });
});

afterEach(() => {
  useCollabEditorGate.setState({ projectId: null, viewer: false });
});

describe("read-only files", () => {
  it("leaves an ordinary file editable", () => {
    expect(activeFileReadOnly()).toBe(false);
    expect(renderHook(() => useActiveFileReadOnly()).result.current).toBe(false);
  });

  it("makes every file read-only for a viewer of the live shared project", () => {
    const { result } = renderHook(() => useActiveFileReadOnly());
    act(() => useCollabEditorGate.setState({ projectId: "paper", viewer: true }));
    expect(activeFileReadOnly()).toBe(true);
    expect(result.current).toBe(true);
    act(() => useCollabEditorGate.setState({ projectId: "paper", viewer: false }));
    expect(activeFileReadOnly()).toBe(false);
    expect(result.current).toBe(false);
  });

  it("ignores a viewer role that belongs to another project", () => {
    useCollabEditorGate.setState({ projectId: "other", viewer: true });
    expect(activeFileReadOnly()).toBe(false);
    expect(renderHook(() => useActiveFileReadOnly()).result.current).toBe(false);
  });
});
