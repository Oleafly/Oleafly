// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ disk: {} as Record<string, string> }));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  projectMutationGeneration: async () => 1,
  readFileContent: async (_id: string, path: string) => mocks.disk[path] ?? "",
  writeFileContent: async (_id: string, path: string, content: string) => {
    mocks.disk[path] = content;
    return { path, generation: 1 };
  },
  mcpSetActiveProject: async () => {},
}));

import { editorText, renderStoreEditor, typeAtEnd } from "@/components/editor/test-editor-host";
import { useFilesStore } from "@/store/files";
import { TypstBibliographyStylePicker } from "./TypstBibliographyStylePicker";

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: { configurable: true, value: () => false },
    releasePointerCapture: { configurable: true, value: () => {} },
    scrollIntoView: { configurable: true, value: () => {} },
  });
});

beforeEach(async () => {
  await useFilesStore.getState().closeProject();
});

it("shows the new style in the open editor and keeps it after the next keystroke", async () => {
  const source = '#bibliography("refs.bib", style: "apa")\n';
  mocks.disk = { "main.typ": source };
  useFilesStore.setState({
    projectId: "typst-project",
    mainDoc: "main.typ",
    activePath: "main.typ",
    tree: [{ path: "main.typ", is_dir: false }],
    files: { "main.typ": { content: source, dirty: false } },
    engine: {
      ...useFilesStore.getState().engine,
      id: "typst",
      typst_resolved: { version: "0.15.1", source: "bundled" },
    },
  });
  renderStoreEditor();
  await act(async () => {});
  render(<TypstBibliographyStylePicker snapshot={null} />);

  fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("option", { name: "nlm-citation-sequence" }));

  await waitFor(() => expect(mocks.disk["main.typ"]).toContain('style: "nlm-citation-sequence"'));
  expect(editorText()).toBe(useFilesStore.getState().files["main.typ"].content);
  act(() => typeAtEnd("\n"));
  expect(useFilesStore.getState().files["main.typ"].content).toContain('style: "nlm-citation-sequence"');
});
