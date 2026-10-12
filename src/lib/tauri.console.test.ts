import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CollabAdminProjectsQuery } from "./tauri";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, Channel: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import * as tauri from "./tauri";

const SERVER = "0192f5a4-7b1c-7d2e-8f3a-1b2c3d4e5f60";
const PROJECT = "0192f5a4-7b1c-7d2e-8f3a-1b2c3d4e5f63";
const query: CollabAdminProjectsQuery = { q: "thesis", status: "archived", sort: "size", order: "desc", cursor: "50", limit: 25 };

beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue(undefined);
});

describe("admin console IPC contract", () => {
  it.each([
    ["collabAdminOverview", () => tauri.collabAdminOverview(SERVER), "collab_admin_overview", { serverId: SERVER }],
    [
      "collabAdminProjects",
      () => tauri.collabAdminProjects(SERVER, query),
      "collab_admin_projects",
      { serverId: SERVER, query },
    ],
    [
      "collabAdminArchiveProject",
      () => tauri.collabAdminArchiveProject(SERVER, PROJECT),
      "collab_admin_archive_project",
      { serverId: SERVER, projectId: PROJECT },
    ],
    [
      "collabAdminUnarchiveProject",
      () => tauri.collabAdminUnarchiveProject(SERVER, PROJECT),
      "collab_admin_unarchive_project",
      { serverId: SERVER, projectId: PROJECT },
    ],
  ] as const)("sends %s", async (_label, call, command, args) => {
    await call();
    expect(mocks.invoke).toHaveBeenCalledWith(command, args);
  });
});

describe("admin console command drift", () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
  const registered = [...read("../../src-tauri/src/lib.rs").matchAll(/collab::console::(collab_[a-z_]+)/g)].map(
    (match) => match[1],
  );
  const camel = (name: string) => name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

  it("registers every console command once", () => {
    expect(registered).toEqual([
      "collab_admin_overview",
      "collab_admin_projects",
      "collab_admin_archive_project",
      "collab_admin_unarchive_project",
    ]);
  });

  it("gives every console command a wrapper and a contract entry", () => {
    const wrappers = read("./tauri.ts");
    const contract = read("../../packages/backend-port/src/index.ts");
    for (const name of registered) {
      expect(wrappers).toContain(`"${name}"`);
      expect(contract).toContain(`${camel(name)}:`);
    }
  });
});
