// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  typstProjectOptions: vi.fn(),
  setTypstProjectOptions: vi.fn(),
  refreshEngine: vi.fn(async () => {}),
  logError: vi.fn(),
}));

vi.mock("@/lib/typst-options", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/typst-options")>()),
  typstProjectOptions: mocks.typstProjectOptions,
  setTypstProjectOptions: mocks.setTypstProjectOptions,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { useFilesStore } from "@/store/files";
import { useTypstVariantStore } from "@/store/typst-variant";
import {
  AddVariantButton,
  TypstVariantsList,
  useTypstVariantsDraft,
  VariantsAlert,
} from "./TypstVariantsEditor";

const copy = enEditor.typstVariants;

function Harness({ projectId = "project" as string | null, enabled = true }) {
  const variants = useTypstVariantsDraft(projectId, enabled);
  return (
    <div>
      <TypstVariantsList variants={variants} />
      <AddVariantButton variants={variants} />
      <VariantsAlert variants={variants} />
      <output data-testid="dirty">{String(variants.dirty)}</output>
      <button
        type="button"
        onClick={() => {
          void variants.save().then((ok) => {
            document.body.dataset.saved = String(ok);
          });
        }}
      >
        {"save"}
      </button>
    </div>
  );
}

function cards() {
  return screen.queryAllByTestId("typst-variant-card");
}

async function saveAndWait() {
  delete document.body.dataset.saved;
  fireEvent.click(screen.getByRole("button", { name: "save" }));
  await waitFor(() => expect(document.body.dataset.saved).toBeDefined());
  return document.body.dataset.saved === "true";
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.typstProjectOptions.mockResolvedValue({
    variants: { draft: { mode: "draft" }, print: {} },
  });
  mocks.setTypstProjectOptions.mockResolvedValue({});
  useFilesStore.setState({ refreshEngine: mocks.refreshEngine } as never);
  useTypstVariantStore.setState({ selections: {} });
});

