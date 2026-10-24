import { beforeEach, describe, expect, it } from "vitest";
import { useAcpSessionsStore, type AcpSelection } from "@/store/acp-sessions";
import { settleSelectionQuotes, syncSelectionQuote, unsettleSelectionQuote } from "./selection-quote";

function selection(label: string, text = "selected text"): AcpSelection {
  return { id: `selection-${label}`, path: "chapters/main.tex", text, label };
}

function quotes(): string[] {
  return (useAcpSessionsStore.getState().composers.paper?.selections ?? []).map((entry) => entry.label);
}

beforeEach(() => {
  useAcpSessionsStore.setState({ composers: { paper: { agentId: "claude", selections: [] } } });
  syncSelectionQuote("paper", null);
});

describe("the editor selection quote", () => {
  it("quotes the current selection once and follows it as it changes", () => {
    syncSelectionQuote("paper", selection("main.tex:25-26"));
    syncSelectionQuote("paper", selection("main.tex:25-26"));
    expect(quotes()).toEqual(["main.tex:25-26"]);

    syncSelectionQuote("paper", selection("main.tex:30-31", "other text"));
    expect(quotes()).toEqual(["main.tex:30-31"]);

    syncSelectionQuote("paper", null);
    expect(quotes()).toEqual([]);
  });

  it("does not quote a sent selection again until the selection changes", () => {
    const sent = selection("main.tex:25-26");
    syncSelectionQuote("paper", sent);
    settleSelectionQuotes("paper", quotesOf());
    useAcpSessionsStore.getState().setComposer("paper", { selections: [] });

    syncSelectionQuote("paper", selection("main.tex:25-26"));
    expect(quotes()).toEqual([]);

    syncSelectionQuote("paper", selection("main.tex:27-28", "new text"));
    expect(quotes()).toEqual(["main.tex:27-28"]);
  });

  it("quotes the same text again after the selection was cleared and made again", () => {
    syncSelectionQuote("paper", selection("main.tex:25-26"));
    settleSelectionQuotes("paper", quotesOf());
    syncSelectionQuote("paper", null);

    syncSelectionQuote("paper", selection("main.tex:25-26"));
    expect(quotes()).toEqual(["main.tex:25-26"]);
  });

  it("keeps a removed quote out, and lets a failed send's quote back in", () => {
    const removed = selection("main.tex:25-26");
    syncSelectionQuote("paper", removed);
    settleSelectionQuotes("paper", [removed]);
    syncSelectionQuote("paper", removed);
    expect(quotes()).toEqual([]);

    unsettleSelectionQuote("paper");
    syncSelectionQuote("paper", removed);
    expect(quotes()).toEqual(["main.tex:25-26"]);
  });
});

function quotesOf(): AcpSelection[] {
  return useAcpSessionsStore.getState().composers.paper?.selections ?? [];
}
