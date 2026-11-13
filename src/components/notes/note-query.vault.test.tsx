// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { NotesDataProvider } from "./notes-data";
import { useVaultQuery } from "./note-query";
import { fakeNotesData } from "./tests/notes-data-fixture";
import "./tests/setup";

const data = fakeNotesData();

function vault(source: string) {
  const wrapper = ({ children }: { children: ReactNode }) => <NotesDataProvider value={data}>{children}</NotesDataProvider>;
  return renderHook(() => useVaultQuery(source, null), { wrapper }).result.current;
}

describe("useVaultQuery", () => {
  it("tells the search box when the query had more combinations than it searches", () => {
    const wide = "(a OR b OR c OR d OR e OR f) (g OR h OR i OR j OR k OR l)";
    expect(vault(wide).query.diagnostics).toContainEqual({ code: "too-many-branches", span: { start: wide.length, end: wide.length } });
    expect(vault("a OR b").query.diagnostics).toEqual([]);
  });
});
