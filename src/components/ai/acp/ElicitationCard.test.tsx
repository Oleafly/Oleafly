import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { restore } = await vi.hoisted(async () => {
  vi.resetModules();
  const { initTestI18n, installUiDom } = await import("./tests/ui-fixtures");
  await initTestI18n();
  return installUiDom();
});

const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/lib/system-browser", () => ({ openInSystemBrowser: mocks.open }));

import type { AcpElicitation, AcpElicitationField, AcpFieldKind } from "@/lib/acp";
import { chooseOption } from "./tests/ui-fixtures";
import { ElicitationCard, fieldProblem } from "./ElicitationCard";

function field(name: string, kind: AcpFieldKind, overrides: Partial<AcpElicitationField> = {}): AcpElicitationField {
  return { name, title: null, description: null, kind, required: false, default: null, secret: false, ...overrides };
}

const text = (overrides: Partial<Extract<AcpFieldKind, { type: "string" }>> = {}): AcpFieldKind =>
  ({ type: "string", minLength: null, maxLength: null, format: null, ...overrides });
const number = (overrides: Partial<Extract<AcpFieldKind, { type: "number" }>> = {}): AcpFieldKind =>
  ({ type: "number", integer: false, minimum: null, maximum: null, ...overrides });
const choice = (multiple = false): AcpFieldKind =>
  ({ type: "choice", options: [["red", "Red"], ["blue", "Blue"]], multiple });

function request(overrides: Partial<AcpElicitation> = {}): AcpElicitation {
  return {
    id: "ask", mode: "form", message: "A few details first.", url: null, fields: [], sessionId: "s", toolCallId: null,
    expiresAt: Date.now() + 60_000, ...overrides,
  };
}

function show(value: AcpElicitation) {
  const onRespond = vi.fn(async () => true);
  render(<ElicitationCard request={value} agentName="Codex" onRespond={onRespond} />);
  return onRespond;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.open.mockResolvedValue(true);
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
});
afterAll(restore);

