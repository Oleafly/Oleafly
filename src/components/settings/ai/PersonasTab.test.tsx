// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/lib/tauri";
import { STARTER_PERSONAS } from "@/lib/starter-personas";
import { PersonasTab } from "./PersonasTab";

function emptyConfig(): AppConfig {
  return {
    ai_personas: [],
    ai_starter_personas_seeded: true,
  } as unknown as AppConfig;
}

function freshSeededConfig(): AppConfig {
  return {
    ai_personas: STARTER_PERSONAS.map(({ id, name, color, prompt }) => ({
      id,
      name,
      color,
      prompt,
    })),
    ai_starter_personas_seeded: true,
  } as unknown as AppConfig;
}

function configWithPersona(): AppConfig {
  return {
    ai_starter_personas_seeded: true,
    ai_personas: [
      {
        id: "plain-editor",
        name: "Plain Editor",
        color: "forest",
        prompt: "Make the prose direct.",
      },
    ],
  } as unknown as AppConfig;
}

describe("PersonasTab", () => {
  it("shows all starter personas as installed on a fresh seeded config", () => {
    render(
      <PersonasTab
        cfg={freshSeededConfig()}
        persist={vi.fn()}
        setMsg={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/Reusable instructions for how the assistant should work/u),
    ).toBeInTheDocument();
    expect(screen.getByText("Research Writer")).toBeInTheDocument();
    expect(screen.getByText("Document Editor")).toBeInTheDocument();
    expect(screen.getByText("Critical Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Draw a Figure")).toBeInTheDocument();
    expect(screen.queryByTestId("ai-personas-empty")).toBeNull();
    expect(screen.queryByText("Suggested personas")).toBeNull();
    expect(screen.queryByRole("button", { name: /Add .* persona/u })).toBeNull();
  });

  it("keeps the empty state and manual starter choices after every persona is deleted", () => {
    render(
      <PersonasTab
        cfg={emptyConfig()}
        persist={vi.fn()}
        setMsg={vi.fn()}
      />,
    );

    expect(screen.getByTestId("ai-personas-empty")).toHaveTextContent(
      "No personas added yet.",
    );
    expect(screen.getByRole("button", { name: "Add Draw a Figure persona" })).toBeVisible();
  });

  it("explains the instructions when creating a custom persona", () => {
    render(
      <PersonasTab
        cfg={emptyConfig()}
        persist={vi.fn()}
        setMsg={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create persona" }));

    expect(
      screen.getByText(
        "Set reusable instructions for how the assistant should work.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Instructions")).toBeInTheDocument();
  });

  it("adds a starter persona to the saved configuration", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    render(
      <PersonasTab
        cfg={emptyConfig()}
        persist={persist}
        setMsg={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Add Research Writer persona" }),
    );

    await waitFor(() => expect(persist).toHaveBeenCalledOnce());
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        ai_personas: [
          expect.objectContaining({
            id: "starter-research-writer",
            name: "Research Writer",
            color: "ocean",
          }),
        ],
      }),
    );
    expect(persist.mock.calls[0][0].ai_personas[0]).not.toHaveProperty(
      "description",
    );
    expect(persist.mock.calls[0][0].ai_starter_personas_seeded).toBe(true);
  });

  it("does not suggest a starter that is already installed", () => {
    const cfg = emptyConfig();
    cfg.ai_personas = [
      {
        id: "starter-critical-reviewer",
        name: "Critical Reviewer",
        color: "grape",
        prompt: "Review carefully.",
      },
    ];

    render(<PersonasTab cfg={cfg} persist={vi.fn()} setMsg={vi.fn()} />);

    expect(
      screen.queryByRole("button", { name: "Add Critical Reviewer persona" }),
    ).toBeNull();
    expect(screen.getByText("Critical Reviewer")).toBeInTheDocument();
  });

  it("creates a custom persona and closes the dialog after it is saved", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    render(<PersonasTab cfg={emptyConfig()} persist={persist} setMsg={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Create persona" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Methods Coach" } });
    fireEvent.change(screen.getByLabelText("Instructions"), {
      target: { value: "Check the methods section for reproducibility." },
    });
    fireEvent.click(screen.getByTestId("persona-submit"));

    await waitFor(() => expect(persist).toHaveBeenCalledOnce());
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        ai_personas: [
          expect.objectContaining({
            name: "Methods Coach",
            prompt: "Check the methods section for reproducibility.",
          }),
        ],
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("edits an installed persona in place", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    render(<PersonasTab cfg={configWithPersona()} persist={persist} setMsg={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit persona Plain Editor" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Plain Editor");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Direct Editor" } });
    fireEvent.click(screen.getByTestId("persona-submit"));

    await waitFor(() => expect(persist).toHaveBeenCalledOnce());
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        ai_personas: [
          expect.objectContaining({ id: "plain-editor", name: "Direct Editor" }),
        ],
      }),
    );
  });

  it("keeps the editor open and shows the persistence error", async () => {
    const persist = vi.fn().mockRejectedValue(new Error("disk unavailable"));
    render(<PersonasTab cfg={configWithPersona()} persist={persist} setMsg={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit persona Plain Editor" }));
    fireEvent.click(screen.getByTestId("persona-submit"));

    expect(await screen.findByText("Error: disk unavailable")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Edit persona" })).toBeInTheDocument();
  });

  it("deletes an installed persona after confirmation", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    render(<PersonasTab cfg={configWithPersona()} persist={persist} setMsg={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete persona Plain Editor" }));
    const confirmation = screen.getByRole("alertdialog", { name: "Delete persona" });
    fireEvent.click(within(confirmation).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(persist).toHaveBeenCalledOnce());
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        ai_personas: [],
        ai_starter_personas_seeded: true,
      }),
    );
  });

  it("reports failures while deleting or installing a starter", async () => {
    const deleteMessage = vi.fn();
    const deletePersist = vi.fn().mockRejectedValue(new Error("cannot delete"));
    const { unmount } = render(
      <PersonasTab cfg={configWithPersona()} persist={deletePersist} setMsg={deleteMessage} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete persona Plain Editor" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog", { name: "Delete persona" })).getByRole("button", {
        name: "Delete",
      }),
    );
    await waitFor(() =>
      expect(deleteMessage).toHaveBeenCalledWith({ ok: false, text: "Error: cannot delete" }),
    );
    unmount();

    const starterMessage = vi.fn();
    render(
      <PersonasTab
        cfg={emptyConfig()}
        persist={vi.fn().mockRejectedValue(new Error("cannot save"))}
        setMsg={starterMessage}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add Research Writer persona" }));
    await waitFor(() =>
      expect(starterMessage).toHaveBeenCalledWith({
        ok: false,
        text: "Could not add Research Writer. Error: cannot save",
      }),
    );
  });
});
