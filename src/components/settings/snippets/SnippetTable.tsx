import { useTranslation } from "react-i18next";
import { ChevronDown, Plus } from "lucide-react";
import { EXPANDS, type Expand, SNIPPET_LANGUAGES, type SnippetLanguage, type SnippetRecord } from "@oleafly/snippets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SearchField } from "@/components/ui/search-field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { expandLabel, languageLabel, placeLabel, snippetName } from "@/features/snippets/records";

export type SnippetStatus = "modified" | "off" | null;

export interface SnippetRow {
  record: SnippetRecord;
  status: SnippetStatus;
}

export interface SnippetFilters {
  query: string;
  language: SnippetLanguage | null;
  expand: Expand | null;
}

const ANY = "any";

function FilterMenu<Value extends string>({
  label,
  anyLabel,
  value,
  options,
  optionLabel,
  onChange,
}: Readonly<{
  label: string;
  anyLabel: string;
  value: Value | null;
  options: readonly Value[];
  optionLabel: (value: Value) => string;
  onChange: (value: Value | null) => void;
}>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="xs" aria-label={label}>
          {value === null ? label : optionLabel(value)}
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[100]">
        <DropdownMenuRadioGroup
          value={value ?? ANY}
          onValueChange={(next) => onChange(next === ANY ? null : (next as Value))}
        >
          <DropdownMenuRadioItem value={ANY}>{anyLabel}</DropdownMenuRadioItem>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {optionLabel(option)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Languages({ record }: Readonly<{ record: SnippetRecord }>) {
  const languages = record.languages === "any" ? (["any"] as const) : record.languages;
  return (
    <span className="flex flex-wrap gap-1">
      {languages.map((language) => (
        <Badge key={language} variant="muted" size="sm">
          {languageLabel(language)}
        </Badge>
      ))}
    </span>
  );
}

export function SnippetTable({
  rows,
  total,
  filters,
  onFiltersChange,
  onEdit,
  onRestore,
  onNew,
}: Readonly<{
  rows: readonly SnippetRow[];
  total: number;
  filters: SnippetFilters;
  onFiltersChange: (filters: SnippetFilters) => void;
  onEdit: (record: SnippetRecord) => void;
  onRestore: (record: SnippetRecord) => void;
  onNew: () => void;
}>) {
  const { t } = useTranslation(["settings"]);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          value={filters.query}
          onChange={(query) => onFiltersChange({ ...filters, query })}
          label={t(($) => $.settings.snippets.library.search)}
          placeholder={t(($) => $.settings.snippets.library.search)}
          clearOnEscape
          className="min-w-40 flex-1"
        />
        <FilterMenu
          label={t(($) => $.settings.snippets.library.language)}
          anyLabel={t(($) => $.settings.snippets.library.allLanguages)}
          value={filters.language}
          options={SNIPPET_LANGUAGES}
          optionLabel={languageLabel}
          onChange={(language) => onFiltersChange({ ...filters, language })}
        />
        <FilterMenu
          label={t(($) => $.settings.snippets.library.expands)}
          anyLabel={t(($) => $.settings.snippets.library.anyExpand)}
          value={filters.expand}
          options={EXPANDS}
          optionLabel={expandLabel}
          onChange={(expand) => onFiltersChange({ ...filters, expand })}
        />
        <Button type="button" size="xs" onClick={onNew}>
          <Plus aria-hidden />
          {t(($) => $.settings.snippets.library.newSnippet)}
        </Button>
      </div>
      <Table containerClassName="max-h-[28rem] rounded-md border">
        <TableHeader>
          <TableRow>
            <TableHead>{t(($) => $.settings.snippets.library.columns.trigger)}</TableHead>
            <TableHead>{t(($) => $.settings.snippets.library.columns.name)}</TableHead>
            <TableHead>{t(($) => $.settings.snippets.library.columns.languages)}</TableHead>
            <TableHead>{t(($) => $.settings.snippets.library.columns.where)}</TableHead>
            <TableHead>{t(($) => $.settings.snippets.library.columns.expands)}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ record, status }) => {
            const name = snippetName(record);
            return (
              <TableRow key={`${record.collection}\u0000${record.id}`} data-testid="snippet-row" className={status === "off" ? "opacity-60" : undefined}>
                <TableCell className="font-mono">
                  <button type="button" className="-mx-1 rounded-sm px-1 text-left hover:bg-primary/10 focus-visible:bg-primary/10" onClick={() => onEdit(record)}>
                    {record.trigger ?? t(($) => $.settings.snippets.library.noTrigger)}
                  </button>
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span>{name}</span>
                    {record.wraps ? (
                      <Badge variant="info" size="sm">
                        {t(($) => $.settings.snippets.library.wraps)}
                      </Badge>
                    ) : null}
                    {status === "modified" ? (
                      <Badge variant="warning" size="sm">
                        {t(($) => $.settings.snippets.library.modified)}
                      </Badge>
                    ) : null}
                    {status === "off" ? (
                      <Badge variant="muted" size="sm">
                        {t(($) => $.settings.snippets.library.turnedOff)}
                      </Badge>
                    ) : null}
                    {status ? (
                      <Button
                        type="button"
                        variant="link"
                        size="xs"
                        className="h-auto p-0"
                        aria-label={t(($) => $.settings.snippets.library.restoreLabel, { name })}
                        onClick={() => onRestore(record)}
                      >
                        {t(($) => $.settings.snippets.library.restore)}
                      </Button>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell>
                  <Languages record={record} />
                </TableCell>
                <TableCell>{placeLabel(record.place)}</TableCell>
                <TableCell>{expandLabel(record.expand)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {rows.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">{t(($) => $.settings.snippets.library.noMatches)}</p>
      ) : null}
      <p className="px-1 text-right text-xs text-muted-foreground">
        {t(($) => $.settings.snippets.library.shown, { shown: rows.length, total })}
      </p>
    </div>
  );
}
