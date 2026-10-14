// @vitest-environment jsdom

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { formatBytes } from "@/lib/format-bytes";
import { formatRelativeTimeFrom } from "@/lib/intl";
import { CAROL, SERVER_ID, collabError, deferred, fill } from "../tests/fixtures";
import { NOW, adminProject, projectsPage } from "./tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabAdminProjects: vi.fn(),
  collabAdminArchiveProject: vi.fn(),
  collabAdminUnarchiveProject: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...mocks,
}));

import { PROJECTS_PAGE_SIZE, ProjectsSection } from "./ProjectsSection";

const copy = enCollab.console.projects;
const GRANT = adminProject();
const THESIS = adminProject({
  project_id: "0192a0b0-0000-7000-8000-0000000000b2",
  title: "Thesis",
  owner: CAROL,
  member_count: 1,
  size_bytes: 512,
  last_activity_at: NOW - 5 * 86_400_000,
});
const OLD = adminProject({
  project_id: "0192a0b0-0000-7000-8000-0000000000b3",
  title: "Old notes",
  status: "archived",
  archived_at: NOW - 86_400_000,
});
const DRAFT = adminProject({ project_id: "0192a0b0-0000-7000-8000-0000000000b4", title: "Draft", status: "pending" });

const FIRST_QUERY = { q: null, status: null, sort: "activity", order: "desc", cursor: null, limit: PROJECTS_PAGE_SIZE };

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.collabAdminProjects.mockResolvedValue(projectsPage([GRANT, THESIS]));
});

function renderSection(props: Partial<Parameters<typeof ProjectsSection>[0]> = {}) {
  return render(<ProjectsSection serverId={SERVER_ID} actor="admin" archiveDays={30} now={NOW} {...props} />);
}

function row(project: { project_id: string }): HTMLElement {
  return screen.getByTestId(`console-project-${project.project_id}`);
}

function lastQuery(): unknown {
  return mocks.collabAdminProjects.mock.calls.at(-1)?.[1];
}

