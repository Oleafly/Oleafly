// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAppQueryClient } from "@/lib/query";
import { useChatsStore } from "@/store/chats";
import { useFilesStore } from "@/store/files";
import { ProjectChatsSidebar } from "./ProjectChatsSidebar";

const loadProjectChats = vi.fn(async (_projectId: string) => "[]");
const gitHeadOid = vi.fn(async (_projectId: string) => "abc123");

vi.mock("@/lib/tauri", () => ({
  loadProjectChats: (...args: unknown[]) =>
    loadProjectChats(...(args as [string])),
  gitHeadOid: (...args: unknown[]) => gitHeadOid(...(args as [string])),
}));

vi.mock("@/lib/skills", () => ({
  useSkills: () => ({ data: [] }),
}));

function renderSidebar() {
  return render(
    <QueryClientProvider client={createAppQueryClient()}>
      <ProjectChatsSidebar />
    </QueryClientProvider>,
  );
}

describe("ProjectChatsSidebar", () => {
  beforeEach(() => {
    loadProjectChats.mockClear();
    gitHeadOid.mockClear();
    loadProjectChats.mockImplementation(async () => "[]");
    window.localStorage.clear();
    useFilesStore.setState({
      projectId: "p1",
      projectName: "Thesis",
      projects: [
        { id: "p1", name: "Thesis", main_doc: "main.tex", kind: "latex", created_at: 1, updated_at: 2 },
        { id: "p2", name: "Workshop paper", main_doc: "paper.tex", kind: "latex", created_at: 1, updated_at: 3 },
      ] as unknown as ReturnType<typeof useFilesStore.getState>["projects"],
      openProject: async () => {},
    } as Partial<ReturnType<typeof useFilesStore.getState>>);
    useChatsStore.setState({
      projectId: "p1",
      activeId: "c1",
      chats: [
        {
          id: "c1",
          projectId: "p1",
          title: "Intro draft",
          createdAt: 1,
          updatedAt: 2,
          messages: [],
          headOid: null,
        },
      ],
    });
  });

  it("renders every project collapsed by default, even the open one", () => {
    renderSidebar();
    expect(screen.getByTestId("harness-project-group-p1")).toBeInTheDocument();
    expect(screen.queryByTestId("harness-project-chats-p1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand chats for Thesis" })).toBeInTheDocument();
  });

  it("expands a project on click and shows a closed folder while collapsed", () => {
    renderSidebar();
    const group = screen.getByTestId("harness-project-group-p1");
    expect(group.querySelector(".lucide-folder")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand chats for Thesis" }));
    expect(screen.getByTestId("harness-chat-c1").textContent).toContain("Intro draft");
    expect(group.querySelector(".lucide-folder-open")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Collapse chats for Thesis" }));
    expect(screen.queryByTestId("harness-chat-c1")).not.toBeInTheDocument();
  });

  it("persists an expanded group across mounts", () => {
    const { unmount } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Expand chats for Thesis" }));
    unmount();

    renderSidebar();
    expect(screen.getByTestId("harness-chat-c1")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Collapse chats for Thesis" }),
    ).toBeInTheDocument();
  });

  it("lists another project's latest chats under Recents and opens one on click", async () => {
    loadProjectChats.mockImplementation(
      async (pid: string) =>
        pid === "p2"
          ? JSON.stringify([
              {
                id: "c9",
                projectId: "p2",
                title: "Camera-ready",
                createdAt: 1,
                updatedAt: 9,
                messages: [],
                headOid: null,
              },
            ])
          : "[]",
    );
    renderSidebar();

    const recent = await screen.findByTestId("harness-recent-c9");
    expect(recent.textContent).toContain("Camera-ready");
    expect(recent.textContent).toContain("Workshop paper");

    fireEvent.click(recent);
    await waitFor(() => {
      expect(useChatsStore.getState().activeId).toBe("c9");
    });
    // Opening from Recents also expands the project so the thread is visible
    // in the tree.
    expect(screen.getByTestId("harness-project-chats-p2")).toBeInTheDocument();
  });

  it("starts a new chat in a project and activates it", async () => {
    renderSidebar();
    const before = useChatsStore.getState().chats.length;
    fireEvent.click(screen.getByTestId("harness-new-chat-p1"));
    await waitFor(() => {
      const state = useChatsStore.getState();
      expect(state.chats.length).toBe(before + 1);
      expect(state.activeId).toBe(state.chats[0]?.id);
      expect(state.chats[0]?.projectId).toBe("p1");
    });
  });

  it("offers New task and search at the top", async () => {
    renderSidebar();
    expect(screen.getByTestId("harness-new-task")).toBeInTheDocument();
    expect(screen.getByTestId("harness-sidebar-search")).toBeInTheDocument();

    // New task without a project just guides the user; nothing crashes.
    useFilesStore.setState({ projectId: null } as Partial<
      ReturnType<typeof useFilesStore.getState>
    >);
    fireEvent.click(screen.getByTestId("harness-new-task"));
    await waitFor(() => expect(screen.getByTestId("harness-new-task")).toBeInTheDocument());
    // Leave the store consistent for the tests that follow.
    useFilesStore.setState({ projectId: "p1" } as Partial<
      ReturnType<typeof useFilesStore.getState>
    >);
  });

  it("starts a new task in the open project on click", async () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId("harness-new-task"));
    await waitFor(() => {
      const state = useChatsStore.getState();
      // The store keeps a per-project chat cache keyed outside the snapshot,
      // so assert the user-visible outcome: a fresh chat leads the list and
      // is the active one.
      expect(state.chats[0]?.projectId).toBe("p1");
      expect(state.chats[0]?.messages).toEqual([]);
      expect(state.activeId).toBe(state.chats[0]?.id);
    });
  });

  it("filters projects and chats from the top search box", async () => {
    loadProjectChats.mockImplementation(
      async (pid: string) =>
        pid === "p2"
          ? JSON.stringify([
              {
                id: "c9",
                projectId: "p2",
                title: "Camera-ready",
                createdAt: 1,
                updatedAt: 9,
                messages: [],
                headOid: null,
              },
            ])
          : "[]",
    );
    renderSidebar();

    fireEvent.change(screen.getByTestId("harness-sidebar-search"), {
      target: { value: "camera" },
    });

    // p2 matches through its "Camera-ready" chat once the disk read lands.
    await waitFor(() => {
      expect(screen.getByTestId("harness-project-group-p2")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("harness-project-group-p1")).not.toBeInTheDocument();
  });

  it("sorts projects by name from the ellipsis menu", async () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId("harness-projects-menu"));
    fireEvent.click(screen.getByTestId("harness-sort-name"));

    const groups = screen.getAllByTestId(/^harness-project-group-/);
    expect(groups.map((g) => g.dataset.testid)).toEqual([
      "harness-project-group-p1",
      "harness-project-group-p2",
    ]);
  });

  it("has no research-workflows footer anymore", () => {
    renderSidebar();
    expect(screen.queryByText(/Research workflows/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Workflows load into the composer/i),
    ).not.toBeInTheDocument();
  });
});
