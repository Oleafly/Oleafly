// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyLocale } from "@/i18n";
import deCore from "@/i18n/locales/de/core.json" with { type: "json" };
import deErrors from "@/i18n/locales/de/errors.json" with { type: "json" };
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import { useFilesStore } from "@/store/files";
import { SaveBlockedDialog } from "./SaveBlockedDialog";

const reason = "project.json is managed by Oleafly and cannot be changed as a project file";

afterEach(async () => {
  useFilesStore.setState({ saveBlocked: null });
  vi.restoreAllMocks();
  await applyLocale("en");
});

describe("SaveBlockedDialog", () => {
  it("stays hidden while nothing is blocked", () => {
    render(<SaveBlockedDialog />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("names the exact file and reason, and offers to stay or discard", async () => {
    const user = userEvent.setup();
    const discard = vi.fn(async () => {});
    const dismiss = vi.fn();
    useFilesStore.setState({
      saveBlocked: {
        action: "close",
        targetProjectId: null,
        failures: [{ path: "project.json", reason }],
      },
      discardUnsavedAndLeave: discard,
      dismissSaveBlocked: dismiss,
    });
    render(<SaveBlockedDialog />);

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(enCore.project.saveBlockedTitle);
    expect(dialog).toHaveTextContent("project.json could not be saved");
    expect(dialog).toHaveTextContent(reason);

    await user.click(screen.getByRole("button", { name: new RegExp(`^${enCore.project.saveBlockedStay}`) }));
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(discard).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: enCore.project.saveBlockedDiscard }),
    );
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it("shows a coded save failure as its sentence in the interface language", async () => {
    await applyLocale("de");
    const refused = `@oleafly/error:${JSON.stringify({
      code: "project.folder_read_only",
      params: { name: "figures/notes.tex" },
      detail: null,
    })}`;
    useFilesStore.setState({
      saveBlocked: {
        action: "close",
        targetProjectId: null,
        failures: [{ path: "figures/notes.tex", reason: refused }],
      },
    });
    render(<SaveBlockedDialog />);

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(deCore.project.saveBlockedTitle);
    expect(dialog).toHaveTextContent(
      deErrors.project.folder_read_only.replace("{{name}}", "figures/notes.tex"),
    );
    expect(dialog).not.toHaveTextContent("@oleafly/error");
  });

  it("lists every file when more than one failed", async () => {
    useFilesStore.setState({
      saveBlocked: {
        action: "switch",
        targetProjectId: "other",
        failures: [
          { path: "project.json", reason },
          { path: "notes/todo.tex", reason: "disk full" },
        ],
      },
    });
    render(<SaveBlockedDialog />);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("2 files could not be saved: project.json, notes/todo.tex");
  });
});