describe("ProjectsSection", () => {
  it("lists every project with its owner, people, size and last activity", async () => {
    renderSection();
    expect(screen.getByText(copy.loading)).toBeInTheDocument();
    expect(await screen.findByText("Grant proposal")).toBeInTheDocument();
    expect(mocks.collabAdminProjects).toHaveBeenCalledWith(SERVER_ID, FIRST_QUERY);
    const grant = row(GRANT);
    expect(within(grant).getByText("Bob Smith")).toBeInTheDocument();
    expect(within(grant).getByText("3")).toBeInTheDocument();
    expect(within(grant).getByText(formatBytes(2 * 1024 * 1024))).toBeInTheDocument();
    expect(within(grant).getByText(formatRelativeTimeFrom(GRANT.last_activity_at, NOW))).toBeInTheDocument();
    expect(within(row(THESIS)).getByText("Carol Diaz")).toBeInTheDocument();
    expect(screen.getByText(fill(copy.count, { shown: "2", total: "2" }))).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: `${copy.columns.activity}` })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
  });

  it("marks archived and uploading projects", async () => {
    mocks.collabAdminProjects.mockResolvedValue(projectsPage([OLD, DRAFT, adminProject({ project_id: "x", title: "Odd", status: "unknown" })]));
    renderSection();
    expect(await screen.findByText("Old notes")).toBeInTheDocument();
    expect(within(row(OLD)).getByText(copy.status.archived)).toBeInTheDocument();
    expect(within(row(DRAFT)).getByText(copy.status.pending)).toBeInTheDocument();
    expect(within(screen.getByTestId("console-project-x")).getByText(copy.status.unknown)).toBeInTheDocument();
    expect(within(row(DRAFT)).queryByText(copy.status.archived)).not.toBeInTheDocument();
  });

  it("searches by title or owner after a pause in typing", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Grant proposal");
    mocks.collabAdminProjects.mockResolvedValue(projectsPage([THESIS]));
    await user.type(screen.getByRole("searchbox", { name: copy.searchLabel }), "  thes ");
    await waitFor(() => expect(lastQuery()).toEqual({ ...FIRST_QUERY, q: "thes" }));
    await waitFor(() => expect(screen.queryByText("Grant proposal")).not.toBeInTheDocument());
    mocks.collabAdminProjects.mockResolvedValue(projectsPage([]));
    await user.type(screen.getByRole("searchbox", { name: copy.searchLabel }), "zzz");
    expect(await screen.findByText(copy.noMatches)).toBeInTheDocument();
  });

  it("sorts by a column and flips the order on a second click", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Grant proposal");
    await user.click(screen.getByRole("button", { name: fill(copy.sortBy, { column: copy.columns.title }) }));
    await waitFor(() => expect(lastQuery()).toEqual({ ...FIRST_QUERY, sort: "title", order: "asc" }));
    expect(screen.getByRole("columnheader", { name: copy.columns.title })).toHaveAttribute("aria-sort", "ascending");
    await user.click(screen.getByRole("button", { name: fill(copy.sortBy, { column: copy.columns.title }) }));
    await waitFor(() => expect(lastQuery()).toEqual({ ...FIRST_QUERY, sort: "title", order: "desc" }));
    await user.click(screen.getByRole("button", { name: fill(copy.sortBy, { column: copy.columns.size }) }));
    await waitFor(() => expect(lastQuery()).toEqual({ ...FIRST_QUERY, sort: "size", order: "desc" }));
    await user.click(screen.getByRole("button", { name: fill(copy.sortBy, { column: copy.columns.owner }) }));
    await waitFor(() => expect(lastQuery()).toEqual({ ...FIRST_QUERY, sort: "owner", order: "asc" }));
    expect(screen.getByRole("columnheader", { name: copy.columns.activity })).toHaveAttribute("aria-sort", "none");
  });

  it("filters by status", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Grant proposal");
    const archived = screen.getByRole("button", { name: copy.filter.archived });
    expect(screen.getByRole("button", { name: copy.filter.all })).toHaveAttribute("aria-pressed", "true");
    await user.click(archived);
    await waitFor(() => expect(lastQuery()).toEqual({ ...FIRST_QUERY, status: "archived" }));
    expect(archived).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: copy.filter.all }));
    await waitFor(() => expect(lastQuery()).toEqual(FIRST_QUERY));
  });

  it("shows more projects page by page", async () => {
    mocks.collabAdminProjects
      .mockResolvedValueOnce(projectsPage([GRANT], { next_cursor: "1", total: 2 }))
      .mockResolvedValueOnce(projectsPage([THESIS], { total: 2 }));
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Grant proposal");
    expect(screen.getByText(fill(copy.count, { shown: "1", total: "2" }))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.loadMore }));
    expect(await screen.findByText("Thesis")).toBeInTheDocument();
    expect(lastQuery()).toEqual({ ...FIRST_QUERY, cursor: "1" });
    expect(screen.queryByRole("button", { name: copy.loadMore })).not.toBeInTheDocument();
  });

  it("explains a failed page and keeps the projects already shown", async () => {
    mocks.collabAdminProjects
      .mockResolvedValueOnce(projectsPage([GRANT], { next_cursor: "1", total: 2 }))
      .mockRejectedValueOnce(collabError("unreachable"));
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Grant proposal");
    await user.click(screen.getByRole("button", { name: copy.loadMore }));
    expect(await screen.findByText(enCollab.errors.unreachable)).toBeInTheDocument();
    expect(screen.getByText("Grant proposal")).toBeInTheDocument();
  });

  it("archives a project after asking and shows it as archived", async () => {
    mocks.collabAdminArchiveProject.mockResolvedValue({ ...GRANT, status: "archived", archived_at: NOW });
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Grant proposal");
    await user.click(within(row(GRANT)).getByRole("button", { name: fill(copy.archiveNamed, { title: "Grant proposal" }) }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(fill(copy.archiveConfirm.title, { title: "Grant proposal" }))).toBeInTheDocument();
    expect(within(dialog).getByText(fill(copy.archiveConfirm.description, { days: "30" }))).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: copy.archiveConfirm.confirm }));
    expect(mocks.collabAdminArchiveProject).toHaveBeenCalledWith(SERVER_ID, GRANT.project_id);
    expect(await within(row(GRANT)).findByText(copy.status.archived)).toBeInTheDocument();
    expect(within(row(GRANT)).getByRole("button", { name: fill(copy.restoreNamed, { title: "Grant proposal" }) })).toBeInTheDocument();
  });

  it("keeps a project when the archive question is cancelled", async () => {
    const user = userEvent.setup();
    renderSection({ archiveDays: null });
    await screen.findByText("Grant proposal");
    await user.click(within(row(GRANT)).getByRole("button", { name: fill(copy.archiveNamed, { title: "Grant proposal" }) }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(copy.archiveConfirm.descriptionLater)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: new RegExp(`^${enCommon.actions.cancel}`) }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(mocks.collabAdminArchiveProject).not.toHaveBeenCalled();
  });

  it("restores an archived project and shows a refusal in its row", async () => {
    mocks.collabAdminProjects.mockResolvedValue(projectsPage([OLD, DRAFT]));
    mocks.collabAdminUnarchiveProject
      .mockResolvedValueOnce({ ...OLD, status: "active", archived_at: null })
      .mockRejectedValueOnce(collabError("conflict"));
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Old notes");
    await user.click(within(row(OLD)).getByRole("button", { name: fill(copy.restoreNamed, { title: "Old notes" }) }));
    await waitFor(() => expect(within(row(OLD)).queryByText(copy.status.archived)).not.toBeInTheDocument());
    expect(mocks.collabAdminUnarchiveProject).toHaveBeenCalledWith(SERVER_ID, OLD.project_id);
    mocks.collabAdminArchiveProject.mockRejectedValueOnce(collabError("forbidden"));
    await user.click(within(row(DRAFT)).getByRole("button", { name: fill(copy.archiveNamed, { title: "Draft" }) }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: copy.archiveConfirm.confirm }));
    expect(await screen.findByText(enCollab.errors.forbidden)).toBeInTheDocument();
  });

  it("keeps each row's Restore off until its own request ends", async () => {
    const older = adminProject({
      project_id: "0192a0b0-0000-7000-8000-0000000000b5",
      title: "Older notes",
      status: "archived",
      archived_at: NOW - 86_400_000,
    });
    const first = deferred<ReturnType<typeof adminProject>>();
    const second = deferred<ReturnType<typeof adminProject>>();
    mocks.collabAdminProjects.mockResolvedValue(projectsPage([OLD, older]));
    mocks.collabAdminUnarchiveProject.mockReset();
    mocks.collabAdminUnarchiveProject.mockImplementation((_server: string, id: string) =>
      id === OLD.project_id ? first.promise : second.promise,
    );
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Old notes");
    const restoreOld = () => within(row(OLD)).getByRole("button", { name: fill(copy.restoreNamed, { title: "Old notes" }) });
    const restoreOlder = () =>
      within(row(older)).getByRole("button", { name: fill(copy.restoreNamed, { title: "Older notes" }) });
    await user.click(restoreOld());
    await user.click(restoreOlder());
    await act(async () => {
      first.resolve({ ...OLD, status: "active", archived_at: null });
      await first.promise;
    });
    expect(within(row(OLD)).queryByText(copy.status.archived)).not.toBeInTheDocument();
    expect(restoreOlder()).toBeDisabled();
    await act(async () => {
      second.resolve({ ...older, status: "active", archived_at: null });
      await second.promise;
    });
    expect(within(row(older)).queryByText(copy.status.archived)).not.toBeInTheDocument();
    expect(mocks.collabAdminUnarchiveProject).toHaveBeenCalledTimes(2);
  });

  it("shows maintainers the list without sizes or archive buttons", async () => {
    mocks.collabAdminProjects.mockResolvedValue(projectsPage([{ ...GRANT, size_bytes: null }]));
    renderSection({ actor: "maintainer" });
    await screen.findByText("Grant proposal");
    expect(screen.getByText(copy.adminOnly)).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: copy.columns.size })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: fill(copy.archiveNamed, { title: "Grant proposal" }) })).not.toBeInTheDocument();
  });

  it("says when the server has no projects", async () => {
    mocks.collabAdminProjects.mockResolvedValue(projectsPage([]));
    renderSection();
    expect(await screen.findByText(copy.empty)).toBeInTheDocument();
  });

  it("explains a failed load and tries again", async () => {
    mocks.collabAdminProjects.mockRejectedValueOnce(collabError("forbidden")).mockResolvedValueOnce(projectsPage([GRANT]));
    const user = userEvent.setup();
    renderSection();
    expect(await screen.findByText(enCollab.errors.forbidden)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: enCommon.actions.retry }));
    expect(await screen.findByText("Grant proposal")).toBeInTheDocument();
  });

  it("ignores a failure for a filter that is no longer current", async () => {
    const late = deferred<ReturnType<typeof projectsPage>>();
    mocks.collabAdminProjects.mockReturnValueOnce(late.promise).mockResolvedValueOnce(projectsPage([THESIS]));
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: copy.filter.active }));
    expect(await screen.findByText("Thesis")).toBeInTheDocument();
    await act(async () => {
      late.reject(collabError("forbidden"));
      await late.promise.catch(() => undefined);
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Thesis")).toBeInTheDocument();
  });

  it("drops a page of older projects that arrives after the list failed to load", async () => {
    const more = deferred<ReturnType<typeof projectsPage>>();
    mocks.collabAdminProjects
      .mockResolvedValueOnce(projectsPage([GRANT], { next_cursor: "1", total: 2 }))
      .mockReturnValueOnce(more.promise)
      .mockRejectedValueOnce(collabError("forbidden"));
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: copy.loadMore }));
    await user.click(screen.getByRole("button", { name: copy.filter.archived }));
    expect(await screen.findByText(enCollab.errors.forbidden)).toBeInTheDocument();
    await act(async () => {
      more.resolve(projectsPage([THESIS], { total: 2 }));
      await more.promise;
    });
    expect(screen.queryByText("Thesis")).not.toBeInTheDocument();
    expect(screen.getByText(enCollab.admin.loadFailed)).toBeInTheDocument();
  });

  it("drops an archived project that comes back after the list failed to load", async () => {
    const archived = deferred<ReturnType<typeof adminProject>>();
    mocks.collabAdminProjects
      .mockResolvedValueOnce(projectsPage([GRANT]))
      .mockRejectedValueOnce(collabError("forbidden"));
    mocks.collabAdminArchiveProject.mockReturnValue(archived.promise);
    const user = userEvent.setup();
    renderSection();
    await user.click(
      await screen.findByRole("button", { name: fill(copy.archiveNamed, { title: "Grant proposal" }) }),
    );
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: copy.archiveConfirm.confirm }));
    await user.click(screen.getByRole("button", { name: copy.filter.pending }));
    expect(await screen.findByText(enCollab.errors.forbidden)).toBeInTheDocument();
    await act(async () => {
      archived.resolve({ ...GRANT, status: "archived", archived_at: NOW });
      await archived.promise;
    });
    expect(screen.queryByText("Grant proposal")).not.toBeInTheDocument();
    expect(screen.getByText(enCollab.admin.loadFailed)).toBeInTheDocument();
  });

  it("flips the activity order from newest first to oldest first", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Grant proposal");
    await user.click(screen.getByRole("button", { name: fill(copy.sortBy, { column: copy.columns.activity }) }));
    await waitFor(() => expect(lastQuery()).toEqual({ ...FIRST_QUERY, order: "asc" }));
    expect(screen.getByRole("columnheader", { name: copy.columns.activity })).toHaveAttribute("aria-sort", "ascending");
  });

  it("leaves the size empty for an admin when the server does not know it", async () => {
    mocks.collabAdminProjects.mockResolvedValue(projectsPage([{ ...GRANT, size_bytes: null }]));
    renderSection();
    await screen.findByText("Grant proposal");
    expect(screen.getByRole("columnheader", { name: copy.columns.size })).toBeInTheDocument();
    const cells = within(row(GRANT)).getAllByRole("cell");
    expect(cells[3]).toBeEmptyDOMElement();
    expect(cells[2]).toHaveTextContent("3");
  });

  it("never adds a page from the previous filter to the new list", async () => {
    const more = deferred<ReturnType<typeof projectsPage>>();
    mocks.collabAdminProjects
      .mockResolvedValueOnce(projectsPage([GRANT], { next_cursor: "1", total: 2 }))
      .mockReturnValueOnce(more.promise)
      .mockResolvedValueOnce(projectsPage([OLD], { total: 1 }));
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: copy.loadMore }));
    await user.click(screen.getByRole("button", { name: copy.filter.archived }));
    expect(await screen.findByText("Old notes")).toBeInTheDocument();
    await act(async () => {
      more.resolve(projectsPage([THESIS], { next_cursor: "2", total: 2 }));
      await more.promise;
    });
    expect(screen.queryByText("Thesis")).not.toBeInTheDocument();
    expect(screen.getByText(fill(copy.count, { shown: "1", total: "1" }))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.loadMore })).not.toBeInTheDocument();
  });

  it("shows that a new search is loading while the earlier results stay on screen", async () => {
    const searching = deferred<ReturnType<typeof projectsPage>>();
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Grant proposal");
    expect(screen.queryByText(copy.loading)).not.toBeInTheDocument();
    mocks.collabAdminProjects.mockReturnValueOnce(searching.promise);
    await user.type(screen.getByRole("searchbox", { name: copy.searchLabel }), "thes");
    expect(await screen.findByText(copy.loading)).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Grant proposal")).toBeInTheDocument();
    await act(async () => {
      searching.resolve(projectsPage([THESIS]));
      await searching.promise;
    });
    expect(screen.queryByText(copy.loading)).not.toBeInTheDocument();
    expect(screen.getByRole("table")).not.toHaveAttribute("aria-busy");
    expect(screen.queryByText("Grant proposal")).not.toBeInTheDocument();
  });

  it("ignores an answer for a search that is no longer current", async () => {
    const late = deferred<ReturnType<typeof projectsPage>>();
    mocks.collabAdminProjects.mockReturnValueOnce(late.promise).mockResolvedValueOnce(projectsPage([THESIS]));
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: copy.filter.active }));
    expect(await screen.findByText("Thesis")).toBeInTheDocument();
    late.resolve(projectsPage([GRANT]));
    await late.promise;
    expect(screen.queryByText("Grant proposal")).not.toBeInTheDocument();
  });
});
