// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { useVisualModeStore } from "./visual-mode";

beforeEach(() => {
  localStorage.clear();
  useVisualModeStore.getState().loadProject(null);
});

it("restores Both and its arrangement per project without replacing the Visual preference", () => {
  const store = useVisualModeStore;
  store.getState().loadProject("first");
  store.getState().setEnabled(true);
  store.getState().setMarkdownSplit(true);
  store.getState().setMarkdownSplitLayout("stacked");
  store.getState().loadProject("second");
  expect(store.getState()).toMatchObject({ enabled: false, markdownSplit: false, markdownSplitLayout: "split" });

  store.getState().loadProject("first");
  expect(store.getState()).toMatchObject({ enabled: true, markdownSplit: true, markdownSplitLayout: "stacked" });
  store.getState().setMarkdownSplit(false);
  store.getState().loadProject(null);
  expect(store.getState()).toMatchObject({ enabled: false, markdownSplit: false, markdownSplitLayout: "split" });
  store.getState().loadProject("first");
  expect(store.getState()).toMatchObject({ enabled: true, markdownSplit: false, markdownSplitLayout: "stacked" });
});
