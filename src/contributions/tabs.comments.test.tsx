// @vitest-environment jsdom

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { railSections, railTabLabel, registry, type AppContext } from "@oleafly/registry";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { useCommentsRail } from "@/components/collab/comments-rail";
import { useCollabRail } from "@/components/collab/collab-rail";
import { loadNamespace } from "@/i18n";
import { registerRailTabs } from "./tabs";

const ctx: AppContext = { projectId: "paper", projectKind: null, theme: "light" };

function shownIds(): string[] {
  return railSections(ctx)
    .flat()
    .map((tab) => tab.id);
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  registry.railTabs.length = 0;
  registerRailTabs();
});

afterEach(() => {
  registry.railTabs.length = 0;
  useCommentsRail.setState({ visible: false, unread: false });
  useCollabRail.setState({ visible: false, unread: false });
});

describe("Comments rail tab", () => {
  it("stays hidden until comments are allowed for the open shared project", () => {
    useCollabRail.setState({ visible: true });
    expect(shownIds()).not.toContain("comments");
    useCommentsRail.setState({ visible: true });
    expect(shownIds()).toContain("comments");
  });

  it("sits right after Live collaboration and names unseen activity", () => {
    useCollabRail.setState({ visible: true });
    useCommentsRail.setState({ visible: true });
    const ids = shownIds();
    expect(ids.indexOf("comments")).toBe(ids.indexOf("collab") + 1);
    const tab = registry.railTabs.find((entry) => entry.id === "comments");
    if (!tab) throw new Error("The Comments tab is not registered.");
    expect(railTabLabel(tab, ctx)).toBe(enCollab.comments.title);
    useCommentsRail.setState({ unread: true });
    expect(railTabLabel(tab, ctx)).toBe(enCollab.comments.titleUnread);
  });
});
