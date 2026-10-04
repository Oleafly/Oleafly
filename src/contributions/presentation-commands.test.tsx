import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { commandGroup, commandKeywords, commandLabel, commandsFor, registry, type AppContext } from "@oleafly/registry";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  present: vi.fn(async () => {}),
  files: {
    projectId: "deck" as string | null,
    mainDoc: "main.typ",
    activePath: "main.typ" as string | null,
    engineLoaded: true,
    engine: { source_format: "typst", capabilities: { formatting_profile: "typst" } },
  },
  migration: { report: null as unknown, openDialog: vi.fn(), showReport: vi.fn() },
}));

vi.mock("@/features/presentation/launch", () => ({ present: mocks.present }));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => mocks.files } }));
vi.mock("@/store/typst-migration", () => ({ useTypstMigrationStore: { getState: () => mocks.migration } }));

import { registerPresentationCommands } from "./presentation-commands";

const project: AppContext = { projectId: "deck", projectKind: null, theme: "light" };
const library: AppContext = { projectId: null, projectKind: null, theme: "light" };

function command(id: string, context: AppContext = project) {
  return commandsFor("palette", context).find((candidate) => candidate.id === id);
}

beforeEach(() => {
  registry.commands.length = 0;
  mocks.present.mockClear();
  mocks.migration.openDialog.mockClear();
  mocks.migration.showReport.mockClear();
  mocks.migration.report = null;
  mocks.files.activePath = "main.typ";
  mocks.files.engine = { source_format: "typst", capabilities: { formatting_profile: "typst" } };
  registerPresentationCommands();
});

afterEach(() => {
  registry.commands.length = 0;
});

describe("presentation commands", () => {
  it("present the compiled PDF of the open project", () => {
    const present = command("palette.present");
    expect(present && commandLabel(present, project)).toBe(enShell.commands.present.label);
    present?.run(project);
    expect(mocks.present).toHaveBeenCalledWith({
      projectId: "deck",
      mode: "start",
      page: 1,
      mainDoc: "main.typ",
      typst: true,
    });
    command("palette.present-with-presenter")?.run(project);
    expect(mocks.present).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "presenter" }));
  });

  it("present the PDF file that is open in the editor", () => {
    mocks.files.activePath = "talks/beamer.pdf";
    command("palette.present")?.run(project);
    expect(mocks.present).toHaveBeenCalledWith(
      expect.objectContaining({ source: { kind: "file", path: "talks/beamer.pdf" } }),
    );
  });

  it("need an open project", () => {
    expect(command("palette.present", library)).toBeUndefined();
  });
});

describe("Typst conversion commands", () => {
  it("offer the conversion only for LaTeX projects", () => {
    expect(command("palette.migrate-to-typst")).toBeUndefined();
    mocks.files.engine = { source_format: "latex", capabilities: { formatting_profile: "latex" } };
    const migrate = command("palette.migrate-to-typst");
    expect(migrate && commandLabel(migrate, project)).toBe(enShell.commands.migrateToTypst.label);
    migrate?.run(project);
    expect(mocks.migration.openDialog).toHaveBeenCalledOnce();
  });

  it("show the last report once there is one", () => {
    expect(command("palette.typst-migration-report")).toBeUndefined();
    mocks.migration.report = { projectId: "new" };
    command("palette.typst-migration-report")?.run(project);
    expect(mocks.migration.showReport).toHaveBeenCalledOnce();
  });
});

describe("command metadata", () => {
  it("files each command under its group with searchable keywords and an icon", () => {
    mocks.files.engine = { source_format: "latex", capabilities: { formatting_profile: "latex" } };
    mocks.migration.report = { projectId: "deck" };
    const expected = [
      ["palette.present", enShell.commandGroups.compile, enShell.commands.present],
      ["palette.present-with-presenter", enShell.commandGroups.compile, enShell.commands.presentWithPresenter],
      ["palette.migrate-to-typst", enShell.commandGroups.project, enShell.commands.migrateToTypst],
      ["palette.typst-migration-report", enShell.commandGroups.project, enShell.commands.typstMigrationReport],
    ] as const;
    for (const [id, group, copy] of expected) {
      const found = command(id);
      if (!found) throw new Error(`missing ${id}`);
      expect(commandGroup(found, project), id).toBe(group);
      expect(commandLabel(found, project), id).toBe(copy.label);
      expect(commandKeywords(found, project), id).toBe(copy.keywords);
      expect(renderToStaticMarkup(found.icon?.(project)), id).toMatch(/^<svg[^>]*class="[^"]*size-4/);
    }
  });

  it("presents without a main document when none is set", () => {
    mocks.files.mainDoc = "";
    command("palette.present")?.run(project);
    expect(mocks.present).toHaveBeenCalledWith(expect.objectContaining({ mainDoc: null }));
    mocks.files.mainDoc = "main.typ";
  });
});
