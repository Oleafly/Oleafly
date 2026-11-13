import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FindBar } from "@/components/ui/find-bar";
import { formatNumber } from "@/lib/intl";

export interface TerminalSearch {
  findNext(term: string, incremental?: boolean): boolean;
  findPrevious(term: string): boolean;
  clear(): void;
  onResults(listener: (index: number, count: number) => void): () => void;
}

export default function TerminalFindBar({
  search,
  onClose,
}: Readonly<{ search: TerminalSearch; onClose(): void }>) {
  const { t } = useTranslation(["common", "workspace"]);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<{ index: number; count: number } | null>(null);

  useEffect(() => search.onResults((index, count) => setResults({ index, count })), [search]);

  useEffect(() => () => search.clear(), [search]);

  const find = (value: string, direction: "next" | "previous" | "typing") => {
    if (!value) {
      search.clear();
      setResults(null);
      return;
    }
    if (direction === "previous") search.findPrevious(value);
    else search.findNext(value, direction === "typing");
  };

  let status = "";
  if (term && results) {
    if (results.count === 0) status = t(($) => $.workspace.terminal.find.none);
    else
      status = t(($) => $.workspace.terminal.find.count, {
        current: results.index >= 0 ? formatNumber(results.index + 1) : "…",
        total: formatNumber(results.count),
      });
  }

  return (
    <FindBar
      data-terminal-find=""
      className="absolute right-3 top-2 z-10"
      focusOnMount
      value={term}
      onValueChange={(value) => {
        setTerm(value);
        find(value, "typing");
      }}
      inputLabel={t(($) => $.workspace.terminal.find.label)}
      status={status}
      onStep={(forward) => find(term, forward ? "next" : "previous")}
      onClose={onClose}
      labels={{
        previous: t(($) => $.workspace.terminal.find.previous),
        next: t(($) => $.workspace.terminal.find.next),
        close: t(($) => $.common.actions.close),
      }}
    />
  );
}
