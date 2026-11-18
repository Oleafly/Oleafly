// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { useTranslation } from "react-i18next";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import { IDLE_TARGET, type MarkdownToolbarState, RESTING_STATE } from "./markdown-model";
import { markdownRow } from "./markdown-toolbar-controls";

function QuoteControl({ state, onQuote }: Readonly<{ state: MarkdownToolbarState; onQuote: () => void }>) {
  const { t } = useTranslation(["common", "editor"]);
  const control = markdownRow({ ...IDLE_TARGET, quote: onQuote }, state, t).find((entry) => entry.id === "quote");
  return <>{control?.render()}</>;
}

beforeAll(async () => {
  await loadNamespace("editor");
});

afterEach(cleanup);

describe("the Markdown toolbar's Quote control", () => {
  it("is on away from a table and off where a quote can't be written", () => {
    const onQuote = vi.fn();
    const { rerender } = render(<QuoteControl state={RESTING_STATE} onQuote={onQuote} />);
    const quote = () => screen.getByRole("button", { name: en.toolbar.insertBlockquote });
    expect(quote()).toBeEnabled();
    quote().click();
    expect(onQuote).toHaveBeenCalledTimes(1);
    rerender(<QuoteControl state={{ ...RESTING_STATE, quotes: false }} onQuote={onQuote} />);
    expect(quote()).toBeDisabled();
  });
});
