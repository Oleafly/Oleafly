// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import type { EvidenceItem, EvidenceReport } from "@/lib/research-tasks";
import { EvidenceChecklist, evidenceItemText } from "./EvidenceChecklist";

const evidence = enResearchTools.evidence;

function item(code: string, params: Record<string, string> = {}, file: string | null = null, line: number | null = null): EvidenceItem {
  return { code, file, line, params };
}

function report(): EvidenceReport {
  return {
    checkedAt: 1,
    checks: [
      { id: "build", status: "warn", items: [item("build.failed", { errors: "3" }, "main.tex", 12)] },
      { id: "references", status: "skipped", items: [item("references.notChecked")] },
      { id: "bibliography", status: "pass", items: [] },
      {
        id: "numbers",
        status: "warn",
        items: [item("numbers.mismatch", { value: "0.92", run: "r002", recorded: "0.913" }, "results.tex")],
      },
      { id: "figures", status: "warn", items: [item("figures.unused", { path: "figures/new.png" })] },
    ],
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("EvidenceChecklist", () => {
  it("renders each check with its status and localized items", () => {
    render(<EvidenceChecklist report={report()} checking={false} onRefresh={vi.fn(async () => {})} />);

    const section = screen.getByTestId("research-evidence");
    expect(within(section).getByRole("heading", { name: evidence.title })).toBeInTheDocument();
    expect(section).toHaveTextContent(evidence.hint);
    const rows = within(section).getAllByRole("listitem").filter((row) => row.parentElement?.classList.contains("divide-y"));
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent(evidence.checks.build);
    expect(rows[0]).toHaveTextContent(evidence.status.warn);
    expect(rows[0]).toHaveTextContent("The build failed with 3 errors.");
    expect(rows[0]).toHaveTextContent("main.tex:12");
    expect(rows[1]).toHaveTextContent(evidence.checks.references);
    expect(rows[1]).toHaveTextContent(evidence.status.skipped);
    expect(rows[1]).toHaveTextContent(evidence.items.referencesNotChecked);
    expect(rows[2]).toHaveTextContent(evidence.checks.bibliography);
    expect(rows[2]).toHaveTextContent(evidence.status.pass);
    expect(within(rows[2]).queryAllByRole("listitem")).toHaveLength(0);
    expect(rows[3]).toHaveTextContent(evidence.checks.numbers);
    expect(rows[3]).toHaveTextContent("0.92 doesn't match run r002 (0.913).");
    expect(within(rows[3]).getByText("results.tex")).toBeInTheDocument();
    expect(rows[4]).toHaveTextContent(evidence.checks.figures);
    expect(rows[4]).toHaveTextContent("figures/new.png isn't used in the document.");
    expect(screen.getByRole("button", { name: evidence.refresh })).toBeEnabled();
  });

  it("check again calls the refresh command and shows it is checking", async () => {
    const pending = deferred();
    const onRefresh = vi.fn(() => pending.promise);
    render(<EvidenceChecklist report={report()} checking={false} onRefresh={onRefresh} />);

    await userEvent.click(screen.getByRole("button", { name: evidence.refresh }));

    expect(onRefresh).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: evidence.running })).toBeDisabled();
    await act(async () => pending.resolve());
    expect(screen.getByRole("button", { name: evidence.refresh })).toBeEnabled();
  });

  it("lets the user check again after a refresh fails", async () => {
    const pending = deferred();
    const onRefresh = vi.fn((): Promise<void> => pending.promise);
    render(<EvidenceChecklist report={null} checking={false} onRefresh={onRefresh} />);

    await userEvent.click(screen.getByRole("button", { name: evidence.refresh }));
    expect(screen.getByTestId("research-evidence")).toHaveTextContent(evidence.running);
    await act(async () => pending.reject(new Error("The task workspace is gone.")));

    await waitFor(() => expect(screen.getByRole("button", { name: evidence.refresh })).toBeEnabled());
    expect(screen.getByRole("alert")).toHaveTextContent("The task workspace is gone.");

    onRefresh.mockResolvedValueOnce(undefined);
    await userEvent.click(screen.getByRole("button", { name: evidence.refresh }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("says it is checking while the backend checks, and still lets the user check again", async () => {
    const onRefresh = vi.fn(async () => {});
    const view = render(<EvidenceChecklist report={null} checking onRefresh={onRefresh} />);
    const section = screen.getByTestId("research-evidence");
    expect(within(section).getByRole("status")).toHaveTextContent(evidence.running);
    expect(within(section).queryByRole("list")).toBeNull();
    await userEvent.click(within(section).getByRole("button", { name: evidence.refresh }));
    expect(onRefresh).toHaveBeenCalledOnce();

    view.rerender(<EvidenceChecklist report={null} checking={false} onRefresh={onRefresh} />);
    expect(within(section).getAllByText(evidence.refresh)).toHaveLength(1);
    expect(within(section).queryByText(evidence.running)).toBeNull();
  });

  it("says when no check has run, so it doesn't read as one that failed", () => {
    render(<EvidenceChecklist report={null} checking={false} onRefresh={vi.fn(async () => {})} />);

    expect(screen.getByTestId("research-evidence")).toHaveTextContent(evidence.empty);
  });

  it("shows at most fifty findings for one check", () => {
    const many: EvidenceReport = {
      checkedAt: 1,
      checks: [
        {
          id: "bibliography",
          status: "warn",
          items: Array.from({ length: 60 }, (_, index) => item("bib.unverified", { key: `key${index}` })),
        },
      ],
    };
    render(<EvidenceChecklist report={many} checking={false} onRefresh={vi.fn(async () => {})} />);

    expect(screen.getByText("key0 couldn't be verified.")).toBeInTheDocument();
    expect(screen.getByText("key49 couldn't be verified.")).toBeInTheDocument();
    expect(screen.queryByText("key50 couldn't be verified.")).toBeNull();
    expect(screen.getByTestId("research-evidence-more")).toHaveTextContent("10 more aren't listed.");
  });
});

describe("evidenceItemText", () => {
  const items = evidence.items;

  it("words every finding with its parameters", () => {
    expect(evidenceItemText(item("build.failed", { errors: "2" }))).toBe("The build failed with 2 errors.");
    expect(evidenceItemText(item("build.skipped", { reason: "The command-line tool isn't available." }))).toBe(
      "The build wasn't checked: The command-line tool isn't available.",
    );
    expect(evidenceItemText(item("references.unresolved", { key: "fig:missing" }))).toBe("fig:missing doesn't resolve.");
    expect(evidenceItemText(item("references.notChecked"))).toBe(items.referencesNotChecked);
    expect(evidenceItemText(item("bib.unverified", { key: "smith2020" }))).toBe("smith2020 couldn't be verified.");
    expect(evidenceItemText(item("bib.titleMismatch", { key: "smith2020", found: "Another paper" }))).toBe(
      "smith2020 points to a different title: Another paper",
    );
    expect(evidenceItemText(item("bib.lookupFailed", { key: "smith2020" }))).toBe(
      "smith2020 couldn't be looked up. Try again later.",
    );
    expect(evidenceItemText(item("numbers.mismatch", { value: "91.3", run: "r004", recorded: "0.9" }))).toBe(
      "91.3 doesn't match run r004 (0.9).",
    );
    expect(evidenceItemText(item("numbers.unknownRun", { run: "r009" }))).toBe("Run r009 doesn't exist.");
    expect(evidenceItemText(item("numbers.noLedgerRow", { run: "r003" }))).toBe("Run r003 has no ledger row.");
    expect(evidenceItemText(item("figures.missing", { path: "figures/a.png" }))).toBe(
      "figures/a.png is referenced but missing.",
    );
    expect(evidenceItemText(item("figures.unused", { path: "figures/b.png" }))).toBe(
      "figures/b.png isn't used in the document.",
    );
  });

  it("leaves a missing parameter blank instead of failing", () => {
    expect(evidenceItemText(item("build.failed"))).toBe("The build failed with  errors.");
    expect(evidenceItemText(item("build.skipped"))).toBe("The build wasn't checked: ");
    expect(evidenceItemText(item("references.unresolved"))).toBe(" doesn't resolve.");
    expect(evidenceItemText(item("bib.unverified"))).toBe(" couldn't be verified.");
    expect(evidenceItemText(item("bib.titleMismatch"))).toBe(" points to a different title: ");
    expect(evidenceItemText(item("bib.lookupFailed"))).toBe(" couldn't be looked up. Try again later.");
    expect(evidenceItemText(item("numbers.mismatch"))).toBe(" doesn't match run  ().");
    expect(evidenceItemText(item("numbers.unknownRun"))).toBe("Run  doesn't exist.");
    expect(evidenceItemText(item("numbers.noLedgerRow"))).toBe("Run  has no ledger row.");
    expect(evidenceItemText(item("figures.missing"))).toBe(" is referenced but missing.");
    expect(evidenceItemText(item("figures.unused"))).toBe(" isn't used in the document.");
  });

  it("shows an unknown finding code as it is", () => {
    expect(evidenceItemText(item("tables.empty", { path: "a.tex" }))).toBe("tables.empty");
  });
});
