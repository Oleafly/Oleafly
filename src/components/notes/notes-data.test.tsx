// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotesDataProvider, useNotesData } from "./notes-data";
import { fakeNotesData } from "./tests/notes-data-fixture";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useNotesData", () => {
  it("throws when no provider supplies notes data", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(() => useNotesData())).toThrow("useNotesData needs a NotesDataProvider");
  });

  it("returns the data the provider supplies", () => {
    const data = fakeNotesData();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NotesDataProvider value={data}>{children}</NotesDataProvider>
    );
    const { result } = renderHook(() => useNotesData(), { wrapper });
    expect(result.current).toBe(data);
  });
});
