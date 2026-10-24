import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { formatNumber } from "@/lib/intl";

/** What the find bar needs from xterm's search addon. */
export interface TerminalSearch {
  /** `incremental` keeps extending the current match while the user types. */
  findNext(term: string, incremental?: boolean): boolean;
  findPrevious(term: string): boolean;
  clear(): void;
  /** Reports the active match index (-1 above the highlight limit) and the match count. */
  onResults(listener: (index: number, count: number) => void): () => void;
}

const iconButtonClass = "size-7 text-muted-foreground hover:text-foreground";

/** Find in the terminal's output: Enter and Shift+Enter step, Escape closes. */
export default function TerminalFindBar({
  search,
  onClose,
}: Readonly<{ search: TerminalSearch; onClose(): void }>) {
  const { t } = useTranslation(["common", "workspace"]);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<{ index: number; count: number } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
    <div
      data-terminal-find=""
      className="absolute right-3 top-2 z-10 flex items-center gap-1 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      <Input
        ref={inputRef}
        aria-label={t(($) => $.workspace.terminal.find.label)}
        placeholder={t(($) => $.workspace.terminal.find.label)}
        value={term}
        spellCheck={false}
        onChange={(event) => {
          setTerm(event.target.value);
          find(event.target.value, "typing");
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key !== "Enter") return;
          // Enter that ends an IME composition belongs to the IME.
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          find(term, event.shiftKey ? "previous" : "next");
        }}
        className="h-7 w-44 text-xs"
      />
      <span
        aria-live="polite"
        data-testid="terminal-find-status"
        className="min-w-16 px-1 text-center text-xs tabular-nums text-muted-foreground"
      >
        {status}
      </span>
      <Tooltip label={t(($) => $.workspace.terminal.find.previous)} side="bottom">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={iconButtonClass}
          aria-label={t(($) => $.workspace.terminal.find.previous)}
          onClick={() => find(term, "previous")}
        >
          <ChevronUp aria-hidden />
        </Button>
      </Tooltip>
      <Tooltip label={t(($) => $.workspace.terminal.find.next)} side="bottom">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={iconButtonClass}
          aria-label={t(($) => $.workspace.terminal.find.next)}
          onClick={() => find(term, "next")}
        >
          <ChevronDown aria-hidden />
        </Button>
      </Tooltip>
      <Tooltip label={t(($) => $.common.actions.close)} side="bottom">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={iconButtonClass}
          aria-label={t(($) => $.common.actions.close)}
          onClick={onClose}
        >
          <X aria-hidden />
        </Button>
      </Tooltip>
    </div>
  );
}
