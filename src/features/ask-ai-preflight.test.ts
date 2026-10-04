import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Finding } from "@oleafly/preflight";

const mocks = vi.hoisted(() => ({
  ensure: vi.fn(async () => true),
  handoff: vi.fn(),
}));

vi.mock("@/features/assistant-handoff", () => ({
  ensureAiProviderOrOpenSettings: mocks.ensure,
  handoffToAssistant: mocks.handoff,
}));

import preflight from "@/i18n/locales/en/preflight.json" with { type: "json" };
import { askAiAboutFinding, askAiAboutFindings } from "./ask-ai-preflight";

const rules = preflight.rules;

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    lens: "ats",
    severity: "error",
    title: { key: "rules.multi-column.titleTwoColumn" },
    detail: { key: "rules.multi-column.detailTwoColumn" },
    ...overrides,
  } as Finding;
}

function prompt(): string {
  expect(mocks.handoff).toHaveBeenCalledOnce();
  expect(mocks.handoff.mock.calls[0][1]).toEqual({ autoSend: false });
  return mocks.handoff.mock.calls[0][0] as string;
}

beforeEach(() => {
  mocks.handoff.mockClear();
  mocks.ensure.mockReset().mockResolvedValue(true);
});

describe("asking the assistant about preflight findings", () => {
  it("describes one finding with its file, page and English detail", async () => {
    await askAiAboutFinding(finding({ file: "cv.tex", page: 2 }));

    const text = prompt();
    expect(text).toContain("Fix this preflight finding in the current document.");
    expect(text).toContain(`- [Error] ${rules["multi-column"].titleTwoColumn} (cv.tex, p.2)`);
    expect(text).toContain(`  ${rules["multi-column"].detailTwoColumn}`);
  });

  it("names the page alone when the finding has no file, and nothing when it has neither", async () => {
    await askAiAboutFinding(finding({ severity: "warning", page: 4 }));
    expect(prompt()).toContain(`- [Warning] ${rules["multi-column"].titleTwoColumn} (p.4)\n`);

    mocks.handoff.mockClear();
    await askAiAboutFinding(finding({ severity: "info" as Finding["severity"], file: "cv.tex" }));
    expect(prompt()).toContain(`- [Note] ${rules["multi-column"].titleTwoColumn} (cv.tex)\n`);
  });

  it("stops when no AI provider is configured", async () => {
    mocks.ensure.mockResolvedValue(false);

    await askAiAboutFinding(finding());
    await askAiAboutFindings([finding(), finding({ id: "f2" })]);

    expect(mocks.handoff).not.toHaveBeenCalled();
  });

  it("does nothing for an empty list and asks about a single finding directly", async () => {
    await askAiAboutFindings([]);
    expect(mocks.handoff).not.toHaveBeenCalled();

    await askAiAboutFindings([finding()]);
    expect(prompt()).toContain("Fix this preflight finding in the current document.");
  });

  it("lists several findings in one request", async () => {
    await askAiAboutFindings([
      finding(),
      finding({ id: "f2", severity: "warning", title: { key: "rules.icon-near-contact.title" }, file: "cv.tex" }),
    ]);

    const text = prompt();
    expect(text).toContain("Fix the following preflight findings in the current document.");
    expect(text).toContain(`- [Error] ${rules["multi-column"].titleTwoColumn}\n`);
    expect(text).toContain(`- [Warning] ${rules["icon-near-contact"].title} (cv.tex)`);
    expect(text).toContain("re-run preflight to verify each is resolved");
  });
});
