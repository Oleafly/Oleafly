import type { CollabAdminOverview, CollabAdminProject, CollabAdminProjectsPage } from "@/lib/tauri";
import { BOB, SHARED_ID, runtimeSettings } from "../../tests/fixtures";

export const DAY = 86_400_000;
export const STARTED = 1_760_000_000_000;
export const NOW = STARTED + 3 * DAY;

export function overview(overrides: Partial<CollabAdminOverview> = {}): CollabAdminOverview {
  return {
    server_name: "Smith Lab",
    version: "0.1.0",
    protocol: { min: 1, max: 1 },
    started_at: STARTED,
    now: NOW,
    health: { status: "ok", issues: [] },
    counts: {
      people: 12,
      suspended_people: 1,
      devices: 20,
      projects: 7,
      archived_projects: 2,
      pending_projects: 1,
      open_rooms: 2,
      people_online: 3,
    },
    storage: { database_bytes: 4096, snapshot_bytes: 3 * 1024 * 1024, file_bytes: 1536, files_location: "disk" },
    email_configured: false,
    providers: [{ id: "github", kind: "github", label: "GitHub" }],
    settings: runtimeSettings(),
    limits: { max_project_mb: 200, max_file_mb: 50, max_members_per_project: 20 },
    archive_days: 30,
    ...overrides,
  };
}

export function adminProject(overrides: Partial<CollabAdminProject> = {}): CollabAdminProject {
  return {
    project_id: SHARED_ID,
    title: "Grant proposal",
    owner: BOB,
    status: "active",
    member_count: 3,
    size_bytes: 2 * 1024 * 1024,
    created_at: STARTED,
    last_activity_at: NOW - 2 * 3_600_000,
    archived_at: null,
    ...overrides,
  };
}

export function projectsPage(
  items: CollabAdminProject[],
  overrides: Partial<CollabAdminProjectsPage> = {},
): CollabAdminProjectsPage {
  return { items, next_cursor: null, total: items.length, ...overrides };
}
