import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, ToolCase } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { openTool } from "@/features/open-tool";
import {
  TOOL_CATEGORY_ORDER,
  TOOL_DEFINITIONS,
  toolCategoryLabel,
  toolDescription,
  toolName,
  toolTags,
  type ToolDefinition,
} from "@/lib/tool-catalog";
import { ToolPageShell } from "@/components/tools/ToolPageShell";

const TOOL_TONES: Record<
  ToolDefinition["tone"],
  { icon: string; badge: string; slash: string }
> = {
  rose: {
    icon: "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    badge: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
    slash: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  violet: {
    icon: "border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    badge: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
    slash: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  emerald: {
    icon: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    slash: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  cyan: {
    icon: "border-cyan-500/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
    badge: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
    slash: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  },
  blue: {
    icon: "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    badge: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    slash: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  sky: {
    icon: "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    badge: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
    slash: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  amber: {
    icon: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    slash: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
};

function ToolCard({ tool }: Readonly<{
  tool: ToolDefinition;
}>) {
  const tone = TOOL_TONES[tool.tone];
  const name = toolName(tool.id);
  const description = toolDescription(tool.id);
  const tags = toolTags(tool.id);
  return (
    <button
      type="button"
      data-testid={`latex-tool-card-${tool.id}`}
      onClick={() => void openTool(tool)}
      className="group flex w-full items-start gap-4 rounded-xl border bg-card p-5 text-left shadow-sm transition-[border-color,background-color,transform,box-shadow] hover:-translate-y-0.5 hover:border-primary/35 hover:bg-accent/25 hover:shadow-md motion-reduce:transform-none"
    >
      <span
        className={cn(
          "flex size-12 shrink-0 items-center justify-center rounded-xl border",
          tone.icon,
        )}
      >
        <tool.icon className="size-5.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold">{name}</span>
          <code className={cn("rounded px-2 py-0.5 text-[10px] font-semibold", tone.slash)}>
            {`/${tool.slash[0]}`}
          </code>
        </span>
        <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
          {description}
        </span>
        <span className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className={cn("rounded-full px-2.5 py-1 text-[10px] font-medium", tone.badge)}
            >
              {tag}
            </span>
          ))}
        </span>
      </span>
    </button>
  );
}

function matchingTools(search: string): readonly ToolDefinition[] {
  const query = search.trim().toLowerCase();
  if (!query) return TOOL_DEFINITIONS;
  return TOOL_DEFINITIONS.filter((tool) =>
    `${toolName(tool.id)} ${toolDescription(tool.id)} ${toolTags(tool.id).join(" ")} ${tool.slash.join(" ")}`
      .toLowerCase()
      .includes(query),
  );
}

function groupByCategory(tools: readonly ToolDefinition[]) {
  const byCategory = new Map<string, ToolDefinition[]>();
  for (const tool of tools) {
    byCategory.set(tool.category, [...(byCategory.get(tool.category) ?? []), tool]);
  }
  return TOOL_CATEGORY_ORDER.filter((category) => byCategory.has(category)).map((category) => ({
    category,
    tools: byCategory.get(category) ?? [],
  }));
}

export function LatexToolsView() {
  const { t } = useTranslation(["common", "researchTools"]);
  const [search, setSearch] = useState("");
  const grouped = groupByCategory(matchingTools(search));

  return (
    <ToolPageShell
      page="tools"
      title={t(($) => $.researchTools.tools.galleryTitle)}
      subtitle={t(($) => $.researchTools.tools.gallerySubtitle)}
      icon={ToolCase}
      showTheme
      testId="latex-tools-view"
    >
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[96rem] px-5 py-6 sm:px-7 lg:px-9">
          <div className="mb-7 flex flex-col gap-4 border-b pb-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                {t(($) => $.researchTools.tools.toolCount, {
                  count: TOOL_DEFINITIONS.length,
                })}
              </p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight">
                {t(($) => $.researchTools.tools.heroTitle)}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t(($) => $.researchTools.tools.heroBody)}
              </p>
            </div>
            <div className="relative w-full lg:w-96">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label={t(($) => $.researchTools.tools.searchAria)}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t(($) => $.researchTools.tools.searchPlaceholder, {
                  total: TOOL_DEFINITIONS.length,
                })}
                className="h-10 pl-9 text-sm"
              />
            </div>
          </div>

          {grouped.length === 0 ? (
            <div className="flex min-h-72 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
              {t(($) => $.researchTools.tools.noMatches)}
            </div>
          ) : (
            <div className="space-y-8">
              {grouped.map(({ category, tools }) => (
                <section key={category} aria-labelledby={`tools-${category}`}>
                  <div className="mb-3 flex items-center gap-3">
                    <h2
                      id={`tools-${category}`}
                      className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                    >
                      {toolCategoryLabel(category)}
                    </h2>
                    <span className="text-xs tabular-nums text-muted-foreground/70">{tools.length}</span>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                    {tools.map((tool) => (
                      <ToolCard key={tool.id} tool={tool} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </main>
    </ToolPageShell>
  );
}
