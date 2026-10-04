// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { CreatePersonaDialog } from "./CreatePersonaDialog";

const copy = enSettings.ai.personas;

beforeEach(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

describe("CreatePersonaDialog", () => {
  it("asks for a name and prompt, then creates the persona with the chosen color on Enter", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => ({ ok: true }));
    const onOpenChange = vi.fn();
    render(<CreatePersonaDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />);

    expect(screen.getByRole("dialog", { name: copy.form.createTitle })).toBeInTheDocument();
    await user.click(screen.getByTestId("persona-submit"));
    expect(screen.getByText(copy.form.required)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(copy.form.instructions), "Keep it short.");
    await user.click(screen.getByRole("combobox", { name: copy.form.color }));
    await user.click(await screen.findByRole("option", { name: copy.colors.ocean }));
    await user.type(screen.getByLabelText(enCommon.labels.name), "Terse Editor{Enter}");

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSubmit).toHaveBeenCalledWith({
      id: expect.any(String),
      name: "Terse Editor",
      color: "ocean",
      prompt: "Keep it short.",
    });
  });

  it("keeps the dialog open with the reason a save failed", async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false, message: "A persona with that name exists." });
    const onOpenChange = vi.fn();
    const editing = { id: "p-1", name: "Critic", color: "grape", prompt: "Be blunt." };
    render(<CreatePersonaDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} editing={editing} />);

    expect(screen.getByRole("dialog", { name: copy.form.editTitle })).toBeInTheDocument();
    expect(screen.getByLabelText(enCommon.labels.name)).toHaveValue("Critic");
    await user.click(screen.getByTestId("persona-submit"));
    expect(await screen.findByText(copy.form.saveFailed)).toBeInTheDocument();

    await user.click(screen.getByTestId("persona-submit"));
    expect(await screen.findByText("A persona with that name exists.")).toBeInTheDocument();
    expect(onSubmit).toHaveBeenLastCalledWith(editing);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