describe("ElicitationCard", () => {
  it("sends typed values for string, number, boolean and choice fields", async () => {
    const onRespond = show(request({
      fields: [
        field("name", text(), { title: "Name", required: true, description: "Your display name" }),
        field("count", number({ integer: true, minimum: 1, maximum: 10 }), { title: "Count" }),
        field("ok", { type: "boolean" }, { title: "Agree" }),
        field("color", choice(), { title: "Color" }),
        field("tags", choice(true), { title: "Tags" }),
        field("note", text(), { title: "Note" }),
      ],
    }));
    expect(screen.getByRole("group", { name: "Agent request" })).toBeInTheDocument();
    expect(screen.getByText("Codex asks:")).toBeInTheDocument();
    expect(screen.getByText("A few details first.")).toBeInTheDocument();
    expect(screen.getByText("Your display name")).toBeInTheDocument();
    expect(screen.getByText("(Required)")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Count"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("switch"));
    await chooseOption(screen.getByRole("combobox"), "Red");
    fireEvent.click(screen.getByRole("checkbox", { name: "Blue" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onRespond).toHaveBeenCalledWith("accept", { name: "x", count: 3, ok: true, color: "red", tags: ["blue"] }));
  });

  it("starts from the agent's defaults and drops a cleared number", async () => {
    const onRespond = show(request({
      fields: [
        field("name", text(), { default: "Ada" }),
        field("count", number(), { default: 2 }),
        field("ok", { type: "boolean" }, { default: true }),
        field("color", choice(), { default: "blue" }),
        field("tags", choice(true), { default: ["red", 7] }),
        field("weird", number(), { default: "not a number" }),
        field("off", { type: "boolean" }, { default: "yes" }),
      ],
    }));
    fireEvent.change(screen.getByLabelText("count"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Red" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onRespond).toHaveBeenCalledWith("accept", { name: "Ada", ok: true, color: "blue", tags: [], off: false }));
  });

  it("hides secret values", () => {
    show(request({ fields: [field("token", text(), { title: "Token", secret: true, default: "sk-default" })] }));
    const input = screen.getByLabelText("Token") as HTMLInputElement;
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input.value).toBe("");
  });

  it("marks each invalid field and sends nothing", async () => {
    const onRespond = show(request({
      fields: [
        field("name", text({ minLength: 3 }), { required: true }),
        field("email", text({ format: "email" })),
        field("count", number({ integer: true })),
      ],
    }));
    expect(screen.getByLabelText("email")).toHaveAttribute("type", "email");
    fireEvent.change(screen.getByLabelText("email"), { target: { value: "not an address" } });
    fireEvent.change(screen.getByLabelText("count"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual([
      "Check this field.", "Check this field.", "Check this field.",
    ]);
    expect(screen.getByLabelText(/^name/)).toHaveAttribute("aria-invalid", "true");
    expect(onRespond).not.toHaveBeenCalled();
  });

  it("declines or cancels without content", async () => {
    const onRespond = show(request({ fields: [field("name", text(), { required: true })] }));
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(onRespond).toHaveBeenCalledWith("decline", undefined));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onRespond).toHaveBeenLastCalledWith("cancel", undefined));
  });

  it("asks before opening a URL", async () => {
    const onRespond = show(request({ mode: "url", url: "https://auth.example.org/approve?code=1", message: "Approve the app." }));
    expect(screen.getByText("auth.example.org")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open in browser" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Open auth.example.org?")).toBeInTheDocument();
    expect(mocks.open).not.toHaveBeenCalled();
    // The dialog's buttons end with their key hint (↵, esc), so match how their names start.
    fireEvent.click(within(dialog).getByRole("button", { name: /^Open in browser/ }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalledWith("https://auth.example.org/approve?code=1"));
    await waitFor(() => expect(onRespond).toHaveBeenCalledWith("accept", undefined));
    expect(await screen.findByText("Waiting for the site to finish.")).toBeInTheDocument();
    // The step on the site may never finish: Decline stays.
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
  });

  it("offers the link again when the answer did not reach the agent", async () => {
    const onRespond = vi.fn(async () => false);
    render(<ElicitationCard request={request({ mode: "url", url: "https://auth.example.org/approve" })} agentName="Codex" onRespond={onRespond} />);
    fireEvent.click(screen.getByRole("button", { name: "Open in browser" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /^Open in browser/ }));
    await waitFor(() => expect(onRespond).toHaveBeenCalledWith("accept", undefined));
    expect(await screen.findByRole("button", { name: "Open in browser" })).toBeEnabled();
    expect(screen.queryByText("Waiting for the site to finish.")).toBeNull();
    expect(screen.getByRole("button", { name: "Decline" })).toBeEnabled();
  });

  it("says so, and does not tell the agent, when no browser opens", async () => {
    mocks.open.mockResolvedValue(false);
    const onRespond = show(request({ mode: "url", url: "https://auth.example.org/approve?code=1" }));
    fireEvent.click(screen.getByRole("button", { name: "Open in browser" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Open in browser/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The link could not be opened in your browser.");
    expect(onRespond).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
    // A second try that works clears the message.
    mocks.open.mockResolvedValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Open in browser" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /^Open in browser/ }));
    await waitFor(() => expect(onRespond).toHaveBeenCalledWith("accept", undefined));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("opens nothing when the user cancels the site prompt or declines", async () => {
    const onRespond = show(request({ mode: "url", url: "not a url" }));
    expect(screen.getByText("not a url")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open in browser" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Cancel/ }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mocks.open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(onRespond).toHaveBeenCalledWith("decline", undefined));
  });

  it("does nothing for a site request without an address", async () => {
    const onRespond = show(request({ mode: "url", url: null }));
    fireEvent.click(screen.getByRole("button", { name: "Open in browser" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Open ?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /^Open in browser/ }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.open).not.toHaveBeenCalled();
    expect(onRespond).not.toHaveBeenCalled();
  });
});

describe("field checks", () => {
  it("accepts an empty optional field and refuses an empty required one", () => {
    expect(fieldProblem(field("a", text()), undefined)).toBe(false);
    expect(fieldProblem(field("a", text(), { required: true }), "")).toBe(true);
    expect(fieldProblem(field("a", choice(true), { required: true }), [])).toBe(true);
  });

  it("checks text length, email and web addresses", () => {
    expect(fieldProblem(field("a", text({ minLength: 2 })), "x")).toBe(true);
    expect(fieldProblem(field("a", text({ maxLength: 2 })), "xyz")).toBe(true);
    expect(fieldProblem(field("a", text({ minLength: 1, maxLength: 3 })), "ab")).toBe(false);
    expect(fieldProblem(field("a", text({ maxLength: 2 })), "😀😀")).toBe(false);
    expect(fieldProblem(field("a", text({ format: "email" })), "ada@example.org")).toBe(false);
    expect(fieldProblem(field("a", text({ format: "email" })), "ada example.org")).toBe(true);
    expect(fieldProblem(field("a", text({ format: "email" })), "ada@ex ample.org")).toBe(true);
    expect(fieldProblem(field("a", text({ format: "uri" })), "https://example.org")).toBe(false);
    expect(fieldProblem(field("a", text({ format: "uri" })), "nope")).toBe(true);
    expect(fieldProblem(field("a", text()), 3)).toBe(true);
  });

  it("checks numbers, booleans and choices", () => {
    expect(fieldProblem(field("a", number()), Number.NaN)).toBe(true);
    expect(fieldProblem(field("a", number()), "3")).toBe(true);
    expect(fieldProblem(field("a", number({ integer: true })), 1.5)).toBe(true);
    expect(fieldProblem(field("a", number({ minimum: 2 })), 1)).toBe(true);
    expect(fieldProblem(field("a", number({ maximum: 2 })), 3)).toBe(true);
    expect(fieldProblem(field("a", number({ minimum: 1, maximum: 3 })), 2)).toBe(false);
    expect(fieldProblem(field("a", { type: "boolean" }), "yes")).toBe(true);
    expect(fieldProblem(field("a", { type: "boolean" }), false)).toBe(false);
    expect(fieldProblem(field("a", choice()), "green")).toBe(true);
    expect(fieldProblem(field("a", choice()), "red")).toBe(false);
    expect(fieldProblem(field("a", choice(true)), ["red", "green"])).toBe(true);
    expect(fieldProblem(field("a", choice(true)), ["red", "blue"])).toBe(false);
  });
});