describe("Typst build variants", () => {
  it("lists the saved variants with their values", async () => {
    render(<Harness />);
    expect(screen.getByText(copy.loading)).toBeInTheDocument();
    await waitFor(() => expect(cards()).toHaveLength(2));

    const [draft, print] = cards();
    expect(within(draft).getByRole("textbox", { name: copy.name })).toHaveValue("draft");
    expect(within(draft).getByRole("textbox", { name: copy.key })).toHaveValue("mode");
    expect(within(draft).getByRole("textbox", { name: copy.value })).toHaveValue("draft");
    expect(within(print).getByText(copy.noInputs)).toBeInTheDocument();
    expect(screen.getByTestId("dirty")).toHaveTextContent("false");
  });

  it("says when the project has no variants", async () => {
    mocks.typstProjectOptions.mockResolvedValue({ variants: {} });
    render(<Harness />);

    expect(await screen.findByText(copy.empty)).toBeInTheDocument();
  });

  it("shows a failed load and retries it", async () => {
    mocks.typstProjectOptions.mockRejectedValueOnce(new Error("project locked"));
    render(<Harness />);

    expect(await screen.findByText("project locked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.add })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: enCommon.actions.retry }));

    await waitFor(() => expect(cards()).toHaveLength(2));
  });

  it("edits, adds and removes variants and their values", async () => {
    render(<Harness />);
    await waitFor(() => expect(cards()).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: copy.add }));
    expect(cards()).toHaveLength(3);
    const added = cards()[2];
    expect(within(added).getByRole("textbox", { name: copy.name })).toHaveValue("variant 3");
    expect(screen.getByTestId("dirty")).toHaveTextContent("true");

    fireEvent.change(within(added).getByRole("textbox", { name: copy.name }), { target: { value: "slides" } });
    fireEvent.change(within(added).getByRole("textbox", { name: copy.key }), { target: { value: "theme" } });
    fireEvent.change(within(added).getByRole("textbox", { name: copy.value }), { target: { value: "dark" } });
    fireEvent.click(within(added).getByRole("button", { name: copy.addInput }));
    expect(within(added).getAllByRole("textbox", { name: copy.key })).toHaveLength(2);
    fireEvent.click(within(added).getAllByRole("button", { name: copy.removeInput })[1]);
    expect(within(added).getAllByRole("textbox", { name: copy.key })).toHaveLength(1);

    fireEvent.click(within(cards()[0]).getByRole("button", { name: copy.removeInput }));
    expect(within(cards()[0]).getByText(copy.noInputs)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove the variant print" }));
    expect(cards()).toHaveLength(2);

    expect(await saveAndWait()).toBe(true);
    expect(mocks.setTypstProjectOptions).toHaveBeenCalledWith("project", {
      variants: { draft: {}, slides: { theme: "dark" } },
    });
    expect(mocks.refreshEngine).toHaveBeenCalled();
    expect(screen.getByTestId("dirty")).toHaveTextContent("false");
  });

  it("keeps the selected variant selected after a rename", async () => {
    useTypstVariantStore.setState({ selections: { project: "draft" } });
    render(<Harness />);
    await waitFor(() => expect(cards()).toHaveLength(2));

    fireEvent.change(within(cards()[0]).getByRole("textbox", { name: copy.name }), {
      target: { value: "review" },
    });

    expect(await saveAndWait()).toBe(true);
    expect(useTypstVariantStore.getState().selections.project).toBe("review");
  });

  it("refuses to save a draft with a problem and explains it", async () => {
    render(<Harness />);
    await waitFor(() => expect(cards()).toHaveLength(2));
    fireEvent.change(within(cards()[1]).getByRole("textbox", { name: copy.name }), {
      target: { value: "draft" },
    });

    expect(await saveAndWait()).toBe(false);
    expect(screen.getByRole("alert")).toHaveTextContent(copy.nameTaken);
    expect(mocks.setTypstProjectOptions).not.toHaveBeenCalled();

    fireEvent.change(within(cards()[1]).getByRole("textbox", { name: copy.name }), {
      target: { value: "print" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports a failed save", async () => {
    mocks.setTypstProjectOptions.mockRejectedValueOnce(new Error("read-only folder"));
    render(<Harness />);
    await waitFor(() => expect(cards()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: copy.add }));
    fireEvent.change(within(cards()[2]).getByRole("textbox", { name: copy.key }), {
      target: { value: "x" },
    });

    expect(await saveAndWait()).toBe(false);
    expect(screen.getByRole("alert")).toHaveTextContent("read-only folder");
    expect(mocks.logError).toHaveBeenCalledWith("save Typst variants", expect.any(Error));
    expect(screen.getByTestId("dirty")).toHaveTextContent("true");
  });

  it("falls back to a generic message when the failure has no text", async () => {
    mocks.setTypstProjectOptions.mockRejectedValueOnce("");
    render(<Harness />);
    await waitFor(() => expect(cards()).toHaveLength(2));

    expect(await saveAndWait()).toBe(false);
    expect(screen.getByRole("alert")).toHaveTextContent(enErrors.unknown);
  });

  it("does nothing without a project", async () => {
    render(<Harness projectId={null} />);

    expect(await saveAndWait()).toBe(false);
    expect(mocks.typstProjectOptions).not.toHaveBeenCalled();
    expect(screen.getByText(copy.loading)).toBeInTheDocument();
  });

  it("drops a load that finishes after the editor was disabled", async () => {
    let finish: (value: unknown) => void = () => {};
    let fail: (error: unknown) => void = () => {};
    mocks.typstProjectOptions
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
      .mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = reject)));
    const { rerender } = render(<Harness />);
    rerender(<Harness enabled={false} />);
    rerender(<Harness />);
    rerender(<Harness enabled={false} />);

    await act(async () => {
      finish({ variants: { late: {} } });
      fail(new Error("late failure"));
    });

    expect(cards()).toHaveLength(0);
    expect(screen.queryByText("late failure")).toBeNull();
  });
});
