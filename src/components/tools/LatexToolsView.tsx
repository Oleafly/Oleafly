import { useMemo, useState } from "react";
import { Search, ToolCase } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { openTool } from "@/features/open-tool";
import {
  TOOL_CATEGORY_ORDER,
  TOOL_DEFINITIONS,
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

function ToolCard({ tool }: { tool: ToolDefinition }) {
  const tone = TOOL_TONES[tool.tone];
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
          <span className="text-base font-semibold">{tool.name}</span>
          <code className={cn("rounded px-2 py-0.5 text-[10px] font-semibold", tone.slash)}>
            /{tool.slash[0]}
          </code>
        </span>
        <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
          {tool.description}
        </span>
        <span className="mt-3 flex flex-wrap gap-1.5">
          {tool.tags.map((tag) => (
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

export function LatexToolsView() {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return TOOL_DEFINITIONS;
    return TOOL_DEFINITIONS.filter((tool) =>
      `${tool.name} ${tool.description} ${tool.tags.join(" ")} ${tool.slash.join(" ")}`
        .toLowerCase()
        .includes(query),
    );
  }, [search]);
  const grouped = useMemo(() => {
    const byCategory = new Map<string, ToolDefinition[]>();
    for (const tool of filtered) {
      byCategory.set(tool.category, [...(byCategory.get(tool.category) ?? []), tool]);
    }
    return TOOL_CATEGORY_ORDER.filter((category) => byCategory.has(category)).map((category) => ({
      category,
      tools: byCategory.get(category) ?? [],
    }));
  }, [filtered]);

  return (
    <ToolPageShell
      page="tools"
      title="Oleafly Tools"
      subtitle="Quick, project-independent tools for research writing"
      icon={ToolCase}
      showTheme
      testId="latex-tools-view"
    >
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[96rem] px-5 py-6 sm:px-7 lg:px-9">
          <div className="mb-7 flex flex-col gap-4 border-b pb-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                {TOOL_DEFINITIONS.length} tools
              </p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight">Convert, check, and keep moving</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Converters work without creating a project. Copy the result, save it, or open it in
                Oleafly when you are ready.
              </p>
            </div>
            <div className="relative w-full lg:w-96">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search Oleafly Tools"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={`Search ${TOOL_DEFINITIONS.length} tools or commands`}
                className="h-10 pl-9 text-sm"
              />
            </div>
          </div>

          {grouped.length === 0 ? (
            <div className="flex min-h-72 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
              No tools match “{search.trim()}”.
            </div>
          ) : (
            <div className="space-y-8">
              {grouped.map(({ category, tools }) => (
                <section key={category} aria-labelledby={`tools-${category.toLowerCase()}`}>
                  <div className="mb-3 flex items-center gap-3">
                    <h2
                      id={`tools-${category.toLowerCase()}`}
                      className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                    >
                      {category}
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
