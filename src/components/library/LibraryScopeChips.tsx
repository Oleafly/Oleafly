import { useId } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "@/lib/intl";
import { LIBRARY_SCOPES, type LibraryScope } from "@/lib/library-projects";

export function LibraryScopeChips({
  value,
  counts,
  onChange,
}: Readonly<{
  value: LibraryScope;
  counts: Record<LibraryScope, number>;
  onChange: (scope: LibraryScope) => void;
}>) {
  const { t } = useTranslation(["library"]);
  const name = useId();
  const labels: Record<LibraryScope, string> = {
    all: t(($) => $.library.home.scope.all),
    library: t(($) => $.library.home.scope.library),
    folders: t(($) => $.library.home.scope.folders),
  };

  return (
    <fieldset data-testid="library-scope" className="flex flex-wrap items-center gap-1.5">
      <legend className="sr-only">{t(($) => $.library.home.scope.label)}</legend>
      {LIBRARY_SCOPES.map((scope) => (
        <label key={scope} className="relative inline-flex">
          <input
            type="radio"
            name={name}
            value={scope}
            checked={scope === value}
            onChange={() => onChange(scope)}
            className="peer sr-only"
          />
          <span className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-border/70 bg-background/60 px-3 text-xs font-medium text-muted-foreground backdrop-blur-md transition-colors hover:bg-accent/60 hover:text-foreground peer-checked:border-primary/45 peer-checked:bg-primary/15 peer-checked:text-foreground peer-focus-visible:border-primary/70 peer-focus-visible:bg-accent/70 peer-focus-visible:text-foreground">
            <span>{labels[scope]}</span>
            <span className="tabular-nums opacity-70">{formatNumber(counts[scope])}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
