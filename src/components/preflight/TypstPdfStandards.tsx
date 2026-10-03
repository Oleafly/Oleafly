import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileCheck2, Info } from "lucide-react";
import type { TypstOptionsDescriptor } from "@oleafly/backend-port";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { exportCurrentTypst } from "@/features/export";
import { typstArchivalStandards, typstStandardLabel, typstTagsPdfByDefault } from "@/lib/typst-options";

export function TypstPdfStandards({
  options,
  version,
}: Readonly<{ options: TypstOptionsDescriptor; version: string | null }>) {
  const { t } = useTranslation(["preflight"]);
  const standards = typstArchivalStandards(options);
  const [chosen, setChosen] = useState<string | null>(null);
  const standard = chosen && standards.includes(chosen) ? chosen : (standards[0] ?? null);
  const label = version ?? "";
  return (
    <div
      data-testid="typst-pdf-standards"
      className="mx-3 mb-4 rounded-md border border-sidebar-border bg-black/[0.03] px-2.5 py-2 dark:bg-background"
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {t(($) => $.preflight.typstStandards.title)}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        {t(($) => $.preflight.typstStandards.intro)}
      </p>
      <p className="mt-2 flex items-start gap-1 text-[11px] leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
        <span>
          {typstTagsPdfByDefault(version)
            ? t(($) => $.preflight.typstStandards.tagged, { version: label })
            : t(($) => $.preflight.typstStandards.untagged, { version: label })}
        </span>
      </p>
      {standard ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Select value={standard} onValueChange={setChosen}>
            <SelectTrigger
              className="h-7 w-32 text-xs"
              aria-label={t(($) => $.preflight.typstStandards.standard)}
              data-testid="typst-pdf-standard"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {standards.map((value) => (
                <SelectItem key={value} value={value}>
                  {typstStandardLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            data-testid="typst-pdf-standard-export"
            onClick={() => void exportCurrentTypst({ format: "pdf", pdfStandard: standard })}
            className="inline-flex items-center gap-1.5 rounded border border-input px-2 py-1 text-xs hover:bg-accent focus-visible:bg-accent"
          >
            <FileCheck2 className="size-3.5" /> {t(($) => $.preflight.typstStandards.export)}
          </button>
        </div>
      ) : (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {t(($) => $.preflight.typstStandards.none, { version: label })}
        </p>
      )}
      {standard === "ua-1" && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {t(($) => $.preflight.typstStandards.uaNote)}
        </p>
      )}
    </div>
  );
}
